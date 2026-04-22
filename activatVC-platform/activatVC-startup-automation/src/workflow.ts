import crypto from 'crypto';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { Prisma, PrismaClient } from '@prisma/client';
import { CreateBucketCommand, HeadBucketCommand, PutObjectCommand, S3Client, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { AGENTS, AgentConfig, DATAROOM_GUIDE, FounderInput, GapSeed, classifyDocument, normalizeStage, VERDICT_THRESHOLDS, AGENT_PARTICIPATION_THRESHOLD, FEEDBACK_SCORE_THRESHOLD, RED_FLAG_THRESHOLD } from './constants';
import type { AgentScoreEntry, RedFlag, GateResult, InterviewQuestion, ICDecisionMemo } from './constants';
import { getMasterPromptMeta, runMasterOrchestrator } from './masterOrchestrator';

export const prisma = new PrismaClient();

const AGENT_EXECUTION_MODE = 'external';
const AGENTS_PLATFORM_URL = (process.env.AGENTS_PLATFORM_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');

export const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  region: 'us-east-1',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'minioadmin',
  },
  forcePathStyle: true,
});

export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function safeParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function parseFounders(body: Record<string, unknown>): FounderInput[] {
  const founders = safeParse<FounderInput[]>(body.founders, []);
  if (founders.length > 0) {
    return founders.map((founder) => ({
      name: founder.name,
      country: founder.country,
      citizenship: founder.citizenship,
      profiles: Array.isArray(founder.profiles) ? founder.profiles : [],
    }));
  }

  if (typeof body.founderNames === 'string' && body.founderNames.trim()) {
    return body.founderNames
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => ({ name, profiles: [] }));
  }

  return [];
}

export function getAppBucketName(applicationId: string) {
  // S3 bucket names must be lowercase and valid
  return `startup-${applicationId.toLowerCase()}`;
}

