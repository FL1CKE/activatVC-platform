"""
Orchestrator Service — исправленная версия.

Баг из шага 3: run_analysis вызывался как BackgroundTask FastAPI,
но при этом использовал self.db — сессию которая уже была закрыта
после завершения HTTP запроса trigger_run.

Фикс: run_analysis создаёт свою сессию через AsyncSessionLocal.
trigger_run и run_analysis теперь полностью независимы по сессиям.

FAA (Founder Assessment Agent) — условный запуск:
  1. startupStage == "pre-seed"
  2. Отсутствует трекшн (нет выручки, пользователей, LOI, закрытых раундов)
Оркестратор определяет условие через _should_run_faa() перед созданием задач.

RCA (Reference Check Agent) — условный запуск:
  - auto: Investment Score v1 ≥ 66 (пороговое значение RCA_SCORE_THRESHOLD)
  - manual: инвестор явно указал trigger_rca=True в запросе
  RCA НЕ включается в стандартный DD-pipeline. Запускается отдельно после
  получения Investment Score v1 через API endpoint /api/v1/runs/{run_id}/rca.
  В режиме discovery RCA получает контекст стартапа + JSON всех DD-агентов.
"""
import asyncio
import logging
from datetime import datetime, UTC

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from app.agents.base_agent import BaseAgent
from app.external.master_agent_client import MasterAgentClient
from app.models.agent import Agent, AgentPrompt
from app.models.run import AnalysisRun, AgentTask, RunStatus, TaskStatus
from app.schemas.run import TriggerRunRequest

logger = logging.getLogger(__name__)

# Роль FAA-агента в БД
FAA_ROLE = "FAA"

# Роль RCA-агента в БД
RCA_ROLE = "RCA"

# Стадии, на которых FAA может запускаться
FAA_ELIGIBLE_STAGES = {"pre-seed", "pre_seed", "preseed"}

# Порог Investment Score v1 для автоматического запуска RCA
RCA_SCORE_THRESHOLD = 66.0

# Ключевые слова в финансовых данных, указывающие на наличие трекшна
TRACTION_KEYWORDS = [
    "revenue", "выручка", "mrr", "arr", "paying customer",
    "платящих клиент", "loi", "pilot contract", "пилотный контракт",
    "previous round", "предыдущий раунд", "closed round",
]


def _detect_traction(startup_data: dict) -> bool:
    """
    Определяет наличие трекшна по данным стартапа.
    Возвращает True если трекшн обнаружен (FAA не запускается).
    """
    application = startup_data.get("application", {})

    # Проверяем financialSummary на ключевые слова трекшна
    financial_summary = (application.get("financialSummary") or "").lower()
    description = (application.get("description") or "").lower()
    combined_text = financial_summary + " " + description

    for keyword in TRACTION_KEYWORDS:
        if keyword.lower() in combined_text:
            logger.info(f"FAA: traction keyword detected: '{keyword}'")
            return True

    # Проверяем investmentAmount — закрытый раунд
    if application.get("investmentAmount") and float(application.get("investmentAmount", 0)) > 0:
        logger.info("FAA: previous investment detected, skipping FAA")
        return True

    return False


