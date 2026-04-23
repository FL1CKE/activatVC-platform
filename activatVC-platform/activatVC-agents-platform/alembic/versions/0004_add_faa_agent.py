"""Add FAA agent support: faa_signal field on agent_tasks, faa_eligible flag on runs

Revision ID: 0004
Revises: 0003_add_prompt_set_tag
Create Date: 2026-04-20

FAA (Founder Assessment Agent) — 6-й агент платформы.
Запускается только при stage=pre-seed + отсутствие трекшна.

Изменения:
- agent_tasks.faa_signal (JSON TEXT, nullable) — результат интервью FAA в виде JSON,
  который Orchestrator передаёт агенту CHRO через поле faa_signal.
- analysis_runs.faa_eligible (BOOLEAN, default False) — флаг, был ли FAA включён
  в данный Run по условию (pre-seed + no traction). Нужен для отчётности.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "0004"
down_revision = "0003_add_prompt_set_tag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Добавляем поле faa_signal в agent_tasks:
    # хранит JSON-результат интервью FAA (схема из ЧАСТИ 9 промпта FAA_v3_0.md)
    op.add_column(
        "agent_tasks",
        sa.Column(
            "faa_signal",
            sa.Text(),
            nullable=True,
            comment=(
                "JSON-результат сессии FAA (ИБФ, вердикт, блоки, флаги). "
                "Заполняется только для задач агента FAA. "
                "Передаётся в контекст агента CHRO через Orchestrator."
            ),
        ),
    )

    # Добавляем флаг faa_eligible в analysis_runs:
    # показывает, был ли FAA включён в этот Run
    op.add_column(
        "analysis_runs",
        sa.Column(
            "faa_eligible",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment=(
                "True если FAA был включён в Run: stage=pre-seed + no traction. "
                "False если FAA был пропущен (стадия не pre-seed или обнаружен трекшн)."
            ),
        ),
    )


def downgrade() -> None:
    op.drop_column("analysis_runs", "faa_eligible")
    op.drop_column("agent_tasks", "faa_signal")
