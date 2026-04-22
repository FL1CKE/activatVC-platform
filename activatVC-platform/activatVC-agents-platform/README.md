# Activat VC — Платформа ИИ-агентов

Платформа для автоматизированного due diligence стартапов с помощью 5 специализированных ИИ-агентов. Каждый агент — отдельная управленческая роль: CLO, CFO, CHRO, CMO+CCO, CPO+CTO. Платформа работает в связке с мастер-агентом (`startup-automation`).

> **⚠️ Standalone-режим** (`ORCHESTRATION_MODE=standalone`) находится в разработке и пока не настроен для полноценного использования. Для production используйте режим `master_webhook` в связке с `startup-automation`.

## Стек

- **FastAPI** + Uvicorn (async)
- **SQLAlchemy** (async) + PostgreSQL
- **Alembic** — миграции БД
- **LLM**: Anthropic Claude (основной, streaming) / OpenAI GPT-5.4 Pro (автоматический fallback при 403/401) / Google Gemini — переключаемые per-агент через API без перезапуска
- **Экспорт отчётов**: Markdown, DOCX, PDF (xhtml2pdf / ReportLab)
- **Шкала оценок**: 0–100 (не 1–10)

---

## Быстрый старт

### 1. Клонируем и создаём .env

```bash
cp .env.example .env
```

Минимальный `.env` для локального запуска:

```env
DATABASE_URL=postgresql+asyncpg://admin:adminpassword@localhost:5433/agents_platform
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...          # для автоматического fallback при 403/401
DEFAULT_LLM_PROVIDER=anthropic
FALLBACK_LLM_PROVIDER=openai        # провайдер для fallback
FALLBACK_LLM_MODEL=gpt-4.1     # модель для fallback
MASTER_AGENT_BASE_URL=http://127.0.0.1:3100
ORCHESTRATION_MODE=master_webhook
DEBUG=true
```

### 2. Устанавливаем зависимости

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
# source .venv/bin/activate  # Linux/Mac

pip install -r requirements.txt
```

### 3. Применяем миграции

```bash
alembic upgrade head
```

### 4. Заполняем агентов

```bash
# Создаёт 5 агентов (CLO, CFO, CHRO, CMO+CCO, CPO+CTO) с базовыми промптами
python -m app.scripts.seed_agents
```

### 5. Запускаем

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

**Swagger UI:** http://127.0.0.1:8000/api/docs  
**Health check:** http://127.0.0.1:8000/health

---

## Режимы работы

| Режим | ORCHESTRATION_MODE | Описание |
|-------|-------------------|----------|
| **Связка с мастером** | `master_webhook` | Данные стартапа + коллбэки через Master Agent API (`startup-automation`) |
| **Автономный** | `standalone` | Платформа работает самостоятельно, данные mock или из тела запроса |

В автономном режиме можно передавать `use_mock=true` или кастомные `startup_data` в `POST /api/v1/runs/trigger`.

---

## Управление агентами во время работы

Все настройки применяются мгновенно на следующем запуске — **перезапуск не нужен**.

```bash
# Сменить модель агента
PATCH /api/v1/agents/{id}
{ "model_version": "claude-sonnet-4-20250514" }

# Сменить провайдера
PATCH /api/v1/agents/{id}
{ "model_provider": "openai", "model_version": "gpt-4o" }

# Новая версия промпта (старая остаётся в истории)
POST /api/v1/agents/{id}/prompts
{ "content": "You are CLO...", "comment": "v2 — усиленный compliance блок" }

# Откат промпта
POST /api/v1/agents/{id}/prompts/rollback/2

# Ротация API-ключа
POST /api/v1/agents/{id}/api-keys
{ "api_key": "sk-ant-..." }

# Откат API-ключа
POST /api/v1/agents/{id}/api-keys/rollback/1
```

---

## Экспорт отчётов

После завершения анализа каждый агент генерирует PDF-отчёт, который автоматически отправляется мастер-агенту. Ручной экспорт:

| Формат | URL |
|--------|-----|
| Markdown | `GET /api/v1/export/{task_id}/md` |
| DOCX | `GET /api/v1/export/{task_id}/docx` |
| PDF | `GET /api/v1/export/{task_id}/pdf` |
| Полный отчёт запуска (MD) | `GET /api/v1/export/run/{run_id}/md` |

---

## Тестовый запуск (без мастер-агента)

```bash
# Запустить анализ с мок-данными
curl -X POST http://127.0.0.1:8000/api/v1/runs/trigger \
  -H "Content-Type: application/json" \
  -d '{"application_id": "mock-saas-001", "use_mock": true}'

