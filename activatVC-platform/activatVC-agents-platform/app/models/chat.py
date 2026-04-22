from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import Integer, Text, DateTime, ForeignKey, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MessageRole(str, PyEnum):
    USER = "user"
    ASSISTANT = "assistant"
    SYSTEM = "system"


class ChatMessage(Base):
    """
    Сообщение в чате с агентом после завершения анализа.
    task_id связывает чат с конкретным запуском конкретного агента —
    агент имеет контекст своего отчёта при ответе на вопросы.
    """
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    task_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agent_tasks.id", ondelete="CASCADE"),
        nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(
        Enum(MessageRole), nullable=False
    )
    content: Mapped[str] = mapped_column(Text(length=4294967295), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    task: Mapped["AgentTask"] = relationship(  # noqa: F821
        "AgentTask", back_populates="chat_messages"
    )

    def __repr__(self) -> str:
        return f"<ChatMessage(id={self.id}, task_id={self.task_id}, role={self.role})>"
