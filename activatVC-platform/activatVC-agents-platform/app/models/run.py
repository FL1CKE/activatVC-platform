from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Integer, String, Text, DateTime, JSON,
    ForeignKey, Enum, func, Float
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class RunStatus(str, PyEnum):
    PENDING = "pending"  # создан, ещё не запущен
    RUNNING = "running"  # агенты работают
    WAITING_DATA = "waiting_data"  # один или несколько агентов ждут доп. данных
    COMPLETED = "completed"  # все агенты завершили
    FAILED = "failed"  # критическая ошибка


class TaskStatus(str, PyEnum):
    PENDING = "pending"
    RUNNING = "running"
    NEEDS_INFO = "needs_info"  # агент запросил доп. данные
    COMPLETED = "completed"
    FAILED = "failed"
    RETRYING = "retrying"  # повторная попытка после получения данных


class MissingDataStatus(str, PyEnum):
    PENDING = "pending"  # запрос отправлен, данных ещё нет
    FULFILLED = "fulfilled"  # данные получены, можно повторить анализ
    CANCELLED = "cancelled"


class AnalysisRun(Base):
    """
    Один запуск анализа = один стартап.
    Содержит ссылку на applicationId из Master Agent и агрегированный статус.
    """
    __tablename__ = "analysis_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    application_id: Mapped[str] = mapped_column(
        String(100), nullable=False, index=True
    )
    # application_id — UUID из Master Agent API. Индексируем для быстрого поиска.

    startup_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(
        Enum(
            RunStatus,
            values_callable=lambda enum_class: [item.value for item in enum_class],
            native_enum=True,
        ),
        default=RunStatus.PENDING,
        nullable=False,
    )
    triggered_by: Mapped[str] = mapped_column(
        String(50), default="manual", nullable=False
    )  # "manual", "webhook", "test"

    # Кэшируем данные стартапа чтобы не дёргать Master Agent API повторно
    startup_data_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    prompt_set_tag: Mapped[str | None] = mapped_column(String(64), nullable=True) # Hash tracing the exact prompts used

    # FAA флаг — True если FAA был включён в Run (pre-seed + no traction)
    faa_eligible: Mapped[bool] = mapped_column(
        Integer, default=False, nullable=False, server_default="0"
    )

    # RCA флаги — был ли запущен Reference Check Agent и как
    rca_triggered: Mapped[bool] = mapped_column(
        Integer, default=False, nullable=False, server_default="0"
    )
    rca_trigger_type: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # "auto" (score ≥ 66) или "manual"

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    tasks: Mapped[list["AgentTask"]] = relationship(
        "AgentTask", back_populates="run", cascade="all, delete-orphan"
    )

    @property
    def completed_tasks_count(self) -> int:
        return sum(1 for t in self.tasks if t.status == TaskStatus.COMPLETED)

    @property
    def total_tasks_count(self) -> int:
        return len(self.tasks)

    def __repr__(self) -> str:
        return f"<AnalysisRun(id={self.id}, app_id={self.application_id}, status={self.status})>"


class AgentTask(Base):
    """
    Задача одного агента в рамках запуска.
    Каждый AnalysisRun порождает N AgentTask (по одному на каждого активного агента).
    """
    __tablename__ = "agent_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    run_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("analysis_runs.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    prompt_version_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("agent_prompts.id"), nullable=True
    )
    # Фиксируем версию промпта на момент запуска — важно для воспроизводимости

    status: Mapped[str] = mapped_column(
        Enum(
            TaskStatus,
            values_callable=lambda enum_class: [item.value for item in enum_class],
            native_enum=True,
        ),
        default=TaskStatus.PENDING,
        nullable=False,
    )

    # Результат анализа
    report_content: Mapped[str | None] = mapped_column(
        Text(), nullable=True
    )  # неограниченный текст
    report_file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # FAA JSON-сигнал: заполняется только для задач агента FAA.
    # Содержит ИБФ, вердикт, блоки, красные флаги (схема ЧАСТИ 9 FAA_v3_0.md).
    # Оркестратор передаёт этот JSON агенту CHRO в поле faa_signal.
    faa_signal: Mapped[str | None] = mapped_column(Text(), nullable=True)

    # RCA поля: режим работы и ID контакта (для briefing/analysis задач)
    rca_mode: Mapped[str | None] = mapped_column(
        String(20), nullable=True
    )  # "discovery" | "briefing" | "analysis"
    rca_contact_id: Mapped[str | None] = mapped_column(
        String(50), nullable=True
    )  # RC-XXX из discovery-JSON

    # Метрики выполнения
    tokens_used: Mapped[int | None] = mapped_column(Integer, nullable=True)
    llm_model_used: Mapped[str | None] = mapped_column(String(100), nullable=True)
    execution_time_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)

    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    run: Mapped["AnalysisRun"] = relationship("AnalysisRun", back_populates="tasks")
    agent: Mapped["Agent"] = relationship("Agent", back_populates="tasks")  # noqa: F821
    missing_data_requests: Mapped[list["MissingDataRequest"]] = relationship(
        "MissingDataRequest", back_populates="task", cascade="all, delete-orphan"
    )
    chat_messages: Mapped[list["ChatMessage"]] = relationship(  # noqa: F821
        "ChatMessage", back_populates="task", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<AgentTask(id={self.id}, agent_id={self.agent_id}, status={self.status})>"


class MissingDataRequest(Base):
    """
    Запрос агента на недостающие данные.
    Соответствует 'needs_info' режиму в Master Agent API.
    """
    __tablename__ = "missing_data_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False, index=True
    )

    requested_docs: Mapped[list] = mapped_column(
        JSON, nullable=False
    )  # список строк: ["CohortAnalysisTable", "TractionMetricsCSV"]

    status: Mapped[str] = mapped_column(
        Enum(
            MissingDataStatus,
            values_callable=lambda enum_class: [item.value for item in enum_class],
            native_enum=True,
        ),
        default=MissingDataStatus.PENDING,
        nullable=False,
    )

    requested_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # Relationships
    task: Mapped["AgentTask"] = relationship(
        "AgentTask", back_populates="missing_data_requests"
    )

    def __repr__(self) -> str:
        return f"<MissingDataRequest(id={self.id}, task_id={self.task_id}, status={self.status})>"
