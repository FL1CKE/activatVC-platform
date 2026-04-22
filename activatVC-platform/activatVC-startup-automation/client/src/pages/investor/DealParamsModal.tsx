import { useState } from "react";

type DealParamsModalProps = {
  onClose: () => void;
  onConfirm: () => void;
};

const tabs = ["Параметры сделки", "Транши и milestone", "Условия SHA"];

export default function DealParamsModal({ onClose, onConfirm }: DealParamsModalProps) {
  const [tab, setTab] = useState(0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Параметры сделки</h3>
            <p className="text-sm text-slate-500">Настройка перед запуском GEN-pipeline</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-600">
            Закрыть
          </button>
        </div>

        <div className="flex border-b border-slate-100">
          {tabs.map((title, idx) => (
            <button
              key={title}
              type="button"
              onClick={() => setTab(idx)}
              className={`flex-1 px-3 py-2 text-xs font-medium ${tab === idx ? "border-b-2 border-blue-600 text-blue-700" : "text-slate-500"}`}
            >
              {title}
            </button>
          ))}
        </div>

        <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
          {tab === 0 && (
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Инструмент
                <select className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                  <option>SAFE</option>
                  <option>Equity</option>
                  <option>Convertible Note</option>
                </select>
              </label>
              <label className="text-sm text-slate-700">
                Сумма
                <input defaultValue="500 000" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-slate-700">
                Pre-money
                <input defaultValue="4 500 000" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
              <label className="text-sm text-slate-700">
                Доля инвестора (%)
                <input defaultValue="10" className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              </label>
            </div>
          )}

          {tab === 1 && (
            <div className="space-y-2 text-sm text-slate-700">
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-medium text-slate-900">Транш 1</p>
                <p className="mt-1">MRR достигает $35,000</p>
                <p>CI/CD внедрен, время деплоя &lt; 15 мин</p>
                <p>CTO переходит на full-time</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-medium text-slate-900">Транш 2</p>
                <p className="mt-1">LTV:CAC &gt; 3.5x</p>
                <p>CAC снижен до $280 (direct)</p>
                <p>Нанят Head of Sales</p>
              </div>
            </div>
          )}

          {tab === 2 && (
            <ul className="space-y-2 text-sm text-slate-700">
              <li className="rounded-lg border border-slate-200 p-3">Вестинг основателей: 4 года, 1 год cliff</li>
              <li className="rounded-lg border border-slate-200 p-3">Anti-dilution: broad-based weighted average</li>
              <li className="rounded-lg border border-slate-200 p-3">Drag-along / Tag-along</li>
              <li className="rounded-lg border border-slate-200 p-3">ROFR при продаже долей</li>
            </ul>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700">
            Отмена
          </button>
          <button type="button" onClick={onConfirm} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}
