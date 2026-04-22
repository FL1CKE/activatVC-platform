import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type CriteriaEntry = { name: string; score: number; weight?: number; comment: string; preliminary?: boolean; not_applicable_at_stage?: boolean };

type RedFlagItem = string | { flag?: string; severity?: string; category?: string; [key: string]: unknown };
type QuestionItem = string | { question?: string; why?: string; area?: string; priority?: string; [key: string]: unknown };

type AgentRunPayload = {
  specialist?: string;
  round?: number;
  score?: number;
  strengths?: (string | Record<string, unknown>)[];
  red_flags?: RedFlagItem[];
  criteria_breakdown?: CriteriaEntry[];
  participation_conditions?: { applicable: boolean; conditions: string[]; note?: string };
  founder_recommendations?: { applicable: boolean; recommendations: string[]; note?: string };
  questions_for_founder_interview?: QuestionItem[];
  data_quality?: { comment?: string; missing_critical?: boolean; completeness_percent?: number };
  _fullContent?: string;
  [key: string]: unknown;
};

/** Safely convert any value to a renderable string */
function toText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

type AgentRunData = {
  id: string;
  agentName: string;
  status: string;
  round: number;
  score?: number | null;
  responsePayload?: AgentRunPayload | null;
};

export default function AgentReportPage() {
  const { applicationId, runId } = useParams<{ applicationId: string; runId: string }>();
  const [run, setRun] = useState<AgentRunData | null>(null);
  const [startupName, setStartupName] = useState("Unknown");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!applicationId) return;
    (async () => {
      try {
        const res = await fetch(`/api/applications/${applicationId}`);
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) throw new Error(data?.error || "Не удалось загрузить заявку");
        setStartupName(data.startupName || "Unknown");
        const found = (data.agentRuns || []).find((r: AgentRunData) => r.id === runId);
        if (!found) throw new Error("Запуск агента не найден");
        setRun(found);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Ошибка загрузки");
      } finally {
        setLoading(false);
      }
    })();
  }, [applicationId, runId]);

  // --- Derive all values from run (safe defaults when run is null) ---
  const p = (run?.responsePayload || {}) as AgentRunPayload;
  const score = run?.score ?? p.score ?? null;
  const today = new Date().toISOString().slice(0, 10);
  const criteria: CriteriaEntry[] = Array.isArray(p.criteria_breakdown) ? p.criteria_breakdown : [];
  const strengths = Array.isArray(p.strengths) ? p.strengths : [];
  const risks = Array.isArray(p.red_flags) ? p.red_flags : [];
  const questions = Array.isArray(p.questions_for_founder_interview) ? p.questions_for_founder_interview : [];
  const pcConditions: string[] = p.participation_conditions?.conditions || [];
  const pcApplicable: boolean = p.participation_conditions?.applicable ?? false;
  const frRecs: string[] = p.founder_recommendations?.recommendations || [];
  const frApplicable: boolean = p.founder_recommendations?.applicable ?? false;
  const dqComment: string = p.data_quality?.comment || "";
  const dqPct: number | undefined = p.data_quality?.completeness_percent;
  const dqMissing: boolean = p.data_quality?.missing_critical ?? false;

  const hasStructuredData = criteria.length > 0 || strengths.length > 0 || risks.length > 0 || questions.length > 0;
  const rawFullContent = typeof p._fullContent === "string" ? p._fullContent : "";
  const fullContent = rawFullContent
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/```json[\s\S]*$/g, "")
    .trim();
  const showMarkdown = fullContent.length > 500;

  // useMemo MUST be called unconditionally (before any early returns)
  const syntheticMarkdown = useMemo(() => {
    // Only build if the agent returned JSON-first and we have structured data
    if (showMarkdown || !hasStructuredData) return "";
    const parts: string[] = [];
    if (fullContent.length > 0) {
      parts.push(fullContent, "");
    }
    if (criteria.length > 0) {
      parts.push("## Оценка по критериям", "");
      parts.push("| Критерий | Оценка | Комментарий |");
      parts.push("|---|---|---|");
      for (const c of criteria) {
        const sc = c.not_applicable_at_stage ? "N/A" : String(c.score);
        parts.push(`| ${c.name} | ${sc} | ${c.comment || "—"} |`);
      }
      parts.push("");
    }
    if (strengths.length > 0) {
      parts.push("## Сильные стороны", "");
      for (const s of strengths) parts.push(`- ✓ ${toText(s)}`);
      parts.push("");
    }
    if (risks.length > 0) {
      parts.push("## Ключевые риски", "");
      for (const r of risks) {
        const text = typeof r === "string" ? r : (r as Record<string, unknown>)?.flag;
        const severity = typeof r === "object" && r ? (r as Record<string, unknown>).severity as string : undefined;
        parts.push(`- ⚠ ${severity ? `**[${severity}]** ` : ""}${toText(text)}`);
      }
      parts.push("");
    }
    if (pcApplicable && pcConditions.length > 0) {
      parts.push("## Условия для инвестирования", "");
      for (const d of pcConditions) parts.push(`- → ${d}`);
      parts.push("");
    }
    if (frApplicable && frRecs.length > 0) {
      parts.push("## Рекомендации основателю", "");
      for (const d of frRecs) parts.push(`- ${d}`);
      parts.push("");
    }
    if (questions.length > 0) {
      parts.push("## Вопросы для интервью с основателем", "");
      for (const q of questions) {
        const text = typeof q === "string" ? q : (q as Record<string, unknown>)?.question;
        parts.push(`- ${toText(text)}`);
      }
      parts.push("");
    }
    if (dqComment) {
      parts.push("## Качество данных", "");
      if (dqPct !== undefined) parts.push(`Полнота данных: **${dqPct}%**${dqMissing ? " ⚠ Критические данные отсутствуют" : ""}`);
      parts.push(dqComment, "");
    }
    return parts.join("\n");
  }, [showMarkdown, hasStructuredData, fullContent, criteria, strengths, risks, questions, pcApplicable, pcConditions, frApplicable, frRecs, dqComment, dqPct, dqMissing]);

  // Early returns AFTER all hooks
  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-slate-500">Загрузка...</div>;
  }
  if (error || !run) {
    return <div className="flex min-h-screen items-center justify-center text-rose-600">{error || "Ошибка"}</div>;
  }

  const renderAsMarkdown = showMarkdown || syntheticMarkdown.length > 0;
  const scoreColor =
    score == null ? "text-slate-600" : score >= 75 ? "text-emerald-700" : score >= 50 ? "text-amber-700" : "text-rose-700";

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
        {/* Nav */}
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
          <p className="text-xs uppercase tracking-widest text-slate-400 mb-1">VentureIQ</p>
          <h1 className="text-2xl font-bold text-slate-900">
            {run.agentName} Strategic Report: {startupName}
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            Prepared by: <span className="font-semibold">{run.agentName} AI Agent</span>
          </p>
          <p className="text-sm text-slate-500">
            Date: {today} · Round: {run.round}
          </p>
          {score != null && (
            <div className="mt-4 flex items-center gap-3">
              <span className={`text-4xl font-bold ${scoreColor}`}>{Math.round(score)}</span>
              <span className="text-slate-400 text-xl">/100</span>
              {pcApplicable && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Условия участия
                </span>
              )}
              {!pcApplicable && frApplicable && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  Рекомендации основателю
                </span>
              )}
            </div>
          )}
        </div>

        {/* Specialist note */}
        {p.specialist && (
          <section className="mb-8">
            <p className="text-sm text-slate-500 italic">
              Анализ выполнен агентом: <span className="font-semibold text-slate-700">{p.specialist}</span>
            </p>
          </section>
        )}

        {/* Primary: render as markdown (either from _fullContent text or synthesized from structured data) */}
        {renderAsMarkdown && (
          <section className="mb-8">
            <div className="prose prose-slate prose-sm max-w-none rounded-xl border border-slate-200 bg-slate-50 p-5 leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]}>{showMarkdown ? fullContent : syntheticMarkdown}</Markdown>
            </div>
          </section>
        )}

        {/* Structured data sections — show as primary only when neither markdown nor synthetic available */}
        {hasStructuredData && !renderAsMarkdown && (
          <>
        {/* Criteria Breakdown */}
        {criteria.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">1. Assessment Criteria Breakdown</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Критерий</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Оценка</th>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Примечания</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.map((c, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="px-4 py-2 text-slate-800">{c.name}</td>
                      <td className="px-4 py-2 text-center font-semibold">
                        <span
                          className={
                            c.not_applicable_at_stage
                              ? "text-slate-400"
                              : c.score >= 75 ? "text-emerald-700" : c.score >= 50 ? "text-amber-700" : "text-rose-700"
                          }
                        >
                          {c.not_applicable_at_stage ? "—" : c.score}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-slate-600">{c.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Strengths */}
        {strengths.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">2. Strengths</h2>
            <ul className="space-y-2">
              {strengths.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="mt-0.5 shrink-0 text-emerald-600">✓</span>
                  {toText(s)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Risks */}
        {risks.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">3. Key Risks</h2>
            <ul className="space-y-2">
              {risks.map((r, i) => {
                const text = typeof r === "string" ? r : (r as Record<string, unknown>)?.flag;
                const severity = typeof r === "object" && r ? (r as Record<string, unknown>).severity as string : undefined;
                return (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="mt-0.5 shrink-0 text-rose-500">⚠</span>
                    <span>
                      {severity && (
                        <span className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${
                          severity === "critical" ? "bg-rose-100 text-rose-700" : severity === "moderate" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"
                        }`}>{severity}</span>
                      )}
                      {toText(text)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Investment Conditions */}
        {pcApplicable && pcConditions.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">4. Условия для инвестирования</h2>
            <ul className="space-y-2">
              {pcConditions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                  <span className="shrink-0 text-emerald-600">→</span>
                  {d}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Recommendations for Founders */}
        {frApplicable && frRecs.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">5. Рекомендации основателю</h2>
            <ul className="space-y-2">
              {frRecs.map((d, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 p-3 text-sm text-slate-700">
                  <span className="shrink-0 font-bold text-amber-600">{i + 1}.</span>
                  {d}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Interview Questions */}
        {questions.length > 0 && (
          <section className="mb-8 page-break">
            <h2 className="text-lg font-bold text-slate-900 mb-3">6. Вопросы для интервью с основателем</h2>
            <ol className="space-y-3 list-decimal pl-5">
              {questions.map((q, i) => {
                const text = typeof q === "string" ? q : (q as Record<string, unknown>)?.question;
                const why = typeof q === "object" && q ? (q as Record<string, unknown>).why as string : undefined;
                const area = typeof q === "object" && q ? (q as Record<string, unknown>).area as string : undefined;
                const priority = typeof q === "object" && q ? (q as Record<string, unknown>).priority as string : undefined;
                return (
                  <li key={i} className="text-sm text-slate-700">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      {area && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-medium text-blue-700">{area}</span>}
                      {priority && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        priority === "high" ? "bg-rose-50 text-rose-700" : priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"
                      }`}>{priority}</span>}
                    </div>
                    <p>{toText(text)}</p>
                    {why && <p className="mt-0.5 text-xs text-slate-400 italic">{why}</p>}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {/* Data Quality */}
        {(dqComment || dqPct !== undefined) && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-1">7. Качество данных</h2>
            <div className="flex items-center gap-3 mb-3">
              {dqPct !== undefined && (
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  dqPct >= 70 ? "bg-emerald-50 text-emerald-700" : dqPct >= 40 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"
                }`}>
                  Полнота данных: {dqPct}%
                </span>
              )}
              {dqMissing && (
                <span className="rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-700">
                  Критические данные отсутствуют
                </span>
              )}
            </div>
            {dqComment && (
              <p className="text-sm text-slate-600 leading-relaxed">{dqComment}</p>
            )}
          </section>
        )}
          </>
        )}

        {/* Collapsible structured data when markdown report is primary */}
        {hasStructuredData && showMarkdown && (
          <details className="mb-8">
            <summary className="cursor-pointer text-sm font-medium text-slate-500 hover:text-slate-700">
              Структурированные данные агента ▸
            </summary>
            <div className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-700">
              {criteria.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1">Criteria Breakdown</h3>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {criteria.map((c, i) => <li key={i}>{c.name}: {c.not_applicable_at_stage ? "—" : c.score} — {c.comment}</li>)}
                  </ul>
                </div>
              )}
              {strengths.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1">Strengths</h3>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {strengths.map((s, i) => <li key={i}>{toText(s)}</li>)}
                  </ul>
                </div>
              )}
              {risks.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1">Risks</h3>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {risks.map((r, i) => <li key={i}>{toText(typeof r === "string" ? r : (r as Record<string, unknown>)?.flag)}</li>)}
                  </ul>
                </div>
              )}
              {questions.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-1">Questions</h3>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {questions.map((q, i) => <li key={i}>{toText(typeof q === "string" ? q : (q as Record<string, unknown>)?.question)}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Fallback: short text with no structured data (e.g. agent returned preamble + truncated JSON) */}
        {!renderAsMarkdown && !hasStructuredData && fullContent && (
          <section className="mb-8">
            <div className="prose prose-slate prose-sm max-w-none rounded-xl border border-slate-200 bg-slate-50 p-5 leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]}>{fullContent}</Markdown>
            </div>
          </section>
        )}

        <footer className="mt-12 border-t border-slate-100 pt-4 text-xs text-slate-400">
          Generated by VentureIQ · {today}
        </footer>
      </div>
    </>
  );
}
