import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AGENT_ORDER, extractMagicToken } from "../../constants";
import type { ApplicationDetail } from "../../types";

type LocationState = {
  applicationId?: string;
  magicToken?: string | null;
  startupName?: string;
  stage?: string;
};

function toAgentProgress(detail: ApplicationDetail | null): Record<string, number> {
  const progressMap: Record<string, number> = {};

  // Determine if analysis is actively running (agents started but not all done yet)
  const isActivelyRunning = !!detail && detail.status !== "pending" && detail.status !== "complete" && detail.status !== "awaiting_founder";

  for (const agentName of AGENT_ORDER) {
    // If analysis is underway, treat agents with no record as "running" (35%), not "waiting" (0%)
    progressMap[agentName] = isActivelyRunning ? 5 : 0;
  }

  if (!detail?.agentRuns) {
    return progressMap;
  }

  for (const run of detail.agentRuns) {
    if (!AGENT_ORDER.includes(run.agentName)) continue;
    if (run.status === "completed") progressMap[run.agentName] = 100;
    else if (run.status === "needs_more_info") progressMap[run.agentName] = 70;
    else progressMap[run.agentName] = Math.max(progressMap[run.agentName], 35);
  }

  return progressMap;
}

export default function ProcessingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = (location.state as LocationState | null) || {};

  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const appId = state.applicationId;

  useEffect(() => {
    let timer: number | null = null;
    let cancelled = false;

    const poll = async () => {
      if (!appId) {
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/applications/${appId}`);
        const payload = await response.json().catch(() => null);

        if (!response.ok || !payload) {
          throw new Error(payload?.error || "Не удалось получить статус анализа");
        }

        if (cancelled) return;
        setDetail(payload as ApplicationDetail);
        setLoading(false);

        const status = String(payload.status || "");
        const token = extractMagicToken(payload.magicLinkUrl) || state.magicToken || null;
        if (token && (status === "complete" || status === "awaiting_founder")) {
          navigate(`/magic/${token}`, { replace: true });
          return;
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Ошибка загрузки статуса");
        setLoading(false);
      }

      timer = window.setTimeout(poll, 3500);
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [appId, navigate, state.magicToken]);

  const baseProgress = useMemo(() => toAgentProgress(detail), [detail]);

  // Gradual progress: all active agents tick up slowly over time
  const [tick, setTick] = useState(0);
  const tickRef = useRef(tick);
  tickRef.current = tick;
  useEffect(() => {
    const iv = window.setInterval(() => setTick((t) => t + 1), 4000);
    return () => window.clearInterval(iv);
  }, []);

  const progress = useMemo(() => {
    const map: Record<string, number> = { ...baseProgress };
    for (const agent of AGENT_ORDER) {
      const base = map[agent] ?? 0;
      // For any active agent (> 0%), slowly creep up based on tick
      if (base > 0 && base < 100) {
        map[agent] = Math.min(90, base + Math.min(tick * 1.5, 85));
      }
    }
    return map;
  }, [baseProgress, tick]);

  const globalProgress = useMemo(() => {
    const values = Object.values(progress);
    if (values.length === 0) return 0;
    return Math.round(values.reduce((acc, item) => acc + item, 0) / values.length);
  }, [progress]);

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">VentureIQ</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Идет анализ заявки</h1>
        <p className="mt-2 text-sm text-slate-600">
          {state.startupName ? `${state.startupName}` : "Стартап"} · Стадия {state.stage || "seed"}. Обычно анализ занимает 5-15 минут.
        </p>

        <style>{`
          @keyframes shimmer { 0% { transform: translateX(-100%); } 100% { transform: translateX(400%); } }
          .shimmer-bar { animation: shimmer 1.4s linear infinite; }
        `}</style>

        <div className="mt-6 rounded-xl border border-blue-100 bg-blue-50 p-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-blue-900">Общий прогресс</span>
            <span className="font-semibold text-blue-800">{globalProgress}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="relative h-full rounded-full bg-blue-600 transition-all duration-700" style={{ width: `${Math.max(globalProgress, globalProgress > 0 ? 5 : 0)}%` }}>
              {globalProgress > 0 && globalProgress < 100 && (
                <div className="shimmer-bar absolute inset-y-0 w-1/3 rounded-full bg-white/30" />
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {AGENT_ORDER.map((agent) => {
            const pct = progress[agent] ?? 0;
            const running = pct > 0 && pct < 100;
            const done = pct === 100;
            return (
              <div key={agent} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-800">{agent}</span>
                  <span className={done ? "font-semibold text-emerald-600" : running ? "text-blue-500" : "text-slate-400"}>
                    {done ? "✓ готово" : running ? "анализ..." : "ожидание"}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={[
                      "h-full rounded-full transition-all duration-700 ease-in-out",
                      done ? "bg-emerald-500" : running ? "bg-blue-500" : "bg-slate-300",
                      running ? "animate-pulse" : "",
                    ].join(" ")}
                    style={{ width: `${pct === 0 ? 0 : Math.max(pct, 8)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {loading && <p className="mt-4 text-sm text-slate-500">Получаем статус...</p>}
        {detail && (
          <p className="mt-4 text-sm text-slate-600">
            Текущий статус: <span className="font-semibold text-slate-900">{detail.status}</span>
          </p>
        )}
        {error && <p className="mt-4 text-sm text-rose-600">{error}</p>}

        {!appId && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
            Не удалось получить id заявки из состояния страницы. Вернитесь к форме и отправьте заново.
          </div>
        )}

        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
          <p className="text-xs text-slate-500">
            После завершения всех проверок вы будете автоматически перенаправлены на страницу с результатами анализа.
            Не закрывайте эту вкладку.
          </p>
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Link to="/apply" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Назад к форме
          </Link>
          <Link to="/" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
            Главная
          </Link>
        </div>
      </div>
    </div>
  );
}
