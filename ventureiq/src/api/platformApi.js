/**
 * platformApi.js — клиент к Python backend (activatVC-agents-platform).
 *
 * Dev: запросы идут через Vite proxy /api/platform → http://localhost:8000
 * Production (Vercel): VITE_PLATFORM_API_URL указывает напрямую на Railway/Render
 *
 * Установите в Vercel Environment Variables:
 *   VITE_PLATFORM_API_URL = https://your-backend.railway.app/api/v1
 *   VITE_CHAT_API_URL     = https://your-chat.railway.app/api/chat
 */

const BASE = import.meta.env.VITE_PLATFORM_API_URL || "/api/platform";

/**
 * Маппинг данных формы → структура StartupDataSchema Python backend.
 *
 * @param {object} company  — данные из CompanyBlock
 * @param {object[]} founders — массив фаундеров
 * @param {object} docs     — загруженные документы (имена файлов)
 * @returns {object} startup_data совместимый с TriggerRunRequest
 */
export function buildStartupPayload(company, founders, docs) {
  return {
    application: {
      id: `app-${Date.now()}`,
      startupName: company.company || "Unknown",
      startupStage: mapStage(company.stage),
      activityType: company.activity || null,
      description: company.desc || null,
      businessModel: null,
      financialSummary: null,
      websiteUrl: company.site || null,
      driveLink: null,
      investmentAmount: parseInvestment(company.invest),
      currency: "USD",
      founders: (founders || []).map((f) => ({
        name: f.name || "",
        role: f.role || "CEO",
        linkedin:
          f.links?.find((l) => l.type === "LinkedIn")?.url || null,
        background: null,
      })),
      email: company.email || null,
    },
    documents: buildDocumentsList(docs),
  };
}

function mapStage(stage) {
  if (!stage) return "pre-seed";
  const s = stage.toLowerCase();
  if (s.includes("pre")) return "pre-seed";
  if (s.includes("seed")) return "seed";
  return stage;
}

function parseInvestment(raw) {
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return isNaN(n) ? null : n;
}

function buildDocumentsList(docs) {
  if (!docs) return [];
  const result = [];
  Object.entries(docs).forEach(([id, filename]) => {
    if (filename) {
      result.push({
        id: `doc-${id}`,
        originalName: filename,
        mimeType: guessMime(filename),
        category: mapDocCategory(id),
        classifiedAs: id,
        fileUrl: `mock://local/${filename}`,
      });
    }
  });
  return result;
}

function guessMime(name) {
  if (!name) return "application/octet-stream";
  const ext = name.split(".").pop()?.toLowerCase();
  const map = {
    pdf: "application/pdf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };
  return map[ext] || "application/octet-stream";
}

function mapDocCategory(id) {
  const cat1 = ["pitch", "fin", "mkt", "tech", "unit", "founders", "cap", "val"];
  const cat2 = ["cred", "video", "rounds"];
  const cat3 = ["ip", "tm", "corp", "contracts", "tos"];
  if (cat1.includes(id)) return "cat1_required";
  if (cat2.includes(id)) return "cat2_optional";
  if (cat3.includes(id)) return "cat3_legal";
  return "other";
}

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * Запустить анализ стартапа.
 * Возвращает { run_id, status } или бросает Error.
 */
export async function triggerAnalysis(startupData) {
  const body = {
    application_id: startupData.application.id,
    use_mock: false,
    startup_data: startupData,
  };

  const res = await fetch(`${BASE}/runs/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }

  return res.json(); // { id, application_id, status, ... }
}

/**
 * Получить статус и результаты запуска.
 */
export async function getRunStatus(runId) {
  const res = await fetch(`${BASE}/runs/${runId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Поллинг статуса запуска до завершения.
 *
 * @param {number} runId
 * @param {function} onUpdate — вызывается при каждом обновлении
 * @param {object} opts — { intervalMs, maxWaitMs }
 */
export async function pollRunStatus(runId, onUpdate, opts = {}) {
  const { intervalMs = 5000, maxWaitMs = 900_000 } = opts;
  const deadline = Date.now() + maxWaitMs;

  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const run = await getRunStatus(runId);
        onUpdate(run);

        const done = ["completed", "failed", "waiting_data"].includes(run.status);
        if (done) {
          resolve(run);
          return;
        }

        if (Date.now() >= deadline) {
          reject(new Error("Analysis polling timeout"));
          return;
        }

        setTimeout(tick, intervalMs);
      } catch (e) {
        reject(e);
      }
    };

    tick();
  });
}

/**
 * Запустить RCA для завершённого Run.
 */
export async function triggerRCA(runId, mode = "discovery", contactId = null) {
  const res = await fetch(`${BASE}/runs/${runId}/rca`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode,
      contact_id: contactId,
      trigger_type: "auto",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }

  return res.json();
}
