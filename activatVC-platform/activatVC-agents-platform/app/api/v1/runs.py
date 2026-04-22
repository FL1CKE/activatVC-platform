from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Literal

from app.core.database import get_db
from app.services.orchestrator import OrchestratorService, RCA_SCORE_THRESHOLD
from app.services.run_service import RunService
from app.schemas.run import (
    TriggerRunRequest, AnalysisRunResponse, AnalysisRunListResponse, AgentTaskResponse
)
from app.external.mock_data import list_mock_ids

router = APIRouter()


class TriggerRCARequest(BaseModel):
    """Запрос на запуск RCA для существующего Run."""
    mode: Literal["discovery", "briefing", "analysis"] = "discovery"
    contact_id: str | None = None  # RC-XXX, обязателен для briefing и analysis
    trigger_type: Literal["auto", "manual"] = "manual"

    model_config = {"json_schema_extra": {
        "examples": [
            {"mode": "discovery", "trigger_type": "manual"},
            {"mode": "briefing", "contact_id": "RC-001", "trigger_type": "manual"},
            {"mode": "analysis", "contact_id": "RC-001", "trigger_type": "manual"},
        ]
    }}


def _task_to_response(task) -> AgentTaskResponse:
    return AgentTaskResponse(
        id=task.id,
        agent_id=task.agent_id,
        agent_name=task.agent.name if task.agent else None,
        agent_role=task.agent.role if task.agent else None,
        status=task.status,
        report_content=task.report_content,
        tokens_used=task.tokens_used,
        llm_model_used=task.llm_model_used,
        execution_time_seconds=task.execution_time_seconds,
        error_message=task.error_message,
        started_at=task.started_at,
        completed_at=task.completed_at,
        missing_data_requests=task.missing_data_requests or [],
        faa_signal=getattr(task, "faa_signal", None),
        rca_mode=getattr(task, "rca_mode", None),
        rca_contact_id=getattr(task, "rca_contact_id", None),
    )


def _run_to_response(run) -> AnalysisRunResponse:
    tasks = [_task_to_response(t) for t in (run.tasks or [])]
    return AnalysisRunResponse(
        id=run.id,
        application_id=run.application_id,
        startup_name=run.startup_name,
        status=run.status,
        triggered_by=run.triggered_by,
        started_at=run.started_at,
        completed_at=run.completed_at,
        created_at=run.created_at,
        tasks=tasks,
        completed_tasks_count=sum(1 for t in tasks if t.status == "completed"),
        total_tasks_count=len(tasks),
        faa_eligible=getattr(run, "faa_eligible", False),
        rca_triggered=getattr(run, "rca_triggered", False),
        rca_trigger_type=getattr(run, "rca_trigger_type", None),
    )


# ─── GET /runs ─────────────────────────────────────────────────────────────────

