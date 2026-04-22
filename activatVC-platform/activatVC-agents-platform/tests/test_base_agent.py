"""
Тесты BaseAgent.
Запуск: pytest tests/test_base_agent.py -v
"""
import copy
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agents.base_agent import BaseAgent, AgentRunContext
from app.core.config import settings
from app.agents.document_parser import extract_text
from app.external.mock_data import MOCK_STARTUPS


# ─── Document Parser Tests ─────────────────────────────────────────────────────

def test_extract_text_plain():
    result = extract_text(b"Hello, this is plain text.", "text/plain", "test.txt")
    assert result == "Hello, this is plain text."


def test_extract_text_markdown():
    result = extract_text(b"# Title\n\nSome **bold** text.", "text/markdown", "test.md")
    assert "Title" in result
    assert "bold" in result


def test_extract_text_unsupported_format():
    result = extract_text(b"\x00\x01\x02", "application/octet-stream", "file.bin")
    assert "[Unsupported format" in result


def test_extract_text_truncates_large_content():
    from app.agents.document_parser import MAX_CHARS
    large_content = ("x" * (MAX_CHARS + 1000)).encode()
    result = extract_text(large_content, "text/plain", "big.txt")
    assert len(result) <= MAX_CHARS + 100
    assert "truncated" in result


def test_extract_text_empty_bytes():
    result = extract_text(b"", "text/plain", "empty.txt")
    assert result == ""


# ─── Mock data structure tests ─────────────────────────────────────────────────

def test_saas_startup_has_founders():
    data = MOCK_STARTUPS["mock-saas-001"]
    founders = data["application"]["founders"]
    assert len(founders) == 2
    assert any(f["role"] == "CEO" for f in founders)
    assert any(f["role"] == "CTO" for f in founders)


def test_deeptech_has_three_founders():
    data = MOCK_STARTUPS["mock-deeptech-003"]
    assert len(data["application"]["founders"]) == 3


def test_marketplace_missing_financial_docs():
    data = MOCK_STARTUPS["mock-marketplace-002"]
    classified = [d["classifiedAs"] for d in data["documents"]]
    assert "FinancialModel" not in classified


# ─── AgentRunContext helpers ───────────────────────────────────────────────────

def _make_ctx(startup_id: str = "mock-saas-001") -> AgentRunContext:
    """
    Создаём контекст с КОПИЕЙ данных стартапа — не мутируем глобальный MOCK_STARTUPS.
    Фикс: тест test_check_missing_data_none_when_all_present добавлял документ
    в глобальный словарь, и он оставался для test_fetch_startup_data_success.
    """
    from app.models.agent import Agent, AgentPrompt

    agent = MagicMock(spec=Agent)
    agent.role = "CFO"
    agent.model_provider = "openai"
    agent.model_version = "gpt-4o"
    agent.api_key_encrypted = None

    prompt = MagicMock(spec=AgentPrompt)
    prompt.content = "You are a CFO. Analyze finances.\n\n## REQUIRED_DOCS\n- FinancialModel\n"

    ctx = AgentRunContext(
        task_id=1,
        application_id=startup_id,
        agent=agent,
        prompt=prompt,
        use_mock=True,
    )
    # ВАЖНО: deep copy чтобы не мутировать глобальный MOCK_STARTUPS
    ctx.startup_data = copy.deepcopy(MOCK_STARTUPS[startup_id])
    ctx.documents_text = [
        {"name": "pitch.pdf", "classified_as": "PitchDeck", "text": "Startup pitch content..."}
    ]
    return ctx


# ─── Message building ──────────────────────────────────────────────────────────

def test_build_messages_includes_startup_name():
    ctx = _make_ctx("mock-saas-001")
    agent = BaseAgent.__new__(BaseAgent)
    messages = agent._build_messages(ctx)
    full_text = " ".join(m.content for m in messages)
    assert "DataPilot" in full_text


