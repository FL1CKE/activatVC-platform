import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

# Alembic Config object
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Импортируем ВСЕ модели — иначе Alembic не увидит таблицы
# Этот импорт критичен: если забыть модель — она не попадёт в миграцию
from app.core.database import Base  # noqa: F401
from app.models import (  # noqa: F401
    Agent, AgentPrompt,
    AnalysisRun, AgentTask, MissingDataRequest,
    ChatMessage,
)

target_metadata = Base.metadata


def get_url() -> str:
    """
    Берём DATABASE_URL из .env через наш Settings.
    Alembic использует синхронный движок — заменяем async драйвер на sync.
    """
    from app.core.config import settings
    url = settings.DATABASE_URL
    # async драйверы → sync для Alembic
    url = url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    return url


def run_migrations_offline() -> None:
    """
    Offline режим — генерирует SQL скрипт без подключения к БД.
    Полезно для code review миграций перед применением.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,       # отслеживает изменения типов колонок
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Online режим — применяет миграции напрямую."""
    from sqlalchemy.ext.asyncio import create_async_engine
    from app.core.config import settings

    url = settings.DATABASE_URL
    # Убеждаемся, что используется async драйвер
    url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")

    connectable = create_async_engine(url, poolclass=pool.NullPool)

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
