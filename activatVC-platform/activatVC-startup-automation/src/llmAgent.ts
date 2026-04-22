import { AgentConfig, MockAgentResponse } from './constants';
import { LLMProvider, getAgentPrompt } from './settings';

type AgentPayload = {
  round: number;
  submission: {
    startupName: string;
    startupStage?: string | null;
    activityType?: string | null;
    description?: string | null;
    businessModel?: string | null;
    financialSummary?: string | null;
    websiteUrl?: string | null;
    investmentAmount?: unknown;
    currency?: string | null;
    founders?: unknown;
  };
  documentIndex: Array<{ category?: string; originalName?: string; filename?: string }>;
  relevantDocuments: Array<{ category: string; originalName?: string; filename?: string }>;
  gapReviewResponses?: Array<{ title: string; responseText?: string | null }>;
};

function buildUserMessage(agent: AgentConfig, payload: AgentPayload): string {
  const { submission, documentIndex, relevantDocuments, gapReviewResponses } = payload;

  const founders = Array.isArray(submission.founders)
    ? (submission.founders as Array<{ name?: string; country?: string }>)
        .map((f) => `${f.name || 'Unknown'}${f.country ? ` (${f.country})` : ''}`)
        .join(', ')
    : 'Not provided';

  const allDocsText = documentIndex.length > 0
    ? documentIndex
        .map((d) => `  • ${d.filename || d.originalName || 'document'} [${d.category || 'general'}]`)
        .join('\n')
    : '  (No documents uploaded)';

  const relevantDocsText = relevantDocuments.length > 0
    ? relevantDocuments
        .map((d) => `  • ${d.originalName || d.filename || 'document'} [${d.category}]`)
        .join('\n')
    : `  (No documents in your relevant categories: ${agent.relevantCategories.join(', ')})`;

  const gapText = (gapReviewResponses || [])
    .filter((g) => g.responseText)
    .map((g) => `  • ${g.title}: ${g.responseText}`)
    .join('\n');

  return [
    '═══════════════════════════════════════════════',
    'STARTUP DUE DILIGENCE SUBMISSION',
    '═══════════════════════════════════════════════',
    '',
    `Startup Name:     ${submission.startupName || 'Unknown'}`,
    `Stage:            ${submission.startupStage || 'Not specified'}`,
    `Activity Type:    ${submission.activityType || 'Not specified'}`,
    `Analysis Round:   ${payload.round}`,
    `Website:          ${submission.websiteUrl || 'Not provided'}`,
    `Investment Ask:   ${submission.investmentAmount ? `${submission.investmentAmount} ${submission.currency || 'USD'}` : 'Not specified'}`,
    '',
    '--- DESCRIPTION ---',
    submission.description || 'No description provided.',
    '',
    '--- BUSINESS MODEL ---',
    submission.businessModel || 'Not specified.',
    '',
    '--- FINANCIAL SUMMARY ---',
    submission.financialSummary || 'Not provided.',
    '',
    '--- FOUNDERS ---',
    founders,
    '',
    '--- ALL SUBMITTED DOCUMENTS ---',
    allDocsText,
    '',
    `--- YOUR RELEVANT DOCUMENTS (${agent.name}) ---`,
    relevantDocsText,
    ...(gapText ? ['', '--- FOUNDER FOLLOW-UP RESPONSES ---', gapText] : []),
    '',
    '═══════════════════════════════════════════════',
    `Analyze this startup as ${agent.name}. Use Режим 4: provide a full Markdown investor report (Section 7 of your prompt), then append a \`\`\`json\`\`\` block with the complete structured data (Section 6 schema).`,
  ].join('\n');
}

// ─── LLM API Callers ──────────────────────────────────────────────────────────

const LLM_TIMEOUT_MS = 180_000; // 3 minutes — long enough for claude-opus

async function callAnthropic(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json() as { content: Array<{ type: string; text: string }> };
    const block = data.content?.find((b) => b.type === 'text');
    if (!block?.text) throw new Error('Anthropic response contained no text content');
    return block.text;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callOpenAI(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16000,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI response contained no content');
    return content;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callGoogle(
  systemPrompt: string,
  userMessage: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 16000 },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Gemini API error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json() as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
    };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Google Gemini response contained no text');
    return text;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Test connection (minimal call) ──────────────────────────────────────────

export async function testLLMConnection(
  provider: LLMProvider,
  model: string,
  apiKey: string,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const ping = 'Respond with exactly: {"ok":true}';
  try {
    let raw: string;
    switch (provider) {
      case 'anthropic':
        raw = await callAnthropic('You are a test responder.', ping, model, apiKey);
        break;
      case 'openai':
        raw = await callOpenAI('You are a test responder.', ping, model, apiKey);
        break;
      case 'google':
      case 'vertex_ai':
        raw = await callGoogle('You are a test responder.', ping, model, apiKey);
        break;
      default:
        return { ok: false, latencyMs: 0, error: `Unknown provider: ${provider}` };
    }
    const latencyMs = Date.now() - start;
    // Accept any response that arrived without error as success
    return { ok: Boolean(raw), latencyMs };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: String(err) };
  }
}

