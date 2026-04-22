import type { SVGProps } from "react";
import { Link } from "react-router-dom";
import { IconArrow, IconBriefcase, IconCalculator, IconFile, IconSettings, IconTrendingUp, IconUser } from "../components/icons";

type CardIcon = (props: SVGProps<SVGSVGElement>) => JSX.Element;

const cards: { title: string; subtitle: string; to: string; color: string; bg: string; Icon: CardIcon; available: boolean }[] = [
  {
    title: "Фаундерам",
    subtitle: "Подать заявку и пройти Due Diligence",
    to: "/apply",
    color: "text-blue-700",
    bg: "bg-blue-50",
    Icon: IconUser,
    available: true,
  },
  {
    title: "Инвесторам",
    subtitle: "Просмотр отчета агентов и внутреннего заключения",
    to: "/dashboard",
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    Icon: IconTrendingUp,
    available: true,
  },
  {
    title: "Бухгалтерия",
    subtitle: "Раздел в разработке",
    to: "/stub/accounting",
    color: "text-violet-700",
    bg: "bg-violet-50",
    Icon: IconCalculator,
    available: false,
  },
  {
    title: "Шаблоны",
    subtitle: "Раздел в разработке",
    to: "/stub/templates",
    color: "text-slate-700",
    bg: "bg-slate-100",
    Icon: IconFile,
    available: false,
  },
  {
    title: "Портфель",
    subtitle: "Раздел в разработке",
    to: "/stub/portfolio",
    color: "text-cyan-700",
    bg: "bg-cyan-50",
    Icon: IconBriefcase,
    available: false,
  },
  {
    title: "AI Настройки",
    subtitle: "Провайдер, API-ключ, промпты агентов",
    to: "/admin/settings",
    color: "text-indigo-700",
    bg: "bg-indigo-50",
    Icon: IconSettings,
    available: true,
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-slate-50 px-6 py-12">
      <div className="mx-auto max-w-6xl">
        <div className="mb-10 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Activat VC</p>
          <h1 className="mt-2 text-5xl font-semibold text-slate-900">VentureIQ</h1>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-7 text-slate-600">
            Автоматизированный due diligence стартапов. 6 ИИ-агентов, внутренний и founder-facing формат заключений.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.title}
              to={card.to}
              className={`group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${!card.available ? "opacity-60" : ""}`}
            >
              <div className={`mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg ${card.bg} ${card.color}`}>
                <card.Icon className="h-5 w-5" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                {!card.available && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                    Скоро
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-slate-600">{card.subtitle}</p>
              {card.available && (
                <div className={`mt-4 inline-flex items-center gap-1 text-sm font-medium ${card.color}`}>
                  Открыть
                  <IconArrow className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              )}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
