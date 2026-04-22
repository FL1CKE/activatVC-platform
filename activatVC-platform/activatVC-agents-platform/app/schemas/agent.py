from datetime import datetime
from pydantic import BaseModel
from app.models.agent import ModelProvider, PromptFormat


class AgentPromptBase(BaseModel):
    content: str | None = None
    format: PromptFormat = PromptFormat.TEXT
    file_path: str | None = None
    comment: str | None = None


class AgentPromptCreate(AgentPromptBase):
    pass


class AgentPromptResponse(AgentPromptBase):
    id: int
    agent_id: int
    version: int
    is_active: bool
    created_at: datetime
    created_by: str | None = None

    model_config = {"from_attributes": True}


class AgentBase(BaseModel):
    name: str
    role: str
    description: str | None = None
    is_active: bool = True
    model_provider: ModelProvider = ModelProvider.GOOGLE
    model_version: str = "gemini-2.5-flash"

    # Фикс: отключаем защиту namespace "model_" для наших полей
    model_config = {"protected_namespaces": ()}


class AgentCreate(AgentBase):
    api_key: str | None = None
    initial_prompt: str | None = None


class AgentUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None
    model_provider: ModelProvider | None = None
    model_version: str | None = None
    api_key: str | None = None

    model_config = {"protected_namespaces": ()}


class AgentResponse(AgentBase):
    id: int
    created_at: datetime
    updated_at: datetime
    has_api_key: bool = False
    active_prompt: AgentPromptResponse | None = None

    model_config = {"from_attributes": True, "protected_namespaces": ()}


class AgentListResponse(BaseModel):
    items: list[AgentResponse]
    total: int


class AgentApiKeyRotate(BaseModel):
    api_key: str
    comment: str | None = None


class AgentApiKeyHistoryResponse(BaseModel):
    id: int
    agent_id: int
    version: int
    is_active: bool
    key_masked: str
    comment: str | None = None
    created_at: datetime
    created_by: str | None = None

    model_config = {"from_attributes": True}
