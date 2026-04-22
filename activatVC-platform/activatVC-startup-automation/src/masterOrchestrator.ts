import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getMasterOrchestratorPrompt } from './settings';

type OrchestratorInput = {
  startupName: string;
  startupStage: string | null;
  activityType: string | null;
  investmentScore: number;
  verdict: string;
  scoreBreakdown: Array<Record<string, unknown>>;
  strengths: string[];
  risks: string[];
  interviewGuide: Array<Record<string, unknown>>;
  agentOutputs: Record<string, unknown>;
};

type OrchestratorResult = {
  used: boolean;
  reason?: string;
  sourcePath?: string;
  promptHash?: string;
  provider?: string;
  model?: string;
  heroPhrase?: string;
  executiveSummary?: string;
};

type PromptCache = {
  sourcePath: string;
  content: string;
  hash: string;
};

const mode = (process.env.MASTER_ORCHESTRATOR_MODE || 'deterministic').toLowerCase();
const provider = (process.env.MASTER_ORCHESTRATOR_PROVIDER || 'openai').toLowerCase();
const model = process.env.MASTER_ORCHESTRATOR_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini');
const maxAgentChars = Number(process.env.MASTER_ORCHESTRATOR_MAX_AGENT_CHARS || '3000');
const promptPath = process.env.MASTER_ORCHESTRATOR_PROMPT_PATH || './config/master_orchestrator_prompt_v5.2.md';

let cache: PromptCache | null = null;

function parseJsonObject(text: string) {
  const trimmed = (text || '').trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const candidates = [trimmed, withoutFence];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate) as { heroPhrase?: string; executiveSummary?: string };
    } catch {
      // try next strategy
    }
  }

  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const slice = withoutFence.slice(start, end + 1);
    return JSON.parse(slice) as { heroPhrase?: string; executiveSummary?: string };
  }

  throw new Error('llm_output_not_json');
}

function resolvePromptPath() {
  if (path.isAbsolute(promptPath)) return promptPath;
  return path.resolve(process.cwd(), promptPath);
}

function loadPrompt(): PromptCache | null {
  // Priority 1: dynamic override from llm-settings.json (admin UI)
  const adminPrompt = getMasterOrchestratorPrompt();
  if (adminPrompt) {
    const hash = crypto.createHash('sha256').update(adminPrompt).digest('hex');
    if (cache && cache.hash === hash && cache.sourcePath === 'llm-settings.json') return cache;
    cache = { sourcePath: 'llm-settings.json', content: adminPrompt, hash };
    return cache;
  }

  // Priority 2: file on disk
  const sourcePath = resolvePromptPath();
  if (!fs.existsSync(sourcePath)) return null;

  const content = fs.readFileSync(sourcePath, 'utf-8').trim();
  if (!content) return null;

  const hash = crypto.createHash('sha256').update(content).digest('hex');
  if (cache && cache.hash === hash && cache.sourcePath === sourcePath) return cache;

  cache = { sourcePath, content, hash };
  return cache;
}

function truncateAgentOutputs(agentOutputs: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [agent, payload] of Object.entries(agentOutputs)) {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= maxAgentChars) {
      output[agent] = payload;
      continue;
    }

    output[agent] = {
      _truncated: true,
      _size: serialized.length,
      excerpt: serialized.slice(0, maxAgentChars),
    };
  }
  return output;
}

function buildUserPayload(input: OrchestratorInput) {
  return {
    startup: {
      name: input.startupName,
      stage: input.startupStage,
      activityType: input.activityType,
    },
    score: {
      investmentScore: input.investmentScore,
      verdict: input.verdict,
      breakdown: input.scoreBreakdown,
    },
    signals: {
      strengths: input.strengths,
      risks: input.risks,
      interviewGuide: input.interviewGuide,
    },
    finalAgentJsons: truncateAgentOutputs(input.agentOutputs),
    output_contract: {
      format: 'json',
      schema: {
        heroPhrase: 'string (<= 220 chars)',
        executiveSummary: 'string (<= 1600 chars)',
      },
      rules: [
        'Do not invent facts not present in inputs',
        'Be concise and investment-oriented',
        'Return JSON only',
      ],
    },
  };
}

async function callOpenAI(systemPrompt: string, userPayload: unknown) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is missing');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI error: HTTP ${response.status} ${body.slice(0, 400)}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content || '{}';
  return parseJsonObject(content);
}

async function callAnthropic(systemPrompt: string, userPayload: unknown) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is missing');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system: systemPrompt,
      messages: [
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic error: HTTP ${response.status} ${body.slice(0, 400)}`);
  }

  const data = await response.json() as {
    content?: Array<{ type?: string; text?: string }>;
  };
  const text = data.content?.find((item) => item.type === 'text')?.text || '{}';
  return parseJsonObject(text);
}

export function getMasterPromptMeta() {
  const prompt = loadPrompt();
  if (!prompt) return null;
  return {
    sourcePath: prompt.sourcePath,
    promptHash: prompt.hash,
    mode,
    provider,
    model,
  };
}

export async function runMasterOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const prompt = loadPrompt();
  if (!prompt) {
    return { used: false, reason: 'master_prompt_not_found_or_empty' };
  }

  if (mode !== 'llm') {
    return {
      used: false,
      reason: `mode_${mode}`,
      sourcePath: prompt.sourcePath,
      promptHash: prompt.hash,
      provider,
      model,
    };
  }

  const userPayload = buildUserPayload(input);

  try {
    const completion = provider === 'anthropic'
      ? await callAnthropic(prompt.content, userPayload)
      : await callOpenAI(prompt.content, userPayload);

    const heroPhrase = (completion.heroPhrase || '').trim();
    const executiveSummary = (completion.executiveSummary || '').trim();
    if (!heroPhrase || !executiveSummary) {
      return {
        used: false,
        reason: 'llm_output_missing_fields',
        sourcePath: prompt.sourcePath,
        promptHash: prompt.hash,
        provider,
        model,
      };
    }

    return {
      used: true,
      sourcePath: prompt.sourcePath,
      promptHash: prompt.hash,
      provider,
      model,
      heroPhrase,
      executiveSummary,
    };
  } catch (error) {
    return {
      used: false,
      reason: error instanceof Error ? error.message : 'master_orchestrator_call_failed',
      sourcePath: prompt.sourcePath,
      promptHash: prompt.hash,
      provider,
      model,
    };
  }
}
