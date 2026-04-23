from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from app.core.config import settings
import re
import ssl


def _build_async_url(url: str) -> str:
    """Конвертирует URL для asyncpg драйвера."""
    # postgres:// → postgresql+asyncpg://
    url = re.sub(r'^postgres(ql)?(\+\w+)?://', 'postgresql+asyncpg://', url)

    # Убираем sslmode= — asyncpg его не понимает
    url = re.sub(r'[?&]sslmode=[^&]+', '', url)

    # Убираем осиротевший ? если параметров не осталось
    url = re.sub(r'\?$', '', url)

    return url


def _build_ssl_context(url: str) -> ssl.SSLContext | None:
    """Возвращает SSL контекст если нужен, иначе None."""
    needs_ssl = any(x in url for x in [
        'render.com', 'supabase.co', 'neon.tech', 'amazonaws.com'
    ])
    if not needs_ssl:
        return None

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


_async_url = _build_async_url(settings.DATABASE_URL)
_ssl_ctx = _build_ssl_context(settings.DATABASE_URL)

engine = create_async_engine(
    _async_url,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"ssl": _ssl_ctx} if _ssl_ctx else {},
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