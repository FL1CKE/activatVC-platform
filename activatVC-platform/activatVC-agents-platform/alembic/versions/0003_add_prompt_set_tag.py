"""Add prompt_set_tag to analysis_runs

Revision ID: 0003_add_prompt_set_tag
Revises: 0002_agent_api_key_history
Create Date: 2026-03-30 00:00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_add_prompt_set_tag"
down_revision: Union[str, None] = "0002_agent_api_key_history"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns(table_name)}
    return column_name in columns


def upgrade() -> None:
    if not _has_column("analysis_runs", "prompt_set_tag"):
        op.add_column(
            "analysis_runs",
            sa.Column("prompt_set_tag", sa.String(length=64), nullable=True),
        )


def downgrade() -> None:
    if _has_column("analysis_runs", "prompt_set_tag"):
        op.drop_column("analysis_runs", "prompt_set_tag")
