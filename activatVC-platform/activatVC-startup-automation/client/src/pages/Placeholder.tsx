import { Link, useParams } from "react-router-dom";

const labels: Record<string, { title: string; desc: string }> = {
  accounting: {
    title: "Бухгалтерия",
    desc: "Функционал кабинета бухгалтерии появится на следующем этапе.",
  },
  templates: {
    title: "Шаблоны",
    desc: "Управление шаблонами документов пока в разработке.",
  },
  portfolio: {
    title: "Портфель",
    desc: "Мониторинг портфельных компаний будет добавлен отдельно.",
  },
};

export default function PlaceholderPage() {
  const { section } = useParams();
  const view = labels[section || ""] || {
    title: "Раздел",
    desc: "Этот раздел пока в разработке.",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Activat VC</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-900">{view.title}</h1>
        <p className="mt-3 text-sm leading-7 text-slate-600">{view.desc}</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Вернуться на главную
        </Link>
      </div>
    </div>
  );
}
