import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApplicationDetail, FounderReport as FounderReportType } from "../../types";

export default function FounderReportPage() {
  const { applicationId } = useParams<{ applicationId: string }>();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!applicationId) return;
    (async () => {
      try {
        const res = await fetch(`/api/applications/${applicationId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error || "Не удалось загрузить заявку");
        setDetail(data as ApplicationDetail);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    })();
  }, [applicationId]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Загрузка...</div>;
  }
  if (error || !detail) {
    return <div className="flex min-h-screen items-center justify-center text-rose-600">{error || "Ошибка"}</div>;
  }

  const report = detail.founderReport as FounderReportType | null;
  const today = new Date().toISOString().slice(0, 10);
  const verdict = report?.verdict || detail.verdict || "PENDING";
  const strengths = report?.strengths || [];
  const weaknesses = report?.weaknesses || [];
  const recommendations = report?.recommendations || [];

  const verdictLabel: Record<string, string> = {
    INVEST: "Рекомендуем к инвестированию",
    CONDITIONAL: "Условная рекомендация",
    WATCH: "В листе наблюдения",
    "PASS WITH FB": "Не подходит сейчас — с обратной связью",
    PASS: "Не подходит на данном этапе",
  };
  const verdictColors: Record<string, string> = {
    INVEST: "bg-emerald-50 border-emerald-200 text-emerald-800",
    CONDITIONAL: "bg-blue-50 border-blue-200 text-blue-800",
    WATCH: "bg-violet-50 border-violet-200 text-violet-800",
    "PASS WITH FB": "bg-amber-50 border-amber-200 text-amber-800",
    PASS: "bg-rose-50 border-rose-200 text-rose-800",
  };
  const vStyle = verdictColors[verdict] || "bg-slate-50 border-slate-200 text-slate-700";

  const completedRuns = (detail.agentRuns || []).filter(
    (r) => r.responsePayload && r.status === "completed"
  );

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { font-size: 11pt; }
          .page-break { page-break-before: always; }
        }
      `}</style>
      <div className="min-h-screen bg-white px-6 py-10 mx-auto max-w-4xl">
        <div className="no-print mb-6 flex items-center gap-3">
          <Link to="/dashboard" className="text-xs text-blue-600 hover:underline">
            ← Дашборд
          </Link>
          <button
            type="button"
            onClick={() => window.print()}
            className="ml-auto rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Печать / PDF ↓
          </button>
        </div>

        {/* Header */}
        <div className="border-b border-slate-200 pb-6 mb-8">
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">
            VentureIQ · Founder Assessment
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            Founder Report: {detail.startupName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">Date: {today}</p>
          <div className={`mt-4 rounded-xl border p-4 ${vStyle}`}>
            <p className="font-bold text-lg">{verdict}</p>
            <p className="text-sm mt-1">{verdictLabel[verdict] || verdict}</p>
          </div>
          {detail.heroPhrase && (
            <p className="mt-4 text-base text-slate-700 italic">"{detail.heroPhrase}"</p>
          )}
        </div>

        {/* Executive Summary */}
        {detail.executiveSummary && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">Executive Summary</h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {detail.executiveSummary}
            </p>
          </section>
        )}

        {/* Strengths */}
        {strengths.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">1. Сильные стороны</h2>
            <ul className="space-y-3">
              {strengths.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-slate-700"
                >
                  <span className="shrink-0 font-bold text-emerald-600">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Weaknesses */}
        {weaknesses.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">2. Зоны для развития</h2>
            <ul className="space-y-3">
              {weaknesses.map((w, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-slate-700"
                >
                  <span className="shrink-0 font-bold text-amber-600">△</span>
                  {w}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">3. Рекомендации</h2>
            <ol className="space-y-3 list-decimal pl-5">
              {recommendations.map((r, i) => (
                <li key={i} className="text-sm text-slate-700 leading-relaxed">
                  {r}
                </li>
              ))}
            </ol>
          </section>
        )}

        {/* Per-area feedback — render agent reports as markdown */}
        {completedRuns.length > 0 && (
          <section className="mb-8 page-break">
            <h2 className="text-lg font-bold text-slate-900 mb-3">4. Оценка по направлениям</h2>
            <div className="space-y-4">
              {completedRuns.map((r) => {
                const rp = r.responsePayload as Record<string, unknown> | null;
                const rawFc = typeof rp?._fullContent === "string" ? (rp._fullContent as string) : "";
                const strippedFc = rawFc
                  .replace(/```json[\s\S]*?```/g, "")
                  .replace(/```json[\s\S]*$/g, "")
                  .trim();
                const frRecs = Array.isArray(
                  (rp?.founder_recommendations as Record<string, unknown> | undefined)?.recommendations
                )
                  ? ((rp!.founder_recommendations as Record<string, unknown>).recommendations as string[])
                  : [];
                return (
                  <details key={r.id} className="rounded-xl border border-slate-200">
                    <summary className="cursor-pointer p-4 font-semibold text-slate-800 hover:bg-slate-50">
                      {r.agentName}
                      {typeof rp?.score === "number" && (
                        <span className={`ml-2 text-sm font-bold ${rp.score >= 75 ? "text-emerald-600" : rp.score >= 50 ? "text-amber-600" : "text-rose-600"}`}>
                          {Math.round(rp.score as number)}/100
                        </span>
                      )}
                    </summary>
                    <div className="border-t border-slate-100 p-4">
                      {strippedFc.length > 200 ? (
                        <div className="prose prose-slate prose-sm max-w-none leading-relaxed">
                          <Markdown remarkPlugins={[remarkGfm]}>{strippedFc}</Markdown>
                        </div>
                      ) : frRecs.length > 0 ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Рекомендации</p>
                          <ul className="space-y-1">
                            {frRecs.map((d, i) => (
                              <li key={i} className="text-sm text-slate-700">• {d}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="text-sm text-slate-500 italic">Подробности доступны в полном отчёте агента.</p>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        )}

        <footer className="mt-12 border-t border-slate-100 pt-4 text-xs text-slate-400">
          VentureIQ Founder Assessment Report · {today}
        </footer>
      </div>
    </>
  );
}
