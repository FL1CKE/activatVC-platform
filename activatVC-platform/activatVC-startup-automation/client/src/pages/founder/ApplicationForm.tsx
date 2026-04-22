import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Chat from "../../components/Chat";
import { ASSIST_KB, ACTIVITIES, CA_COUNTRIES, CAT3_DOCS, CURRENCIES, DOC_INFO, ELIGIBLE_CA, FORBIDDEN_KW, SUBDOCS, extractMagicToken, normalizeText } from "../../constants";
import type { FormIssue, FounderDraft } from "../../types";

type UploadMap = Record<string, File | null>;

type ProcessingState = {
  applicationId?: string;
  magicToken?: string | null;
  startupName?: string;
  stage?: string;
};

const profileTypes = ["LinkedIn", "Instagram", "Twitter/X", "Telegram", "Сайт", "Другое"];

const initialUploads: UploadMap = {
  pitch: null,
  fin: null,
  mkt: null,
  tech: null,
  unit: null,
  founders: null,
  cap: null,
  val: null,
  video: null,
  rounds: null,
  ip: null,
  tm: null,
  corp: null,
  contracts: null,
  tos: null,
};

function hasCentralAsiaFounder(founders: FounderDraft[]) {
  return founders.some((founder) => {
    const country = normalizeText(founder.country);
    const citizenship = normalizeText(founder.citizenship);
    return ELIGIBLE_CA.some((entry) => country.includes(entry) || citizenship.includes(entry));
  });
}

function fileLabel(file: File | null): string {
  return file ? file.name : "Не загружено";
}