def test_build_messages_has_system_and_user():
    ctx = _make_ctx()
    agent = BaseAgent.__new__(BaseAgent)
    messages = agent._build_messages(ctx)
    roles = [m.role for m in messages]
    assert "system" in roles
    assert "user" in roles


def test_build_messages_includes_document_text():
    ctx = _make_ctx()
    agent = BaseAgent.__new__(BaseAgent)
    messages = agent._build_messages(ctx)
    user_content = next(m.content for m in messages if m.role == "user")
    assert "pitch content" in user_content


# ─── Missing data detection ────────────────────────────────────────────────────

def test_check_missing_data_detects_missing():
    ctx = _make_ctx("mock-marketplace-002")   # нет FinancialModel
    agent = BaseAgent.__new__(BaseAgent)
    missing = agent._check_missing_data(ctx)
    assert missing is not None
    assert "FinancialModel" in missing


def test_check_missing_data_none_when_all_present():
    ctx = _make_ctx("mock-saas-001")
    # Добавляем FinancialModel в КОПИЮ данных (не в глобальный MOCK_STARTUPS)
    ctx.startup_data["documents"].append({
        "id": "x", "originalName": "fin.xlsx",
        "mimeType": "application/xlsx",
        "category": "finance",
        "classifiedAs": "FinancialModel",
        "fileUrl": "http://test/fin.xlsx",
    })
    agent = BaseAgent.__new__(BaseAgent)
    missing = agent._check_missing_data(ctx)
    assert missing is None


def test_check_missing_data_accepts_snake_case_financial_model():
    ctx = _make_ctx("mock-saas-001")
    for document in ctx.startup_data["documents"]:
        if document.get("classifiedAs") == "FinancialModel":
            document["classifiedAs"] = "financial_model"

    agent = BaseAgent.__new__(BaseAgent)
    missing = agent._check_missing_data(ctx)
    assert missing is None


def test_check_missing_data_treats_burn_rate_report_as_financial_equivalent():
    ctx = _make_ctx("mock-saas-001")
    ctx.prompt.content = "You are a CFO.\n\n## REQUIRED_DOCS\n- BurnRateReport\n"
    for document in ctx.startup_data["documents"]:
        if document.get("classifiedAs") == "FinancialModel":
            document["classifiedAs"] = "financial_model"

    agent = BaseAgent.__new__(BaseAgent)
    missing = agent._check_missing_data(ctx)
    assert missing is None


def test_check_missing_data_none_when_no_required_section():
    ctx = _make_ctx()
    ctx.prompt.content = "You are a CRO. No required docs section here."
    agent = BaseAgent.__new__(BaseAgent)
    missing = agent._check_missing_data(ctx)
    assert missing is None


# ─── LLM Client factory ────────────────────────────────────────────────────────

def test_create_llm_provider_openai():
    from app.agents.llm_client import create_llm_provider, OpenAIProvider
    with patch("openai.AsyncOpenAI"):
        provider = create_llm_provider("openai", "sk-test")
    assert isinstance(provider, OpenAIProvider)


def test_create_llm_provider_anthropic():
    from app.agents.llm_client import create_llm_provider, AnthropicProvider
    with patch("anthropic.AsyncAnthropic"):
        provider = create_llm_provider("anthropic", "sk-ant-test")
    assert isinstance(provider, AnthropicProvider)


def test_create_llm_provider_unknown_raises():
    from app.agents.llm_client import create_llm_provider
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        create_llm_provider("gpt5-imaginary", "key")


