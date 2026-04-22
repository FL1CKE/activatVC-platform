import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Link } from "react-router-dom";
import { PolarAngleAxis, PolarGrid, Radar, RadarChart, ResponsiveContainer } from "recharts";
import Chat from "../../components/Chat";
import { AGENT_ORDER, ORCHESTRATOR_KB } from "../../constants";
import type { AggregateReport, AppListItem, ApplicationDetail, ScoreBreakdown } from "../../types";
import AgentCard from "./AgentCard";
import InvestorDecision from "./InvestorDecision";

function getScoreColor(score: number): string {
  if (score >= 70) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-rose-600";
}

function getScoreBg(score: number): string {
  if (score >= 70) return "bg-emerald-50 border-emerald-200";
  if (score >= 50) return "bg-amber-50 border-amber-200";
  return "bg-rose-50 border-rose-200";
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    awaiting_founder: "Ожидает фаундера",
    analyzing: "Анализируется",
    complete: "Завершено",
    draft: "Черновик",
    pending: "В очереди",
    failed: "Ошибка",
    needs_more_info: "Требует данных",
  };
  return map[status] || status;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    INVEST: "bg-emerald-50 text-emerald-700 border-emerald-200",
    CONDITIONAL: "bg-blue-50 text-blue-700 border-blue-200",
    WATCH: "bg-violet-50 text-violet-700 border-violet-200",
    "PASS WITH FB": "bg-amber-50 text-amber-700 border-amber-200",
    PASS: "bg-rose-50 text-rose-700 border-rose-200",
    PENDING: "bg-slate-100 text-slate-600 border-slate-200",
  };
  const color = colors[verdict] ?? "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${color}`}>{verdict}</span>;
}


