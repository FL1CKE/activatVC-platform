export type FounderInput = {
  name: string;
  country?: string;
  citizenship?: string;
  profiles?: string[];
};

export type GapSeed = {
  source: 'prepare' | 'agent_request';
  gapType: 'critical' | 'recommended';
  title: string;
  description: string;
  question: string;
  inputType: 'text' | 'file' | 'text_or_file';
  requestedByAgent?: string;
  affectsAgents: string[];
};

export type AgentQuestion = {
  question: string;
  priority: 'high' | 'medium' | 'low';
  why: string;
};

export type AgentDocRequest = {
  title: string;
  description: string;
  question: string;
  inputType: 'file' | 'text' | 'text_or_file';
  severity: 'critical' | 'recommended';
};

export type MockAgentResponse = {
  specialist: string;
  round: number;
  score: number;
  summary: string;
  strengths: string[];
  risks: string[];
  criteriaBreakdown: Array<{ name: string; score: number; note: string }>;
  participationConditions: { label: string; details: string[] };
  founderRecommendations: { label: string; details: string[] };
  questionsForFounderInterview: AgentQuestion[];
  dataQuality: { status: 'complete' | 'partial'; notes: string[] };
  crossQueries: Array<Record<string, unknown>>;
  requestedDocuments: AgentDocRequest[];
};

export type AgentConfig = {
  name: string;
  slug: string;
  weight: number;
  coeff: { 'pre-seed': number; seed: number };
  relevantCategories: string[];
};

export const AGENTS: AgentConfig[] = [
  { name: 'CMO+CCO', slug: 'cmo-cco', weight: 17, coeff: { 'pre-seed': 0.8, seed: 1.0 }, relevantCategories: ['business', 'general'] },
  { name: 'CLO', slug: 'clo', weight: 10, coeff: { 'pre-seed': 0.8, seed: 0.9 }, relevantCategories: ['legal', 'team'] },
  { name: 'CFO', slug: 'cfo', weight: 14, coeff: { 'pre-seed': 0.6, seed: 0.9 }, relevantCategories: ['financial'] },
  { name: 'CPO+CTO', slug: 'cpo-cto', weight: 18, coeff: { 'pre-seed': 1.2, seed: 1.2 }, relevantCategories: ['technical', 'product'] },
  { name: 'CHRO', slug: 'chro', weight: 22, coeff: { 'pre-seed': 1.3, seed: 1.2 }, relevantCategories: ['team'] },
];

export const DATAROOM_GUIDE = [
  {
    key: 'pitch_deck',
    title: 'Pitch deck / business overview',
    category: 'business',
    requiredLevel: 'critical',
    why: 'Explains the startup problem, solution, market, traction, and fundraising story.',
    examples: ['Pitch deck', 'Business plan', 'One-pager'],
  },
  {
    key: 'financials',
    title: 'Financial model or financial summary',
    category: 'financial',
    requiredLevel: 'critical',
    why: 'Lets the investment team understand revenue logic, expenses, runway, and unit economics.',
    examples: ['Financial model', 'P&L', 'Budget', 'Revenue summary'],
  },
  {
    key: 'founder_info',
    title: 'Founder and team background',
    category: 'team',
    requiredLevel: 'critical',
    why: 'Needed to evaluate founder-market fit and execution capability.',
    examples: ['CV', 'Resume', 'LinkedIn links', 'Team page'],
  },
  {
    key: 'technical_docs',
    title: 'Product and technical materials',
    category: 'technical',
    requiredLevel: 'recommended',
    why: 'Useful for product and technology review.',
    examples: ['Roadmap', 'Architecture doc', 'Product specs', 'MVP screenshots'],
  },
  {
    key: 'legal_docs',
    title: 'Legal and corporate documents',
    category: 'legal',
    requiredLevel: 'recommended',
    why: 'Important for legal diligence and cap table review.',
    examples: ['Certificate of incorporation', 'SAFE', 'SHA', 'Cap table'],
  },
];

export const CENTRAL_ASIA_ELIGIBLE_COUNTRIES = [
  'kazakhstan',
  'uzbekistan',
  'kyrgyzstan',
  'kyrgyz republic',
  'tajikistan',
  'turkmenistan',
  'казахстан',
  'узбекистан',
  'кыргызстан',
  'киргизия',
  'таджикистан',
  'туркменистан',
];

export const ALLOWED_INDUSTRIES = [
  'SaaS / B2B-платформа',
  'Маркетплейс',
  'Мобильное приложение',
  'Fintech / Payments',
  'Edtech',
  'Logistics Tech / Supply Chain',
  'HR Tech / Recruitment',
  'Legal Tech',
  'E-commerce / Retail Tech',
  'PropTech',
  'Agritech',
  'Mediatech / Content',
  'Adtech / Marketing Tech',
  'CRM / ERP',
  'Analytics / BI',
  'Dev Tools / API',
  'Cybersecurity (без R&D)',
  'IoT Platform (без R&D)',
];

export const FORBIDDEN_INDUSTRY_KEYWORDS = [
  'crypto',
  'blockchain',
  'casino',
  'gambling',
  'betting',
  'bookmaker',
  'token',
  'memecoin',
  'nft',
  'web3',
];

export const ALLOWED_STARTUP_STAGES = ['pre-seed', 'seed'] as const;

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeStartupStage(stage?: string | null): 'pre-seed' | 'seed' | null {
  const normalized = normalizeText(stage || '');
  if (!normalized) return null;
  if (normalized.includes('pre')) return 'pre-seed';
  if (normalized === 'seed') return 'seed';
  return null;
}

export function isAllowedIndustry(industry?: string | null): boolean {
  const normalized = normalizeText(industry || '');
  if (!normalized) return false;
  return ALLOWED_INDUSTRIES.some((item) => normalizeText(item) === normalized);
}

