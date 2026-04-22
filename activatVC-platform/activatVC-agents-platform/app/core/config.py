from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from pathlib import Path


from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from pathlib import Path
import os


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Startup Analyzer"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = False

    # Database
    DATABASE_URL: str
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20

    # Master Agent API
    MASTER_AGENT_BASE_URL: str = "http://127.0.0.1:3100"
    MASTER_AGENT_TIMEOUT: int = 30
    ORCHESTRATION_MODE: str = "master_webhook"  # master_webhook | standalone

    # File Storage
    STORAGE_PATH: Path = Path("./storage")
    PROMPTS_PATH: Path = Path("./storage/prompts")
    REPORTS_PATH: Path = Path("./storage/reports")

    # Security
    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    # CORS — comma-separated origins, or "*" for all (dev only)
    CORS_ORIGINS_RAW: str = "*"

    # Frontend — путь к собранному Vite build для production-режима.
    # Оставьте пустым если фронтенд запускается отдельно (dev-режим).
    FRONTEND_DIR: str = ""

    @property
    def CORS_ORIGINS(self) -> list[str]:
        raw = self.CORS_ORIGINS_RAW.strip()
        if raw == "*":
            return ["*"]
        return [o.strip() for o in raw.split(",") if o.strip()]

    # LLM defaults — system is 100% Anthropic Claude
    DEFAULT_LLM_PROVIDER: str = "anthropic"
    FALLBACK_LLM_PROVIDER: str = "openai"
    FALLBACK_LLM_MODEL: str = "gpt-4.1"
    OPENAI_API_KEY: str = ""
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_API_KEY: str = ""

    @field_validator("STORAGE_PATH", "PROMPTS_PATH", "REPORTS_PATH", mode="before")
    @classmethod
    def create_dirs(cls, v: str) -> Path:
        path = Path(v)
        path.mkdir(parents=True, exist_ok=True)
        return path

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
        "extra": "ignore",
    }


# Кэшируем — Settings создаётся один раз за время жизни приложения
# lru_cache гарантирует что .env читается только при старте
@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
