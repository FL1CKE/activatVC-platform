# RCA Agent — Интеграция в activatVC-platform

## Что добавлено

### Новый агент: RCA (Reference Check Agent)

**Роль в БД:** `RCA`  
**Промпт:** `app/agents/RCA_v1_3.md` (версия 1.3, 575 строк)  
**Модель:** `claude-sonnet-4-6` (Anthropic)

RCA — агент референс-чека. Выходит «в поле» и получает информацию из первых уст.
Работает независимо от DD-агентов, читает их JSON-выходы только для понимания пробелов.

---

## Три режима работы

| Режим | Триггер | Входные данные | Выход |
|-------|---------|----------------|-------|
| `discovery` | auto (score ≥ 66) или manual | Данные стартапа + JSON DD-агентов | JSON: список контактов, запрос фаундеру |
| `briefing` | Инвестор выбрал контакт | `contact_id` (RC-XXX) | HTML-фрагмент: брифинг для аналитика |
| `analysis` | Аналитик загрузил транскрипт | `contact_id` + транскрипт в контексте | JSON: сигналы для CHRO и CMO |

### Условие запуска
RCA **НЕ** запускается автоматически в DD-pipeline.  
Запускается отдельно после получения Investment Score v1:
- **auto**: score v1 ≥ 66 (порог `RCA_SCORE_THRESHOLD`)
- **manual**: инвестор явно запрашивает через API

---

## API

### Запустить RCA
```
POST /api/v1/runs/{run_id}/rca
```

**Тело запроса:**
```json
{
  "mode": "discovery",
  "trigger_type": "manual"
}
```

**Режим briefing (требует contact_id из discovery):**
```json
{
  "mode": "briefing",
  "contact_id": "RC-001",
  "trigger_type": "manual"
}
```

**Режим analysis:**
```json
{
  "mode": "analysis",
  "contact_id": "RC-001",
  "trigger_type": "manual"
}
```

**Ответ (202 Accepted):**
```json
{
  "task_id": 42,
  "run_id": 7,
  "rca_mode": "discovery",
  "rca_contact_id": null,
  "trigger_type": "manual",
  "status": "pending",
  "message": "RCA task created (mode=discovery). Poll GET /runs/7/tasks/42 for status and result."
}
```

### Получить результат
```
GET /api/v1/runs/{run_id}/tasks/{task_id}
```
Поле `report_content` содержит JSON (discovery/analysis) или HTML (briefing).
Поля `rca_mode` и `rca_contact_id` указывают режим задачи.

---

## Поток данных

```
DD Pipeline завершён → Investment Score v1 рассчитан
         │
         ▼ (score ≥ 66 или manual)
POST /runs/{id}/rca  {mode: "discovery"}
         │
         ▼
OrchestratorService.trigger_rca()
  ├── Создаёт AgentTask (rca_mode="discovery")
  ├── Помечает AnalysisRun.rca_triggered=True
  └── _build_rca_context():
        ├── startup_data (стадия, описание, контакты фаундера)
        └── dd_agents_json (JSON всех завершённых DD-агентов → для анализа пробелов)
         │
         ▼
BaseAgent.run()
  └── _build_messages():
        ├── Стандартный startup_context
        └── ## RCA Execution Context (mode, stage, founder_contacts, DD JSONs)
         │
         ▼
LLM (claude-sonnet-4-6)
  └── Возвращает discovery JSON
         │
         ▼
Инвестор изучает список контактов → выбирает RC-001
         │
POST /runs/{id}/rca  {mode: "briefing", contact_id: "RC-001"}
         │
         ▼
LLM → HTML брифинг для аналитика
         │
Аналитик проводит звонок, загружает транскрипт
         │
POST /runs/{id}/rca  {mode: "analysis", contact_id: "RC-001"}
  └── Транскрипт передаётся в контексте startup_data или как дополнительный документ
         │
         ▼
LLM → analysis JSON (сигналы для CHRO/CMO, score_delta)
  └── Orchestrator применяет score_delta → Investment Score v2
```

---

## Изменения в файлах

| Файл | Изменение |
|------|-----------|
| `app/agents/RCA_v1_3.md` | **Новый файл** — промпт RCA v1.3 |
| `app/scripts/seed_agents.py` | 7-й агент RCA + `_load_rca_prompt()` |
| `app/services/orchestrator.py` | `RCA_ROLE`, `RCA_SCORE_THRESHOLD`, `trigger_rca()`, `_build_rca_context()` |
| `app/agents/base_agent.py` | RCA execution context в `_build_messages()` |
| `app/models/run.py` | `AnalysisRun.rca_triggered`, `AnalysisRun.rca_trigger_type`, `AgentTask.rca_mode`, `AgentTask.rca_contact_id` |
| `app/schemas/run.py` | Новые поля в `AgentTaskResponse` и `AnalysisRunResponse` |
| `app/api/v1/runs.py` | `POST /runs/{id}/rca` endpoint, `TriggerRCARequest` схема |
| `alembic/versions/0005_add_rca_agent.py` | **Новая миграция** |

---

## Деплой

### 1. Применить миграцию БД
```bash
alembic upgrade head
```

### 2. Добавить RCA в БД
```bash
python -m app.scripts.seed_agents
```
Вывод должен включать:
```
✓ Created agent: RCA — Reference Check Agent [CONDITIONAL: score ≥ 66 or manual]
```

---

## Сигналы и score_delta

RCA передаёт сигналы **только** агентам CHRO и CMO (согласно § 10.6 промпта).  
Диапазон `score_delta`: от **−20** до **+10**.  
Наблюдения о зонах CFO / CLO / CPO идут в `out_of_scope_observations[]` без поправки к скору.

Orchestrator применяет коэффициент достоверности:
- `high` → 100% delta
- `medium` → 50% delta  
- `low` → 25% delta
