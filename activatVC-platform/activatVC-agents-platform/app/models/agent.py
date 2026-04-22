from datetime import datetime
from enum import Enum as PyEnum
from sqlalchemy import (
    Integer, String, Text, Boolean, DateTime,
    ForeignKey, Enum, func
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ModelProvider(str, PyEnum):
    OPENAI = "openai"
    ANTHROPIC = "anthropic"
    GOOGLE = "google"
    CUSTOM = "custom"

class PromptFormat(str, PyEnum):
    TEXT = "text"
    MARKDOWN = "markdown"
    DOCX = "docx"


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)
    # role — короткое имя: CLO, CFO, CHRO, CMO+CCO, CPO+CTO
    # Используется как agentName при отправке в Master Agent API

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    model_provider: Mapped[str] = mapped_column(
        Enum(
            ModelProvider,
            values_callable=lambda enum_class: [item.value for item in enum_class],
            native_enum=True,
        ),
        default=ModelProvider.GOOGLE,
        nullable=False,
    )
    model_version: Mapped[str] = mapped_column(String(100), nullable=False)
    # api_key хранится в зашифрованном виде (шифрование в сервисном слое)
    # НИКОГДА не выводим в API ответах
    api_key_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    prompts: Mapped[list["AgentPrompt"]] = relationship(
        "AgentPrompt", back_populates="agent", cascade="all, delete-orphan",
        order_by="AgentPrompt.version.desc()"
    )
    api_keys: Mapped[list["AgentApiKey"]] = relationship(
        "AgentApiKey", back_populates="agent", cascade="all, delete-orphan",
        order_by="AgentApiKey.version.desc()"
    )
    tasks: Mapped[list["AgentTask"]] = relationship(  # noqa: F821
        "AgentTask", back_populates="agent"
    )

    @property
    def active_prompt(self) -> "AgentPrompt | None":
        """Возвращает текущий активный промпт агента."""
        return next((p for p in self.prompts if p.is_active), None)

    def __repr__(self) -> str:
        return f"<Agent(id={self.id}, role={self.role}, active={self.is_active})>"


class AgentPrompt(Base):
    __tablename__ = "agent_prompts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    # version автоинкрементируется в сервисном слое при создании нового промпта

    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Только один промпт на агента может быть активным одновременно
    # При активации нового — предыдущий деактивируется (логика в PromptService)

    content: Mapped[str | None] = mapped_column(
        Text(), nullable=True
    )  # неограниченный текст
    format: Mapped[str] = mapped_column(
        Enum(
            PromptFormat,
            values_callable=lambda enum_class: [item.value for item in enum_class],
            native_enum=True,
        ),
        default=PromptFormat.TEXT,
        nullable=False,
    )
    file_path: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # путь к файлу если промпт хранится как MD/DOCX

    comment: Mapped[str | None] = mapped_column(
        String(500), nullable=True
    )  # заметка при создании версии (как git commit message)

    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Relationships
    agent: Mapped["Agent"] = relationship("Agent", back_populates="prompts")

    def __repr__(self) -> str:
        return f"<AgentPrompt(id={self.id}, agent_id={self.agent_id}, v={self.version}, active={self.is_active})>"


class AgentApiKey(Base):
    __tablename__ = "agent_api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    agent_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    key_masked: Mapped[str] = mapped_column(String(32), nullable=False)
    api_key_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(String(100), nullable=True)

    agent: Mapped["Agent"] = relationship("Agent", back_populates="api_keys")

    def __repr__(self) -> str:
        return f"<AgentApiKey(id={self.id}, agent_id={self.agent_id}, v={self.version}, active={self.is_active})>"
