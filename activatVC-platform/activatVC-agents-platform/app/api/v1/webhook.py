from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, Header
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.database import get_db
from app.services.orchestrator import OrchestratorService
from app.schemas.run import TriggerRunRequest, AnalysisRunResponse

router = APIRouter()


class WebhookPayload(BaseModel):
    applicationId: str
    event: str = "new_application"   # тип события от Master Agent
    targetAgent: str | None = None
    relayId: str | None = None
    sourceAgent: str | None = None
    round: int | None = None
    priority: str | None = None
    idempotencyKey: str | None = None


@router.post("/trigger", status_code=202)
async def webhook_trigger(
    payload: WebhookPayload,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    x_webhook_secret: str | None = Header(default=None),
):
    """
    Webhook endpoint — Master Agent пушит сюда applicationId.

    TODO (V1): добавить верификацию x_webhook_secret
    Сейчас принимаем любой запрос — только для MVP/dev.

    Пример curl:
        curl -X POST http://localhost:8000/api/v1/webhook/trigger \\
          -H "Content-Type: application/json" \\
          -d '{"applicationId": "mock-saas-001", "event": "new_application"}'
    """
    if payload.event not in {"new_application", "relay_question", "relay_answer"}:
        # Пока обрабатываем только этот тип событий
        return {"status": "ignored", "reason": f"Unknown event: {payload.event}"}

    if payload.event in {"relay_question", "relay_answer"}:
        if not payload.targetAgent:
            raise HTTPException(400, "targetAgent is required for relay events")
        if not payload.relayId:
            raise HTTPException(400, "relayId is required for relay events")
        if not payload.sourceAgent:
            raise HTTPException(400, "sourceAgent is required for relay events")

    orchestrator = OrchestratorService(db)
    run = await orchestrator.trigger_run(
        TriggerRunRequest(
            application_id=payload.applicationId,
            use_mock=False,
            target_agent_role=payload.targetAgent if payload.event in {"relay_question", "relay_answer"} else None,
        )
    )

    background_tasks.add_task(
        orchestrator.run_analysis,
        run_id=run.id,
        application_id=payload.applicationId,
        use_mock=False,
    )

    return {"status": "accepted", "run_id": run.id, "application_id": payload.applicationId}