async function ensureBucketExists(bucket: string) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    
    // Make bucket publicly readable so downloaded URLs work
    const policy = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "PublicReadGetObject",
          Effect: "Allow",
          Principal: "*",
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${bucket}/*`]
        }
      ]
    };
    
    await s3.send(new PutBucketPolicyCommand({
      Bucket: bucket,
      Policy: JSON.stringify(policy)
    }));
  }
}

export async function uploadFilesToStorage(files: Express.Multer.File[] | undefined, applicationId: string, source: string) {
  const uploadedDocs: Array<{ id: string; originalName: string; fieldName: string }> = [];

  if (!files || files.length === 0) {
    return uploadedDocs;
  }

  const bucket = getAppBucketName(applicationId);
  await ensureBucketExists(bucket);

  for (const file of files) {
    try { file.originalname = decodeURIComponent(file.originalname); } catch (e) {}
    const key = `${Date.now()}-${crypto.randomUUID()}-${file.originalname}`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      }),
    );

    const classification = classifyDocument(file.originalname, file.mimetype);
    const baseUrl = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9100';
    const fileUrl = `${baseUrl}/${bucket}/${key}`;
    const doc = await prisma.applicationDocument.create({
      data: {
        applicationId,
        storageKey: key,
        fileUrl,
        originalName: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        source,
        ...classification,
      },
    });

    uploadedDocs.push({ id: doc.id, originalName: doc.originalName, fieldName: file.fieldname });
  }

  return uploadedDocs;
}

export async function logEvent(applicationId: string, eventType: string, message: string, payload?: unknown) {
  await prisma.applicationEvent.create({
    data: {
      applicationId,
      eventType,
      message,
      payload: payload === undefined ? undefined : toJson(payload),
    },
  });
}

export async function getOrCreateMagicLink(applicationId: string) {
  const existing = await prisma.magicLinkSession.findFirst({
    where: { applicationId },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) return existing;

  return prisma.magicLinkSession.create({
    data: {
      applicationId,
      token: crypto.randomBytes(20).toString('hex'),
    },
  });
}

export async function getApplicationDetail(id: string) {
  return prisma.application.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { uploadedAt: 'desc' } },
      gapItems: { orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] },
      magicLinks: { orderBy: { createdAt: 'desc' } },
      agentRuns: { orderBy: [{ round: 'desc' }, { createdAt: 'asc' }] },
      events: { orderBy: { createdAt: 'desc' } },
    },
  });
}

export function buildMagicLinkUrl(token: string, appBaseUrl: string) {
  return `${appBaseUrl}/magic/${token}`;
}

function relayPendingAgeThresholdMs() {
  const value = Number(process.env.RELAY_PENDING_MAX_AGE_MS || 180_000);
  if (!Number.isFinite(value) || value <= 0) return 180_000;
  return Math.max(10_000, value);
}

function buildRelaySummary(application: NonNullable<Awaited<ReturnType<typeof getApplicationDetail>>>) {
  const events = Array.isArray(application.events) ? application.events : [];
  if (events.length === 0) {
    return {
      round: application.currentRound || 0,
      unanswered: 0,
      unconsumed: 0,
      stale: 0,
      blocking: 0,
      hasBlocking: false,
      unansweredRelayIds: [],
      unconsumedRelayIds: [],
      staleRelayIds: [],
    };
  }

  const latestRoundFromRuns = application.agentRuns.length > 0
    ? Math.max(...application.agentRuns.map((run) => run.round || 0))
    : 0;
  const round = Math.max(application.currentRound || 0, latestRoundFromRuns);

  const questionByRelayId = new Map<string, { createdAtMs: number; round: number }>();
  const answerByRelayId = new Map<string, { createdAtMs: number }>();
  const consumedRelayIds = new Set<string>();

  for (const event of events) {
    if (event.eventType !== 'relay.question' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    const relayId = typeof payload.relayId === 'string' ? payload.relayId.trim() : '';
    const eventRoundRaw = typeof payload.round === 'string' ? Number(payload.round) : Number(payload.round);
    const eventRound = Number.isFinite(eventRoundRaw) && eventRoundRaw > 0 ? eventRoundRaw : round;
    if (!relayId || eventRound !== round) continue;
    const createdAtMs = new Date(event.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) continue;
    questionByRelayId.set(relayId, { createdAtMs, round: eventRound });
  }

  for (const event of events) {
    if (event.eventType !== 'relay.answer' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    const relayId = typeof payload.relayId === 'string' ? payload.relayId.trim() : '';
    if (!relayId || !questionByRelayId.has(relayId)) continue;
    const createdAtMs = new Date(event.createdAt).getTime();
    if (!Number.isFinite(createdAtMs)) continue;
    answerByRelayId.set(relayId, { createdAtMs });
  }

  for (const event of events) {
    if (event.eventType !== 'relay.answer.consumed' || !event.payload || typeof event.payload !== 'object') continue;
    const payload = event.payload as Record<string, unknown>;
    const relayId = typeof payload.relayId === 'string' ? payload.relayId.trim() : '';
    if (!relayId || !questionByRelayId.has(relayId)) continue;
    consumedRelayIds.add(relayId);
  }

  const now = Date.now();
  const staleThreshold = relayPendingAgeThresholdMs();
  const unansweredRelayIds: string[] = [];
  const unconsumedRelayIds: string[] = [];
  const staleRelayIds = new Set<string>();

  for (const [relayId, question] of questionByRelayId.entries()) {
    const answer = answerByRelayId.get(relayId);
    if (!answer) {
      unansweredRelayIds.push(relayId);
      if (now - question.createdAtMs >= staleThreshold) staleRelayIds.add(relayId);
      continue;
    }

    if (!consumedRelayIds.has(relayId)) {
      unconsumedRelayIds.push(relayId);
      if (now - answer.createdAtMs >= staleThreshold) staleRelayIds.add(relayId);
    }
  }

  const unanswered = unansweredRelayIds.length;
  const unconsumed = unconsumedRelayIds.length;
  const stale = staleRelayIds.size;
  const blocking = unanswered + unconsumed - stale;

  return {
    round,
    unanswered,
    unconsumed,
    stale,
    blocking,
    hasBlocking: blocking > 0,
    unansweredRelayIds,
    unconsumedRelayIds,
    staleRelayIds: Array.from(staleRelayIds),
  };
}

type FounderReportView = {
  verdict: string;
  heroPhrase: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
};

export function buildFounderReportFromAggregate(aggregateReport: unknown): FounderReportView | null {
  if (!aggregateReport || typeof aggregateReport !== 'object') return null;
  const aggregate = aggregateReport as Record<string, unknown>;

  const decisionMemo = (aggregate.decisionMemo && typeof aggregate.decisionMemo === 'object')
    ? (aggregate.decisionMemo as Record<string, unknown>)
    : {};

  const strengths = Array.isArray(decisionMemo.strengths)
    ? decisionMemo.strengths.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : [];

  const risks = Array.isArray(decisionMemo.risks)
    ? decisionMemo.risks.filter((item): item is string => typeof item === 'string').slice(0, 8)
    : [];

  const redFlags = Array.isArray(aggregate.redFlags)
    ? aggregate.redFlags
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const rf = item as Record<string, unknown>;
        const agent = typeof rf.agent === 'string' ? rf.agent : 'Agent';
        const flag = typeof rf.flag === 'string' ? rf.flag : '';
        return flag ? `${agent}: ${flag}` : '';
      })
      .filter((item): item is string => Boolean(item))
    : [];

  const weaknesses = [...redFlags, ...risks].slice(0, 10);

  const failedGateRecommendations = Array.isArray(aggregate.passFailGates)
    ? aggregate.passFailGates
      .filter((item) => item && typeof item === 'object' && (item as Record<string, unknown>).passed === false)
      .map((item) => {
        const gate = item as Record<string, unknown>;
        return typeof gate.detail === 'string' ? gate.detail : '';
      })
      .filter((item): item is string => Boolean(item))
    : [];

  const interviewRecommendations = Array.isArray(aggregate.interviewGuide)
    ? aggregate.interviewGuide
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const question = (item as Record<string, unknown>).question;
        return typeof question === 'string' ? question : '';
      })
      .filter((item): item is string => Boolean(item))
      .slice(0, 5)
    : [];

  const recommendations = [...failedGateRecommendations, ...interviewRecommendations].slice(0, 10);

  const verdict = typeof aggregate.verdict === 'string' ? aggregate.verdict : 'PENDING';
  const heroPhrase = typeof aggregate.heroPhrase === 'string'
    ? aggregate.heroPhrase
    : 'Итоговая рекомендация формируется после завершения анализа.';

  return {
    verdict,
    heroPhrase,
    strengths: strengths.length > 0 ? strengths : ['Позитивные сигналы будут отображены после полной агрегации.'],
    weaknesses: weaknesses.length > 0 ? weaknesses : ['Критичные слабые стороны не выявлены.'],
    recommendations: recommendations.length > 0
      ? recommendations
      : ['Уточните ключевые метрики, обновите документы и подайте заявку повторно после доработки.'],
  };
}

/**
 * Pass through the score unchanged. All agents use a 0-100 scale.
 * Returns 0 for null/undefined/non-finite values.
 */
export function normalizeScore(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  return score;
}

/**
 * Search a responsePayload object for an overall score using common patterns
 * computed as Σ (criteria[i].score × criteria[i].weight / 100) per the agent prompt schemas.
 */
