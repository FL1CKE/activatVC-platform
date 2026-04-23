from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
import re


def _build_async_url(url: str) -> str:
    """
    Конвертирует URL для async драйвера.
    postgresql (sync) → asyncpg (async)
    Убирает sslmode= (не поддерживается asyncpg) и заменяет на ssl=true.
    """
    # Конвертируем драйвер
    if "postgresql+psycopg2://" in url:
        url = url.replace("postgresql+psycopg2://", "postgresql+asyncpg://")
    elif "postgresql://" in url and "asyncpg" not in url:
        url = url.replace("postgresql://", "postgresql+asyncpg://")

    # asyncpg не понимает sslmode= — заменяем на ssl=true
    if "sslmode=require" in url or "sslmode=verify-full" in url or "sslmode=verify-ca" in url:
        url = re.sub(r"[?&]sslmode=[^&]+", "", url)
        url = url + ("&ssl=true" if "?" in url else "?ssl=true")
    elif "sslmode=disable" in url:
        url = re.sub(r"[?&]sslmode=[^&]+", "", url)

    return url


DATABASE_URL = _build_async_url(settings.DATABASE_URL)

# SSL аргументы для connect_args (для Supabase и других managed PostgreSQL)
_connect_args = {}
if "supabase.co" in DATABASE_URL or "ssl=true" in DATABASE_URL:
    import ssl as _ssl
    _ssl_ctx = _ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = _ssl.CERT_NONE
    _connect_args = {"ssl": _ssl_ctx}

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args=_connect_args,
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