class OrchestratorService:

    def __init__(self, db: AsyncSession):
        self.db = db
        self.master_client = MasterAgentClient()

    def _should_run_faa(self, startup_data: dict) -> bool:
        """
        Проверяет условие запуска FAA:
          1. Стадия == pre-seed
          2. Трекшн отсутствует

        Возвращает True если FAA должен быть включён в Run.
        """
        application = startup_data.get("application", {})
        stage = (application.get("startupStage") or "").lower().strip()

        if stage not in FAA_ELIGIBLE_STAGES:
            logger.info(f"FAA skipped: stage='{stage}' is not pre-seed")
            return False

        if _detect_traction(startup_data):
            logger.info("FAA skipped: traction detected")
            return False

        logger.info("FAA eligible: pre-seed stage + no traction detected")
        return True

    async def trigger_run(self, request: TriggerRunRequest) -> AnalysisRun:
        """
        Создаёт Run + Tasks в БД и возвращает Run.
        НЕ запускает анализ — это делает run_analysis (в BackgroundTask).
        """
        startup_name = await self._get_startup_name(
            request.application_id, request.use_mock, request.startup_data
        )

        run = AnalysisRun(
            application_id=request.application_id,
            startup_name=startup_name,
            status=RunStatus.PENDING,
            triggered_by="mock" if request.use_mock else "manual",
            startup_data_json=request.startup_data,
            faa_eligible=False,  # будет обновлено после проверки условий FAA ниже
        )
        self.db.add(run)
        await self.db.flush()

        result = await self.db.execute(
            select(Agent).where(Agent.is_active == True)  # noqa: E712
        )
        agents = result.scalars().all()

        if request.target_agent_role:
            agents = [a for a in agents if a.role == request.target_agent_role]

        # --- FAA conditional filtering ---
        # FAA запускается только при pre-seed + отсутствие трекшна.
        # Определяем условие заранее, используя startup_data из запроса
        # (или пустой dict если данные ещё не подгружены — в этом случае FAA пропускается).
        faa_eligible = False
        if not request.target_agent_role or request.target_agent_role == FAA_ROLE:
            startup_data_for_check = request.startup_data or {}
            if startup_data_for_check:
                faa_eligible = self._should_run_faa(startup_data_for_check)
            else:
                # Данных нет в запросе — попробуем из mock если use_mock
                if request.use_mock:
                    from app.external.mock_data import get_mock_startup
                    mock = get_mock_startup(request.application_id)
                    if mock:
                        faa_eligible = self._should_run_faa(mock)
                else:
                    # Без данных безопаснее не запускать FAA
                    logger.info("FAA skipped: no startup_data available at trigger time")

        agents_to_run = []
        for agent in agents:
            if agent.role == FAA_ROLE and not faa_eligible:
                logger.info(f"FAA agent (id={agent.id}) excluded from run {run.id}: conditions not met")
                continue
            agents_to_run.append(agent)

        if not agents_to_run:
            logger.warning("No active agents found. Run seed_agents first.")

        import hashlib
        prompt_contents = []

        for agent in agents_to_run:
            active_prompt = await self._get_active_prompt(agent.id)
            if active_prompt and active_prompt.content:
                prompt_contents.append(f"{agent.role}:{active_prompt.version}:{active_prompt.content}")
            
            task = AgentTask(
                run_id=run.id,
                agent_id=agent.id,
                prompt_version_id=active_prompt.id if active_prompt else None,
                status=TaskStatus.PENDING,
            )
            self.db.add(task)

        # Generate lock hash for the exact prompt set
        prompt_set_tag = hashlib.sha256("||".join(sorted(prompt_contents)).encode()).hexdigest()[:12] if prompt_contents else "no-prompts"
        run.prompt_set_tag = prompt_set_tag
        run.faa_eligible = faa_eligible  # фиксируем: был ли FAA включён в Run

        await self.db.commit()
        await self.db.refresh(run)

        logger.info(
            f"Run {run.id} created for {request.application_id}, "
            f"agents: {len(agents_to_run)}"
            + (" (FAA included)" if faa_eligible else "")
        )
        return run

    async def run_analysis(
        self,
        run_id: int,
        application_id: str,
        use_mock: bool,
    ) -> None:
        """
        Запускает анализ в фоне.

        ВАЖНО: этот метод вызывается как FastAPI BackgroundTask —
        к этому моменту HTTP запрос уже завершён и self.db ЗАКРЫТА.
        Поэтому создаём новую сессию через AsyncSessionLocal.

        Порядок выполнения с FAA:
        1. Если FAA-задача присутствует в Run — запускаем её первой (синхронно).
        2. Результат FAA (faa_signal JSON) записывается в AgentTask.faa_signal.
        3. Остальные агенты запускаются параллельно. CHRO получает faa_signal
           через extra_context в base_agent.run().
        """
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as db:
            # Помечаем Run как запущенный
            await db.execute(
                update(AnalysisRun)
                .where(AnalysisRun.id == run_id)
                .values(status=RunStatus.RUNNING, started_at=datetime.utcnow())
            )
            await db.commit()

            # Загружаем pending задачи вместе с агентами
            result = await db.execute(
                select(AgentTask, Agent)
                .join(Agent, AgentTask.agent_id == Agent.id)
                .where(
                    AgentTask.run_id == run_id,
                    AgentTask.status == TaskStatus.PENDING,
                )
            )
            rows = result.all()
            tasks = [row[0] for row in rows]
            agents_by_task_id = {row[0].id: row[1] for row in rows}

            if not tasks:
                logger.warning(f"Run {run_id}: no pending tasks")
                return

            # Разделяем FAA и остальные задачи
            faa_task = next(
                (t for t in tasks if agents_by_task_id[t.id].role == FAA_ROLE),
                None,
            )
            other_tasks = [t for t in tasks if agents_by_task_id[t.id].role != FAA_ROLE]

            logger.info(
                f"Run {run_id}: launching {len(tasks)} agents "
                f"({'FAA first, then ' if faa_task else ''}{len(other_tasks)} parallel)"
            )

        # Шаг 1: если FAA присутствует — запускаем его первым и ждём результата
        faa_signal_json: str | None = None
        if faa_task:
            logger.info(f"Run {run_id}: starting FAA task {faa_task.id}")
            try:
                await self._run_single_agent(faa_task.id, application_id, use_mock)
                # Читаем результат FAA из БД
                from app.core.database import AsyncSessionLocal
                async with AsyncSessionLocal() as db:
                    res = await db.execute(
                        select(AgentTask).where(AgentTask.id == faa_task.id)
                    )
                    completed_faa = res.scalar_one_or_none()
                    if completed_faa:
                        faa_signal_json = completed_faa.faa_signal
                        if faa_signal_json:
                            logger.info(f"Run {run_id}: FAA signal captured ({len(faa_signal_json)} chars)")
                        else:
                            logger.info(f"Run {run_id}: FAA completed but no signal JSON (interview skipped?)")
            except Exception as e:
                logger.error(f"Run {run_id}: FAA task {faa_task.id} failed: {e}")

        # Шаг 2: запускаем остальных агентов параллельно, передавая faa_signal в CHRO
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            results = await asyncio.gather(
                *[
                    self._run_single_agent(
                        task.id,
                        application_id,
                        use_mock,
                        faa_signal=faa_signal_json if agents_by_task_id[task.id].role == "CHRO" else None,
                    )
                    for task in other_tasks
                ],
                return_exceptions=True,
            )

            # Логируем неожиданные исключения (base_agent ловит свои)
            for i, res in enumerate(results):
                if isinstance(res, Exception):
                    logger.error(
                        f"Run {run_id}, task {other_tasks[i].id}: "
                        f"unhandled exception: {res}"
                    )

        # Финализируем Run в отдельной сессии
        async with AsyncSessionLocal() as db:
            await self._finalize_run(run_id, db)

    async def _run_single_agent(
        self,
        task_id: int,
        application_id: str,
        use_mock: bool,
        faa_signal: str | None = None,
    ) -> None:
        """Каждый агент получает свою изолированную DB сессию.

        faa_signal — JSON-строка из результата FAA, передаётся только агенту CHRO.
        """
        from app.core.database import AsyncSessionLocal

        async with AsyncSessionLocal() as agent_db:
            agent = BaseAgent(db=agent_db, master_client=self.master_client)
            await agent.run(
                task_id=task_id,
                application_id=application_id,
                use_mock=use_mock,
                extra_context={"faa_signal": faa_signal} if faa_signal else None,
            )

    async def _finalize_run(self, run_id: int, db: AsyncSession) -> None:
        result = await db.execute(
            select(AgentTask).where(AgentTask.run_id == run_id)
        )
        tasks = result.scalars().all()
        statuses = [t.status for t in tasks]

        if not statuses:
            final = RunStatus.FAILED
        elif all(s == TaskStatus.COMPLETED for s in statuses):
            final = RunStatus.COMPLETED
        elif all(s == TaskStatus.FAILED for s in statuses):
            final = RunStatus.FAILED
        elif TaskStatus.NEEDS_INFO in statuses:
            final = RunStatus.WAITING_DATA
        else:
            final = RunStatus.COMPLETED  # частичный успех

        await db.execute(
            update(AnalysisRun)
            .where(AnalysisRun.id == run_id)
            .values(status=final, completed_at=datetime.utcnow())
        )
        await db.commit()
        logger.info(f"Run {run_id} → {final}")

    async def _get_active_prompt(self, agent_id: int) -> AgentPrompt | None:
        result = await self.db.execute(
            select(AgentPrompt).where(
                AgentPrompt.agent_id == agent_id,
                AgentPrompt.is_active == True,  # noqa: E712
            )
        )
        return result.scalar_one_or_none()

    async def _get_startup_name(
        self,
        application_id: str,
        use_mock: bool,
        startup_data: dict | None = None,
    ) -> str | None:
        if startup_data:
            return startup_data.get("application", {}).get("startupName")
        if use_mock:
            from app.external.mock_data import get_mock_startup
            data = get_mock_startup(application_id)
            return data["application"]["startupName"] if data else None
        try:
            data = await self.master_client.fetch_startup_data(application_id)
            return data.get("application", {}).get("startupName")
        except Exception:
            return None

    # ─── RCA методы ─────────────────────────────────────────────────────────

    async def trigger_rca(
        self,
        run_id: int,
        trigger_type: str = "manual",
        rca_mode: str = "discovery",
        contact_id: str | None = None,
    ) -> AgentTask | None:
        """
        Запускает RCA для существующего Run.

        trigger_type: 'auto' (score ≥ 66) или 'manual' (инвестор).
        rca_mode: 'discovery' | 'briefing' | 'analysis'
        contact_id: RC-XXX (обязателен для briefing и analysis режимов)

        Создаёт AgentTask для RCA и запускает его как BackgroundTask.
        Возвращает созданную задачу или None если RCA-агент не найден.
        """
        from app.core.database import AsyncSessionLocal

        # Находим RCA-агента в БД
        result = await self.db.execute(
            select(Agent).where(Agent.role == RCA_ROLE, Agent.is_active == True)  # noqa: E712
        )
        rca_agent = result.scalar_one_or_none()

        if not rca_agent:
            logger.error(f"RCA agent not found in DB. Run seed_agents first.")
            return None

        # Получаем актуальный промпт
        active_prompt = await self._get_active_prompt(rca_agent.id)

        # Создаём задачу RCA
        task = AgentTask(
            run_id=run_id,
            agent_id=rca_agent.id,
            prompt_version_id=active_prompt.id if active_prompt else None,
            status=TaskStatus.PENDING,
            rca_mode=rca_mode,
            rca_contact_id=contact_id,
        )
        self.db.add(task)

        # Помечаем Run как rca_triggered
        await self.db.execute(
            update(AnalysisRun)
            .where(AnalysisRun.id == run_id)
            .values(rca_triggered=True, rca_trigger_type=trigger_type)
        )
        await self.db.commit()
        await self.db.refresh(task)

        logger.info(
            f"RCA task {task.id} created for run {run_id} "
            f"(mode={rca_mode}, trigger={trigger_type}, contact_id={contact_id})"
        )

        # Получаем данные Run для запуска агента
        run_result = await self.db.execute(
            select(AnalysisRun).where(AnalysisRun.id == run_id)
        )
        run = run_result.scalar_one_or_none()
        if not run:
            logger.error(f"Run {run_id} not found")
            return task

        # Строим extra_context с данными для RCA
        rca_context = await self._build_rca_context(run, rca_mode, contact_id)

        # Запускаем в фоне
        async with AsyncSessionLocal() as agent_db:
            agent = BaseAgent(db=agent_db, master_client=self.master_client)
            await agent.run(
                task_id=task.id,
                application_id=run.application_id,
                use_mock=(run.triggered_by == "mock"),
                extra_context=rca_context,
            )

        return task

    async def _build_rca_context(
        self,
        run: AnalysisRun,
        rca_mode: str,
        contact_id: str | None,
    ) -> dict:
        """
        Собирает extra_context для RCA-агента:
        - rca_mode: текущий режим работы
        - rca_contact_id: ID контакта (для briefing/analysis)
        - dd_agents_json: JSON-выходы всех завершённых DD-агентов (для discovery)
        - startup_stage: стадия стартапа из данных заявки
        - founder_provided_contacts: контакты от фаундера (если есть в startup_data)
        """
        context: dict = {
            "rca_mode": rca_mode,
            "rca_contact_id": contact_id,
        }

        # Стадия стартапа
        startup_data = run.startup_data_json or {}
        application = startup_data.get("application", {})
        context["startup_stage"] = application.get("startupStage", "unknown")
        context["founder_provided_contacts"] = application.get("referenceContacts", [])

        # В discovery-режиме собираем JSON-выходы всех завершённых DD-агентов
        if rca_mode == "discovery":
            dd_results = await self.db.execute(
                select(AgentTask, Agent)
                .join(Agent, AgentTask.agent_id == Agent.id)
                .where(
                    AgentTask.run_id == run.id,
                    AgentTask.status == TaskStatus.COMPLETED,
                    Agent.role.notin_([RCA_ROLE, FAA_ROLE]),
                )
            )
            rows = dd_results.all()
            dd_agents_json: dict[str, str] = {}
            for task_row, agent_row in rows:
                if task_row.report_content:
                    dd_agents_json[agent_row.role] = task_row.report_content
            context["dd_agents_json"] = dd_agents_json
            logger.info(
                f"RCA discovery context: {len(dd_agents_json)} DD agent reports collected "
                f"({', '.join(dd_agents_json.keys())})"
            )

        return context
