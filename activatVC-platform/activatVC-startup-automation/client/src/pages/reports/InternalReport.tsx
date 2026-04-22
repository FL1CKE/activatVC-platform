import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AggregateReport, ApplicationDetail, ScoreBreakdown } from "../../types";

function toNum(v: unknown): number {
  return typeof v === "number" && !isNaN(v) ? v : 0;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75
      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
      : score >= 50
        ? "bg-amber-50 text-amber-700 border-amber-200"
        : "bg-rose-50 text-rose-700 border-rose-200";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${color}`}>
      {Math.round(score)}/100
    </span>
  );
}

export default function InternalReportPage() {
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

  const ag = detail.aggregateReport as AggregateReport | null;
  const score = toNum(ag?.investmentScore ?? detail.investmentScore);
  const verdict = ag?.verdict || detail.verdict || "PENDING";
  const today = new Date().toISOString().slice(0, 10);
  const breakdown: ScoreBreakdown[] = Array.isArray(ag?.scoreBreakdown) ? ag.scoreBreakdown! : [];
  const redFlags = ag?.redFlags || [];
  const gates = ag?.passFailGates || [];
  const strengths = ag?.decisionMemo?.strengths || [];
  const risks = ag?.decisionMemo?.risks || [];
  const interviewGuide = ag?.interviewGuide || [];
  const agentRuns = detail.agentRuns || [];

  const verdictColors: Record<string, string> = {
    INVEST: "bg-emerald-100 text-emerald-800",
    CONDITIONAL: "bg-blue-100 text-blue-800",
    WATCH: "bg-violet-100 text-violet-800",
    "PASS WITH FB": "bg-amber-100 text-amber-800",
    PASS: "bg-rose-100 text-rose-800",
  };
  const vColor = verdictColors[verdict] || "bg-slate-100 text-slate-700";
  const scoreRingColor = score >= 75 ? "#059669" : score >= 50 ? "#d97706" : "#dc2626";

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
            VentureIQ · Internal Report
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            Investment Committee Report: {detail.startupName}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Date: {today} · Stage: {detail.startupStage || "—"} · Type: {detail.activityType || "—"}
          </p>
          <div className="mt-4 flex items-center gap-5">
            <div className="text-center">
              <p className="text-5xl font-bold" style={{ color: scoreRingColor }}>
                {Math.round(score)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Investment Score / 100</p>
            </div>
            <span className={`rounded-xl px-4 py-2 text-sm font-bold ${vColor}`}>{verdict}</span>
          </div>
          {ag?.heroPhrase && (
            <p className="mt-3 text-base text-slate-700 italic">"{ag.heroPhrase}"</p>
          )}
        </div>

        {/* Executive Summary */}
        {ag?.executiveSummary && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">Executive Summary</h2>
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
              {ag.executiveSummary}
            </p>
          </section>
        )}

        {/* Score Breakdown */}
        {breakdown.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">1. Agent Score Breakdown</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-slate-700">Agent</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Score</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Weight</th>
                    <th className="px-4 py-2 text-center font-semibold text-slate-700">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.map((row, i) => (
                    <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="px-4 py-2 font-medium text-slate-800">{row.agent}</td>
                      <td className="px-4 py-2 text-center">
                        <ScoreBadge score={toNum(row.finalScore)} />
                      </td>
                      <td className="px-4 py-2 text-center text-slate-600">{toNum(row.baseWeight)}%</td>
                      <td className="px-4 py-2 text-center text-slate-600">
                        {toNum(row.weightedContribution).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Pass/Fail Gates */}
        {gates.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">2. Pass / Fail Gates</h2>
            <div className="space-y-2">
              {gates.map((g, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-lg p-3 text-sm ${
                    g.passed ? "bg-emerald-50" : "bg-rose-50"
                  }`}
                >
                  <span
                    className={`font-bold ${g.passed ? "text-emerald-600" : "text-rose-600"}`}
                  >
                    {g.passed ? "✓" : "✗"}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">{g.gate}</p>
                    <p className="text-slate-600">{g.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Red Flags */}
        {redFlags.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-rose-700 mb-3">3. Red Flags</h2>
            <div className="space-y-2">
              {redFlags.map((rf, i) => (
                <div
                  key={i}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                    rf.severity === "critical"
                      ? "border-rose-200 bg-rose-50"
                      : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <span
                    className={`shrink-0 text-xs font-bold uppercase ${
                      rf.severity === "critical" ? "text-rose-700" : "text-amber-700"
                    }`}
                  >
                    {rf.severity}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">{rf.agent}</p>
                    <p className="text-slate-700">{rf.flag}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Strengths & Risks */}
        <div className="mb-8 grid gap-6 md:grid-cols-2">
          {strengths.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">4. Strengths</h2>
              <ul className="space-y-2">
                {strengths.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="shrink-0 text-emerald-600">✓</span>
                    {s}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {risks.length > 0 && (
            <section>
              <h2 className="text-lg font-bold text-slate-900 mb-3">5. Key Risks</h2>
              <ul className="space-y-2">
                {risks.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="shrink-0 text-amber-600">⚠</span>
                    {r}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Agent Summaries — with markdown report content */}
        {agentRuns.filter((r) => r.responsePayload).length > 0 && (
          <section className="mb-8 page-break">
            <h2 className="text-lg font-bold text-slate-900 mb-3">6. Agent Summaries</h2>
            <div className="space-y-4">
              {agentRuns
                .filter((r) => r.responsePayload)
                .map((r) => {
                  const rp = r.responsePayload as Record<string, unknown> | null;
                  const rawFc = typeof rp?._fullContent === "string" ? (rp._fullContent as string) : "";
                  const strippedFc = rawFc
                    .replace(/```json[\s\S]*?```/g, "")
                    .replace(/```json[\s\S]*$/g, "")
                    .trim();
                  return (
                    <details key={r.id} className="rounded-xl border border-slate-200">
                      <summary className="cursor-pointer p-4">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-slate-800">{r.agentName}</p>
                          <ScoreBadge score={toNum(r.score ?? (rp?.score as number | undefined))} />
                        </div>
                      </summary>
                      <div className="border-t border-slate-100 p-4">
                        {strippedFc.length > 200 ? (
                          <div className="prose prose-slate prose-sm max-w-none leading-relaxed">
                            <Markdown remarkPlugins={[remarkGfm]}>{strippedFc}</Markdown>
                          </div>
                        ) : (
                          <Link
                            to={`/report/agent/${applicationId}/${r.id}`}
                            className="inline-block text-xs text-blue-600 hover:underline"
                          >
                            Открыть полный отчёт →
                          </Link>
                        )}
                        <div className="mt-3">
                          <Link
                            to={`/report/agent/${applicationId}/${r.id}`}
                            className="inline-block text-xs text-blue-600 hover:underline"
                          >
                            Открыть полный отчёт →
                          </Link>
                        </div>
                      </div>
                    </details>
                  );
                })}
            </div>
          </section>
        )}

        {/* Interview Guide */}
        {interviewGuide.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-bold text-slate-900 mb-3">7. Founder Interview Guide</h2>
            <div className="space-y-3">
              {interviewGuide.slice(0, 12).map((q, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs text-slate-400 mb-1">
                    {q.priority} · {q.area}
                  </p>
                  <p className="text-sm text-slate-800">{q.question}</p>
                  {q.why && <p className="mt-1 text-xs text-slate-500 italic">{q.why}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        <footer className="mt-12 border-t border-slate-100 pt-4 text-xs text-slate-400">
          VentureIQ Internal Report · {today} · Confidential
        </footer>
      </div>
    </>
  );
}