export default function InvestorDashboardPage() {
  const [apps, setApps] = useState<AppListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [aggregate, setAggregate] = useState<AggregateReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    const loadApps = async () => {
      try {
        setLoading(true);
        const response = await fetch("/api/applications");
        const payload = await response.json().catch(() => []);
        if (!response.ok || !Array.isArray(payload)) {
          throw new Error("Не удалось загрузить список заявок");
        }
        if (cancelled) return;
        setApps(payload as AppListItem[]);
        if (payload.length > 0) {
          setSelectedId(String(payload[0].id));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки списка");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadApps();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadDetails = async () => {
      if (!selectedId) return;
      setDetailLoading(true);
      setDetail(null);
      setAggregate(null);
      setError("");

      try {
        const [detailResponse, aggregateResponse] = await Promise.all([
          fetch(`/api/applications/${selectedId}`),
          fetch(`/api/applications/${selectedId}/aggregate`),
        ]);

        const detailPayload = await detailResponse.json().catch(() => null);
        const aggregatePayload = await aggregateResponse.json().catch(() => null);

        if (!detailResponse.ok || !detailPayload) {
          throw new Error(detailPayload?.error || "Не удалось загрузить детали заявки");
        }

        if (cancelled) return;
        const detailData = detailPayload as ApplicationDetail;
        setDetail(detailData);

        const aggregateData = (aggregateResponse.ok && aggregatePayload
          ? (aggregatePayload as AggregateReport)
          : (detailData.aggregateReport as AggregateReport | null)) || null;
        setAggregate(aggregateData);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки деталей");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    };

    loadDetails();

    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const scoreBreakdown = useMemo<ScoreBreakdown[]>(() => {
    if (!aggregate?.scoreBreakdown || !Array.isArray(aggregate.scoreBreakdown)) return [];
    return aggregate.scoreBreakdown;
  }, [aggregate]);

  const radarData = useMemo(
    () =>
      AGENT_ORDER.map((agentName) => {
        const row = scoreBreakdown.find((item) => item.agent === agentName);
        return {
          agent: agentName,
          score: row ? toNumber(row.finalScore) : 0,
        };
      }),
    [scoreBreakdown],
  );

  const byAgentPayload = aggregate?.finalAgentJsons || {};

  const fallbackEvents = useMemo(() => {
    const runs = Array.isArray(detail?.agentRuns) ? detail.agentRuns : [];
    if (runs.length === 0) return [] as Array<{
      agentName: string;
      primaryProvider: string;
      primaryModel: string;
      usedProvider: string;
      usedModel: string;
    }>;

    const latestRound = runs.reduce((maxRound, run) => {
      const round = Number.isFinite(run.round) ? run.round : 0;
      return round > maxRound ? round : maxRound;
    }, 0);

    return runs
      .filter((run) => run.round === latestRound)
      .map((run) => {
        const payload = run.responsePayload as Record<string, unknown> | null;
        const routing = payload && typeof payload === "object"
          ? (payload._llmRouting as Record<string, unknown> | undefined)
          : undefined;
        if (!routing) return null;

        const fallbackUsed = routing.fallbackUsed === true || routing.fallbackUsed === "true";
        if (!fallbackUsed) return null;

        return {
          agentName: run.agentName,
          primaryProvider: String(routing.primaryProvider || "unknown"),
          primaryModel: String(routing.primaryModel || "unknown"),
          usedProvider: String(routing.usedProvider || "unknown"),
          usedModel: String(routing.usedModel || "unknown"),
        };
      })
      .filter((item): item is {
        agentName: string;
        primaryProvider: string;
        primaryModel: string;
        usedProvider: string;
        usedModel: string;
      } => item !== null);
  }, [detail?.agentRuns]);

  const internalSummary = aggregate?.executiveSummary || detail?.executiveSummary || "Отчет формируется.";
  const investmentScore = toNumber(aggregate?.investmentScore ?? detail?.investmentScore ?? 0);
  const verdict = aggregate?.verdict || detail?.verdict || "PENDING";
  const heroPhrase = aggregate?.heroPhrase || detail?.heroPhrase || "Внутренний отчет доступен после завершения анализа.";

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:px-6">
      {loading ? (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-slate-500">Загрузка заявок...</p>
        </div>
      ) : error && apps.length === 0 ? (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-rose-600">{error}</p>
        </div>
      ) : (
      <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[240px_1fr_320px]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Pipeline</p>
          <h2 className="mt-2 text-sm font-semibold text-slate-900">Заявки · {apps.length}</h2>

          <div className="mt-3 space-y-1.5">
            {apps.length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Нет заявок</p>
            ) : (
              apps.map((app) => {
                const score = app.investmentScore != null ? toNumber(app.investmentScore) : null;
                return (
                  <button
                    key={app.id}
                    type="button"
                    onClick={() => setSelectedId(app.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                      selectedId === app.id
                        ? "border-blue-200 bg-blue-50"
                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <p className="truncate text-sm font-medium text-slate-900">{app.startupName}</p>
                      {score !== null && (
                        <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${getScoreBg(score)} ${getScoreColor(score)}`}>
                          {Math.round(score)}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs text-slate-500">{formatStatus(app.status)}</span>
                      {app.verdict && app.verdict !== "PENDING" && <VerdictBadge verdict={app.verdict} />}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <Link
            to="/"
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
          >
            На главную
          </Link>
        </aside>

        <main className="space-y-4">
          {detailLoading ? (
            <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm">
              <p className="text-sm text-slate-400">Загрузка данных...</p>
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5">
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          ) : (
          <>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-slate-900">{detail?.startupName || "Заявка"}</h1>
                <p className="mt-1 text-sm text-slate-600">{heroPhrase}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {detail?.activityType && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{detail.activityType}</span>
                  )}
                  {detail?.startupStage && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-700">{detail.startupStage}</span>
                  )}
                  {detail?.status && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{formatStatus(detail.status)}</span>
                  )}
                </div>
              </div>

              <div className="shrink-0 text-right">
                <p className={`text-5xl font-semibold ${getScoreColor(investmentScore)}`}>{Math.round(investmentScore)}</p>
                <p className="text-xs text-slate-500">Investment Score / 100</p>
                <div className="mt-2">
                  <VerdictBadge verdict={verdict} />
                </div>
              </div>
            </div>

            {fallbackEvents.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">
                  Основная LLM-модель была недоступна, анализ выполнен через fallback
                </p>
                <ul className="mt-2 space-y-1 text-xs text-amber-800">
                  {fallbackEvents.map((event) => (
                    <li key={`${event.agentName}-${event.primaryProvider}-${event.usedProvider}`}>
                      {event.agentName}: {event.primaryProvider}/{event.primaryModel} → {event.usedProvider}/{event.usedModel}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {detail?.id && (
                <a
                  href={`/report/internal/${detail.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                >
                  Internal Report →
                </a>
              )}
              {detail?.id && (
                <a
                  href={`/report/founder/${detail.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                >
                  Founder Report →
                </a>
              )}
            </div>
          </section>


          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Профиль агентов</h2>
            {scoreBreakdown.length === 0 ? (
              <p className="mt-2 text-sm text-slate-400">Нет данных для отображения.</p>
            ) : (
              <div className="mt-3 h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="agent" tick={{ fill: "#64748b", fontSize: 11 }} />
                    <Radar dataKey="score" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.15} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-slate-900">Карточки агентов</h2>
            {scoreBreakdown.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">Нет данных агентов.</div>
            ) : (
              scoreBreakdown.map((row) => {
                const matchedRun = detail?.agentRuns?.find(
                  (r) => r.agentName === row.agent && r.responsePayload
                );
                return (
                  <AgentCard
                    key={row.agent}
                    agent={row.agent}
                    score={toNumber(row.finalScore)}
                    weight={toNumber(row.baseWeight)}
                    payload={byAgentPayload[row.agent]}
                    applicationId={detail?.id}
                    runId={matchedRun?.id}
                  />
                );
              })
            )}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Executive Summary</h2>
            <div className="prose prose-sm mt-3 max-w-none text-slate-700">
              <ReactMarkdown>{internalSummary}</ReactMarkdown>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900">Внутренний отчет (закрытый)</h2>
            <p className="mt-2 text-sm text-slate-600">
              Этот блок предназначен только для сотрудников Activat VC и содержит подробную логику по каждому агенту и критерию.
            </p>

            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pass / Fail Gates</p>
                <ul className="mt-2 space-y-1 text-sm text-slate-700">
                  {(aggregate?.passFailGates || []).map((gate, idx) => (
                    <li key={`${gate.gate}-${idx}`}>
                      <span className={gate.passed ? "text-emerald-700" : "text-rose-700"}>{gate.passed ? "✓" : "✗"}</span>{" "}
                      {gate.detail}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-lg border border-slate-200 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Red Flags</p>
                {(aggregate?.redFlags || []).length === 0 ? (
                  <p className="mt-2 text-xs text-slate-400">Нет критичных замечаний.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {(aggregate?.redFlags || []).map((item, idx) => (
                      <li key={`${item.agent}-${idx}`} className={item.severity === "critical" ? "text-rose-700" : "text-amber-700"}>
                        <span className="font-medium">[{item.severity}]</span> {item.agent}: {item.flag}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {(aggregate?.interviewGuide || []).slice(0, 8).map((item, idx) => (
                <div key={`${item.question}-${idx}`} className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
                  <p className="font-medium text-slate-900">{item.question}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.area} · {item.priority}
                  </p>
                </div>
              ))}
            </div>

            <details className="mt-4 rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-900">Показать полный JSON по агентам</summary>
              <pre className="mt-3 overflow-x-auto rounded-md bg-slate-50 p-3 text-xs text-slate-700">
                {JSON.stringify(aggregate?.finalAgentJsons || {}, null, 2)}
              </pre>
            </details>
          </section>

          <InvestorDecision score={investmentScore} />
          </>
          )}
        </main>

        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <Chat
            title="Orchestrator"
            initialMessage="Анализ готов. Можете спросить, почему получился такой score и какие ключевые риски сделки."
            knowledgeBase={ORCHESTRATOR_KB}
            quickQuestions={["Почему такой score?", "Главные риски?", "Условия сделки?"]}
          />
        </aside>
      </div>
      )}
    </div>
  );
}
