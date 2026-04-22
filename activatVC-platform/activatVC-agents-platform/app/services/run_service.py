from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from app.models.run import AnalysisRun, AgentTask
from app.models.agent import Agent


class RunService:

    def __init__(self, db: AsyncSession):
        self.db = db

    async def list_runs(self, limit: int = 20, offset: int = 0) -> tuple[list[AnalysisRun], int]:
        from sqlalchemy.orm import selectinload

        total_result = await self.db.execute(select(func.count()).select_from(AnalysisRun))
        total = total_result.scalar_one()

        result = await self.db.execute(
            select(AnalysisRun)
            .options(
                selectinload(AnalysisRun.tasks).selectinload(AgentTask.agent),
                selectinload(AnalysisRun.tasks).selectinload(AgentTask.missing_data_requests),
            )
            .order_by(AnalysisRun.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return result.scalars().unique().all(), total

    async def get_run(self, run_id: int) -> AnalysisRun | None:
        result = await self.db.execute(
            select(AnalysisRun).where(AnalysisRun.id == run_id)
        )
        return result.scalar_one_or_none()

    async def get_run_with_tasks(self, run_id: int) -> AnalysisRun | None:
        """Загружает Run вместе со всеми задачами и агентами (для detail view)."""
        from sqlalchemy.orm import selectinload
        result = await self.db.execute(
            select(AnalysisRun)
            .options(
                selectinload(AnalysisRun.tasks).selectinload(AgentTask.agent),
                selectinload(AnalysisRun.tasks).selectinload(AgentTask.missing_data_requests),
            )
            .where(AnalysisRun.id == run_id)
        )
        return result.scalar_one_or_none()

    async def get_task(self, task_id: int) -> AgentTask | None:
        from sqlalchemy.orm import selectinload
        result = await self.db.execute(
            select(AgentTask)
            .options(
                selectinload(AgentTask.agent),
                selectinload(AgentTask.missing_data_requests),
            )
            .where(AgentTask.id == task_id)
        )
        return result.scalar_one_or_none()
