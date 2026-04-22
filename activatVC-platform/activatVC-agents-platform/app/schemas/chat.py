from datetime import datetime
from pydantic import BaseModel
from app.models.chat import MessageRole


class ChatMessageRequest(BaseModel):
    content: str


class ChatMessageResponse(BaseModel):
    id: int
    task_id: int
    role: MessageRole
    content: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatHistoryResponse(BaseModel):
    task_id: int
    messages: list[ChatMessageResponse]
