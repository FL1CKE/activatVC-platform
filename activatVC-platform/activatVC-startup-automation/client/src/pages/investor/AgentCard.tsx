import { useMemo, useState } from "react";

type AgentCardProps = {
  agent: string;
  score: number;
  weight: number;
  payload?: any;
  applicationId?: string;
  runId?: string;
};

function getColor(score: number): string {
  if (score >= 70) return "text-emerald-600";
  if (score >= 50) return "text-amber-600";
  return "text-rose-600";
}

export default function AgentCard({ agent, score, weight, payload, applicationId, runId }: AgentCardProps) {
  const [open, setOpen] = useState(false);

  const strengths = useMemo(() => {
    const value = payload?.strengths;
    return Array.isArray(value) ? value : [];
  }, [payload]);

  const redFlags = useMemo(() => {
    const value = payload?.red_flags;
    return Array.isArray(value) ? value : [];
  }, [payload]);

  const conditions = useMemo(() => {
    const value = payload?.conditions || payload?.investment_conditions;
    return Array.isArray(value) ? value : [];
  }, [payload]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((prev) => !prev)} className="flex flex-1 items-center justify-between text-left">
          <div>
            <p className="text-sm font-semibold text-slate-900">{agent}</p>
            <p className="text-xs text-slate-500">Вес: {weight}%</p>
          </div>
          <div className="text-right">
            <p className={`text-2xl font-semibold ${getColor(score)}`}>{Math.round(score)}</p>
            <p className="text-xs text-slate-500">/ 100</p>
          </div>
        </button>
        {applicationId && runId && (
          <a
            href={`/report/agent/${applicationId}/${runId}`}
            target="_blank"
            rel="noreferrer"
            title="Открыть отчёт агента"
            className="ml-2 shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Отчёт →
          </a>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Сильные стороны</p>
            {strengths.length === 0 ? (
              <p className="mt-1 text-sm text-slate-500">Нет данных.</p>
            ) : (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {strengths.map((item: string, idx: number) => (
                  <li key={`strength-${idx}`}>{item}</li>
                ))}
              </ul>
            )}
          </div>

          {redFlags.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-400">Red flags</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-rose-700">
                {redFlags.map((item: any, idx: number) => (
                  <li key={`flag-${idx}`}>{item.flag || JSON.stringify(item)}</li>
                ))}
              </ul>
            </div>
          )}

          {conditions.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-400">Условия инвестирования</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {conditions.map((item: string, idx: number) => (
                  <li key={`condition-${idx}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
