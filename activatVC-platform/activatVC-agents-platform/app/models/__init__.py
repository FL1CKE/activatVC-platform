# Важно: все модели должны быть импортированы здесь
# Alembic сканирует Base.metadata только если модели загружены в память
from app.models.agent import Agent, AgentPrompt, AgentApiKey, ModelProvider, PromptFormat
from app.models.run import AnalysisRun, AgentTask, MissingDataRequest, RunStatus, TaskStatus, MissingDataStatus
from app.models.chat import ChatMessage, MessageRole

__all__ = [
    "Agent", "AgentPrompt", "AgentApiKey", "ModelProvider", "PromptFormat",
    "AnalysisRun", "AgentTask", "MissingDataRequest", "RunStatus", "TaskStatus", "MissingDataStatus",
    "ChatMessage", "MessageRole",
]
