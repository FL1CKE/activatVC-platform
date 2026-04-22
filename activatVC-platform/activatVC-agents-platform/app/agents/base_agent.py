"""
Base Agent — сердце системы.

Все 5 агентов (CLO, CFO, CHRO, CMO+CCO, CPO+CTO) — это один и тот же класс,
инстанциированный с разными конфигами из БД.

Жизненный цикл одного запуска агента:
1. load_prompt()          — читает актуальный промпт из БД
2. fetch_startup_data()   — скачивает данные стартапа (реальные или мок)
3. download_documents()   — скачивает и парсит файлы
4. build_messages()       — собирает messages для LLM
5. run_llm()              — вызывает LLM
6. submit_result()        — отправляет отчёт в Master Agent API
7. save_to_db()           — сохраняет результат в нашу БД
"""
import asyncio
import logging
import re
import time
from datetime import datetime, UTC

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.agents.llm_client import create_llm_provider, LLMMessage, LLMResponse
from app.agents.document_parser import extract_text
from app.external.master_agent_client import MasterAgentClient, MasterAgentError
from app.models.agent import Agent, AgentPrompt
from app.models.run import AnalysisRun, AgentTask, TaskStatus, MissingDataRequest, MissingDataStatus
from app.models.chat import ChatMessage, MessageRole
from app.core.config import settings

logger = logging.getLogger(__name__)


def _normalize_doc_label(value: str) -> str:
    """Normalizes doc labels so camelCase/snake_case/hyphen variants compare consistently."""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


DOC_REQUIREMENT_EQUIVALENTS: dict[str, set[str]] = {
    "financialmodel": {
        "financialmodel",
        "financialsummary",
        "pnl",
        "profitandloss",
    },
    # Burn/rate metrics are often embedded in the financial model for early-stage startups.
    "burnratereport": {
        "burnratereport",
        "burnrate",
        "runwayreport",
        "cashflowreport",
        "financialmodel",
    },
}


class AgentRunContext:
    """
    Контекст одного запуска агента.
    Передаётся между методами вместо множества параметров.
    """
    def __init__(
        self,
        task_id: int,
        application_id: str,
        agent: Agent,
        prompt: AgentPrompt,
        use_mock: bool = False,
        extra_context: dict | None = None,
    ):
        self.task_id = task_id
        self.application_id = application_id
        self.agent = agent
        self.prompt = prompt
        self.use_mock = use_mock

        # Заполняется в процессе выполнения
        self.startup_data: dict = {}
        self.documents_text: list[dict] = []   # [{"name": ..., "text": ...}]
        self.llm_response: LLMResponse | None = None
        self.started_at = datetime.utcnow()
        self.relay_request: dict | None = None
        self.relay_answer: dict | None = None
        self.sync_to_master: bool = not use_mock

        # Дополнительный контекст от оркестратора (например, faa_signal для CHRO)
        self.extra_context: dict = extra_context or {}


