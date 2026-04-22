"""Add API key history table

Revision ID: 0002_agent_api_key_history
Revises: 0001_initial
Create Date: 2026-03-29 00:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "0002_agent_api_key_history"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agent_api_keys",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("key_masked", sa.String(length=32), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=False),
        sa.Column("comment", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_api_keys_id", "agent_api_keys", ["id"])
    op.create_index("ix_agent_api_keys_agent_id", "agent_api_keys", ["agent_id"])

    # Migrate existing api_key values into v1 history rows.
    op.execute(
        """
        INSERT INTO agent_api_keys (agent_id, version, is_active, key_masked, api_key_encrypted, comment, created_at, created_by)
        SELECT id, 1, true, '[legacy]', api_key_encrypted, 'Migrated from agents.api_key_encrypted', CURRENT_TIMESTAMP, 'migration'
        FROM agents
        WHERE api_key_encrypted IS NOT NULL AND api_key_encrypted <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_agent_api_keys_agent_id", table_name="agent_api_keys")
    op.drop_index("ix_agent_api_keys_id", table_name="agent_api_keys")
    op.drop_table("agent_api_keys")
