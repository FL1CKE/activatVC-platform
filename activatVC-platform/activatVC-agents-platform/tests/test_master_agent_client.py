"""
Тесты Master Agent Client.
Используем httpx.MockTransport чтобы не зависеть от реального сервера.
Запуск: pytest tests/test_master_agent_client.py -v
"""
import json
import pytest
import httpx
from unittest.mock import AsyncMock, patch

from app.external.master_agent_client import MasterAgentClient, StartupNotFoundError, MasterAgentError
from app.external.mock_data import get_mock_startup, list_mock_ids, MOCK_STARTUPS


# ─── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client():
    return MasterAgentClient(base_url="http://test-server", timeout=5)


@pytest.fixture
def saas_startup_data():
    return MOCK_STARTUPS["mock-saas-001"]


# ─── Mock data tests ───────────────────────────────────────────────────────────

def test_mock_data_all_three_startups_exist():
    ids = list_mock_ids()
    assert len(ids) == 3
    assert "mock-saas-001" in ids
    assert "mock-marketplace-002" in ids
    assert "mock-deeptech-003" in ids


def test_mock_startup_has_required_fields():
    for startup_id in list_mock_ids():
        data = get_mock_startup(startup_id)
        assert data is not None
        assert "application" in data
        assert "documents" in data
        app = data["application"]
        assert "id" in app
        assert "startupName" in app


def test_mock_marketplace_has_no_drive_link():
    """CraftHub намеренно не имеет driveLink — тест сценария needs_info."""
    data = get_mock_startup("mock-marketplace-002")
    assert data["application"]["driveLink"] is None


def test_mock_marketplace_has_missing_financial_docs():
    """CraftHub не имеет финансовой модели — CFO должен запросить needs_info."""
    data = get_mock_startup("mock-marketplace-002")
    doc_types = [d["classifiedAs"] for d in data["documents"]]
    assert "FinancialModel" not in doc_types


def test_mock_unknown_id_returns_none():
    assert get_mock_startup("nonexistent-id") is None


# ─── Client tests (с мок HTTP) ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_startup_data_success(client, saas_startup_data):
    """Успешный GET /data — возвращает данные стартапа."""
    mock_response = httpx.Response(200, json=saas_startup_data)

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
        result = await client.fetch_startup_data("mock-saas-001")

    assert result["application"]["startupName"] == "DataPilot"
    assert len(result["documents"]) == 3


@pytest.mark.asyncio
async def test_fetch_startup_data_404_raises(client):
    """404 от сервера → StartupNotFoundError."""
    mock_response = httpx.Response(404, json={"error": "not found"})

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock, return_value=mock_response):
        with pytest.raises(StartupNotFoundError):
            await client.fetch_startup_data("nonexistent-uuid")


@pytest.mark.asyncio
async def test_submit_needs_info_success(client):
    """POST needs_info — сервер отвечает 200."""
    mock_response = httpx.Response(200, json={"gapItemsCount": 2, "status": "ok"})

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        result = await client.submit_needs_info(
            application_id="mock-marketplace-002",
            agent_name="CFO",
            requested_docs=["FinancialModel", "BurnRateReport"],
        )

    assert result["gapItemsCount"] == 2


@pytest.mark.asyncio
async def test_submit_completed_success(client):
    """POST completed с отчётом — сервер отвечает 200."""
    mock_response = httpx.Response(200, json={"status": "saved"})

    with patch("httpx.AsyncClient.post", new_callable=AsyncMock, return_value=mock_response):
        result = await client.submit_completed(
            application_id="mock-saas-001",
            agent_name="CFO",
            report_content="# Financial Analysis\n\nARR $1.8M, MoM 12%...",
        )

    assert result["status"] == "saved"


@pytest.mark.asyncio
async def test_check_document_availability_true(client):
    mock_response = httpx.Response(200)

    with patch("httpx.AsyncClient.head", new_callable=AsyncMock, return_value=mock_response):
        result = await client.check_document_availability("http://test-server:9100/file.pdf")

    assert result is True


@pytest.mark.asyncio
async def test_check_document_availability_false_on_error(client):
    with patch("httpx.AsyncClient.head", new_callable=AsyncMock, side_effect=httpx.ConnectError("fail")):
        result = await client.check_document_availability("http://unreachable/file.pdf")

    assert result is False