export default function ApplicationForm() {
  const navigate = useNavigate();

  const [startupName, setStartupName] = useState("");
  const [startupStage, setStartupStage] = useState("seed");
  const [activityType, setActivityType] = useState("");
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [investmentAmount, setInvestmentAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(false);

  const [founders, setFounders] = useState<FounderDraft[]>([
    {
      id: 1,
      name: "",
      email: "",
      country: "Казахстан",
      citizenship: "",
      profileType: "LinkedIn",
      profileUrl: "",
    },
  ]);

  const [uploads, setUploads] = useState<UploadMap>(initialUploads);
  const [issues, setIssues] = useState<FormIssue[]>([]);

  const requiredSubdocs = useMemo(
    () => SUBDOCS.filter((slot) => slot.requiredFor.includes(startupStage as "seed" | "pre-seed")),
    [startupStage],
  );

  const updateFounder = (id: number, field: keyof FounderDraft, value: string) => {
    setFounders((prev) => prev.map((founder) => (founder.id === id ? { ...founder, [field]: value } : founder)));
  };

  const addFounder = () => {
    setFounders((prev) => [
      ...prev,
      {
        id: Date.now(),
        name: "",
        email: "",
        country: "Казахстан",
        citizenship: "",
        profileType: "LinkedIn",
        profileUrl: "",
      },
    ]);
  };

  const removeFounder = (id: number) => {
    setFounders((prev) => (prev.length > 1 ? prev.filter((founder) => founder.id !== id) : prev));
  };

  const setUpload = (key: string, file: File | null) => {
    setUploads((prev) => ({ ...prev, [key]: file }));
  };

  const validateForm = (): FormIssue[] => {
    const nextIssues: FormIssue[] = [];
    const combined = `${description} ${activityType}`.toLowerCase();

    if (!startupName.trim()) nextIssues.push({ field: "startupName", message: "Укажите название компании." });
    if (!activityType.trim()) nextIssues.push({ field: "activityType", message: "Выберите вид деятельности." });
    if (!description.trim()) nextIssues.push({ field: "description", message: "Добавьте описание проекта." });
    if (!["seed", "pre-seed"].includes(startupStage)) {
      nextIssues.push({ field: "startupStage", message: "Допускаются только стадии pre-seed и seed." });
    }

    const firstFounder = founders[0];
    if (!firstFounder?.name.trim()) nextIssues.push({ field: "founderName", message: "Укажите имя основного фаундера." });
    if (!firstFounder?.email.trim()) nextIssues.push({ field: "founderEmail", message: "Укажите email основного фаундера." });

    if (!hasCentralAsiaFounder(founders)) {
      nextIssues.push({ field: "caFounder", message: "Нужен минимум один фаундер из Центральной Азии." });
    }

    const forbiddenHit = FORBIDDEN_KW.find((kw) => combined.includes(kw));
    if (forbiddenHit) {
      nextIssues.push({
        field: "industry",
        message: `Проект не проходит gate check из-за запрещенной индустрии/ключевого слова: ${forbiddenHit}.`,
      });
    }

    if (!uploads.pitch) nextIssues.push({ field: "pitch", message: "Загрузите Pitch Deck." });
    if (!uploads.fin) nextIssues.push({ field: "fin", message: "Загрузите финансовую модель." });

    for (const slot of requiredSubdocs) {
      if (!uploads[slot.id]) {
        nextIssues.push({ field: slot.id, message: `Обязательный документ: ${slot.label}.` });
      }
    }

    return nextIssues;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading) return;

    const validationIssues = validateForm();
    setIssues(validationIssues);
    if (validationIssues.length > 0) return;

    setLoading(true);
    try {
      const payload = new FormData();
      const mappedFounders = founders
        .filter((founder) => founder.name.trim() || founder.email.trim())
        .map((founder) => ({
          name: founder.name.trim(),
          email: founder.email.trim(),
          country: founder.country,
          citizenship: founder.citizenship.trim(),
          profiles: founder.profileUrl.trim() ? [founder.profileUrl.trim()] : [],
        }));

      payload.set("startupName", startupName.trim());
      payload.set("founderEmail", mappedFounders[0]?.email || founders[0]?.email || "");
      payload.set("startupStage", startupStage);
      payload.set("activityType", activityType);
      payload.set("description", description.trim());
      payload.set("businessModel", description.trim());
      payload.set("websiteUrl", websiteUrl.trim());
      payload.set("driveLink", driveLink.trim());
      payload.set("investmentAmount", investmentAmount.trim() || "0");
      payload.set("currency", currency);
      payload.set("founders", JSON.stringify(mappedFounders));
      payload.set("isTraditionalBusiness", "false");

      Object.values(uploads)
        .filter((file): file is File => Boolean(file))
        .forEach((file) => payload.append("documents", file));

      const response = await fetch("/api/applications", { method: "POST", body: payload });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const backendIssues = Array.isArray(data?.details)
          ? data.details.map((detail: any) => ({ field: String(detail.field || "form"), message: String(detail.message || "Validation error") }))
          : [{ field: "form", message: String(data?.error || "Не удалось отправить заявку") }];
        setIssues(backendIssues);
        return;
      }

      const magicLinkUrl = data?.magicLinkUrl || data?.application?.magicLinkUrl || null;
      const appId = data?.application?.id || null;
      const magicToken = extractMagicToken(magicLinkUrl);
      const state: ProcessingState = {
        applicationId: appId || undefined,
        magicToken,
        startupName,
        stage: startupStage,
      };

      navigate("/processing", { state });
    } catch (error) {
      setIssues([
        {
          field: "form",
          message: `Ошибка сети: ${error instanceof Error ? error.message : "unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 md:px-6">
      <form onSubmit={submit} className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
              Назад
            </Link>
            <h1 className="text-2xl font-semibold text-slate-900">Заявка на рассмотрение</h1>
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">A. Базовая информация</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-sm text-slate-700">
                Название компании *
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={startupName}
                  onChange={(event) => setStartupName(event.target.value)}
                />
              </label>

              <label className="text-sm text-slate-700">
                Вид деятельности *
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={activityType}
                  onChange={(event) => setActivityType(event.target.value)}
                >
                  <option value="">Выберите...</option>
                  {ACTIVITIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-700">
                Стадия *
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={startupStage}
                  onChange={(event) => setStartupStage(event.target.value)}
                >
                  <option value="pre-seed">Pre-seed</option>
                  <option value="seed">Seed</option>
                </select>
              </label>

              <label className="text-sm text-slate-700">
                Website
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                />
              </label>

              <label className="text-sm text-slate-700 md:col-span-2">
                Описание проекта *
                <textarea
                  className="mt-1 h-24 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>

              <label className="text-sm text-slate-700">
                Запрашиваемая сумма
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={investmentAmount}
                  onChange={(event) => setInvestmentAmount(event.target.value)}
                />
              </label>

              <label className="text-sm text-slate-700">
                Валюта
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {CURRENCIES.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-sm text-slate-700 md:col-span-2">
                Data Room link (Google Drive / Notion)
                <input
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  value={driveLink}
                  onChange={(event) => setDriveLink(event.target.value)}
                  placeholder="https://..."
                />
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Фаундеры</h3>
                <button
                  type="button"
                  onClick={addFounder}
                  className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                >
                  + Добавить
                </button>
              </div>

              <div className="space-y-3">
                {founders.map((founder, idx) => (
                  <div key={founder.id} className="rounded-lg border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Фаундер {idx + 1}</p>
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => removeFounder(founder.id)}
                          className="text-xs text-rose-600"
                        >
                          Удалить
                        </button>
                      )}
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <input
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Имя и фамилия"
                        value={founder.name}
                        onChange={(event) => updateFounder(founder.id, "name", event.target.value)}
                      />
                      <input
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Email"
                        value={founder.email}
                        onChange={(event) => updateFounder(founder.id, "email", event.target.value)}
                      />
                      <select
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={founder.country}
                        onChange={(event) => updateFounder(founder.id, "country", event.target.value)}
                      >
                        {CA_COUNTRIES.map((country) => (
                          <option key={country} value={country}>
                            {country}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Гражданство"
                        value={founder.citizenship}
                        onChange={(event) => updateFounder(founder.id, "citizenship", event.target.value)}
                      />
                      <select
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={founder.profileType}
                        onChange={(event) => updateFounder(founder.id, "profileType", event.target.value)}
                      >
                        {profileTypes.map((profileType) => (
                          <option key={profileType} value={profileType}>
                            {profileType}
                          </option>
                        ))}
                      </select>
                      <input
                        className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="Ссылка на профиль"
                        value={founder.profileUrl}
                        onChange={(event) => updateFounder(founder.id, "profileUrl", event.target.value)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">B. Документы</h2>

            <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <h3 className="text-sm font-semibold text-rose-800">Категория 1 — обязательные</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-700">
                  Pitch Deck *
                  <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload("pitch", event.target.files?.[0] || null)} />
                  <span className="text-[11px] text-slate-500">{fileLabel(uploads.pitch)}</span>
                </label>
                <label className="text-xs text-slate-700">
                  Финансовая модель *
                  <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload("fin", event.target.files?.[0] || null)} />
                  <span className="text-[11px] text-slate-500">{fileLabel(uploads.fin)}</span>
                </label>
              </div>

              <div className="mt-3 space-y-2 rounded-lg border border-rose-100 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Субдокументы</p>
                {SUBDOCS.filter((slot) => slot.requiredFor.includes(startupStage as "seed" | "pre-seed") || slot.optionalFor?.includes(startupStage as "seed" | "pre-seed")).map((slot) => {
                  const optional = Boolean(slot.optionalFor?.includes(startupStage as "seed" | "pre-seed"));
                  return (
                    <label key={slot.id} className="block text-xs text-slate-700">
                      {slot.label} {optional ? "(опционально)" : "*"}
                      <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload(slot.id, event.target.files?.[0] || null)} />
                      <span className="text-[11px] text-slate-500">{fileLabel(uploads[slot.id])}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mb-4 rounded-xl border border-blue-200 bg-blue-50 p-3">
              <h3 className="text-sm font-semibold text-blue-800">Product Demo</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <label className="text-xs text-slate-700">
                  Видео демо
                  <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload("video", event.target.files?.[0] || null)} />
                  <span className="text-[11px] text-slate-500">{fileLabel(uploads.video)}</span>
                </label>
                <label className="text-xs text-slate-700">
                  Документы прошлых раундов
                  <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload("rounds", event.target.files?.[0] || null)} />
                  <span className="text-[11px] text-slate-500">{fileLabel(uploads.rounds)}</span>
                </label>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <h3 className="text-sm font-semibold text-slate-800">Категория 3 — юридический пакет (опционально)</h3>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {CAT3_DOCS.map((slot) => (
                  <label key={slot.id} className="text-xs text-slate-700">
                    {slot.label}
                    <input type="file" className="mt-1 block w-full text-xs" onChange={(event) => setUpload(slot.id, event.target.files?.[0] || null)} />
                    <span className="text-[11px] text-slate-500">{fileLabel(uploads[slot.id])}</span>
                  </label>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold text-slate-900">Памятка по документам</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {Object.entries(DOC_INFO).map(([key, value]) => (
                <div key={key} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{key}</p>
                  <p className="mt-1 text-sm text-slate-700">{value.what}</p>
                  <p className="mt-1 text-xs text-slate-500">{value.why}</p>
                </div>
              ))}
            </div>
          </section>

          {issues.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-4">
              <h3 className="text-sm font-semibold text-rose-700">Исправьте ошибки перед отправкой</h3>
              <ul className="mt-2 list-disc pl-5 text-sm text-rose-700">
                {issues.map((issue, index) => (
                  <li key={`${issue.field}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            </section>
          )}

          <div className="sticky bottom-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {loading ? "Отправляем..." : "Отправить на анализ"}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">После отправки вы перейдете на экран анализа.</p>
          </div>
        </div>

        <div className="lg:sticky lg:top-6 lg:h-fit">
          <Chat
            title="ИИ-ассистент фаундера"
            initialMessage="Помогу заполнить заявку и проверить обязательные документы."
            knowledgeBase={ASSIST_KB}
            quickQuestions={["Что важно для pre-seed?", "Как загрузить demo?", "Что такое FAA?"]}
          />
        </div>
      </form>
    </div>
  );
}
