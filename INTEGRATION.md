# activatVC — Full Stack Integration

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                        БРАУЗЕР                              │
│  ventureiq (React/Vite :5173)                               │
│  ├── /api/chat        → Node.js Chat Server (:3001)         │
│  └── /api/platform/*  → Python Agents Backend (:8000)       │
└─────────────────────────────────────────────────────────────┘
         │                        │
         ▼                        ▼
┌─────────────────┐    ┌──────────────────────────────────────┐
│  Node.js        │    │  Python FastAPI                       │
│  server/        │    │  activatVC-agents-platform/           │
│  server.js      │    │                                       │
│  :3001          │    │  Агенты: CLO, CFO, CHRO,             │
│                 │    │  CMO+CCO, CPO+CTO, FAA, RCA          │
│  AI Ассистент   │    │  :8000                               │
│  (Claude)       │    │                                       │
└─────────────────┘    └──────────────────────────────────────┘
                                  │
                                  ▼
                       ┌──────────────────┐
                       │   PostgreSQL     │
                       │   :5433          │
                       └──────────────────┘
```

## Что изменено при интеграции

### ventureiq (FRONT)

| Файл | Изменение |
|------|-----------|
| `src/api/platformApi.js` | **Новый файл** — клиент к Python backend: `triggerAnalysis()`, `pollRunStatus()`, `triggerRCA()`, маппинг данных формы |
| `src/VentureIQ_Prototype_v4.jsx` | `alert()` при сабмите → реальный `handleSubmit()` с polling + панель результатов агентов |
| `vite.config.js` | Раздельный proxy: `/api/chat` → Node `:3001`, `/api/platform` → Python `:8000` |
| `package.json` | Скрипты `dev:all`, `dev:chat` |
| `server/server.js` | CORS обновлён, добавлен прокси `/api/platform/*` → Python (для продакшна) |
| `server/Dockerfile` | **Новый файл** — контейнер Node.js сервера |
| `.env.example` | **Новый файл** — конфиг для фронтенд-сервисов |

### Корень репозитория
| Файл | Описание |
|------|---------|
| `docker-compose.yml` | **Новый файл** — запуск всего стека одной командой |
| `.env.example` | **Новый файл** — корневые переменные окружения |

---

## Быстрый старт (локальная разработка)

### 1. Переменные окружения
```bash
cp .env.example .env
# Заполните ANTHROPIC_API_KEY и другие ключи
```

### 2. Python backend
```bash
cd activatVC-platform/activatVC-agents-platform
cp .env.example .env
# Заполните .env (DATABASE_URL, ANTHROPIC_API_KEY)

pip install -r requirements.txt
alembic upgrade head
python -m app.scripts.seed_agents

uvicorn app.main:app --port 8000 --reload
# → http://localhost:8000/api/docs
```

### 3. Node.js AI-чат
```bash
cd ventureiq
cp .env.example .env
# Заполните ANTHROPIC_API_KEY

npm install
node server/server.js
# → http://localhost:3001
```

### 4. Фронтенд (Vite)
```bash
cd ventureiq
npm run dev
# → http://localhost:5173
```

### Или всё сразу (фронт + Node чат):
```bash
cd ventureiq
npm run dev:all
```

---

## Docker (полный стек)

```bash
cp .env.example .env
# Заполните ANTHROPIC_API_KEY

docker-compose up --build
# Запустит: postgres + python-backend + node-chat
# Фронтенд собирается отдельно или через профиль dev:
docker-compose --profile dev up
```

После запуска:
- Фронтенд: http://localhost:5173
- Python API docs: http://localhost:8000/api/docs
- Node health: http://localhost:3001/health

---

## Как работает отправка заявки

1. Фаундер заполняет форму → нажимает «Отправить на рассмотрение»
2. `handleSubmit()` в `VentureIQ_Prototype_v4.jsx`:
   - `buildStartupPayload()` — маппит данные формы в формат Python backend
   - `triggerAnalysis()` → `POST /api/platform/runs/trigger`
   - Vite proxy перенаправляет на `POST http://localhost:8000/api/v1/runs/trigger`
3. Python backend создаёт Run + AgentTasks, запускает агентов в фоне
4. `pollRunStatus()` каждые 4 сек опрашивает `GET /api/platform/runs/{id}`
5. После завершения — показывает панель с результатами (статус каждого агента)

### FAA (Founder Assessment Agent)
Запускается автоматически если:
- `startupStage == "pre-seed"` **И** нет признаков трекшна в данных формы

### RCA (Reference Check Agent)
Запускается отдельно через:
```
POST /api/platform/runs/{run_id}/rca
{ "mode": "discovery", "trigger_type": "manual" }
```

---

## Продакшн — nginx конфиг (пример)

```nginx
server {
    listen 80;
    server_name ventureiq.example.com;

    # Фронтенд (собранный vite build)
    root /var/www/ventureiq/dist;
    try_files $uri $uri/ /index.html;

    # AI чат
    location /api/chat {
        proxy_pass http://localhost:3001;
    }

    # Python агенты
    location /api/platform/ {
        rewrite ^/api/platform/(.*)$ /api/v1/$1 break;
        proxy_pass http://localhost:8000;
    }
}
```