@router.get("", response_model=AnalysisRunListResponse)
async def list_runs(
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    runs, total = await RunService(db).list_runs(limit=limit, offset=offset)
    return AnalysisRunListResponse(
        items=[_run_to_response(r) for r in runs],
        total=total,
    )


# ─── POST /runs/trigger ────────────────────────────────────────────────────────

@router.post("/trigger", response_model=AnalysisRunResponse, status_code=202)
async def trigger_run(
    request: TriggerRunRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Запускает анализ стартапа.
    Возвращает Run сразу (202 Accepted) — анализ идёт в фоне.
    Клиент поллит GET /runs/{id} для статуса.

    use_mock=true → берёт данные из встроенных мок-стартапов.
    Доступные mock IDs: mock-saas-001, mock-marketplace-002, mock-deeptech-003
    """
    if request.use_mock and request.application_id not in list_mock_ids():
        raise HTTPException(
            400,
            f"Unknown mock ID '{request.application_id}'. "
            f"Available: {list_mock_ids()}"
        )

    orchestrator = OrchestratorService(db)
    run = await orchestrator.trigger_run(request)

    # Запускаем анализ в фоне — не блокируем HTTP ответ
    # BackgroundTasks FastAPI — простой способ без Celery для MVP
    background_tasks.add_task(
        orchestrator.run_analysis,
        run_id=run.id,
        application_id=request.application_id,
        use_mock=request.use_mock,
    )

    return AnalysisRunResponse(
        id=run.id,
        application_id=run.application_id,
        startup_name=run.startup_name,
        status=run.status,
        triggered_by=run.triggered_by,
        created_at=run.created_at,
    )


# ─── GET /runs/mock-ids ────────────────────────────────────────────────────────

@router.get("/mock-ids", response_model=list[str])
async def get_mock_ids():
    """Список доступных мок application_id для тестирования."""
    return list_mock_ids()


# ─── GET /runs/{id} ────────────────────────────────────────────────────────────

@router.get("/{run_id}", response_model=AnalysisRunResponse)
async def get_run(run_id: int, db: AsyncSession = Depends(get_db)):
    """Детальный статус запуска со всеми задачами агентов."""
    run = await RunService(db).get_run_with_tasks(run_id)
    if not run:
        raise HTTPException(404, f"Run {run_id} not found")
    return _run_to_response(run)


# ─── GET /runs/{id}/tasks/{task_id} ───────────────────────────────────────────

@router.get("/{run_id}/tasks/{task_id}", response_model=AgentTaskResponse)
async def get_task(run_id: int, task_id: int, db: AsyncSession = Depends(get_db)):
    """Детали одной задачи агента включая полный отчёт."""
    task = await RunService(db).get_task(task_id)
    if not task or task.run_id != run_id:
        raise HTTPException(404, f"Task {task_id} not found in run {run_id}")
    return _task_to_response(task)


# ─── POST /runs/{id}/rca ───────────────────────────────────────────────────────

@router.post("/{run_id}/rca", status_code=202)
async def trigger_rca(
    run_id: int,
    request: TriggerRCARequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Запускает Reference Check Agent (RCA) для существующего Run.

    RCA работает в трёх последовательных режимах:
    - **discovery** — поиск контактов (клиенты, партнёры, инвесторы, эксперты),
      сверка с фаундерским списком, формирование запроса фаундеру.
      Запускается первым. Не требует contact_id.
    - **briefing** — персональный брифинг для аналитика перед звонком.
      Требует contact_id (RC-XXX из discovery-результата).
    - **analysis** — извлечение сигналов из транскрипта звонка.
      Требует contact_id. Отчёт агента должен содержать транскрипт как часть контекста.

    Автозапуск (trigger_type=auto) происходит когда Investment Score v1 ≥ {threshold}.
    Ручной запуск (trigger_type=manual) — по решению инвестора в любой момент.
    """.format(threshold=RCA_SCORE_THRESHOLD)

    # Валидация: briefing и analysis требуют contact_id
    if request.mode in ("briefing", "analysis") and not request.contact_id:
        raise HTTPException(
            400,
            f"contact_id is required for RCA mode '{request.mode}'. "
            "Run discovery first to get RC-XXX contact IDs."
        )

    # Проверяем что Run существует
    run = await RunService(db).get_run_with_tasks(run_id)
    if not run:
        raise HTTPException(404, f"Run {run_id} not found")

    orchestrator = OrchestratorService(db)
    task = await orchestrator.trigger_rca(
        run_id=run_id,
        trigger_type=request.trigger_type,
        rca_mode=request.mode,
        contact_id=request.contact_id,
    )

    if not task:
        raise HTTPException(
            503,
            "RCA agent not found or not active. Run 'python -m app.scripts.seed_agents' first."
        )

    return {
        "task_id": task.id,
        "run_id": run_id,
        "rca_mode": request.mode,
        "rca_contact_id": request.contact_id,
        "trigger_type": request.trigger_type,
        "status": task.status,
        "message": (
            f"RCA task created (mode={request.mode}). "
            "Poll GET /runs/{run_id}/tasks/{task_id} for status and result."
        ),
    }
