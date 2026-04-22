# Activat VC — Мастер-агент

Система автоматизации венчурного анализа стартапов. Фаундеры подают заявки через веб-форму, загружают документы — система запускает команду ИИ-агентов, агрегирует результаты и выдаёт IC Decision Memo с инвестиционным скором и вердиктом.

## Стек

- **Express** (TypeScript) — REST API, мастер-оркестратор
- **Prisma** + PostgreSQL — основная БД
- **MinIO** (S3-совместимый) — хранилище документов стартапов и отчётов агентов
- **React** (Vite + TailwindCSS) — фронтенд: форма заявки + портал фаундера
- **pdfkit** — генерация IC Decision Memo PDF
- **Docker Compose** — PostgreSQL + MinIO для локального запуска

---

## Быстрый старт

### 1. Запускаем инфраструктуру

```bash
docker-compose up -d postgres minio
```

PostgreSQL: `localhost:5433`  
MinIO API: `localhost:9100`  
MinIO Console: `localhost:9101` (логин: `minioadmin` / `minioadmin`)

### 2. Настраиваем .env

```bash
cp .env.connected.example .env
```

Минимальный `.env` для локальной связки с агент-платформой:

```env
DATABASE_URL=postgresql://admin:adminpassword@localhost:5433/activat_db?schema=public
PORT=3000
APP_PUBLIC_URL=http://127.0.0.1:3100

S3_ENDPOINT=http://localhost:9100
S3_PUBLIC_ENDPOINT=http://127.0.0.1:9100
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin

AGENT_EXECUTION_MODE=external
AGENTS_PLATFORM_URL=http://127.0.0.1:8000

MAGIC_LINK_SECRET=your-secret-key
```

### 3. Устанавливаем зависимости и применяем миграции

```bash
npm install
npx prisma migrate deploy
```

### 4. Запускаем мастер-агент

```bash
npm run dev
```

API доступен на **http://127.0.0.1:3100**

### 5. Запускаем фронтенд (отдельный терминал)

```bash
cd client
npm install
npm run dev
```

Фронтенд на **http://localhost:5173**

---

## Полный локальный запуск (все сервисы)

| Сервис | Команда | URL |
|--------|---------|-----|
| PostgreSQL + MinIO | `docker-compose up -d postgres minio` | — |
| Агент-платформа | `cd ../activatVC-agents-platform && uvicorn app.main:app --port 8000` | :8000 |
| Мастер-агент | `npm run dev` | :3100 |
| Фронтенд | `cd client && npm run dev` | :5173 |

---

## Режимы работы агентов

| `AGENT_EXECUTION_MODE` | Описание |
|------------------------|----------|
| `external` | Диспетчеризация в [activatVC-agents-platform](../activatVC-agents-platform). Это production-режим. |
| `mock` | Внутренние mock-агенты. Для быстрого тестирования без LLM. |

---

## Демо флоу

1. Открыть **http://localhost:5173/apply**
2. Заполнить форму, загрузить документы (pitch deck, финмодель и т.д.), нажать отправить
3. Скопировать **Magic Link** — персональная ссылка фаундера для отслеживания анализа
4. VC-аналитик запускает анализ:
   ```bash
   POST http://127.0.0.1:3100/api/applications/{id}/analyze
   ```
5. 5 ИИ-агентов анализируют стартап параллельно, загружают PDF-отчёты в хранилище
6. После завершения мастер-агент агрегирует результаты → генерирует **IC Decision Memo (PDF)**
7. Открыть Magic Link → видны все PDF-отчёты, скор, вердикт, открытые запросы

---

## Ссылки

| Что | URL |
|-----|-----|
| Форма заявки | http://localhost:5173/apply |
| Портал фаундера | http://localhost:5173/magic/`<token>` |
| API мастер-агента | http://127.0.0.1:3100 |
| Health check | http://127.0.0.1:3100/ping |
| MinIO Console | http://127.0.0.1:9101 |

---

## Структура проекта

```
src/
├── index.ts          — Express-приложение, все API-маршруты
├── workflow.ts       — бизнес-логика: агрегация, PDF, MinIO, диспетчеризация
├── constants.ts      — конфигурация агентов, веса, пороги, типы
├── masterOrchestrator.ts — LLM-оркестратор для IC-вердикта
├── settings.ts       — настройки LLM-провайдеров (runtime)
├── llmAgent.ts       — LLM-клиент для мастер-оркестратора
└── mockAgents.ts     — mock-ответы агентов

client/src/
├── App.tsx           — React-приложение: роутинг и лейаут
├── main.tsx
├── components/       — Chat, icons
└── pages/
    ├── founder/      — ApplicationForm, Portal, Processing
    ├── investor/     — Dashboard, AgentCard, InvestorDecision
    ├── reports/      — AgentReport, FounderReport, InternalReport
    └── admin/        — Settings (настройки LLM-провайдеров)

prisma/
└── schema.prisma     — схема БД

scripts/
├── simulate_agent.js       — ручная симуляция ответа агента
├── validate_env.ts         — проверка env при старте
├── sync_prompts.ts         — синхронизация промптов
├── reaggregate.ts          — пересчёт агрегации
└── vm/                     — скрипты деплоя на VM

tests/                — интеграционные тесты
```

---

## Ключевые API-маршруты

| Method | URL | Описание |
|--------|-----|----------|
| POST | `/api/applications` | Подача заявки + загрузка документов |
| GET | `/api/applications` | Список заявок (для VC) |
| GET | `/api/applications/:id` | Детали заявки |
| POST | `/api/applications/:id/analyze` | Запустить анализ агентами |
| GET | `/api/magic/:token` | Данные портала фаундера |
| POST | `/api/magic/:token/respond` | Ответ фаундера на запросы агентов |
| POST | `/api/webhooks/startups/:id/processed` | Коллбэк от агент-платформы |
| GET | `/ping` | Health check |

---

## Secret Scanning

Pre-commit hook с Gitleaks установлен. Активировать:

```bash
./scripts/install-git-hooks.ps1   # Windows
```

GitHub Actions: `.github/workflows/secret-scan.yml`