# Статус запуска
curl http://127.0.0.1:8000/api/v1/runs/{id}

# Список доступных мок-стартапов
curl http://127.0.0.1:8000/api/v1/runs/mock-ids
```

### Мок-стартапы

| ID | Название | Особенность |
|----|----------|-------------|
| `mock-saas-001` | DataPilot | SaaS B2B, все данные есть |
| `mock-marketplace-002` | CraftHub | Нет финмодели — CFO вернёт `needs_info` |
| `mock-deeptech-003` | NeuralSense | DeepTech pre-revenue, сложный кейс |

---

## Тесты

```bash
pytest tests/ -v
```

---

## Relay-протокол (агент → агент через Master)

Агенты могут запрашивать информацию у других агентов через мастер-агента. Для этого LLM возвращает в ответе:

```
RELAY_TO: CFO
RELAY_QUESTION: What is the current burn rate and runway?
```

Платформа автоматически перехватывает это и отправляет `POST /api/webhooks/startups/{id}/relay/question` в мастер-агент. Ответ придёт в следующем раунде через `relayAnswer` в данных стартапа.

---

## Структура проекта

```
app/
├── api/v1/
│   ├── agents.py    — CRUD + промпты + ключи
│   ├── runs.py      — запуск и мониторинг
│   ├── chat.py      — чат с агентом после анализа
│   ├── export.py    — экспорт MD/DOCX/PDF
│   └── webhook.py   — webhook от Master Agent
├── agents/
│   ├── base_agent.py       — единый класс всех агентов
│   ├── llm_client.py       — абстракция Claude/OpenAI/Gemini
│   └── document_parser.py  — парсинг PDF/DOCX/MD
├── core/
│   ├── config.py    — настройки из .env
│   └── database.py  — SQLAlchemy async
├── external/
│   ├── master_agent_client.py  — HTTP клиент для Master Agent API
│   └── mock_data.py            — тестовые стартапы
├── models/          — SQLAlchemy ORM модели
├── schemas/         — Pydantic схемы (agent, chat, run, startup)
├── services/
│   ├── orchestrator.py    — параллельный запуск агентов
│   ├── agent_service.py   — CRUD + версионирование
│   ├── run_service.py     — запросы по запускам
│   └── report_service.py  — генерация PDF/DOCX
└── scripts/
    ├── seed_agents.py         — начальное заполнение БД
    ├── import_docx_prompts.py — импорт промптов из DOCX
    └── _load_new_prompts.py   — загрузка обновлённых промптов
alembic/   — миграции
scripts/   — git hooks, predeploy-check
tests/     — тесты
```

---

## API Reference

### Agents
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/v1/agents` | Список агентов |
| POST | `/api/v1/agents` | Создать агента |
| GET | `/api/v1/agents/{id}` | Детали |
| PATCH | `/api/v1/agents/{id}` | Обновить (модель, провайдер, статус) |
| GET | `/api/v1/agents/{id}/prompts` | История промптов |
| POST | `/api/v1/agents/{id}/prompts` | Новая версия промпта |
| POST | `/api/v1/agents/{id}/prompts/rollback/{v}` | Откат промпта |
| POST | `/api/v1/agents/{id}/api-keys` | Ротация ключа |
| POST | `/api/v1/agents/{id}/api-keys/rollback/{v}` | Откат ключа |
| GET | `/api/v1/agents/{id}/api-keys/history` | История ключей |

### Runs
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/v1/runs` | Список запусков |
| POST | `/api/v1/runs/trigger` | Запустить анализ |
| GET | `/api/v1/runs/mock-ids` | Список мок-стартапов |
| GET | `/api/v1/runs/{id}` | Детали запуска |

### Export
| Method | URL | Описание |
|--------|-----|----------|
| GET | `/api/v1/export/{task_id}/md` | Markdown |
| GET | `/api/v1/export/{task_id}/docx` | DOCX |
| GET | `/api/v1/export/{task_id}/pdf` | PDF |
| GET | `/api/v1/export/run/{run_id}/md` | Полный отчёт запуска |

---

## Secret Scanning

Перед каждым коммитом автоматически запускается Gitleaks (pre-commit hook). Чтобы активировать:

```powershell
./scripts/install-git-hooks.ps1
```

GitHub Actions workflow: `.github/workflows/secret-scan.yml` — проверяет push и PR.
