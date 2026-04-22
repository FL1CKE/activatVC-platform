from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings


def _build_async_url(url: str) -> str:
    """
    Конвертирует URL для async драйвера.
    postgresql (sync) → asyncpg (async)
    """
    if "postgresql://" in url and "asyncpg" not in url:
        return url.replace("postgresql://", "postgresql+asyncpg://")
    if "postgresql+psycopg2://" in url:
        return url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    return url


DATABASE_URL = _build_async_url(settings.DATABASE_URL)

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_recycle=3600,
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncSession:
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Только для dev/test. В продакшне — alembic upgrade head."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
