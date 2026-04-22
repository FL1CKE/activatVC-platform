"""Initial schema — all tables

Revision ID: 0001_initial
Revises:
Create Date: 2024-01-01 00:00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "agents",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("role", sa.String(50), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "model_provider",
            # Нижний регистр — совпадает с Python Enum значениями
            sa.Enum("openai", "anthropic", "google", "custom", name="modelprovider"),
            nullable=False,
            server_default="openai",
        ),
        sa.Column("model_version", sa.String(100), nullable=False),
        sa.Column("api_key_encrypted", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("role"),
    )
    op.create_index("ix_agents_id", "agents", ["id"])

    op.create_table(
        "agent_prompts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column(
            "format",
            sa.Enum("text", "markdown", "docx", name="promptformat"),
            nullable=False,
            server_default="text",
        ),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("comment", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(100), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_prompts_id", "agent_prompts", ["id"])
    op.create_index("ix_agent_prompts_agent_id", "agent_prompts", ["agent_id"])

    op.create_table(
        "analysis_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("application_id", sa.String(100), nullable=False),
        sa.Column("startup_name", sa.String(255), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "waiting_data", "completed", "failed", name="runstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("triggered_by", sa.String(50), nullable=False, server_default="manual"),
        sa.Column("startup_data_json", sa.JSON(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_analysis_runs_id", "analysis_runs", ["id"])
    op.create_index("ix_analysis_runs_application_id", "analysis_runs", ["application_id"])

    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("prompt_version_id", sa.Integer(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("pending", "running", "needs_info", "completed", "failed", "retrying", name="taskstatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("report_content", sa.Text(), nullable=True),
        sa.Column("report_file_path", sa.String(500), nullable=True),
        sa.Column("tokens_used", sa.Integer(), nullable=True),
        sa.Column("llm_model_used", sa.String(100), nullable=True),
        sa.Column("execution_time_seconds", sa.Float(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retry_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["analysis_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["prompt_version_id"], ["agent_prompts.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_tasks_id", "agent_tasks", ["id"])
    op.create_index("ix_agent_tasks_run_id", "agent_tasks", ["run_id"])
    op.create_index("ix_agent_tasks_agent_id", "agent_tasks", ["agent_id"])

    op.create_table(
        "missing_data_requests",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("requested_docs", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "fulfilled", "cancelled", name="missingdatastatus"),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("requested_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("fulfilled_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_missing_data_requests_id", "missing_data_requests", ["id"])
    op.create_index("ix_missing_data_requests_task_id", "missing_data_requests", ["task_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("user", "assistant", "system", name="messagerole"),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_id", "chat_messages", ["id"])
    op.create_index("ix_chat_messages_task_id", "chat_messages", ["task_id"])


def downgrade() -> None:
    op.drop_table("chat_messages")
    op.drop_table("missing_data_requests")
    op.drop_table("agent_tasks")
    op.drop_table("analysis_runs")
    op.drop_table("agent_prompts")
    op.drop_table("agents")
