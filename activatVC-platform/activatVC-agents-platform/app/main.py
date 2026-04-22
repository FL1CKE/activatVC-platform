from contextlib import asynccontextmanager
import logging
import traceback
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.core.database import init_db

logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Ищем папку frontend относительно корня проекта (на уровень выше app/)
# В dev-режиме (Vite отдельно) папки нет — это нормально, INFO вместо WARNING
_BASE_DIR = Path(__file__).parent.parent
_cfg_frontend = settings.FRONTEND_DIR.strip() if settings.FRONTEND_DIR else ""
FRONTEND_DIR = Path(_cfg_frontend) if _cfg_frontend else _BASE_DIR / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    if settings.DEBUG:
        await init_db()
        logger.info("DB initialized")
    yield
    logger.info("Shutdown")


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.error(
        "Unhandled exception on %s %s: %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "detail": str(exc)},
    )

# ─── API роуты ─────────────────────────────────────────────────────────────────
from app.api.v1 import agents, runs, chat, webhook, export  # noqa: E402

app.include_router(agents.router,  prefix="/api/v1/agents",  tags=["Agents"])
app.include_router(runs.router,    prefix="/api/v1/runs",    tags=["Runs"])
app.include_router(chat.router,    prefix="/api/v1/chat",    tags=["Chat"])
app.include_router(webhook.router, prefix="/api/v1/webhook", tags=["Webhook"])
app.include_router(export.router,  prefix="/api/v1/export",  tags=["Export"])


@app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


# ─── Фронтенд ──────────────────────────────────────────────────────────────────
# В production: собранный Vite build кладётся в папку frontend/ рядом с app/
# В development: фронтенд запускается отдельно (npm run dev:all в ventureiq/)
#   → папки frontend/ нет, это штатная ситуация, INFO вместо WARNING
if FRONTEND_DIR.exists():
    logger.info(f"Serving frontend from {FRONTEND_DIR}")

    @app.get("/", include_in_schema=False)
    async def frontend_index():
        return FileResponse(FRONTEND_DIR / "index.html")

    @app.get("/run", include_in_schema=False)
    async def frontend_run():
        return FileResponse(FRONTEND_DIR / "run.html")

    @app.get("/agents", include_in_schema=False)
    async def frontend_agents_page():
        return FileResponse(FRONTEND_DIR / "agents.html")

    # Статические файлы (CSS, JS, assets)
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    logger.info(
        "Frontend directory not found at '%s'. "
        "Running in API-only mode — start the Vite dev server separately: "
        "cd ventureiq && npm run dev:all",
        FRONTEND_DIR,
    )
