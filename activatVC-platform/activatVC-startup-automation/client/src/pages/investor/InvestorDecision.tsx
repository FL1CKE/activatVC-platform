import { useState } from "react";
import DealParamsModal from "./DealParamsModal";

type InvestorDecisionProps = {
  score: number;
};

type Decision = "approve" | "reject" | "revision" | null;

export default function InvestorDecision({ score }: InvestorDecisionProps) {
  const [decision, setDecision] = useState<Decision>(null);
  const [showDealModal, setShowDealModal] = useState(false);
  const [showConfirm, setShowConfirm] = useState<Decision>(null);
  const [comment, setComment] = useState("");

  const canApprove = score >= 60;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900">Решение инвестора</h3>
      <p className="mt-1 text-xs text-slate-600">Зафиксируйте итог после изучения полного внутреннего отчета и собеседования с фаундером.</p>

      {!decision && (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={!canApprove}
            onClick={() => setShowDealModal(true)}
            className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          >
            Одобрить
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm("revision")}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700"
          >
            Запросить доработки
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm("reject")}
            className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
          >
            Отказать
          </button>
        </div>
      )}

      {decision === "approve" && (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Инвестиция одобрена. Запущен сценарий подготовки сделки.
        </p>
      )}
      {decision === "revision" && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Фаундеру отправлен запрос на доработки с краткой обратной связью.
        </p>
      )}
      {decision === "reject" && (
        <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Отказ зафиксирован. Фаундеру отправлено краткое заключение с зонами для улучшения.
        </p>
      )}

      {showDealModal && (
        <DealParamsModal
          onClose={() => setShowDealModal(false)}
          onConfirm={() => {
            setDecision("approve");
            setShowDealModal(false);
          }}
        />
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
            <h4 className="text-sm font-semibold text-slate-900">
              {showConfirm === "reject" ? "Подтвердить отказ" : "Запросить доработки"}
            </h4>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="Комментарий фаундеру"
              className="mt-3 h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowConfirm(null)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => {
                  setDecision(showConfirm);
                  setShowConfirm(null);
                }}
                className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
              >
                Подтвердить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
