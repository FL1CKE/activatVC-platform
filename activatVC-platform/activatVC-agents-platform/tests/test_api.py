"""
Тесты API роутов через httpx AsyncClient + PostgreSQL test DB.
Запуск: pytest tests/test_api.py -v

Требуется тестовая БД: postgresql+asyncpg://admin:adminpassword@localhost:5433/agents_platform_test
"""
import os
import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from unittest.mock import patch, AsyncMock

from app.main import app
from app.core.database import Base, get_db

TEST_DB_URL = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://admin:adminpassword@localhost:5433/agents_platform_test",
)

test_engine = create_async_engine(TEST_DB_URL)
TestSession = async_sessionmaker(test_engine, expire_on_commit=False)


async def override_db():
    async with TestSession() as s:
        try:
            yield s
            await s.commit()
        except Exception:
            await s.rollback()
            raise


@pytest.fixture(autouse=True)
async def setup_db():
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def client():
    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
async def agent(client):
    r = await client.post("/api/v1/agents", json={
        "name": "Test CFO", "role": "CFO_TEST",
        "model_provider": "openai", "model_version": "gpt-4o",
        "initial_prompt": "You are a CFO.",
    })
    assert r.status_code == 201
    return r.json()


# ─── Health ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_health(client):
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


# ─── Agents ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_agents_empty(client):
    r = await client.get("/api/v1/agents")
    assert r.status_code == 200
    assert r.json()["total"] == 0


@pytest.mark.asyncio
async def test_create_agent_success(client):
    r = await client.post("/api/v1/agents", json={
        "name": "CFO", "role": "CFO",
        "model_provider": "openai", "model_version": "gpt-4o",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["role"] == "CFO"
    assert data["has_api_key"] is False
    assert "api_key_encrypted" not in data
    assert "api_key" not in data


@pytest.mark.asyncio
async def test_create_agent_duplicate_role(client, agent):
    r = await client.post("/api/v1/agents", json={
        "name": "Another", "role": "CFO_TEST",
        "model_provider": "openai", "model_version": "gpt-4o",
    })
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_get_agent(client, agent):
    r = await client.get(f"/api/v1/agents/{agent['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == agent["id"]


@pytest.mark.asyncio
async def test_get_agent_not_found(client):
    assert (await client.get("/api/v1/agents/99999")).status_code == 404


@pytest.mark.asyncio
async def test_update_agent(client, agent):
    r = await client.patch(f"/api/v1/agents/{agent['id']}", json={
        "model_version": "gpt-4o-mini", "is_active": False,
    })
    assert r.status_code == 200
    assert r.json()["model_version"] == "gpt-4o-mini"
    assert r.json()["is_active"] is False


@pytest.mark.asyncio
async def test_rotate_and_list_api_keys(client, agent):
    r1 = await client.post(f"/api/v1/agents/{agent['id']}/api-keys", json={
        "api_key": "sk-test-1234567890",
        "comment": "Initial for tests",
    })
    assert r1.status_code == 201
    d1 = r1.json()
    assert d1["version"] == 1
    assert d1["is_active"] is True
    assert d1["key_masked"].startswith("sk-t")

    r2 = await client.post(f"/api/v1/agents/{agent['id']}/api-keys", json={
        "api_key": "sk-test-abcdefghij",
        "comment": "Rotate",
    })
    assert r2.status_code == 201
    d2 = r2.json()
    assert d2["version"] == 2
    assert d2["is_active"] is True

    rh = await client.get(f"/api/v1/agents/{agent['id']}/api-keys/history?limit=5")
    assert rh.status_code == 200
    history = rh.json()
    assert len(history) == 2
    assert history[0]["version"] == 2
    assert history[0]["is_active"] is True
    assert history[1]["version"] == 1
    assert history[1]["is_active"] is False

    ra = await client.get(f"/api/v1/agents/{agent['id']}")
    assert ra.status_code == 200
    assert ra.json()["has_api_key"] is True


@pytest.mark.asyncio
async def test_rollback_api_key(client, agent):
    await client.post(f"/api/v1/agents/{agent['id']}/api-keys", json={"api_key": "sk-test-1111"})
    await client.post(f"/api/v1/agents/{agent['id']}/api-keys", json={"api_key": "sk-test-2222"})

    rr = await client.post(f"/api/v1/agents/{agent['id']}/api-keys/rollback/1")
    assert rr.status_code == 200
    rollback = rr.json()
    assert rollback["version"] == 3
    assert "Rollback" in (rollback["comment"] or "")


# ─── Prompts ──────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_prompt_version(client, agent):
    r = await client.post(f"/api/v1/agents/{agent['id']}/prompts", json={
        "content": "Improved v2 prompt", "format": "text", "comment": "Better"
    })
    assert r.status_code == 201
    assert r.json()["version"] == 2
    assert r.json()["is_active"] is True


@pytest.mark.asyncio
async def test_rollback_prompt(client, agent):
    await client.post(f"/api/v1/agents/{agent['id']}/prompts", json={
        "content": "V2", "format": "text"
    })
    r = await client.post(f"/api/v1/agents/{agent['id']}/prompts/rollback/1")
    assert r.status_code == 200
    assert r.json()["version"] == 3
    assert "Rollback" in r.json()["comment"]


# ─── Runs ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_runs_empty(client):
    r = await client.get("/api/v1/runs")
    assert r.status_code == 200
    assert r.json()["total"] == 0


@pytest.mark.asyncio
async def test_mock_ids(client):
    r = await client.get("/api/v1/runs/mock-ids")
    assert r.status_code == 200
    assert "mock-saas-001" in r.json()


@pytest.mark.asyncio
async def test_trigger_run_invalid_mock(client):
    r = await client.post("/api/v1/runs/trigger", json={
        "application_id": "bad-id", "use_mock": True,
    })
    assert r.status_code == 400
    assert "Unknown mock ID" in r.json()["detail"]


@pytest.mark.asyncio
async def test_trigger_run_creates_run(client, agent):
    """
    Фикс: run_analysis запускается как BackgroundTask и создаёт свою сессию
    через AsyncSessionLocal — не тестовую. Мокаем run_analysis чтобы он
    не пытался обращаться к БД, тест проверяет только создание Run.
    """
    with patch(
        "app.services.orchestrator.OrchestratorService.run_analysis",
        new_callable=AsyncMock,
    ):
        r = await client.post("/api/v1/runs/trigger", json={
            "application_id": "mock-saas-001", "use_mock": True,
        })

    assert r.status_code == 202
    data = r.json()
    assert data["application_id"] == "mock-saas-001"
    assert "id" in data


@pytest.mark.asyncio
async def test_get_run_not_found(client):
    assert (await client.get("/api/v1/runs/99999")).status_code == 404


@pytest.mark.asyncio
async def test_export_not_found(client):
    assert (await client.get("/api/v1/export/99999/md")).status_code == 404
