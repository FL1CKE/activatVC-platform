# Гайд по API для суб-агентов (Activat.vc)

Базовый URL:
- `http://127.0.0.1:3100`

Используйте этот гайд, чтобы:
1. Получать текстовые данные стартапа и файлы для анализа.
2. Возвращать результат анализа обратно в оркестратор.

---

## 1) Получение данных стартапа (вход)

Endpoint:
- `GET /api/webhooks/startups/{applicationId}/data`

Пример:
- `GET http://127.0.0.1:3100/api/webhooks/startups/2ba7d70a-7496-4f84-b561-75627a99bd7b/data`

Ответ содержит:
- `application` → текстовая информация о стартапе.
- `documents[]` → метаданные загруженных файлов + прямой `fileUrl`.

### Важные поля для чтения

Из `application`:
- `id`
- `startupName`
- `startupStage`
- `activityType`
- `description`
- `businessModel`
- `financialSummary`
- `websiteUrl`
- `driveLink`
- `investmentAmount`
- `currency`
- `founders`

Из `documents[]`:
- `id`
- `originalName`
- `mimeType`
- `category`
- `classifiedAs`
- `fileUrl`

---

## 2) Отправка результата анализа (выход)

Endpoint:
- `POST /api/webhooks/startups/{applicationId}/processed`
- Content-Type: `multipart/form-data`

Всегда нужно передавать:
- `agentName` (например: `CFO`, `CTO`, `CMO` и т.д.)
- `status` (`needs_info` или `completed`)

Рекомендуется также передавать:
- `response_json` (JSON-строка с полным ответом агента)
- `round` (номер прогона, число; если не передан — берется текущий)

### Режим A: Нужны дополнительные данные от фаундера

Используйте, если агент не может завершить анализ из-за недостающих документов.

Обязательные поля:
- `agentName`
- `status=needs_info`
- `requested_docs` (JSON-строка с массивом названий нужных документов)

Пример:
```bash
curl -X POST "http://127.0.0.1:3100/api/webhooks/startups/2ba7d70a-7496-4f84-b561-75627a99bd7b/processed" \
  -F "agentName=CFO" \
  -F "status=needs_info" \
  -F 'requested_docs=["CohortAnalysisTable","TractionMetricsCSV"]'
```

Ожидаемое поведение:
- Платформа ставит workflow на паузу.
- Для фаундера создаются запросы на недостающие данные.
- Magic link остаётся активным для дозагрузки информации.

### Режим B: Анализ завершён

Используйте, если анализ полностью готов.

Обязательные поля:
- `agentName`
- `status=completed`

Опциональные поля:
- `documents` (вложения, например отчёт агента)
- `response_json` (полный структурированный ответ агента)
- `summary`, `analysis`, `score`, `verdict` (если не используете `response_json`)

Пример:
```bash
curl -X POST "http://127.0.0.1:3100/api/webhooks/startups/2ba7d70a-7496-4f84-b561-75627a99bd7b/processed" \
  -F "agentName=CFO" \
  -F "status=completed" \
  -F "round=1" \
  -F 'response_json={"summary":"Unit economics are improving","score":7.8,"verdict":"WATCH","strengths":["Gross margin trend positive"],"risks":["High CAC volatility"]}' \
  -F "documents=@./agent-report.txt;type=text/plain"
```

Ожидаемое поведение:
- Платформа сохраняет загруженные документы агента.
- Платформа сохраняет `response_json` как результат прогона агента.
- Workflow переходит к следующему шагу оркестрации.

---

## 3) Пример на JavaScript (Node/fetch)

```js
const appId = "2ba7d70a-7496-4f84-b561-75627a99bd7b";
const base = "http://127.0.0.1:3100";

// 1) получить входные данные
const dataRes = await fetch(`${base}/api/webhooks/startups/${appId}/data`);
if (!dataRes.ok) throw new Error(`GET data failed: ${dataRes.status}`);
const data = await dataRes.json();

console.log(data.application.startupName);
console.log(data.documents.map(d => d.fileUrl));

// 2) отправить результат (needs_info)
const form = new FormData();
form.append("agentName", "CFO");
form.append("status", "needs_info");
form.append("requested_docs", JSON.stringify(["CohortAnalysisTable", "TractionMetricsCSV"]));

const postRes = await fetch(`${base}/api/webhooks/startups/${appId}/processed`, {
  method: "POST",
  body: form,
});

if (!postRes.ok) throw new Error(`POST processed failed: ${postRes.status}`);
console.log(await postRes.json());
```

---

## 4) Быстрый smoke-check для суб-агентов

1. `GET /data` возвращает `200` и непустой `application`.
2. Каждый `documents[].fileUrl` открывается/скачивается без ошибок.
3. `POST /processed` с `needs_info` возвращает `200` и `gapItemsCount`.
4. `POST /processed` с `completed` возвращает `200`, а загруженные документы сохраняются.
5. Если передан `response_json`, результат агента виден в портале в блоке “Результаты ИИ-агентов (последний прогон)”.

---

## 5) Примечания

- Публичные URL объектов MinIO сейчас доступны на порту `9100` для быстрой интеграции.
- Консоль MinIO на `9101` ограничена (не публичная).
- Если название запрашиваемого документа содержит пробелы/спецсимволы, передавайте его обычной JSON-строкой в `requested_docs`.
- Чтобы отличать реальные ответы друзей от моков, используйте уникальные `agentName` (например `FRIEND_CFO`) и всегда передавайте `response_json`.
