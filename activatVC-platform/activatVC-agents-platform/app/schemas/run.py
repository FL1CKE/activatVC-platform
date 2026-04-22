from datetime import datetime
from typing import Literal
from pydantic import BaseModel
from app.models.run import RunStatus, TaskStatus


class TriggerRunRequest(BaseModel):
    """Запрос на запуск анализа стартапа."""
    application_id: str
    use_mock: bool = False      # если True — берём данные из mock_data.py
    startup_data: dict | None = None  # standalone mode: полные данные application+documents
    target_agent_role: str | None = None


class RelayQuestionEnvelope(BaseModel):
    relay_id: str
    from_agent: str
    to_agent: str
    question: str
    round: int
    priority: Literal["high", "medium", "low"] = "medium"
    idempotency_key: str


class RelayAnswerEnvelope(BaseModel):
    relay_id: str
    from_agent: str
    answer: str


class RelayConsumedEnvelope(BaseModel):
    relay_id: str
    consumed_by_agent: str


class MissingDataRequestResponse(BaseModel):
    id: int
    requested_docs: list[str]
    status: str
    requested_at: datetime
    fulfilled_at: datetime | None = None

    model_config = {"from_attributes": True}


class AgentTaskResponse(BaseModel):
    id: int
    agent_id: int
    agent_name: str | None = None   # денормализуем для удобства фронта
    agent_role: str | None = None
    status: TaskStatus
    report_content: str | None = None
    tokens_used: int | None = None
    llm_model_used: str | None = None
    execution_time_seconds: float | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    missing_data_requests: list[MissingDataRequestResponse] = []
    # FAA
    faa_signal: str | None = None
    # RCA
    rca_mode: str | None = None
    rca_contact_id: str | None = None

    model_config = {"from_attributes": True}


class AnalysisRunResponse(BaseModel):
    id: int
    application_id: str
    startup_name: str | None = None
    status: RunStatus
    triggered_by: str
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime
    tasks: list[AgentTaskResponse] = []
    completed_tasks_count: int = 0
    total_tasks_count: int = 0
    # FAA / RCA флаги
    faa_eligible: bool = False
    rca_triggered: bool = False
    rca_trigger_type: str | None = None

    model_config = {"from_attributes": True}


class AnalysisRunListResponse(BaseModel):
    items: list[AnalysisRunResponse]
    total: int