class BaseAgent:
    """
    Универсальный агент. Не наследуется для каждой роли —
    конфигурируется через AgentConfig из БД.
    """

    def __init__(
        self,
        db: AsyncSession,
        master_client: MasterAgentClient | None = None,
    ):
        self.db = db
        self.master_client = master_client or MasterAgentClient()

    @property
    def _is_standalone_mode(self) -> bool:
        return settings.ORCHESTRATION_MODE.lower() == "standalone"

    async def run(
        self,
        task_id: int,
        application_id: str,
        use_mock: bool = False,
        extra_context: dict | None = None,
    ) -> None:
        """
        Точка входа. Оркестратор вызывает этот метод.
        Все исключения перехватываем здесь — агент никогда не роняет весь процесс.

        extra_context — дополнительные данные от оркестратора:
          {"faa_signal": "<JSON-строка>"} для агента CHRO, если FAA выполнился.
        """
        logger.info(f"[Task {task_id}] Starting agent run for application {application_id}")

        # Помечаем задачу как запущенную
        await self._update_task_status(task_id, TaskStatus.RUNNING)

        try:
            # 1. Загружаем конфиг агента и промпт
            agent, prompt = await self._load_agent_config(task_id)
            if not agent or not prompt:
                raise ValueError(f"Agent or prompt not found for task {task_id}")

            ctx = AgentRunContext(
                task_id=task_id,
                application_id=application_id,
                agent=agent,
                prompt=prompt,
                use_mock=use_mock,
                extra_context=extra_context,
            )

            # 2. Получаем данные стартапа
            await self._fetch_startup_data(ctx)

            # 3. Скачиваем и парсим документы
            await self._download_documents(ctx)

            # 4. Проверяем — нужны ли дополнительные данные
            missing = self._check_missing_data(ctx)
            if missing:
                await self._handle_needs_info(ctx, missing)
                return

            # 5. Строим промпт и вызываем LLM
            messages = self._build_messages(ctx)
            try:
                ctx.llm_response = await self._run_llm(ctx, messages)
            except Exception as llm_exc:
                err_s = str(llm_exc)
                is_timeout_or_overload = (
                    "timeout" in err_s.lower() or
                    "timed out" in err_s.lower() or
                    "overloaded" in err_s.lower() or
                    "529" in err_s
                )
                if is_timeout_or_overload:
                    logger.warning(
                        f"[Task {task_id}] [{ctx.agent.role}] LLM timed out / overloaded — "
                        f"saving partial result instead of failing"
                    )
                    from app.agents.llm_client import LLMResponse as _LLMResp
                    ctx.llm_response = _LLMResp(
                        content=(
                            f"⚠️ Анализ не завершён — превышено время ожидания ответа от LLM.\n\n"
                            f"Агент **{ctx.agent.role}** не успел завершить анализ за отведённое время. "
                            f"Рекомендуется перезапустить анализ.\n\n"
                            f"Техническая информация: {err_s[:300]}"
                        ),
                        model="partial",
                        tokens_used=0,
                        provider="partial",
                    )
                else:
                    raise

            # 6. Отправляем результат в Master Agent
            await self._submit_completed(ctx)

            # 7. Сохраняем в БД
            await self._save_completed(ctx)

            logger.info(
                f"[Task {task_id}] [{agent.role}] Completed. "
                f"Tokens: {ctx.llm_response.tokens_used}, "
                f"Time: {(datetime.utcnow() - ctx.started_at).seconds}s"
            )

        except MasterAgentError as e:
            logger.error(f"[Task {task_id}] Master Agent API error: {e}")
            await self._save_failed(task_id, str(e))

        except Exception as e:
            logger.exception(f"[Task {task_id}] Unexpected error: {e}")
            await self._save_failed(task_id, str(e))

    # ─── Private methods ───────────────────────────────────────────────────────

    async def _load_agent_config(self, task_id: int) -> tuple[Agent | None, AgentPrompt | None]:
        """Загружаем агента и его активный промпт через task_id."""
        result = await self.db.execute(
            select(AgentTask).where(AgentTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            return None, None

        result = await self.db.execute(
            select(Agent).where(Agent.id == task.agent_id)
        )
        agent = result.scalar_one_or_none()
        if not agent:
            return None, None

        # Берём зафиксированную версию промпта (сохранённую в момент создания задачи)
        # Это гарантирует воспроизводимость — даже если промпт обновили во время анализа
        if task.prompt_version_id:
            result = await self.db.execute(
                select(AgentPrompt).where(AgentPrompt.id == task.prompt_version_id)
            )
            prompt = result.scalar_one_or_none()
        else:
            # Фолбэк на активный промпт
            result = await self.db.execute(
                select(AgentPrompt).where(
                    AgentPrompt.agent_id == agent.id,
                    AgentPrompt.is_active == True,  # noqa: E712
                )
            )
            prompt = result.scalar_one_or_none()

        return agent, prompt

    async def _fetch_startup_data(self, ctx: AgentRunContext) -> None:
        """Получает данные стартапа — из мока или реального API."""
        if ctx.use_mock:
            from app.external.mock_data import get_mock_startup
            data = get_mock_startup(ctx.application_id)
            if not data:
                raise ValueError(f"Mock startup not found: {ctx.application_id}")
            ctx.startup_data = data
            ctx.sync_to_master = False
        elif self._is_standalone_mode:
            result = await self.db.execute(
                select(AnalysisRun)
                .join(AgentTask, AgentTask.run_id == AnalysisRun.id)
                .where(AgentTask.id == ctx.task_id)
            )
            run = result.scalar_one_or_none()
            if run and run.startup_data_json:
                ctx.startup_data = run.startup_data_json
                # Local standalone run with embedded payload does not require
                # callback sync to Master API.
                ctx.sync_to_master = False
                return

            # Compatibility fallback: if standalone run was triggered from webhook
            # without embedded startup_data, pull data from Master API.
            logger.warning(
                "[Task %s] standalone mode without startup_data for %s; "
                "falling back to Master API fetch",
                ctx.task_id,
                ctx.application_id,
            )
            ctx.startup_data = await self.master_client.fetch_startup_data(
                ctx.application_id,
                agent_name=ctx.agent.role,
            )
            # Standalone webhook-triggered runs still need callback sync.
            ctx.sync_to_master = True
            relay_request = ctx.startup_data.get("relayRequest")
            if isinstance(relay_request, dict):
                ctx.relay_request = relay_request
            relay_answer = ctx.startup_data.get("relayAnswer")
            if isinstance(relay_answer, dict):
                ctx.relay_answer = relay_answer
        else:
            ctx.startup_data = await self.master_client.fetch_startup_data(
                ctx.application_id,
                agent_name=ctx.agent.role,
            )
            ctx.sync_to_master = True
            relay_request = ctx.startup_data.get("relayRequest")
            if isinstance(relay_request, dict):
                ctx.relay_request = relay_request
            relay_answer = ctx.startup_data.get("relayAnswer")
            if isinstance(relay_answer, dict):
                ctx.relay_answer = relay_answer

    async def _download_documents(self, ctx: AgentRunContext) -> None:
        """
        Скачивает документы параллельно и парсит текст.
        Недоступные документы пропускаем с предупреждением — не останавливаем анализ.
        """
        documents = ctx.startup_data.get("documents", [])
        if not documents:
            return

        async def download_one(doc: dict) -> dict | None:
            file_url = doc.get("fileUrl", "")
            if not file_url:
                return None

            # Пропускаем мок-URL (файлов нет реально)
            if ctx.use_mock and "mock" in file_url:
                logger.debug(f"Skipping mock document: {doc.get('originalName')}")
                return {
                    "name": doc.get("originalName", "unknown"),
                    "classified_as": doc.get("classifiedAs", ""),
                    "text": f"[Mock document — content not available in test mode: {doc.get('originalName')}]",
                }

            # Проверяем доступность
            is_available = await self.master_client.check_document_availability(file_url)
            if not is_available:
                logger.warning(f"Document unavailable: {file_url}")
                return {
                    "name": doc.get("originalName", "unknown"),
                    "classified_as": doc.get("classifiedAs", ""),
                    "text": f"[Document unavailable: {doc.get('originalName')}]",
                }

            try:
                content = await self.master_client.download_document(file_url)
                text = extract_text(
                    content,
                    doc.get("mimeType", ""),
                    doc.get("originalName", ""),
                )
                return {
                    "name": doc.get("originalName", "unknown"),
                    "classified_as": doc.get("classifiedAs", ""),
                    "text": text,
                }
            except Exception as e:
                logger.warning(f"Failed to download {doc.get('originalName')}: {e}")
                return {
                    "name": doc.get("originalName", "unknown"),
                    "classified_as": doc.get("classifiedAs", ""),
                    "text": f"[Download failed: {e}]",
                }

        # Параллельная загрузка всех документов
        results = await asyncio.gather(*[download_one(doc) for doc in documents])
        ctx.documents_text = [r for r in results if r is not None]
        logger.info(f"[Task {ctx.task_id}] Downloaded {len(ctx.documents_text)} documents")

    def _check_missing_data(self, ctx: AgentRunContext) -> list[str] | None:
        """
        Проверяет нужны ли агенту дополнительные данные.

        Логика: читаем из промпта специальную секцию REQUIRED_DOCS.
        Если промпт содержит маркер '## REQUIRED_DOCS' — парсим список.
        Сравниваем с тем что есть в документах стартапа.

        Это позволяет каждому агенту декларировать свои требования прямо в промпте.
        """
        prompt_content = ctx.prompt.content or ""

        if "## REQUIRED_DOCS" not in prompt_content:
            return None  # агент не объявил требований — считаем что всё есть

        # Парсим секцию REQUIRED_DOCS
        required_section = prompt_content.split("## REQUIRED_DOCS")[1]
        # Берём строки до следующего заголовка
        lines = required_section.split("\n")
        required_docs = []
        for line in lines:
            line = line.strip()
            if line.startswith("##"):
                break
            if line.startswith("-") or line.startswith("*"):
                doc_name = line.lstrip("-* ").strip()
                if doc_name:
                    required_docs.append(doc_name)

        if not required_docs:
            return None

        # Проверяем какие из required_docs реально присутствуют.
        # Учитываем классификацию, имя файла и эквиваленты для разных naming conventions.
        available_doc_keys: set[str] = set()
        for doc in ctx.startup_data.get("documents", []):
            classified_as = doc.get("classifiedAs", "")
            if isinstance(classified_as, str) and classified_as.strip():
                available_doc_keys.add(_normalize_doc_label(classified_as))

            original_name = doc.get("originalName", "")
            if isinstance(original_name, str) and original_name.strip():
                available_doc_keys.add(_normalize_doc_label(original_name))

            category = doc.get("category", "")
            if isinstance(category, str) and category.lower() == "financial":
                available_doc_keys.add("financialmodel")

        missing: list[str] = []
        for required in required_docs:
            normalized_required = _normalize_doc_label(required)
            if not normalized_required:
                continue

            equivalent_keys = DOC_REQUIREMENT_EQUIVALENTS.get(
                normalized_required,
                {normalized_required},
            )
            if available_doc_keys.isdisjoint(equivalent_keys):
                missing.append(required)

        return missing if missing else None

    def _build_messages(self, ctx: AgentRunContext) -> list[LLMMessage]:
        """
        Собирает список сообщений для LLM.

        Структура:
        1. system: промпт агента
        2. user: структурированные данные стартапа + документы
        """
        app = ctx.startup_data.get("application", {})

        # Форматируем данные стартапа
        founders_text = "\n".join(
            f"  - {f.get('name')} ({f.get('role')}): {f.get('background', 'N/A')}"
            for f in app.get("founders", [])
        )

        startup_context = f"""# Startup: {app.get('startupName', 'Unknown')}

## Basic Information
- Stage: {app.get('startupStage', 'N/A')}
- Activity Type: {app.get('activityType', 'N/A')}
- Investment Requested: {app.get('investmentAmount', 'N/A')} {app.get('currency', '')}
- Website: {app.get('websiteUrl', 'N/A')}

## Description
{app.get('description', 'N/A')}

## Business Model
{app.get('businessModel', 'N/A')}

## Financial Summary
{app.get('financialSummary', 'N/A')}

## Founders
{founders_text or 'N/A'}
"""

        # Добавляем содержимое документов
        docs_context = ""
        if ctx.documents_text:
            docs_parts = []
            for doc in ctx.documents_text:
                docs_parts.append(
                    f"### Document: {doc['name']} (type: {doc['classified_as']})\n\n{doc['text']}"
                )
            docs_context = "\n\n---\n\n".join(docs_parts)
            docs_context = f"\n\n## Attached Documents\n\n{docs_context}"

        relay_context = ""
        if ctx.relay_request:
            relay_context = (
                "\n\n## Relay Task\n"
                f"- relayId: {ctx.relay_request.get('relayId', 'N/A')}\n"
                f"- fromAgent: {ctx.relay_request.get('fromAgent', 'N/A')}\n"
                f"- question: {ctx.relay_request.get('question', 'N/A')}\n"
                "\nPlease prioritize answering this relay question clearly and concisely."
            )

        relay_answer_context = ""
        if ctx.relay_answer:
            relay_answer_context = (
                "\n\n## Relay Answer Received\n"
                f"- relayId: {ctx.relay_answer.get('relayId', 'N/A')}\n"
                f"- fromAgent: {ctx.relay_answer.get('fromAgent', 'N/A')}\n"
                f"- originalQuestion: {ctx.relay_answer.get('question', 'N/A')}\n"
                f"- answer: {ctx.relay_answer.get('answer', 'N/A')}\n"
                "\nIncorporate this answer and continue your own analysis."
            )

        # FAA сигнал: если агент CHRO и есть результат интервью FAA — добавляем его в контекст
        faa_context = ""
        faa_signal = ctx.extra_context.get("faa_signal") if ctx.extra_context else None
        if faa_signal and ctx.agent.role == "CHRO":
            faa_context = (
                "\n\n## FAA Signal — Founder Assessment Interview Result\n\n"
                "The following JSON is the result of a structured founder interview "
                "conducted by FAA (Founder Assessment Agent) before this analysis run. "
                "Use it to enrich your team evaluation — especially the ИБФ score, "
                "verdict, red flags, and stress test reaction. "
                "If faa_completed is false, the founder declined the interview — do not penalise.\n\n"
                f"```json\n{faa_signal}\n```"
            )

        # RCA контекст: для агента RCA передаём режим работы, контакт и JSON DD-агентов
        rca_context = ""
        if ctx.agent.role == "RCA" and ctx.extra_context:
            rca_mode = ctx.extra_context.get("rca_mode", "discovery")
            rca_contact_id = ctx.extra_context.get("rca_contact_id")
            startup_stage = ctx.extra_context.get("startup_stage", "unknown")
            founder_contacts = ctx.extra_context.get("founder_provided_contacts", [])
            dd_agents_json = ctx.extra_context.get("dd_agents_json", {})

            rca_context = f"\n\n## RCA Execution Context\n\n"
            rca_context += f"**Mode:** `{rca_mode}`\n"
            rca_context += f"**Startup Stage:** {startup_stage}\n"

            if rca_contact_id:
                rca_context += f"**Contact ID:** {rca_contact_id}\n"

            if founder_contacts:
                import json as _json
                rca_context += (
                    f"\n**Founder Provided Contacts** (`founder_provided_contacts[]`):\n"
                    f"```json\n{_json.dumps(founder_contacts, ensure_ascii=False, indent=2)}\n```\n"
                )
            else:
                rca_context += "\n**Founder Provided Contacts:** not provided (empty list)\n"

            if rca_mode == "discovery" and dd_agents_json:
                rca_context += "\n## DD Agents Output (read-only, for gap analysis)\n\n"
                for agent_role, agent_report in dd_agents_json.items():
                    rca_context += f"### {agent_role} Report\n\n{agent_report[:3000]}\n\n---\n\n"

        user_message = startup_context + docs_context + relay_context + relay_answer_context + faa_context + rca_context + (
            "\n\nUse Режим 4 (investor dialogue): provide a FULL Markdown analytical report "
            "(Section 7 of your prompt), then append a ```json``` block with the complete "
            "structured JSON data (Section 6 schema). "
            "IMPORTANT: All scores (overall and per-criterion) MUST be on a 0–100 scale, NOT 1–10. "
            "For example, a weak startup gets 15/100, not 1.5/10."
        )

        return [
            LLMMessage(role="system", content=ctx.prompt.content or ""),
            LLMMessage(role="user", content=user_message),
        ]

    async def _run_llm(self, ctx: AgentRunContext, messages: list[LLMMessage]) -> LLMResponse:
        """Вызывает LLM через соответствующий провайдер с retry при connection errors.
        При 403/401 от основного провайдера автоматически переключается на OpenAI fallback."""
        agent = ctx.agent

        # Расшифровываем API ключ
        api_key = _decrypt_api_key(agent.api_key_encrypted) if agent.api_key_encrypted else _get_default_api_key(agent.model_provider)

        provider = create_llm_provider(agent.model_provider, api_key)
        current_provider_name = agent.model_provider
        current_model = agent.model_version
        original_provider = agent.model_provider
        fallback_used = False

        logger.info(f"[Task {ctx.task_id}] Calling {current_provider_name}/{current_model}")

        max_retries = 3
        for attempt in range(1, max_retries + 1):
            try:
                start = time.time()
                response = await provider.complete(
                    messages=messages,
                    model=current_model,
                    max_tokens=16384,
                    temperature=0.3,  # низкая температура для аналитических задач
                )
                elapsed = time.time() - start

                if fallback_used:
                    logger.warning(
                        f"[Task {ctx.task_id}] FALLBACK SUCCESS: completed via {current_provider_name}/{current_model} "
                        f"(original provider {original_provider} returned auth error). "
                        f"Time: {elapsed:.1f}s, tokens: {response.tokens_used}"
                    )
                else:
                    logger.info(
                        f"[Task {ctx.task_id}] LLM done in {elapsed:.1f}s, "
                        f"tokens: {response.tokens_used}"
                    )
                return response
            except Exception as exc:
                exc_str = str(exc).lower()
                is_forbidden = "403" in str(exc) or "forbidden" in exc_str
                is_unauthorized = "401" in str(exc) or "unauthorized" in exc_str
                is_auth_error = is_forbidden or is_unauthorized

                # 403/401 — provider auth failed, fallback to OpenAI if possible
                if is_auth_error and current_provider_name != settings.FALLBACK_LLM_PROVIDER:
                    fallback_provider = settings.FALLBACK_LLM_PROVIDER
                    fallback_model = settings.FALLBACK_LLM_MODEL
                    logger.warning(
                        f"[Task {ctx.task_id}] {current_provider_name} returned auth error ({exc}), "
                        f"falling back to {fallback_provider}/{fallback_model}"
                    )
                    try:
                        fallback_key = _get_default_api_key(fallback_provider)
                        provider = create_llm_provider(fallback_provider, fallback_key)
                        current_provider_name = fallback_provider
                        current_model = fallback_model
                        fallback_used = True
                        continue  # retry immediately with OpenAI
                    except ValueError:
                        logger.error(f"[Task {ctx.task_id}] OpenAI fallback unavailable (no API key)")
                        raise  # re-raise original error

                is_timeout = "timeout" in exc_str or "timed out" in exc_str
                is_connection = "connection" in exc_str
                is_overload = "overloaded" in exc_str or "529" in str(exc)
                is_rate = "rate" in exc_str
                is_retryable = is_timeout or is_connection or is_overload or is_rate
                # Timeouts without overload: retry once (2 attempts total)
                max_for_this = 2 if is_timeout and not is_overload else max_retries
                if is_retryable and attempt < max_for_this:
                    elapsed = time.time() - start
                    # Connection errors from Anthropic (TCP reset mid-stream) need a
                    # longer pause — server-side issue, short waits just hit the same wall.
                    # Timeouts/overloads also benefit from longer back-off.
                    if is_connection:
                        wait = 120 * attempt  # 2 min, then 4 min
                    elif elapsed < 30:
                        wait = max(60, 60 * attempt)
                    else:
                        wait = 60 * attempt  # 1 min, then 2 min
                    logger.warning(f"[Task {ctx.task_id}] LLM attempt {attempt} failed after {elapsed:.0f}s ({exc}), retrying in {wait}s...")
                    await asyncio.sleep(wait)
                    continue
                raise

    async def _handle_needs_info(self, ctx: AgentRunContext, missing_docs: list[str]) -> None:
        """Отправляет needs_info и сохраняет запрос в БД."""
        logger.info(
            f"[Task {ctx.task_id}] [{ctx.agent.role}] "
            f"Requesting missing docs: {missing_docs}"
        )

        # Отправляем в Master Agent API (только если не мок)
        if ctx.sync_to_master:
            await self.master_client.submit_needs_info(
                application_id=ctx.application_id,
                agent_name=ctx.agent.role,
                requested_docs=missing_docs,
            )

        # Сохраняем запрос в БД
        missing_request = MissingDataRequest(
            task_id=ctx.task_id,
            requested_docs=missing_docs,
            status=MissingDataStatus.PENDING,
        )
        self.db.add(missing_request)

        await self._update_task_status(ctx.task_id, TaskStatus.NEEDS_INFO)
        await self.db.commit()

    async def _submit_completed(self, ctx: AgentRunContext) -> None:
        """Отправляет готовый отчёт в Master Agent API."""
        if not ctx.sync_to_master:
            logger.info(f"[Task {ctx.task_id}] Local mode — skipping submit to Master Agent")
            return

        if not ctx.llm_response:
            return

        if ctx.relay_answer and ctx.relay_answer.get("relayId"):
            await self.master_client.submit_relay_consumed(
                application_id=ctx.application_id,
                relay_id=str(ctx.relay_answer.get("relayId")),
                consumed_by_agent=ctx.agent.role,
            )

        if ctx.relay_request and ctx.relay_request.get("relayId"):
            await self.master_client.submit_relay_answer(
                application_id=ctx.application_id,
                relay_id=str(ctx.relay_request.get("relayId")),
                from_agent=ctx.agent.role,
                answer=ctx.llm_response.content,
            )
            logger.info(
                f"[Task {ctx.task_id}] [{ctx.agent.role}] Relay answer submitted for relayId={ctx.relay_request.get('relayId')}"
            )
            return

        relay_target, relay_question = self._extract_relay_question(ctx.llm_response.content)
        if relay_target and relay_question:
            await self.master_client.submit_relay_question(
                application_id=ctx.application_id,
                from_agent=ctx.agent.role,
                to_agent=relay_target,
                question=relay_question,
            )
            logger.info(
                f"[Task {ctx.task_id}] [{ctx.agent.role}] Relay question submitted to {relay_target}"
            )
            return

        from app.models.run import AgentTask, AnalysisRun
        result = await self.db.execute(
            select(AnalysisRun.prompt_set_tag)
            .join(AgentTask, AgentTask.run_id == AnalysisRun.id)
            .where(AgentTask.id == ctx.task_id)
        )
        prompt_set_tag = result.scalar_one_or_none()

        await self.master_client.submit_completed(
            application_id=ctx.application_id,
            agent_name=ctx.agent.role,
            report_content=ctx.llm_response.content,
            report_filename=f"{ctx.agent.role}_analysis.md",
            prompt_set_version=prompt_set_tag,
            llm_provider_primary=ctx.agent.model_provider,
            llm_model_primary=ctx.agent.model_version,
            llm_provider_used=ctx.llm_response.provider,
            llm_model_used=ctx.llm_response.model,
            llm_fallback_used=(
                str(ctx.llm_response.provider).lower() != str(ctx.agent.model_provider).lower()
                and str(ctx.llm_response.provider).lower() == str(settings.FALLBACK_LLM_PROVIDER).lower()
            ),
        )

    def _extract_relay_question(self, content: str) -> tuple[str | None, str | None]:
        """
        Опциональный протокол для меж-агентного запроса из ответа LLM.

        Ожидаемый формат в тексте:
        RELAY_TO: <agent role>
        RELAY_QUESTION: <question text>
        """
        relay_to = None
        relay_question = None
        for raw_line in content.splitlines():
            line = raw_line.strip()
            if line.upper().startswith("RELAY_TO:"):
                relay_to = line.split(":", 1)[1].strip()
            if line.upper().startswith("RELAY_QUESTION:"):
                relay_question = line.split(":", 1)[1].strip()
        if not relay_to or not relay_question:
            return None, None
        return relay_to, relay_question

    async def _save_completed(self, ctx: AgentRunContext) -> None:
        """Сохраняет результат агента в БД.

        Для агента FAA дополнительно извлекает JSON-сигнал из ответа LLM
        и сохраняет его в поле faa_signal (используется оркестратором для передачи CHRO).
        """
        if not ctx.llm_response:
            return

        elapsed = (datetime.utcnow() - ctx.started_at).total_seconds()

        # Для FAA — извлекаем JSON-блок из ответа и сохраняем как faa_signal
        faa_signal_value: str | None = None
        if ctx.agent.role == "FAA" and ctx.llm_response.content:
            faa_signal_value = self._extract_faa_signal(ctx.llm_response.content)

        await self.db.execute(
            update(AgentTask)
            .where(AgentTask.id == ctx.task_id)
            .values(
                status=TaskStatus.COMPLETED,
                report_content=ctx.llm_response.content,
                tokens_used=ctx.llm_response.tokens_used,
                llm_model_used=ctx.llm_response.model,
                execution_time_seconds=elapsed,
                completed_at=datetime.utcnow(),
                faa_signal=faa_signal_value,
            )
        )
        await self.db.commit()

    def _extract_faa_signal(self, content: str) -> str | None:
        """
        Извлекает JSON-блок FAA-сигнала из ответа LLM.
        FAA промпт (Часть 9) требует передавать чистый JSON без текста.
        Ищем либо ```json ... ``` блок, либо первый { ... } верхнего уровня.
        """
        import json

        # Попытка 1: ```json ... ``` блок
        import re
        json_block = re.search(r"```json\s*(\{.*?\})\s*```", content, re.DOTALL)
        if json_block:
            candidate = json_block.group(1).strip()
            try:
                json.loads(candidate)
                return candidate
            except json.JSONDecodeError:
                pass

        # Попытка 2: первый { } верхнего уровня в тексте
        start = content.find("{")
        if start != -1:
            depth = 0
            for i, ch in enumerate(content[start:], start):
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        candidate = content[start:i + 1]
                        try:
                            json.loads(candidate)
                            return candidate
                        except json.JSONDecodeError:
                            break

        logger.warning(f"[Task {self}] FAA: could not extract JSON signal from response")
        return None

    async def _save_failed(self, task_id: int, error_message: str) -> None:
        """Помечаем задачу как failed с сообщением об ошибке."""
        await self.db.execute(
            update(AgentTask)
            .where(AgentTask.id == task_id)
            .values(
                status=TaskStatus.FAILED,
                error_message=error_message[:1000],  # обрезаем очень длинные ошибки
                completed_at=datetime.utcnow(),
            )
        )
        await self.db.commit()

    async def _update_task_status(self, task_id: int, status: TaskStatus) -> None:
        await self.db.execute(
            update(AgentTask)
            .where(AgentTask.id == task_id)
            .values(
                status=status,
                started_at=datetime.utcnow() if status == TaskStatus.RUNNING else None,
            )
        )
        await self.db.commit()

    # ─── Chat ──────────────────────────────────────────────────────────────────

    async def chat(self, task_id: int, user_message: str) -> str:
        """
        Диалог с агентом после завершения анализа.
        Агент имеет контекст своего отчёта — отвечает в рамках своей роли.
        """
        # Загружаем задачу и отчёт
        result = await self.db.execute(
            select(AgentTask).where(AgentTask.id == task_id)
        )
        task = result.scalar_one_or_none()
        if not task:
            raise ValueError(f"Task {task_id} not found")

        agent, prompt = await self._load_agent_config(task_id)
        if not agent or not prompt:
            raise ValueError(f"Agent config not found for task {task_id}")

        # Загружаем историю чата
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.task_id == task_id)
            .order_by(ChatMessage.created_at)
        )
        history = result.scalars().all()

        # Строим messages: system + отчёт + история + новый вопрос
        messages = [
            LLMMessage(role="system", content=prompt.content or ""),
        ]

        # Добавляем отчёт как контекст
        if task.report_content:
            messages.append(LLMMessage(
                role="assistant",
                content=f"[My previous analysis]\n\n{task.report_content}",
            ))

        # История чата
        for msg in history:
            messages.append(LLMMessage(role=msg.role, content=msg.content))

        # Новый вопрос пользователя
        messages.append(LLMMessage(role="user", content=user_message))

        # Вызываем LLM
        api_key = _decrypt_api_key(agent.api_key_encrypted) if agent.api_key_encrypted else _get_default_api_key(agent.model_provider)
        provider = create_llm_provider(agent.model_provider, api_key)
        response = await provider.complete(messages=messages, model=agent.model_version)

        # Сохраняем оба сообщения в БД
        self.db.add(ChatMessage(task_id=task_id, role=MessageRole.USER, content=user_message))
        self.db.add(ChatMessage(task_id=task_id, role=MessageRole.ASSISTANT, content=response.content))
        await self.db.commit()

        return response.content


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _decrypt_api_key(encrypted: str) -> str:
    """
    Заглушка расшифровки. В реальной системе — используем Fernet или AWS KMS.
    Пока возвращаем как есть (в dev ключи хранятся открытыми).
    TODO: реализовать шифрование в PromptService
    """
    return encrypted


def _get_default_api_key(provider: str) -> str:
    """Фолбэк на глобальный ключ из .env если у агента нет своего."""
    key_map = {
        "openai": settings.OPENAI_API_KEY,
        "anthropic": settings.ANTHROPIC_API_KEY,
        "google": settings.GOOGLE_API_KEY,
    }
    key = key_map.get(provider.lower(), "")
    if not key:
        raise ValueError(
            f"No API key for provider '{provider}'. "
            f"Set it in agent config or in .env ({provider.upper()}_API_KEY)"
        )
    return key