@pytest.mark.asyncio
async def test_fetch_startup_data_standalone_fallbacks_to_master(monkeypatch):
    monkeypatch.setattr(settings, "ORCHESTRATION_MODE", "standalone")

    agent_model = MagicMock()
    agent_model.role = "CFO"

    prompt_model = MagicMock()
    prompt_model.content = "Prompt"

    ctx = AgentRunContext(
        task_id=10,
        application_id="app-123",
        agent=agent_model,
        prompt=prompt_model,
        use_mock=False,
    )

    run = MagicMock()
    run.startup_data_json = None

    result_proxy = MagicMock()
    result_proxy.scalar_one_or_none.return_value = run

    db = MagicMock()
    db.execute = AsyncMock(return_value=result_proxy)

    master_client = MagicMock()
    master_client.fetch_startup_data = AsyncMock(return_value={
        "application": {"startupName": "Acme"},
        "documents": [],
    })

    agent = BaseAgent(db=db, master_client=master_client)

    await agent._fetch_startup_data(ctx)

    master_client.fetch_startup_data.assert_awaited_once_with("app-123", agent_name="CFO")
    assert ctx.startup_data["application"]["startupName"] == "Acme"
    assert ctx.sync_to_master is True


@pytest.mark.asyncio
async def test_fetch_startup_data_standalone_prefers_embedded_payload(monkeypatch):
    monkeypatch.setattr(settings, "ORCHESTRATION_MODE", "standalone")

    agent_model = MagicMock()
    agent_model.role = "CFO"

    prompt_model = MagicMock()
    prompt_model.content = "Prompt"

    embedded_payload = {
        "application": {"startupName": "Embedded"},
        "documents": [],
    }

    ctx = AgentRunContext(
        task_id=11,
        application_id="app-embedded",
        agent=agent_model,
        prompt=prompt_model,
        use_mock=False,
    )

    run = MagicMock()
    run.startup_data_json = embedded_payload

    result_proxy = MagicMock()
    result_proxy.scalar_one_or_none.return_value = run

    db = MagicMock()
    db.execute = AsyncMock(return_value=result_proxy)

    master_client = MagicMock()
    master_client.fetch_startup_data = AsyncMock()

    agent = BaseAgent(db=db, master_client=master_client)

    await agent._fetch_startup_data(ctx)

    master_client.fetch_startup_data.assert_not_awaited()
    assert ctx.startup_data["application"]["startupName"] == "Embedded"
    assert ctx.sync_to_master is False


@pytest.mark.asyncio
async def test_submit_completed_skips_when_sync_disabled():
    ctx = _make_ctx()
    ctx.use_mock = False
    ctx.sync_to_master = False
    ctx.llm_response = MagicMock()
    ctx.llm_response.content = "report"

    master_client = MagicMock()
    master_client.submit_completed = AsyncMock()
    master_client.submit_relay_consumed = AsyncMock()
    master_client.submit_relay_answer = AsyncMock()
    master_client.submit_relay_question = AsyncMock()

    agent = BaseAgent(db=MagicMock(), master_client=master_client)
    await agent._submit_completed(ctx)

    master_client.submit_completed.assert_not_awaited()
    master_client.submit_relay_consumed.assert_not_awaited()
    master_client.submit_relay_answer.assert_not_awaited()
    master_client.submit_relay_question.assert_not_awaited()


@pytest.mark.asyncio
async def test_submit_completed_calls_master_when_sync_enabled():
    ctx = _make_ctx()
    ctx.use_mock = False
    ctx.sync_to_master = True
    ctx.llm_response = MagicMock()
    ctx.llm_response.content = "report"

    master_client = MagicMock()
    master_client.submit_completed = AsyncMock(return_value={"ok": True})
    master_client.submit_relay_consumed = AsyncMock()
    master_client.submit_relay_answer = AsyncMock()
    master_client.submit_relay_question = AsyncMock()

    db = MagicMock()
    prompt_tag_result = MagicMock()
    prompt_tag_result.scalar_one_or_none.return_value = "test-prompt-tag"
    db.execute = AsyncMock(return_value=prompt_tag_result)

    agent = BaseAgent(db=db, master_client=master_client)
    await agent._submit_completed(ctx)

    master_client.submit_completed.assert_awaited_once()
    kwargs = master_client.submit_completed.await_args.kwargs
    assert kwargs["prompt_set_version"] == "test-prompt-tag"
