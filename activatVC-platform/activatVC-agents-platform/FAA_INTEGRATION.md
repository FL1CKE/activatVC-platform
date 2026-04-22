# FAA Agent — Интеграция в activatVC-platform

## Что добавлено

### 1. Новый агент: FAA (Founder Assessment Agent)

**Роль в БД:** `FAA`  
**Промпт:** `app/agents/FAA_v3_0.md` (версия 3.0, 446 строк)  
**Модель:** `claude-sonnet-4-6` (Anthropic)

FAA — агент оценки фаундеров. Проводит структурированное интервью по 4 блокам:
- **КС** — Когнитивная скорость (30%)
- **РС** — Ресурсность (30%)
- **МГ** — Магнетизм (20%)
- **ПП** — Проверка последовательности (20%)

Итог: **ИБФ 0–100** (Итоговый Балл Фаундера) + вердикт (АНОМАЛИЯ / ИНВЕСТИРОВАТЬ / НАБЛЮДАТЬ / ОТКЛОНИТЬ).

---

## Условие запуска

FAA **не запускается автоматически** со всеми агентами. Оркестратор включает его только при одновременном выполнении двух условий:

1. `startupStage == "pre-seed"` (любая капитализация)
2. **Отсутствует трекшн** — в данных стартапа не обнаружено сигналов:
   - ключевые слова выручки/трекшна в `financialSummary` / `description`
   - `investmentAmount > 0` (признак закрытого раунда)

Если фаундер отказался от интервью — CHRO не штрафуется.

---

## Поток данных

```
TriggerRunRequest
      │
      ▼
OrchestratorService.trigger_run()
  ├── _should_run_faa()  ← проверяет stage + traction
  ├── FAA Task создаётся (если eligible)
  └── Остальные Tasks создаются всегда
      │
      ▼
OrchestratorService.run_analysis()
  ├── [1] FAA запускается ПЕРВЫМ (синхронно)
  │       └── BaseAgent.run() → LLM → _save_completed()
  │               └── faa_signal JSON сохраняется в AgentTask.faa_signal
  │
  ├── [2] Остальные агенты запускаются ПАРАЛЛЕЛЬНО
  │       └── CHRO получает faa_signal в extra_context
  │               └── _build_messages() добавляет FAA Signal секцию в user prompt
  └── _finalize_run()
```

---

## Изменения в файлах

| Файл | Изменение |
|------|-----------|
| `app/agents/FAA_v3_0.md` | **Новый файл** — промпт FAA v3.0 |
| `app/scripts/seed_agents.py` | Добавлен 6-й агент FAA + `_load_faa_prompt()` |
| `app/services/orchestrator.py` | Условный запуск FAA, последовательное выполнение FAA→остальные, передача faa_signal в CHRO |
| `app/agents/base_agent.py` | `extra_context` в `AgentRunContext`, `faa_signal` в `_save_completed()`, `_extract_faa_signal()`, FAA-секция в `_build_messages()` для CHRO |
| `app/models/run.py` | Поле `faa_eligible` в `AnalysisRun`, поле `faa_signal` в `AgentTask` |
| `alembic/versions/0004_add_faa_agent.py` | **Новая миграция** — `agent_tasks.faa_signal`, `analysis_runs.faa_eligible` |

---

## Деплой

### 1. Применить миграцию БД
```bash
alembic upgrade head
```

### 2. Добавить FAA в БД
```bash
python -m app.scripts.seed_agents
```
Вывод должен включать:
```
✓ Created agent: FAA — Founder Assessment Agent [CONDITIONAL: pre-seed + no traction]
```

### 3. Проверка условия запуска (пример)
```python
# В TriggerRunRequest передайте startup_data с pre-seed стадией и без трекшна:
{
  "application_id": "test-123",
  "startup_data": {
    "application": {
      "startupStage": "pre-seed",
      "financialSummary": "",  # пусто = нет трекшна
      "investmentAmount": null
    }
  }
}
# → FAA будет включён в Run
```

---

## Примечание по архитектуре

FAA — **интерактивный** агент (проводит интервью с фаундером). В текущей интеграции он работает в **батч-режиме**: получает данные стартапа и генерирует оценку на основе промпта без реального диалога. Для полноценного интерактивного интервью необходима отдельная UI-страница (реализована в `website-test-/src/App.jsx` из FAA_agent.zip — может быть интегрирована как отдельный экран Processing).
