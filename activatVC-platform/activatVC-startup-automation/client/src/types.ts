export type FounderDraft = {
  id: number;
  name: string;
  email: string;
  country: string;
  citizenship: string;
  profileType: string;
  profileUrl: string;
};

export type FormIssue = {
  field: string;
  message: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export type AppListItem = {
  id: string;
  startupName: string;
  status: string;
  investmentScore?: number | null;
  verdict?: string | null;
  activityType?: string | null;
  startupStage?: string | null;
  founders?: unknown;
  magicLinkUrl?: string | null;
};

export type ScoreBreakdown = {
  agent: string;
  finalScore: number;
  baseWeight: number;
  stageCoeff: number;
  weightedContribution: number;
  mode: string;
};

export type RedFlagItem = {
  agent: string;
  flag: string;
  severity: "critical" | "warning";
};

export type GateItem = {
  gate: string;
  passed: boolean;
  detail: string;
};

export type InterviewGuideItem = {
  question: string;
  area: string;
  priority: string;
  why: string;
};

export type AggregateReport = {
  investmentScore?: number;
  verdict?: string;
  heroPhrase?: string;
  executiveSummary?: string;
  scoreBreakdown?: ScoreBreakdown[];
  interviewGuide?: InterviewGuideItem[];
  redFlags?: RedFlagItem[];
  passFailGates?: GateItem[];
  decisionMemo?: {
    strengths?: string[];
    risks?: string[];
    interviewGuide?: InterviewGuideItem[];
  };
  finalAgentJsons?: Record<string, any>;
};

export type FounderReport = {
  verdict: string;
  heroPhrase: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
};

export type ApplicationDetail = {
  id: string;
  startupName: string;
  status: string;
  activityType?: string | null;
  startupStage?: string | null;
  investmentScore?: number | null;
  verdict?: string | null;
  heroPhrase?: string | null;
  executiveSummary?: string | null;
  aggregateReport?: AggregateReport | null;
  founderReport?: FounderReport | null;
  documents?: Array<{
    id: string;
    originalName: string;
    fileUrl: string;
    source: string;
    category?: string;
  }>;
  gapItems?: Array<{
    id: string;
    status: string;
    title: string;
    question: string;
    gapType: string;
  }>;
  agentRuns?: Array<{
    id: string;
    agentName: string;
    status: string;
    round: number;
    score?: number | null;
    responsePayload?: any;
  }>;
  magicLinkUrl?: string | null;
};