function extractStructuredScore(payload: Record<string, unknown>): number {
  // All agents (CLO, CFO, CHRO, CMO+CCO, CPO+CTO) define:
  //   "score" — Σ (criteria_breakdown[i].score × criteria_breakdown[i].weight / 100)
  // If the LLM returned score=0 at top level, recompute from criteria_breakdown.
  const breakdown = payload.criteria_breakdown;
  if (!Array.isArray(breakdown) || breakdown.length === 0) return 0;
  let total = 0;
  let totalWeight = 0;
  for (const item of breakdown) {
    if (item && typeof item === 'object') {
      const s = (item as Record<string, unknown>).score;
      const w = (item as Record<string, unknown>).weight;
      if (typeof s === 'number' && Number.isFinite(s) && s >= 0 &&
          typeof w === 'number' && Number.isFinite(w) && w > 0) {
        total += s * w / 100;
        totalWeight += w;
      }
    }
  }
  if (totalWeight === 0) return 0;
  // Normalize in case weights don't sum to exactly 100
  const result = totalWeight !== 100 ? (total / totalWeight) * 100 : total;
  return Math.round(result * 10) / 10;
}

/**
 * Extract the score from an agent run, checking both the DB column
 * and responsePayload.score (webhook path may only store it in payload).
 */
function extractRunScore(run: { score: number | null; responsePayload: unknown }): number {
  if (typeof run.score === 'number' && Number.isFinite(run.score) && run.score > 0) return run.score;
  const rp = run.responsePayload as Record<string, unknown> | null;
  if (!rp) return 0;
  if (typeof rp.score === 'number' && Number.isFinite(rp.score) && rp.score > 0) return rp.score;
  const structured = extractStructuredScore(rp);
  if (structured > 0) return structured;
  return 0;
}

export function serializeApplication(application: Awaited<ReturnType<typeof getApplicationDetail>>, appBaseUrl: string) {
  if (!application) return null;
  const magicLink = application.magicLinks[0];
  const openGaps = application.gapItems.filter((gap) => gap.status === 'open');
  const blockingGaps = openGaps.filter((gap) => gap.gapType === 'critical' || gap.source === 'agent_request');
  const relaySummary = buildRelaySummary(application);

  // Normalize scores (ensure 0-100 range, zero out invalid values)
  const normalizedRuns = application.agentRuns.map((run) => ({
    ...run,
    score: normalizeScore(extractRunScore(run)),
  }));

  const normalizedInvestmentScore = normalizeScore(application.investmentScore);

  // Also normalize scores inside aggregateReport
  const aggregate = application.aggregateReport as Record<string, any> | null;
  let normalizedAggregate = aggregate;
  if (aggregate) {
    normalizedAggregate = {
      ...aggregate,
      investmentScore: normalizeScore(aggregate.investmentScore),
      scoreBreakdown: Array.isArray(aggregate.scoreBreakdown)
        ? aggregate.scoreBreakdown.map((entry: any) => ({
            ...entry,
            finalScore: normalizeScore(entry.finalScore),
          }))
        : aggregate.scoreBreakdown,
    };
  }

  return {
    ...application,
    investmentScore: normalizedInvestmentScore,
    agentRuns: normalizedRuns,
    aggregateReport: normalizedAggregate,
    founderReport: buildFounderReportFromAggregate(normalizedAggregate),
    magicLinkUrl: magicLink ? buildMagicLinkUrl(magicLink.token, appBaseUrl) : null,
    openGapCount: openGaps.length,
    blockingGapCount: blockingGaps.length,
    relaySummary,
    dataRoomGuide: DATAROOM_GUIDE,
  };
}

