import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ApplicationDetail, FounderReport } from "../../types";

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    awaiting_founder: "Ожидает ваших документов",
    analyzing: "Анализируется",
    complete: "Анализ завершен",
    draft: "Черновик",
    pending: "В очереди",
    failed: "Ошибка",
    needs_more_info: "Требует данных",
  };
  return map[status] || status;
}

function deriveFounderReport(detail: ApplicationDetail | null): FounderReport {
  const verdict = detail?.verdict || detail?.aggregateReport?.verdict || "PENDING";
  const heroPhrase =
    detail?.heroPhrase ||
    detail?.aggregateReport?.heroPhrase ||
    "Оценка формируется на основе результатов 6 агентных анализов.";

  const strengths = (detail?.aggregateReport?.decisionMemo?.strengths || []).slice(0, 6);
  const risks = (detail?.aggregateReport?.decisionMemo?.risks || []).slice(0, 6);
  const redFlags = (detail?.aggregateReport?.redFlags || [])
    .slice(0, 6)
    .map((item) => `${item.agent}: ${item.flag}`);

  const weaknesses = [...redFlags, ...risks].slice(0, 8);

  const failedGates = (detail?.aggregateReport?.passFailGates || [])
    .filter((gate) => !gate.passed)
    .map((gate) => gate.detail);

  const interviewRecommendations = (detail?.aggregateReport?.interviewGuide || [])
    .slice(0, 4)
    .map((item) => item.question);

  const recommendations = [...failedGates, ...interviewRecommendations]
    .filter(Boolean)
    .slice(0, 8);

  return {
    verdict,
    heroPhrase,
    strengths: strengths.length > 0 ? strengths : ["Отчет будет детализирован после завершения всех агентных проверок."],
    weaknesses: weaknesses.length > 0 ? weaknesses : ["Критичные слабые стороны не выявлены."],
    recommendations:
      recommendations.length > 0
        ? recommendations
        : ["Уточните бизнес-показатели и обновите документы перед повторной подачей."],
  };
}

export default function FounderPortalPage() {
  const { token } = useParams();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("Некорректный токен.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/magic/${token}`);
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload) {
          throw new Error(payload?.error || "Не удалось открыть портал фаундера");
        }
        if (cancelled) return;
        setDetail(payload as ApplicationDetail);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [token]);

  const report = useMemo(() => detail?.founderReport || deriveFounderReport(detail), [detail]);

  const founderDocs = (detail?.documents || []).filter((doc) => doc.source.startsWith("founder"));
  const openGaps = (detail?.gapItems || []).filter((gap) => gap.status === "open");

  const verdictColors: Record<string, string> = {
    PASS: "bg-rose-50 text-rose-700 border-rose-200",
    FAIL: "bg-rose-50 text-rose-700 border-rose-200",
    PENDING: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const verdictClass = verdictColors[report.verdict] ?? "bg-slate-100 text-slate-600 border-slate-200";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:px-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Founder Portal</p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">{detail?.startupName || "Заявка"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{detail?.status ? formatStatus(detail.status) : "..."}</span>
            {detail?.investmentScore != null && (
              <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">Score: {detail.investmentScore}</span>
            )}
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${verdictClass}`}>{report.verdict}</span>
          </div>
          {detail?.id && (
            <div className="mt-3">
              <Link
                to={`/report/founder/${detail.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                Открыть отчёт для фаундера →
              </Link>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Краткое заключение для фаундера</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">{report.heroPhrase}</p>

            <h3 className="mt-4 text-sm font-semibold text-emerald-700">Сильные стороны</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {report.strengths.map((item, idx) => (
                <li key={`strength-${idx}`}>{item}</li>
              ))}
            </ul>

            <h3 className="mt-4 text-sm font-semibold text-amber-700">Слабые стороны и зоны роста</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {report.weaknesses.map((item, idx) => (
                <li key={`weak-${idx}`}>{item}</li>
              ))}
            </ul>

            <h3 className="mt-4 text-sm font-semibold text-blue-700">Рекомендации перед повторной подачей</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {report.recommendations.map((item, idx) => (
                <li key={`rec-${idx}`}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Документы</h2>
            <div className="mt-3">
              <p className="text-sm font-medium text-slate-800">Ваши документы</p>
              {founderDocs.length === 0 ? (
                <p className="mt-1 text-xs text-slate-500">Нет загруженных документов.</p>
              ) : (
                <ul className="mt-2 space-y-1 text-sm">
                  {founderDocs.map((doc) => (
                    <li key={doc.id}>
                      <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                        {doc.originalName}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {openGaps.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-800">Открытые запросы</p>
                <ul className="mt-1 list-disc pl-5 text-sm text-amber-800">
                  {openGaps.map((gap) => (
                    <li key={gap.id}>{gap.question || gap.title}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>

        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
          В этом кабинете доступен только краткий founder-facing формат заключения. Подробная логика и полное внутреннее обоснование доступны только инвестору.
        </div>

        {loading && <p className="text-sm text-slate-500">Загрузка...</p>}
        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="pb-4">
          <Link to="/" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            На главную
          </Link>
        </div>
      </div>
    </div>
  );
}
