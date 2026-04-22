export const CA_COUNTRIES = [
  "Казахстан",
  "Узбекистан",
  "Кыргызстан",
  "Таджикистан",
  "Туркменистан",
  "Другое",
];

export const ELIGIBLE_CA = [
  "казахстан",
  "узбекистан",
  "кыргызстан",
  "киргизия",
  "таджикистан",
  "туркменистан",
  "kazakhstan",
  "uzbekistan",
  "kyrgyzstan",
  "tajikistan",
  "turkmenistan",
];

export const CURRENCIES = ["USD", "EUR", "KZT", "RUB"];

export const FORBIDDEN_KW = [
  "crypto",
  "blockchain",
  "web3",
  "nft",
  "gambling",
  "casino",
  "betting",
  "казино",
  "deep-tech",
  "deeptech",
  "биоинформатика",
  "геномика",
];

export const ACTIVITIES = [
  "SaaS / B2B-платформа",
  "Маркетплейс",
  "Мобильное приложение",
  "Fintech / Payments",
  "Edtech",
  "Logistics Tech / Supply Chain",
  "HR Tech / Recruitment",
  "Legal Tech",
  "E-commerce / Retail Tech",
  "PropTech",
  "Agritech",
  "Mediatech / Content",
  "Adtech / Marketing Tech",
  "CRM / ERP",
  "Analytics / BI",
  "Dev Tools / API",
  "Cybersecurity (без R&D)",
  "IoT Platform (без R&D)",
];

export const AGENT_ORDER = ["CMO+CCO", "CLO", "CFO", "CPO+CTO", "CHRO"];

export type StageType = "seed" | "pre-seed";

export type SubdocSlot = {
  id: string;
  label: string;
  requiredFor: StageType[];
  optionalFor?: StageType[];
};

export const SUBDOCS: SubdocSlot[] = [
  { id: "mkt", label: "Market Sizing (TAM/SAM/SOM)", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
  { id: "tech", label: "Technology Overview", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
  { id: "unit", label: "Unit Economics", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
  { id: "founders", label: "Профили основателей", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
  { id: "cap", label: "Таблица капитализации (Cap Table)", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
  { id: "val", label: "Оценка компании (Pre-money)", requiredFor: [], optionalFor: ["seed", "pre-seed"] },
];

export const CAT3_DOCS = [
  { id: "ip", label: "IP Assignment Agreements" },
  { id: "tm", label: "Товарные знаки, домен и Open Source" },
  { id: "corp", label: "Учредительные документы" },
  { id: "contracts", label: "Договоры с сотрудниками и подрядчиками" },
  { id: "tos", label: "Terms of Service & Privacy Policy" },
] as const;

export const ASSIST_KB: Record<string, string> = {
  "pre-seed": "На pre-seed обязательны: Pitch Deck и Финансовая модель. Остальные документы (Market Sizing, Tech Overview, Cap Table и др.) улучшают качество анализа, но не блокируют подачу.",
  "seed": "На seed обязательны: Pitch Deck и Финансовая модель. Дополнительные документы (Unit Economics, Cap Table, оценка компании) повышают точность оценки.",
  "demo": "Product Demo: credentials (URL+логин+пароль) и/или видео walkthrough 5-15 минут.",
  "faa": "FAA: короткое интервью с фаундером, повышает качество оценки CHRO при отсутствии трекшна.",
  "pitch": "Pitch Deck: 10-20 слайдов о проблеме, решении, рынке, бизнес-модели, трекшне и команде.",
  default: "Задайте вопрос по документам или загрузке, помогу по шагам.",
};

export const ORCHESTRATOR_KB: Record<string, string> = {
  "почему": "Скор формируется как взвешенная сумма 5 агентов с коэффициентами по стадии и проверкой pass/fail gates.",
  "риск": "Ключевые риски: критические red flags, проблемы в финмодели, legal gaps и концентрация выручки.",
  "услов": "Условия сделки формируются по критичным замечаниям агентов и отражаются в decision memo.",
  "оценк": "Оценка компании обосновывается в CFO-блоке на основе метрик и сравнительных мультипликаторов.",
  default: "Уточните вопрос: по скорингу, рискам, условиям сделки или отдельному агенту.",
};

export const DOC_INFO: Record<string, { what: string; why: string }> = {
  pitch: {
    what: "Презентация стартапа: проблема, решение, рынок, бизнес-модель, трекшн, команда.",
    why: "Базовый документ для всех 5 агентов.",
  },
  fin: {
    what: "Финмодель с P&L, cash flow, прогнозами и unit-экономикой.",
    why: "Ключевой документ для CFO.",
  },
  mkt: {
    what: "Расчет TAM/SAM/SOM с источниками.",
    why: "Верификация рынка и коммерческого потенциала.",
  },
  tech: {
    what: "Описание архитектуры, стека и техподхода.",
    why: "Оценка масштабируемости CPO+CTO.",
  },
  unit: {
    what: "Метрики CAC/LTV/payback/gross margin.",
    why: "Проверка юнит-экономики и качества роста.",
  },
};

export function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

export function extractMagicToken(url?: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/magic\/([^/?#]+)/i);
  return match ? match[1] : null;
}
