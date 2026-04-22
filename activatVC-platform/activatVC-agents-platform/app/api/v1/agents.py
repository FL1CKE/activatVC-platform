from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.agent import Agent
from app.services.agent_service import AgentService
from app.schemas.agent import (
    AgentCreate, AgentUpdate, AgentResponse, AgentListResponse,
    AgentPromptCreate, AgentPromptResponse,
    AgentApiKeyRotate, AgentApiKeyHistoryResponse,
)

router = APIRouter()


def _to_response(agent: Agent) -> AgentResponse:
    """Никогда не возвращаем api_key_encrypted."""
    active_prompt = None
    if agent.prompts:
        ap = next((p for p in agent.prompts if p.is_active), None)
        if ap:
            active_prompt = AgentPromptResponse.model_validate(ap)
    return AgentResponse(
        id=agent.id,
        name=agent.name,
        role=agent.role,
        description=agent.description,
        is_active=agent.is_active,
        model_provider=agent.model_provider,
        model_version=agent.model_version,
        created_at=agent.created_at,
        updated_at=agent.updated_at,
        has_api_key=bool(agent.api_key_encrypted),
        active_prompt=active_prompt,
    )


async def _load(agent_id: int, db: AsyncSession) -> Agent:
    result = await db.execute(
        select(Agent).options(selectinload(Agent.prompts)).where(Agent.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(404, f"Agent {agent_id} not found")
    return agent


@router.get("", response_model=AgentListResponse)
async def list_agents(active_only: bool = False, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Agent)
        .options(selectinload(Agent.prompts))
        .where(Agent.is_active == True if active_only else True)  # noqa: E712
        .order_by(Agent.id)
    )
    agents = result.scalars().all()
    return AgentListResponse(items=[_to_response(a) for a in agents], total=len(agents))


@router.post("", response_model=AgentResponse, status_code=201)
async def create_agent(data: AgentCreate, db: AsyncSession = Depends(get_db)):
    try:
        agent = await AgentService(db).create_agent(data)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return _to_response(await _load(agent.id, db))


@router.get("/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: int, db: AsyncSession = Depends(get_db)):
    return _to_response(await _load(agent_id, db))


@router.patch("/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: int, data: AgentUpdate, db: AsyncSession = Depends(get_db)):
    try:
        await AgentService(db).update_agent(agent_id, data)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return _to_response(await _load(agent_id, db))


# ─── Prompt versioning ────────────────────────────────────────────────────────

@router.get("/{agent_id}/prompts", response_model=list[AgentPromptResponse])
async def list_prompts(agent_id: int, db: AsyncSession = Depends(get_db)):
    await _load(agent_id, db)  # проверяем что агент существует
    prompts = await AgentService(db).list_prompts(agent_id)
    return [AgentPromptResponse.model_validate(p) for p in prompts]


@router.post("/{agent_id}/prompts", response_model=AgentPromptResponse, status_code=201)
async def create_prompt_version(
    agent_id: int, data: AgentPromptCreate, db: AsyncSession = Depends(get_db)
):
    """Новая версия промпта. Старая автоматически деактивируется."""
    try:
        prompt = await AgentService(db).create_prompt_version(agent_id, data)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return AgentPromptResponse.model_validate(prompt)


@router.post("/{agent_id}/prompts/rollback/{version}", response_model=AgentPromptResponse)
async def rollback_prompt(agent_id: int, version: int, db: AsyncSession = Depends(get_db)):
    """Откат к версии {version}. История не теряется — создаётся новая версия."""
    try:
        prompt = await AgentService(db).rollback_prompt(agent_id, version)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return AgentPromptResponse.model_validate(prompt)


# ─── API key history ─────────────────────────────────────────────────────────

@router.get("/{agent_id}/api-keys/history", response_model=list[AgentApiKeyHistoryResponse])
async def list_api_keys(agent_id: int, limit: int = 5, db: AsyncSession = Depends(get_db)):
    try:
        keys = await AgentService(db).list_api_keys(agent_id, limit=max(1, min(limit, 20)))
    except ValueError as e:
        raise HTTPException(404, str(e))
    return [AgentApiKeyHistoryResponse.model_validate(k) for k in keys]


@router.post("/{agent_id}/api-keys", response_model=AgentApiKeyHistoryResponse, status_code=201)
async def rotate_api_key(
    agent_id: int,
    data: AgentApiKeyRotate,
    db: AsyncSession = Depends(get_db),
):
    try:
        key = await AgentService(db).rotate_api_key(agent_id, data)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return AgentApiKeyHistoryResponse.model_validate(key)


@router.post("/{agent_id}/api-keys/rollback/{version}", response_model=AgentApiKeyHistoryResponse)
async def rollback_api_key(agent_id: int, version: int, db: AsyncSession = Depends(get_db)):
    try:
        key = await AgentService(db).rollback_api_key(agent_id, version)
    except ValueError as e:
        raise HTTPException(404, str(e))
    return AgentApiKeyHistoryResponse.model_validate(key)