export function containsForbiddenIndustryKeywords(value?: string | null): boolean {
  const normalized = normalizeText(value || '');
  if (!normalized) return false;
  return FORBIDDEN_INDUSTRY_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function hasCentralAsiaFounder(founders: FounderInput[]): boolean {
  return founders.some((founder) => {
    const country = normalizeText(founder.country || '');
    const citizenship = normalizeText(founder.citizenship || '');
    return CENTRAL_ASIA_ELIGIBLE_COUNTRIES.includes(country) || CENTRAL_ASIA_ELIGIBLE_COUNTRIES.includes(citizenship);
  });
}

const CATEGORY_KEYWORDS: Array<{ category: string; classifiedAs: string; keywords: string[]; wordBoundary?: string[] }> = [
  { category: 'business', classifiedAs: 'pitch_deck', keywords: ['pitch', 'deck', 'business', 'gtm', 'market', 'competitor', 'customer'] },
  { category: 'financial', classifiedAs: 'financial_model', keywords: ['financial', 'finance', 'p&l', 'pnl', 'budget', 'revenue', 'invoice', 'bank', 'cap', 'burn', 'runway', 'cashflow', 'cash flow', 'model'] },
  { category: 'legal', classifiedAs: 'legal_document', keywords: ['legal', 'nda', 'patent', 'license', 'contract', 'incorporation'], wordBoundary: ['safe', 'share', 'sha', 'term'] },
  { category: 'team', classifiedAs: 'team_profile', keywords: ['cv', 'resume', 'founder', 'team', 'linkedin'] },
  { category: 'technical', classifiedAs: 'technical_document', keywords: ['tech', 'architecture', 'roadmap', 'api', 'spec', 'product', 'mvp'] },
];

function matchesWordBoundary(text: string, word: string): boolean {
  const regex = new RegExp(`(?:^|[^a-z])${word}(?:[^a-z]|$)`, 'i');
  return regex.test(text);
}

export function normalizeStage(stage?: string | null): 'pre-seed' | 'seed' {
  const normalized = (stage || '').toLowerCase();
  return normalized.includes('pre') ? 'pre-seed' : 'seed';
}

export function classifyDocument(originalName: string, mimeType?: string | null) {
  const lowerName = originalName.toLowerCase();
  const match = CATEGORY_KEYWORDS.find((item) => {
    if (item.keywords.some((keyword) => lowerName.includes(keyword))) return true;
    if (item.wordBoundary?.some((word) => matchesWordBoundary(lowerName, word))) return true;
    return false;
  });

  let documentType = 'other';
  if (mimeType?.includes('pdf')) documentType = 'pdf';
  else if (mimeType?.includes('sheet') || lowerName.endsWith('.xlsx') || lowerName.endsWith('.csv')) documentType = 'xlsx';
  else if (mimeType?.includes('word') || lowerName.endsWith('.docx')) documentType = 'docx';
  else if (mimeType?.includes('presentation') || lowerName.endsWith('.pptx')) documentType = 'pptx';
  else if (mimeType?.startsWith('image/')) documentType = 'image';

  // Spreadsheets without a keyword match default to financial (common in VC context)
  const isSpreadsheet = documentType === 'xlsx';
  const category = match?.category || (isSpreadsheet ? 'financial' : 'general');
  const classifiedAs = match?.classifiedAs || (isSpreadsheet ? 'financial_model' : 'general_document');

  return {
    documentType,
    category,
    classifiedAs,
    readable: true,
    summary: `Uploaded ${category} material: ${originalName}`,
  };
}

export function slugToAgentConfig(slug: string): AgentConfig | undefined {
  return AGENTS.find((agent) => agent.slug === slug);
}

// ─── IC Output Contract (ProcessFlow v14) ─────────────────────────────────────

export type AgentScoreEntry = {
  agent: string;
  finalScore: number;
  baseWeight: number;
  stageCoeff: number;
  weightedContribution: number;
  mode: 'participation_conditions' | 'founder_recommendations';
};

export type RedFlag = {
  agent: string;
  flag: string;
  severity: 'critical' | 'warning';
};

export type GateResult = {
  gate: string;
  passed: boolean;
  detail: string;
};

export type InterviewQuestion = {
  question: string;
  area: string;
  priority: string;
  why: string;
};

export type ICDecisionMemo = {
  investmentScore: number;
  verdict: string;
  feedbackPolicy: 'full' | 'none';
  genPipelineEligible: boolean;
  heroPhrase: string;
  executiveSummary: string;
  scoreBreakdown: AgentScoreEntry[];
  strengths: string[];
  risks: string[];
  redFlags: RedFlag[];
  passFailGates: GateResult[];
  interviewGuide: InterviewQuestion[];
};

// ProcessFlow v14 §2.4 — verdict thresholds (evaluated top-down, first match wins)
export const VERDICT_THRESHOLDS: Array<{ minScore: number; verdict: string }> = [
  { minScore: 90, verdict: 'INVEST' },
  { minScore: 75, verdict: 'CONDITIONAL' },
  { minScore: 60, verdict: 'WATCH' },
  { minScore: 40, verdict: 'PASS WITH FB' },
  { minScore: 0, verdict: 'PASS' },
];

// ProcessFlow v14 §3.3 — score ≥ 60 → participation_conditions, < 60 → founder_recommendations
export const AGENT_PARTICIPATION_THRESHOLD = 60;

// ProcessFlow v14 §5.5–5.6 — feedback policy
export const FEEDBACK_SCORE_THRESHOLD = 40;

// Agent score below this triggers a red flag
export const RED_FLAG_THRESHOLD = 30;
