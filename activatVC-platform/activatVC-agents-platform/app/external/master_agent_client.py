import json
import re
from urllib.parse import urlparse

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from pathlib import Path
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


class MasterAgentError(Exception):
    """Базовая ошибка клиента Master Agent API."""
    pass


class StartupNotFoundError(MasterAgentError):
    pass


class MasterAgentClient:
    """
    HTTP клиент для взаимодействия с Master Agent API (activat.vc).

    Изолирован в отдельном классе по двум причинам:
    1. Легко мокать в тестах — заменяем весь клиент одним моком
    2. Retry логика, таймауты, логирование — всё в одном месте
    """

    def __init__(self, base_url: str | None = None, timeout: int | None = None):
        self.base_url = (base_url or settings.MASTER_AGENT_BASE_URL).rstrip("/")
        self.timeout = timeout or settings.MASTER_AGENT_TIMEOUT
        # Extract hostname from base_url to rewrite localhost document URLs
        # so that Docker containers can reach MinIO via the same host.
        parsed = urlparse(self.base_url)
        self._rewrite_host = parsed.hostname  # e.g. "host.docker.internal"

    def _rewrite_file_url(self, file_url: str) -> str:
        """
        Rewrite document URLs to be reachable from inside Docker.
        Stored URLs use 127.0.0.1 or localhost, which don't resolve
        to the host machine from within a container.
        """
        if not self._rewrite_host or self._rewrite_host in ("127.0.0.1", "localhost"):
            return file_url
        rewritten = re.sub(
            r"https?://(127\.0\.0\.1|localhost)(:\d+)",
            lambda m: f"http://{self._rewrite_host}{m.group(2)}",
            file_url,
        )
        if rewritten != file_url:
            logger.debug(f"Rewrote document URL: {file_url} -> {rewritten}")
        return rewritten

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def fetch_startup_data(self, application_id: str, agent_name: str | None = None) -> dict:
        """
        GET /api/webhooks/startups/{applicationId}/data
        Возвращает application + documents[].
        Retry только на сетевые ошибки, не на 4xx.
        """
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/data"
        params = {"agentName": agent_name} if agent_name else None
        logger.info(f"Fetching startup data: {application_id}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.get(url, params=params)

            if response.status_code == 404:
                raise StartupNotFoundError(f"Application {application_id} not found")
            if response.status_code != 200:
                raise MasterAgentError(
                    f"GET /data failed: {response.status_code} — {response.text[:200]}"
                )

            data = response.json()
            logger.info(
                f"Fetched startup: {data.get('application', {}).get('startupName', '?')}, "
                f"docs: {len(data.get('documents', []))}"
            )
            return data

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def submit_relay_question(
        self,
        application_id: str,
        from_agent: str,
        to_agent: str,
        question: str,
        relay_id: str | None = None,
        round_number: int | None = None,
    ) -> dict:
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/relay/question"
        payload: dict[str, str | int] = {
            "fromAgent": from_agent,
            "toAgent": to_agent,
            "question": question,
        }
        if relay_id:
            payload["relayId"] = relay_id
        if round_number:
            payload["round"] = round_number

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, json=payload)
            if response.status_code != 200:
                raise MasterAgentError(
                    f"POST relay/question failed: {response.status_code} — {response.text[:200]}"
                )
            return response.json()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def submit_relay_answer(
        self,
        application_id: str,
        relay_id: str,
        from_agent: str,
        answer: str,
    ) -> dict:
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/relay/answer"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                url,
                json={
                    "relayId": relay_id,
                    "fromAgent": from_agent,
                    "answer": answer,
                },
            )
            if response.status_code != 200:
                raise MasterAgentError(
                    f"POST relay/answer failed: {response.status_code} — {response.text[:200]}"
                )
            return response.json()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def submit_relay_consumed(
        self,
        application_id: str,
        relay_id: str,
        consumed_by_agent: str,
    ) -> dict:
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/relay/consumed"
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                url,
                json={
                    "relayId": relay_id,
                    "consumedByAgent": consumed_by_agent,
                },
            )
            if response.status_code != 200:
                raise MasterAgentError(
                    f"POST relay/consumed failed: {response.status_code} — {response.text[:200]}"
                )
            return response.json()

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def submit_needs_info(
        self,
        application_id: str,
        agent_name: str,
        requested_docs: list[str],
    ) -> dict:
        """
        POST /processed с status=needs_info
        Сообщает что агент не может завершить анализ без доп. документов.
        """
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/processed"
        logger.info(f"[{agent_name}] Submitting needs_info: {requested_docs}")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                url,
                data={
                    "agentName": agent_name,
                    "status": "needs_info",
                    "requested_docs": str(requested_docs).replace("'", '"'),
                    # Master Agent ожидает JSON-строку: '["Doc1","Doc2"]'
                },
            )

            if response.status_code != 200:
                raise MasterAgentError(
                    f"POST needs_info failed: {response.status_code} — {response.text[:200]}"
                )

            result = response.json()
            logger.info(f"[{agent_name}] needs_info accepted, gapItemsCount={result.get('gapItemsCount')}")
            return result

    @retry(
        retry=retry_if_exception_type(httpx.TransportError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True,
    )
    async def submit_completed(
        self,
        application_id: str,
        agent_name: str,
        report_content: str,
        report_filename: str | None = None,
        prompt_set_version: str | None = None,
        llm_provider_primary: str | None = None,
        llm_model_primary: str | None = None,
        llm_provider_used: str | None = None,
        llm_model_used: str | None = None,
        llm_fallback_used: bool | None = None,
    ) -> dict:
        """
        POST /processed с status=completed + файл отчёта.
        Отчёт отправляется как текстовый файл в multipart/form-data.
        """
        url = f"{self.base_url}/api/webhooks/startups/{application_id}/processed"
        logger.info(f"[{agent_name}] Submitting completed report ({len(report_content)} chars)")

        # Extract the JSON body from the report (may be wrapped in ```json ... ```)
        response_json_str = self._extract_response_json(report_content, agent_name)

        data_payload = {
            "agentName": agent_name,
            "status": "completed",
            "full_content": report_content,
        }
        if prompt_set_version:
            data_payload["prompt_set_version"] = prompt_set_version
        if response_json_str:
            data_payload["response_json"] = response_json_str
        if llm_provider_primary:
            data_payload["llm_provider_primary"] = llm_provider_primary
        if llm_model_primary:
            data_payload["llm_model_primary"] = llm_model_primary
        if llm_provider_used:
            data_payload["llm_provider_used"] = llm_provider_used
        if llm_model_used:
            data_payload["llm_model_used"] = llm_model_used
        if llm_fallback_used is not None:
            data_payload["llm_fallback_used"] = "true" if llm_fallback_used else "false"

        # Generate PDF from markdown report; fall back to plain text if unavailable
        try:
            from app.services.report_service import export_report, ExportFormat
            pdf_bytes = export_report(report_content, ExportFormat.PDF, title=f"{agent_name} Analysis Report")
            file_tuple = (f"{agent_name}_report.pdf", pdf_bytes, "application/pdf")
            logger.info(f"[{agent_name}] PDF generated ({len(pdf_bytes)} bytes)")
        except Exception as pdf_err:
            logger.warning(f"[{agent_name}] PDF generation failed, falling back to markdown: {pdf_err}")
            md_filename = report_filename or f"{agent_name}_report.md"
            file_tuple = (md_filename, report_content.encode("utf-8"), "text/plain")

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                url,
                data=data_payload,
                files={
                    "documents": file_tuple,
                },
            )

            if response.status_code != 200:
                raise MasterAgentError(
                    f"POST completed failed: {response.status_code} — {response.text[:200]}"
                )

            result = response.json()
            logger.info(f"[{agent_name}] Report accepted by Master Agent")
            return result

    @staticmethod
    def _extract_response_json(report_content: str, agent_name: str) -> str | None:
        """
        Extract the top-level JSON object from an agent report.
        Reports are typically formatted as ```json\n{...}\n```.
        We parse the JSON and return it as a string for the master agent.
        """
        text = report_content.strip()
        # Try to extract from ```json ... ``` code block
        m = re.search(r"```json\s*\n(.*?)```", text, re.DOTALL)
        if m:
            text = m.group(1).strip()

        # Try to parse the whole thing, or whatever we extracted, as JSON
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                score = parsed.get("score")
                logger.info(f"[{agent_name}] Extracted score={score} from report JSON")
                return json.dumps(parsed, ensure_ascii=False)
        except (json.JSONDecodeError, ValueError):
            pass

        # Fallback: try to find the first top-level { ... } block
        brace_start = report_content.find("{")
        if brace_start >= 0:
            depth = 0
            for i in range(brace_start, len(report_content)):
                if report_content[i] == "{":
                    depth += 1
                elif report_content[i] == "}":
                    depth -= 1
                if depth == 0:
                    try:
                        parsed = json.loads(report_content[brace_start : i + 1])
                        if isinstance(parsed, dict):
                            score = parsed.get("score")
                            logger.info(f"[{agent_name}] Extracted score={score} from report (fallback)")
                            return json.dumps(parsed, ensure_ascii=False)
                    except (json.JSONDecodeError, ValueError):
                        pass
                    break

        logger.warning(f"[{agent_name}] Could not extract JSON from report")
        return None

    async def download_document(self, file_url: str) -> bytes:
        """
        Скачивает документ по прямому URL из documents[].fileUrl
        Документы лежат на MinIO (порт 9100).
        """
        url = self._rewrite_file_url(file_url)
        logger.debug(f"Downloading document: {url}")
        async with httpx.AsyncClient(timeout=60) as client:  # увеличенный таймаут для файлов
            response = await client.get(url, follow_redirects=True)
            if response.status_code != 200:
                raise MasterAgentError(
                    f"Failed to download document {file_url}: {response.status_code}"
                )
            return response.content

    async def check_document_availability(self, file_url: str) -> bool:
        """
        HEAD запрос для проверки доступности документа.
        Используется перед анализом чтобы не тратить токены LLM на недоступные файлы.
        """
        url = self._rewrite_file_url(file_url)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.head(url, follow_redirects=True)
                return response.status_code == 200
        except Exception:
            return False