export async function refreshPrepareGaps(applicationId: string) {
  const application = await getApplicationDetail(applicationId);
  if (!application) throw new Error('Application not found');

  await prisma.gapItem.deleteMany({ where: { applicationId, source: 'prepare', status: 'open' } });

  const founders = Array.isArray(application.founders) ? (application.founders as unknown as FounderInput[]) : [];
  const categories = new Set(application.documents.map((document) => document.category));
  const resolvedResponses = application.gapItems.filter((gap) => gap.status === 'resolved' && (gap.responseText || gap.responseDocumentId));
  const hasResolvedBusinessResponse = resolvedResponses.some((gap) => gap.title === 'Missing business overview');
  const hasResolvedFinancialResponse = resolvedResponses.some((gap) => gap.title === 'Missing financial information');
  const hasResolvedFounderResponse = resolvedResponses.some((gap) => gap.title === 'Missing founder background');
  const documentIndex = application.documents.map((document) => ({
    docId: document.id,
    filename: document.originalName,
    classifiedAs: document.classifiedAs,
    category: document.category,
    readable: document.readable,
    source: document.source,
    summary: document.summary,
  }));

  const newGaps: GapSeed[] = [];
  const hasBusinessContext = Boolean(application.description || application.businessModel || categories.has('business') || categories.has('general') || hasResolvedBusinessResponse);
  const hasFinancialContext = Boolean(application.financialSummary || categories.has('financial') || hasResolvedFinancialResponse);
  const hasFounderContext = founders.length > 0 || categories.has('team') || hasResolvedFounderResponse;

  if (!hasBusinessContext) {
    newGaps.push({
      source: 'prepare',
      gapType: 'critical',
      title: 'Missing business overview',
      description: 'The submission has no clear business model description or business materials.',
      question: 'Please upload a pitch deck or provide a short business model explanation.',
      inputType: 'text_or_file',
      affectsAgents: ['CMO+CCO'],
    });
  }

  if (!hasFinancialContext) {
    newGaps.push({
      source: 'prepare',
      gapType: 'critical',
      title: 'Missing financial information',
      description: 'The submission needs at least a financial summary or financial document.',
      question: 'Please provide revenue, costs, runway, or upload a financial model / P&L.',
      inputType: 'text_or_file',
      affectsAgents: ['CFO'],
    });
  }

  if (!hasFounderContext) {
    newGaps.push({
      source: 'prepare',
      gapType: 'critical',
      title: 'Missing founder background',
      description: 'The submission does not include founder/team background.',
      question: 'Please add founder information or upload CV / profile documents.',
      inputType: 'text_or_file',
      affectsAgents: ['CHRO', 'CLO'],
    });
  }

  if (!categories.has('technical')) {
    newGaps.push({
      source: 'prepare',
      gapType: 'recommended',
      title: 'Recommended technical materials',
      description: 'Technical documentation improves product and technology review.',
      question: 'Optional: upload roadmap, architecture, specs, or product screenshots.',
      inputType: 'file',
      affectsAgents: ['CPO+CTO'],
    });
  }

  if (!categories.has('legal')) {
    newGaps.push({
      source: 'prepare',
      gapType: 'recommended',
      title: 'Recommended legal documents',
      description: 'Legal documents improve diligence completeness.',
      question: 'Optional: upload cap table, incorporation docs, SAFE, or agreements.',
      inputType: 'file',
      affectsAgents: ['CLO'],
    });
  }

  if (!categories.has('team')) {
    newGaps.push({
      source: 'prepare',
      gapType: 'recommended',
      title: 'Recommended team profiles',
      description: 'Team materials help leadership and hiring assessment.',
      question: 'Optional: upload CVs, resumes, or team profile docs.',
      inputType: 'file',
      affectsAgents: ['CHRO'],
    });
  }

  for (const gap of newGaps) {
    await prisma.gapItem.create({
      data: {
        applicationId,
        source: gap.source,
        gapType: gap.gapType,
        status: 'open',
        title: gap.title,
        description: gap.description,
        question: gap.question,
        inputType: gap.inputType,
        requestedByAgent: gap.requestedByAgent,
        affectsAgents: toJson(gap.affectsAgents),
      },
    });
  }

  await getOrCreateMagicLink(applicationId);
  await prisma.application.update({ where: { id: applicationId }, data: { latestDocumentIndex: toJson(documentIndex) } });
}

function getRelevantDocumentsForAgent(application: NonNullable<Awaited<ReturnType<typeof getApplicationDetail>>>, agent: AgentConfig) {
  return application.documents.filter((document) => agent.relevantCategories.includes(document.category));
}

function buildAgentPayload(application: NonNullable<Awaited<ReturnType<typeof getApplicationDetail>>>, agent: AgentConfig, round: number) {
  return {
    mode: 'analyze',
    round,
    applicationId: application.id,
    agent: agent.name,
    submission: {
      startupName: application.startupName,
      founderEmail: application.founderEmail,
      startupStage: application.startupStage,
      startupType: application.startupType,
      activityType: application.activityType,
      description: application.description,
      businessModel: application.businessModel,
      financialSummary: application.financialSummary,
      websiteUrl: application.websiteUrl,
      investmentAmount: application.investmentAmount,
      currency: application.currency,
      driveLink: application.driveLink,
      founders: application.founders,
    },
    documentIndex: (Array.isArray(application.latestDocumentIndex) ? application.latestDocumentIndex : []) as Array<{ category?: string; originalName?: string; filename?: string }>,
    relevantDocuments: getRelevantDocumentsForAgent(application, agent).map((document) => ({
      id: document.id,
      originalName: document.originalName,
      category: document.category,
      classifiedAs: document.classifiedAs,
      fileUrl: document.fileUrl,
      summary: document.summary,
    })),
    gapReviewResponses: application.gapItems
      .filter((gap) => gap.status === 'resolved' && (gap.responseText || gap.responseDocumentId))
      .map((gap) => ({
        id: gap.id,
        title: gap.title,
        question: gap.question,
        responseText: gap.responseText,
        responseDocumentId: gap.responseDocumentId,
      })),
    openGaps: application.gapItems.filter((gap) => gap.status === 'open'),
  };
}

export async function finalizeRound(applicationId: string, round: number) {
  // Close all open gaps from previous rounds — they are superseded by the new round
  const result = await prisma.gapItem.updateMany({
    where: {
      applicationId,
      status: 'open',
      source: { in: ['prepare', 'agent_request', 'founder_batch'] },
    },
    data: { status: 'superseded', resolvedAt: new Date() },
  });

  await logEvent(applicationId, 'round.finalized', `Round ${round} started — ${result.count} stale gap(s) superseded.`, {
    round,
    supersededGaps: result.count,
  });
}

export function computeRoundStatus(
  agentRuns: Array<{ round: number; status: string; agentName: string }>,
  openGaps: Array<{ status: string; gapType: string; source: string }>,
  round: number,
  relayBlockingCount: number,
): 'analyzing' | 'awaiting_founder' | 'complete' | 'ready_for_analysis' {
  const roundRuns = agentRuns.filter((run) => run.round === round);
  // Count agents that have a score (completed or needs_more_info — both produce scores)
  const scoredAgents = new Set(
    roundRuns.filter((run) => run.status === 'completed' || run.status === 'needs_more_info').map((run) => run.agentName),
  );
  // Only prepare-stage critical gaps block the workflow (pre-analysis blockers).
  // Agent-requested documents (post-analysis) are advisory — they don't block aggregation.
  const prepareBlockingGaps = openGaps.filter(
    (gap) => gap.status === 'open' && gap.gapType === 'critical' && gap.source === 'prepare',
  );

  if (relayBlockingCount > 0) {
    return 'analyzing';
  }

  if (scoredAgents.size >= AGENTS.length) {
    return 'complete';
  }

  // Before all agents finish, prepare-stage critical gaps still block
  if (prepareBlockingGaps.length > 0) {
    return 'awaiting_founder';
  }

  if (roundRuns.length === 0) {
    return 'ready_for_analysis';
  }

  return 'analyzing';
}

