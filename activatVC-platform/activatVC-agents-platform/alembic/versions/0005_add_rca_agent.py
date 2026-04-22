"""Add RCA agent support

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-21

RCA (Reference Check Agent) — агент референс-чека.
Запускается при Investment Score v1 ≥ 66 или вручную инвестором.
Работает в трёх режимах: discovery / briefing / analysis.

Изменения:
- analysis_runs.rca_triggered (BOOLEAN, default False) — флаг запуска RCA для данного Run
- analysis_runs.rca_trigger_type (VARCHAR 20, nullable) — 'auto' (score ≥ 66) или 'manual'
- agent_tasks.rca_mode (VARCHAR 20, nullable) — 'discovery' | 'briefing' | 'analysis'
- agent_tasks.rca_contact_id (VARCHAR 50, nullable) — RC-XXX из discovery-вывода для briefing/analysis
"""
from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Флаг: был ли RCA запущен для данного Run
    op.add_column(
        "analysis_runs",
        sa.Column(
            "rca_triggered",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
            comment="True если RCA был запущен (score ≥ 66 или manual trigger).",
        ),
    )

    # Тип триггера RCA
    op.add_column(
        "analysis_runs",
        sa.Column(
            "rca_trigger_type",
            sa.String(20),
            nullable=True,
            comment="'auto' — score ≥ 66; 'manual' — инвестор запустил вручную.",
        ),
    )

    # Режим задачи RCA (discovery / briefing / analysis)
    op.add_column(
        "agent_tasks",
        sa.Column(
            "rca_mode",
            sa.String(20),
            nullable=True,
            comment="Режим RCA: 'discovery' | 'briefing' | 'analysis'. NULL для не-RCA задач.",
        ),
    )

    # contact_id из discovery-результата (нужен для briefing и analysis)
    op.add_column(
        "agent_tasks",
        sa.Column(
            "rca_contact_id",
            sa.String(50),
            nullable=True,
            comment="RC-XXX идентификатор контакта из discovery-JSON. Заполняется для briefing/analysis задач.",
        ),
    )


def downgrade() -> None:
    op.drop_column("agent_tasks", "rca_contact_id")
    op.drop_column("agent_tasks", "rca_mode")
    op.drop_column("analysis_runs", "rca_trigger_type")
    op.drop_column("analysis_runs", "rca_triggered")