// ─── JSON extraction + validation ────────────────────────────────────────────

function extractJson(raw: string): string {
  // Strip markdown code fences if present
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // Find outermost JSON object
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return raw.slice(start, end + 1);
  }
  return raw.trim();
}

function parseAndValidate(raw: string, agent: AgentConfig, round: number): MockAgentResponse {
  const jsonText = extractJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`LLM returned non-JSON. Parse error: ${err}. Raw snippet: ${jsonText.slice(0, 300)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const score = typeof obj.score === 'number' ? Math.max(0, Math.min(100, obj.score)) : 50.0;

  function toStringArray(val: unknown): string[] {
    return Array.isArray(val) ? val.filter((x): x is string => typeof x === 'string') : [];
  }

  function getStr(val: unknown, fallback: string): string {
    return typeof val === 'string' ? val : fallback;
  }

  const criteriaBreakdown = Array.isArray(obj.criteriaBreakdown)
    ? obj.criteriaBreakdown.map((c) => {
        const entry = c as Record<string, unknown>;
        return {
          name: getStr(entry.name, ''),
          score: typeof entry.score === 'number' ? entry.score : score,
          note: getStr(entry.note, ''),
        };
      })
    : [];

  const pcRaw = obj.participationConditions as Record<string, unknown> | undefined;
  const frRaw = obj.founderRecommendations as Record<string, unknown> | undefined;
  const dqRaw = obj.dataQuality as Record<string, unknown> | undefined;

  const questionsForFounderInterview = Array.isArray(obj.questionsForFounderInterview)
    ? obj.questionsForFounderInterview.map((q) => {
        const entry = q as Record<string, unknown>;
        const priority = getStr(entry.priority, 'medium');
        return {
          question: getStr(entry.question, ''),
          priority: (['high', 'medium', 'low'].includes(priority) ? priority : 'medium') as 'high' | 'medium' | 'low',
          why: getStr(entry.why, ''),
        };
      })
    : [];

  const requestedDocuments = Array.isArray(obj.requestedDocuments)
    ? obj.requestedDocuments.map((d) => {
        const entry = d as Record<string, unknown>;
        const inputType = getStr(entry.inputType, 'file');
        return {
          title: getStr(entry.title, ''),
          description: getStr(entry.description, ''),
          question: getStr(entry.question, ''),
          inputType: (['file', 'text', 'text_or_file'].includes(inputType)
            ? inputType
            : 'file') as 'file' | 'text' | 'text_or_file',
          severity: entry.severity === 'critical' ? 'critical' as const : 'recommended' as const,
        };
      })
    : [];

  return {
    specialist: getStr(obj.specialist, agent.name),
    round: typeof obj.round === 'number' ? obj.round : round,
    score,
    summary: getStr(obj.summary, 'Analysis completed.'),
    strengths: toStringArray(obj.strengths),
    risks: toStringArray(obj.risks),
    criteriaBreakdown,
    participationConditions: {
      label: getStr(pcRaw?.label, 'WATCH'),
      details: toStringArray(pcRaw?.details),
    },
    founderRecommendations: {
      label: getStr(frRaw?.label, 'Review recommended'),
      details: toStringArray(frRaw?.details),
    },
    questionsForFounderInterview,
    dataQuality: {
      status: (dqRaw?.status === 'complete' ? 'complete' : 'partial') as 'complete' | 'partial',
      notes: toStringArray(dqRaw?.notes),
    },
    crossQueries: Array.isArray(obj.crossQueries) ? (obj.crossQueries as Record<string, unknown>[]) : [],
    requestedDocuments,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function callLLMAgent(
  agent: AgentConfig,
  payload: AgentPayload,
  config: { provider: LLMProvider; model: string; apiKey: string },
): Promise<MockAgentResponse> {
  const systemPrompt = getAgentPrompt(agent.name);
  const userMessage = buildUserMessage(agent, payload);

  let rawResponse: string;

  switch (config.provider) {
    case 'anthropic':
      rawResponse = await callAnthropic(systemPrompt, userMessage, config.model, config.apiKey);
      break;
    case 'openai':
      rawResponse = await callOpenAI(systemPrompt, userMessage, config.model, config.apiKey);
      break;
    case 'google':
    case 'vertex_ai':
      rawResponse = await callGoogle(systemPrompt, userMessage, config.model, config.apiKey);
      break;
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }

  return parseAndValidate(rawResponse, agent, payload.round);
}