// ─── Master Agent PDF ──────────────────────────────────────────────────────────

function generateICMemoPDF(memo: ICDecisionMemo, startupName: string, round: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const fonts = getCyrillicFonts();
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    if (fonts.normal) doc.registerFont('Norm', fonts.normal);
    if (fonts.bold) doc.registerFont('Bold', fonts.bold);
    const FN = fonts.normal ? 'Norm' : 'Helvetica';
    const FB = fonts.bold ? 'Bold' : 'Helvetica-Bold';

    const DARK = '#1a1a2e';
    const MID = '#16213e';
    const ACCENT = '#0f3460';
    const GRAY = '#555555';

    // Header
    doc.font(FB).fontSize(22).fillColor(DARK).text(`IC Decision Memo: ${startupName}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.font(FN).fontSize(11).fillColor(GRAY).text(`Analysis Round ${round} · Generated ${new Date().toISOString().slice(0, 10)}`, { align: 'center' });
    doc.moveDown(1.2);

    // Score + Verdict banner
    doc.font(FN).fontSize(16).fillColor(MID).text(`Investment Score: ${memo.investmentScore} / 100   ·   Verdict: ${memo.verdict}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.font(FN).fontSize(11).fillColor(DARK).text(memo.heroPhrase, { align: 'center' });
    doc.moveDown(1.2);

    // Executive Summary
    doc.font(FB).fontSize(14).fillColor(ACCENT).text('Executive Summary', { underline: true });
    doc.moveDown(0.3);
    doc.font(FN).fontSize(10).fillColor(DARK).text(memo.executiveSummary, { lineGap: 4 });
    doc.moveDown(1);

    // Score breakdown
    doc.font(FB).fontSize(14).fillColor(ACCENT).text('Score Breakdown by Agent', { underline: true });
    doc.moveDown(0.3);
    for (const entry of memo.scoreBreakdown) {
      doc.font(FN).fontSize(10).fillColor(DARK).text(
        `${entry.agent}: ${entry.finalScore}/100  (weight ${entry.baseWeight}, stage coeff ×${entry.stageCoeff}, contribution ${entry.weightedContribution})`,
        { lineGap: 3 }
      );
    }
    doc.moveDown(1);

    // Pass/Fail gates
    doc.font(FB).fontSize(14).fillColor(ACCENT).text('Pass / Fail Gates', { underline: true });
    doc.moveDown(0.3);
    for (const gate of memo.passFailGates) {
      doc.font(FN).fontSize(10).fillColor(gate.passed ? '#166534' : '#991b1b')
        .text(`${gate.passed ? '✓' : '✗'}  ${gate.gate}: ${gate.detail}`, { lineGap: 3 });
    }
    doc.moveDown(1);

    // Red flags
    if (memo.redFlags.length > 0) {
      doc.font(FB).fontSize(14).fillColor('#991b1b').text('Red Flags', { underline: true });
      doc.moveDown(0.3);
      for (const rf of memo.redFlags) {
        doc.font(FN).fontSize(10).fillColor(DARK)
          .text(`[${rf.severity.toUpperCase()}] ${rf.agent}: ${rf.flag}`, { lineGap: 3 });
      }
      doc.moveDown(1);
    }

    // Strengths & Risks
    doc.font(FB).fontSize(14).fillColor(ACCENT).text('Strengths', { underline: true });
    doc.moveDown(0.3);
    for (const s of memo.strengths) {
      doc.font(FN).fontSize(10).fillColor(DARK).text(`• ${s}`, { lineGap: 2 });
    }
    doc.moveDown(1);

    doc.font(FB).fontSize(14).fillColor(ACCENT).text('Key Risks', { underline: true });
    doc.moveDown(0.3);
    for (const r of memo.risks) {
      doc.font(FN).fontSize(10).fillColor(DARK).text(`• ${r}`, { lineGap: 2 });
    }
    doc.moveDown(1);

    // Interview guide (top 10)
    if (memo.interviewGuide.length > 0) {
      doc.font(FB).fontSize(14).fillColor(ACCENT).text('Founder Interview Questions', { underline: true });
      doc.moveDown(0.3);
      for (const q of memo.interviewGuide.slice(0, 10)) {
        doc.font(FN).fontSize(10).fillColor(DARK)
          .text(`[${q.priority}] ${q.area}: ${q.question}`, { lineGap: 3 });
      }
    }

    doc.end();
  });
}

// ─── Cyrillic-capable font detection ─────────────────────────────────────────

function findFirstExistingPath(candidates: string[]): string | null {
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* skip */ }
  }
  return null;
}

