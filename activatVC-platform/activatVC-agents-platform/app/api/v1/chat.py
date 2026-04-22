from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.agents.base_agent import BaseAgent
from app.models.run import AgentTask, TaskStatus
from app.models.chat import ChatMessage
from app.schemas.chat import ChatMessageRequest, ChatMessageResponse, ChatHistoryResponse

router = APIRouter()


@router.get("/{task_id}/history", response_model=ChatHistoryResponse)
async def get_chat_history(task_id: int, db: AsyncSession = Depends(get_db)):
    """История чата с агентом по задаче."""
    task = await db.get(AgentTask, task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")

    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.task_id == task_id)
        .order_by(ChatMessage.created_at)
    )
    messages = result.scalars().all()

    return ChatHistoryResponse(
        task_id=task_id,
        messages=[ChatMessageResponse.model_validate(m) for m in messages],
    )


@router.post("/{task_id}/message", response_model=ChatMessageResponse)
async def send_message(
    task_id: int,
    request: ChatMessageRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Отправить сообщение агенту.
    Агент отвечает в контексте своего анализа.

    Требование: задача должна быть в статусе completed или needs_info.
    Чат во время анализа не поддерживается — агент занят.
    """
    task = await db.get(AgentTask, task_id)
    if not task:
        raise HTTPException(404, f"Task {task_id} not found")

    if task.status not in (TaskStatus.COMPLETED, TaskStatus.NEEDS_INFO):
        raise HTTPException(
            400,
            f"Cannot chat with agent while task status is '{task.status}'. "
            f"Wait for analysis to complete."
        )

    if not request.content.strip():
        raise HTTPException(400, "Message content cannot be empty")

    agent = BaseAgent(db=db)
    try:
        reply = await agent.chat(task_id=task_id, user_message=request.content)
    except Exception as e:
        raise HTTPException(500, f"LLM error: {str(e)}")

    # Возвращаем последнее сообщение ассистента
    result = await db.execute(
        select(ChatMessage)
        .where(ChatMessage.task_id == task_id, ChatMessage.role == "assistant")
        .order_by(ChatMessage.created_at.desc())
        .limit(1)
    )
    last_msg = result.scalar_one()
    return ChatMessageResponse.model_validate(last_msg)