export function getCyrillicFonts(): { normal: string | null; bold: string | null } {
  return {
    normal: findFirstExistingPath([
      'C:\\Windows\\Fonts\\Arial.ttf',
      'C:\\Windows\\Fonts\\arial.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    ]),
    bold: findFirstExistingPath([
      'C:\\Windows\\Fonts\\Arialbd.ttf',
      'C:\\Windows\\Fonts\\arialbd.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    ]),
  };
}

export async function aggregateApplication(applicationId: string) {
  const application = await getApplicationDetail(applicationId);
  if (!application) throw new Error('Application not found');

  const round = application.currentRound > 0 ? application.currentRound : 1;
  // Include both 'completed' and 'needs_more_info' runs — agents always produce a score even when requesting more docs.
  // Agent-requested documents are advisory (post-analysis); they don't invalidate the current score.
  const completedRuns = application.agentRuns.filter((run) => run.round === round && (run.status === 'completed' || run.status === 'needs_more_info'));
  if (completedRuns.length === 0) return null;

  const latestRunsByAgent = new Map<string, (typeof completedRuns)[number]>();
  for (const run of completedRuns) {
    const existing = latestRunsByAgent.get(run.agentName);
    if (!existing || run.createdAt > existing.createdAt) {
      latestRunsByAgent.set(run.agentName, run);
    }
  }

  const latestRuns = Array.from(latestRunsByAgent.values());

  const stage = normalizeStage(application.startupStage);
  let numerator = 0;
  let denominator = 0;
  const scoreBreakdown: AgentScoreEntry[] = [];
  const interviewGuide: InterviewQuestion[] = [];
  const strengths = new Set<string>();
  const risks = new Set<string>();
  const redFlags: RedFlag[] = [];

  for (const agent of AGENTS) {
    const run = latestRunsByAgent.get(agent.name);
    if (!run || !run.responsePayload) continue;

    const response = run.responsePayload as unknown as {
      questionsForFounderInterview: Array<{ question: string; priority: string; why: string }>;
      strengths: string[];
      risks: string[];
      redFlags?: Array<{ flag: string; severity: 'critical' | 'warning' }>;
    };
    const coeff = agent.coeff[stage];
    const clampedScore = Math.max(0, Math.min(100, normalizeScore(extractRunScore(run))));
    numerator += clampedScore * agent.weight * coeff;
    denominator += agent.weight * coeff;

    const agentMode = clampedScore >= AGENT_PARTICIPATION_THRESHOLD
      ? 'participation_conditions' as const
      : 'founder_recommendations' as const;

    scoreBreakdown.push({
      agent: agent.name,
      finalScore: clampedScore,
      baseWeight: agent.weight,
      stageCoeff: coeff,
      weightedContribution: Number(((clampedScore * agent.weight * coeff)).toFixed(2)),
      mode: agentMode,
    });

    // Red flag detection — agent below threshold (ProcessFlow v14)
    if (clampedScore < RED_FLAG_THRESHOLD) {
      redFlags.push({
        agent: agent.name,
        flag: `${agent.name} scored ${clampedScore}/100 — below red-flag threshold (${RED_FLAG_THRESHOLD})`,
        severity: clampedScore <= 20 ? 'critical' : 'warning',
      });
    }

    // Collect red flags reported by agents themselves (handle both snake_case and camelCase)
    const agentRedFlags = (response as any).red_flags || (response as any).redFlags || [];
    for (const rf of agentRedFlags) {
      const flagText = typeof rf === 'string' ? rf : (rf.flag || rf.description || JSON.stringify(rf));
      const sev: 'critical' | 'warning' = rf.severity === 'critical' ? 'critical' : 'warning';
      redFlags.push({ agent: agent.name, flag: flagText, severity: sev });
    }

    const agentQuestions = (response as any).questions_for_founder_interview || (response as any).questionsForFounderInterview || [];
    for (const question of agentQuestions) {
      interviewGuide.push({ question: question.question, area: agent.name, priority: question.priority, why: question.why });
    }

    for (const item of response.strengths || []) strengths.add(item);
    for (const item of response.risks || []) risks.add(item);
  }

  const investmentScore = denominator > 0 ? Number((numerator / denominator).toFixed(2)) : 0;

  // ProcessFlow v14 §2.4 — verdict from thresholds (top-down, first match)
  let verdict = 'PASS';
  for (const tier of VERDICT_THRESHOLDS) {
    if (investmentScore >= tier.minScore) {
      verdict = tier.verdict;
      break;
    }
  }

  // ProcessFlow v14 §5.5-5.6 — feedback policy
  const feedbackPolicy: 'full' | 'none' = investmentScore >= FEEDBACK_SCORE_THRESHOLD ? 'full' : 'none';

  // ProcessFlow v14 §3.6 — GEN-pipeline eligibility
  const genPipelineEligible = verdict === 'INVEST' || verdict === 'CONDITIONAL';

  // Pass/fail gates
  const passFailGates: GateResult[] = [
    {
      gate: 'minimum_weighted_score',
      passed: investmentScore >= FEEDBACK_SCORE_THRESHOLD,
      detail: `Weighted score ${investmentScore} ${investmentScore >= FEEDBACK_SCORE_THRESHOLD ? '≥' : '<'} ${FEEDBACK_SCORE_THRESHOLD}`,
    },
    {
      gate: 'no_critical_red_flags',
      passed: !redFlags.some((rf) => rf.severity === 'critical'),
      detail: redFlags.filter((rf) => rf.severity === 'critical').length > 0
        ? `${redFlags.filter((rf) => rf.severity === 'critical').length} critical red flag(s) detected`
        : 'No critical red flags',
    },
    {
      gate: 'all_agents_responded',
      passed: latestRuns.length >= AGENTS.length,
      detail: `${latestRuns.length}/${AGENTS.length} agents completed`,
    },
  ];

  const heroPhrase = verdict === 'INVEST'
    ? 'Strong signal to proceed with conviction.'
    : verdict === 'CONDITIONAL'
      ? 'Promising case with clear execution conditions.'
      : verdict === 'WATCH'
        ? 'Worth tracking as the startup closes material gaps.'
        : 'The submission needs stronger fundamentals before investment readiness.';

  const executiveSummary = [
    `${application.startupName} reached an investment score of ${investmentScore}/100 with verdict ${verdict}.`,
    `Top strengths: ${Array.from(strengths).slice(0, 3).join(' ') || 'The current package is coherent for review.'}`,
    `Top risks: ${Array.from(risks).slice(0, 3).join(' ') || 'No major risks were identified.'}`,
  ].join(' ');

  const finalAgentJsons = Object.fromEntries(latestRuns.map((run) => [run.agentName, run.responsePayload]));
  const orchestratorOutput = await runMasterOrchestrator({
    startupName: application.startupName,
    startupStage: application.startupStage,
    activityType: application.activityType,
    investmentScore,
    verdict,
    scoreBreakdown,
    strengths: Array.from(strengths),
    risks: Array.from(risks),
    interviewGuide,
    agentOutputs: finalAgentJsons,
  });

  const finalHeroPhrase = orchestratorOutput.used && orchestratorOutput.heroPhrase
    ? orchestratorOutput.heroPhrase
    : heroPhrase;

  const finalExecutiveSummary = orchestratorOutput.used && orchestratorOutput.executiveSummary
    ? orchestratorOutput.executiveSummary
    : executiveSummary;

  const orchestratorMeta = {
    ...getMasterPromptMeta(),
    used: orchestratorOutput.used,
    reason: orchestratorOutput.reason,
    provider: orchestratorOutput.provider,
    model: orchestratorOutput.model,
    sourcePath: orchestratorOutput.sourcePath,
    promptHash: orchestratorOutput.promptHash,
  };

  // IC Decision Memo — ProcessFlow v14 full output contract
  const decisionMemo: ICDecisionMemo = {
    investmentScore,
    verdict,
    feedbackPolicy,
    genPipelineEligible,
    heroPhrase: finalHeroPhrase,
    executiveSummary: finalExecutiveSummary,
    scoreBreakdown,
    strengths: Array.from(strengths),
    risks: Array.from(risks),
    redFlags,
    passFailGates,
    interviewGuide,
  };

  const founderReport = buildFounderReportFromAggregate({
    verdict,
    heroPhrase: finalHeroPhrase,
    decisionMemo,
    redFlags,
    passFailGates,
    interviewGuide,
  });

  const aggregateReport = {
    mode: 'aggregate',
    submissionId: application.id,
    investmentScore,
    verdict,
    feedbackPolicy,
    genPipelineEligible,
    heroPhrase: finalHeroPhrase,
    scoreBreakdown,
    executiveSummary: finalExecutiveSummary,
    interviewGuide,
    redFlags,
    passFailGates,
    decisionMemo,
    founderReport,
    finalAgentJsons,
    analysisLog: {
      totalRounds: application.currentRound,
      totalAgentRuns: latestRuns.length,
      rounds: [{ round: application.currentRound, investmentScore, completedAgents: latestRuns.map((run) => ({ agent: run.agentName, score: normalizeScore(extractRunScore(run)) })) }],
      orchestrator: orchestratorMeta,
    },
  };

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: 'complete',
      investmentScore,
      verdict,
      heroPhrase: finalHeroPhrase,
      executiveSummary: finalExecutiveSummary,
      interviewQuestions: toJson(interviewGuide),
      aggregateReport: toJson(aggregateReport),
    },
  });

  await logEvent(applicationId, 'aggregate.completed', 'Aggregate report generated.', {
    investmentScore,
    verdict,
    feedbackPolicy,
    genPipelineEligible,
    redFlagCount: redFlags.length,
    gatesPassed: passFailGates.filter((g) => g.passed).length,
    gatesTotal: passFailGates.length,
    orchestrator: orchestratorMeta,
  });

  // Generate and upload IC Decision Memo as PDF for the founder portal
  try {
    const pdfBuffer = await generateICMemoPDF(decisionMemo, application.startupName, round);
    const bucket = getAppBucketName(applicationId);
    await ensureBucketExists(bucket);
    const pdfKey = `${Date.now()}-master_ic_memo.pdf`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: pdfKey,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
    }));
    const baseUrl = process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9100';
    const pdfUrl = `${baseUrl}/${bucket}/${pdfKey}`;
    await prisma.applicationDocument.create({
      data: {
        applicationId,
        storageKey: pdfKey,
        fileUrl: pdfUrl,
        originalName: `IC_Decision_Memo_Round${round}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer.length,
        source: 'agent_master',
        documentType: 'pdf',
        category: 'investment_decision',
        classifiedAs: 'ic_memo',
      },
    });
  } catch (pdfErr) {
    console.error('[aggregateApplication] Master PDF generation failed (non-fatal):', pdfErr);
  }

  return aggregateReport;
}

export async function dispatchAgents(applicationId: string, appBaseUrl: string) {
  const freshApplication = await getApplicationDetail(applicationId);
  if (!freshApplication) throw new Error('Application not found');

  const round = freshApplication.currentRound + 1;
  await prisma.application.update({ where: { id: applicationId }, data: { status: 'analyzing', currentRound: round } });
  await finalizeRound(applicationId, round);
  await prisma.gapItem.deleteMany({ where: { applicationId, source: 'agent_request', status: 'open' } });
  await logEvent(applicationId, 'analysis.started', `Started ${AGENT_EXECUTION_MODE} agent round ${round}.`, { round, mode: AGENT_EXECUTION_MODE });

  if (AGENT_EXECUTION_MODE === 'external') {
    const response = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ applicationId, event: 'new_application' }),
    });

    const responseBody = await response.text();

    if (!response.ok) {
      throw new Error(`Failed to dispatch to agents platform: HTTP ${response.status} ${responseBody.slice(0, 300)}`);
    }

    const responsePayload = safeParse<Record<string, unknown>>(responseBody, {});
    const externalRunIdRaw = responsePayload.run_id ?? responsePayload.runId;
    const externalRunIdNum = Number(externalRunIdRaw);
    const externalRunId = Number.isFinite(externalRunIdNum) && externalRunIdNum > 0
      ? Math.trunc(externalRunIdNum)
      : null;

    await logEvent(applicationId, 'analysis.dispatched_external', 'Round dispatched to external agents platform.', {
      round,
      endpoint: `${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`,
      externalRunId,
    });
    return null;
  }

  // In external mode, agents_platform handles all agent execution.
  // This code path should not be reached.
  throw new Error('AGENT_EXECUTION_MODE must be external — no other modes are supported.');
}

export async function reevaluateAndAdvance(applicationId: string, appBaseUrl: string, publicBaseUrl?: string) {
  await refreshPrepareGaps(applicationId);
  const application = await getApplicationDetail(applicationId);
  if (!application) throw new Error('Application not found');

  // Only PREPARE-stage critical gaps block analysis from starting.
  // Agent-requested documents (agent_request / founder_batch) are post-analysis advisory items
  // and must NOT block the workflow — agents already produced scores with available data.
  const openCriticalPrepareGaps = application.gapItems.filter(
    (gap) => gap.status === 'open' && gap.gapType === 'critical' && gap.source === 'prepare'
  );

  if (openCriticalPrepareGaps.length > 0) {
    await prisma.application.update({ where: { id: applicationId }, data: { status: 'awaiting_founder' } });
    await logEvent(applicationId, 'prepare.awaiting_founder', 'Submission is waiting for founder follow-up.', { openCriticalGaps: openCriticalPrepareGaps.length });
    
    // Log to terminal for easy access
    const magicLink = await getOrCreateMagicLink(applicationId);
    const linkUrl = buildMagicLinkUrl(magicLink.token, publicBaseUrl || appBaseUrl);
    console.log(`\n\n[MASTER AGENT] Action Required for ${application?.startupName}: Missing Materials!`);
    console.log(`[MAGIC LINK] -> ${linkUrl}\n\n`);

    return getApplicationDetail(applicationId);
  }

  // If we already have completed agent runs from a prior round, aggregate
  // (handles the case where recommended-only gaps kept agents in needs_more_info)
  const completedRuns = application.agentRuns.filter((run) => run.status === 'completed');
  if (completedRuns.length > 0) {
    await aggregateApplication(applicationId);
    return getApplicationDetail(applicationId);
  }

  await prisma.application.update({ where: { id: applicationId }, data: { status: 'ready_for_analysis' } });
  await logEvent(applicationId, 'prepare.ready', 'Submission is ready for agent dispatch.');
  await dispatchAgents(applicationId, appBaseUrl);
  return getApplicationDetail(applicationId);
}

type FounderBatchQuestion = {
  agent: string;
  title: string;
  question: string;
  severity: 'critical' | 'recommended';
};

function extractFounderBatchQuestions(requestedDocuments: unknown, agentName: string): FounderBatchQuestion[] {
  if (!Array.isArray(requestedDocuments)) return [];

  const questions: FounderBatchQuestion[] = [];
  for (const item of requestedDocuments) {
    if (typeof item === 'string' && item.trim()) {
      questions.push({
        agent: agentName,
        title: item.trim(),
        question: `Please provide additional information for: ${item.trim()}`,
        severity: 'recommended',
      });
      continue;
    }

    if (item && typeof item === 'object') {
      const value = item as Record<string, unknown>;
      const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Additional information requested';
      const question = typeof value.question === 'string' && value.question.trim()
        ? value.question.trim()
        : `Please provide additional information for: ${title}`;
      const severity = value.severity === 'critical' ? 'critical' : 'recommended';
      questions.push({ agent: agentName, title, question, severity });
    }
  }

  return questions;
}

export async function syncFounderBatchGap(applicationId: string, round: number) {
  const runs = await prisma.agentRun.findMany({
    where: {
      applicationId,
      round,
      status: 'needs_more_info',
    },
    orderBy: { createdAt: 'asc' },
  });

  const batchQuestions = runs.flatMap((run) =>
    extractFounderBatchQuestions(run.requestedDocuments as unknown, run.agentName)
  );

  await prisma.gapItem.deleteMany({
    where: {
      applicationId,
      source: 'founder_batch',
      status: 'open',
    },
  });

  if (batchQuestions.length === 0) {
    return null;
  }

  const uniqueAgents = Array.from(new Set(batchQuestions.map((item) => item.agent)));
  const batchQuestionText = batchQuestions
    .map((item, index) => `${index + 1}. [${item.agent}] ${item.question}`)
    .join('\n');

  // Batch gap is critical only if at least one agent request is critical.
  // If all requests are recommended, it's advisory and should not block analysis.
  const hasCriticalRequest = batchQuestions.some((q) => q.severity === 'critical');
  const batchGapType = hasCriticalRequest ? 'critical' : 'recommended';

  const created = await prisma.gapItem.create({
    data: {
      applicationId,
      source: 'founder_batch',
      gapType: batchGapType,
      status: 'open',
      title: `Founder Batch Questions (Round ${round})`,
      description: `Collected questions from ${uniqueAgents.length} agent(s) for consolidated founder follow-up.`,
      question: batchQuestionText,
      inputType: 'textarea',
      affectsAgents: toJson(uniqueAgents),
    },
  });

  await logEvent(applicationId, 'founder.batch.created', 'Grouped founder question batch created.', {
    round,
    totalQuestions: batchQuestions.length,
    agents: uniqueAgents,
    gapId: created.id,
  });

  return created;
}




