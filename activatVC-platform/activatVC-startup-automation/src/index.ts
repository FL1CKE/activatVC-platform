import path from 'path';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import fs from 'fs';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import dotenv from 'dotenv';
import {
  defaultPromptFor,
  listDefaultPrompts,
  loadSettings,
  saveSettings,
} from './settings';
import { testLLMConnection } from './llmAgent';
import {
  AGENTS,
  ALLOWED_INDUSTRIES,
  DATAROOM_GUIDE,
  containsForbiddenIndustryKeywords,
  hasCentralAsiaFounder,
  isAllowedIndustry,
  normalizeStartupStage,
} from './constants';
import {
  buildMagicLinkUrl,
  aggregateApplication,
  buildFounderReportFromAggregate,
  computeRoundStatus,
  finalizeRound,
  getApplicationDetail,
  getOrCreateMagicLink,
  normalizeScore,
  logEvent,
  parseFounders,
  prisma,
  reevaluateAndAdvance,
  safeParse,
  serializeApplication,
  syncFounderBatchGap,
  toJson,
  uploadFilesToStorage,
} from './workflow';

dotenv.config();

// ── Global process error handlers ─────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  process.exit(1);
});

let _server: http.Server | null = null;

async function gracefulShutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal} — shutting down gracefully...`);
  if (_server) {
    _server.close(async () => {
      console.log('[SHUTDOWN] HTTP server closed.');
      await prisma.$disconnect().catch(() => {});
      process.exit(0);
    });
    // Force exit if graceful shutdown takes too long
    setTimeout(() => process.exit(1), 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ── Application setup ──────────────────────────────────────────────────────────
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());

// Rate limiting per IP on all routes
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
}));
const upload = multer({ storage: multer.memoryStorage() });
const publicDir = path.join(process.cwd(), 'client', 'dist');
const port = Number(process.env.PORT) || 3000;
const publicBaseUrl = process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || `http://127.0.0.1:${port}`;
const internalBaseUrl = process.env.APP_INTERNAL_URL || `http://127.0.0.1:${port}`;
const agentExecutionMode = 'external';
const AGENTS_PLATFORM_URL = (process.env.AGENTS_PLATFORM_URL || 'http://127.0.0.1:8888').replace(/\/$/, '');
const RELAY_PENDING_MAX_AGE_MS = Math.max(10_000, Number(process.env.RELAY_PENDING_MAX_AGE_MS || 180_000));
const RELAY_RETRY_MAX = Math.max(0, Number(process.env.RELAY_RETRY_MAX || 2));


function normalizeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function getPendingRelayForAgent(detail: any, agentName: string) {
  const questions = (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.question' && event.payload)
    .map((event: any) => event.payload as any)
    .filter((payload: any) => payload.toAgent === agentName);

  if (questions.length === 0) return null;

  const answeredIds = new Set(
    (detail?.events || [])
      .filter((event: any) => event.eventType === 'relay.answer' && event.payload)
      .map((event: any) => (event.payload as any).relayId)
      .filter(Boolean)
  );

  return questions.find((question: any) => !answeredIds.has(question.relayId)) || null;
}

function getPendingRelayAnswerForAgent(detail: any, agentName: string) {
  const questions = (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.question' && event.payload)
    .map((event: any) => event.payload as any)
    .filter((payload: any) => payload.fromAgent === agentName);

  if (questions.length === 0) return null;

  const consumedIds = new Set(
    (detail?.events || [])
      .filter((event: any) => event.eventType === 'relay.answer.consumed' && event.payload)
      .map((event: any) => (event.payload as any).relayId)
      .filter(Boolean)
  );

  const answers = (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.answer' && event.payload)
    .map((event: any) => event.payload as any)
    .filter((payload: any) => payload.relayId && !consumedIds.has(payload.relayId));

  for (const answer of answers) {
    const question = questions.find((question: any) => question.relayId === answer.relayId);
    if (!question) continue;
    return {
      relayId: answer.relayId,
      fromAgent: question.toAgent,
      toAgent: question.fromAgent,
      question: question.question,
      answer: answer.answer,
      round: question.round,
    };
  }

  return null;
}

function findRelayQuestion(detail: any, relayId: string) {
  return (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.question' && event.payload)
    .map((event: any) => event.payload as any)
    .find((payload: any) => payload.relayId === relayId);
}

function findRelayAnswer(detail: any, relayId: string, fromAgent?: string) {
  return (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.answer' && event.payload)
    .map((event: any) => event.payload as any)
    .find((payload: any) => payload.relayId === relayId && (!fromAgent || payload.fromAgent === fromAgent));
}

function findRelayConsumed(detail: any, relayId: string, consumedByAgent?: string) {
  return (detail?.events || [])
    .filter((event: any) => event.eventType === 'relay.answer.consumed' && event.payload)
    .map((event: any) => event.payload as any)
    .find((payload: any) => payload.relayId === relayId && (!consumedByAgent || payload.consumedByAgent === consumedByAgent));
}

type RelayPriority = 'high' | 'medium' | 'low';

type RelayQuestionEnvelope = {
  relayId: string;
  idempotencyKey: string;
  fromAgent: string;
  toAgent: string;
  question: string;
  round: number;
  priority: RelayPriority;
};

type RelayAnswerEnvelope = {
  relayId: string;
  fromAgent: string;
  answer: string;
};

type RelayConsumedEnvelope = {
  relayId: string;
  consumedByAgent: string;
};

function normalizeRelayPriority(value: unknown): RelayPriority {
  if (typeof value !== 'string') return 'medium';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'high' || normalized === 'low' || normalized === 'medium') {
    return normalized;
  }
  return 'medium';
}

function parseRelayQuestionEnvelope(body: Record<string, unknown>, defaultRound: number): RelayQuestionEnvelope | null {
  const fromAgent = typeof body.fromAgent === 'string' ? body.fromAgent.trim() : '';
  const toAgent = typeof body.toAgent === 'string' ? body.toAgent.trim() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const relayIdRaw = typeof body.relayId === 'string' && body.relayId.trim()
    ? body.relayId.trim()
    : crypto.randomUUID();
  const idempotencyKey = typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : relayIdRaw;
  const roundRaw = typeof body.round === 'string' ? Number(body.round) : Number(body.round);
  const round = Number.isFinite(roundRaw) && roundRaw > 0 ? roundRaw : defaultRound;
  const priority = normalizeRelayPriority(body.priority);

  if (!fromAgent || !toAgent || !question) {
    return null;
  }

  return {
    relayId: relayIdRaw,
    idempotencyKey,
    fromAgent,
    toAgent,
    question,
    round,
    priority,
  };
}

function parseRelayAnswerEnvelope(body: Record<string, unknown>): RelayAnswerEnvelope | null {
  const relayId = typeof body.relayId === 'string' ? body.relayId.trim() : '';
  const fromAgent = typeof body.fromAgent === 'string' ? body.fromAgent.trim() : '';
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';

  if (!relayId || !fromAgent || !answer) {
    return null;
  }

  return { relayId, fromAgent, answer };
}

function parseRelayConsumedEnvelope(body: Record<string, unknown>): RelayConsumedEnvelope | null {
  const relayId = typeof body.relayId === 'string' ? body.relayId.trim() : '';
  const consumedByAgent = typeof body.consumedByAgent === 'string' ? body.consumedByAgent.trim() : '';

  if (!relayId || !consumedByAgent) {
    return null;
  }

  return { relayId, consumedByAgent };
}

function getRelayPendingSnapshot(detail: any, agentName: string) {
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const questionEvents = events.filter((event: any) => event.eventType === 'relay.question' && event.payload);
  const answerEvents = events.filter((event: any) => event.eventType === 'relay.answer' && event.payload);
  const consumedEvents = events.filter((event: any) => event.eventType === 'relay.answer.consumed' && event.payload);

  const answeredIds = new Set(answerEvents.map((event: any) => event.payload?.relayId).filter(Boolean));
  const consumedIds = new Set(consumedEvents.map((event: any) => event.payload?.relayId).filter(Boolean));

  const inboundPending = questionEvents
    .filter((event: any) => event.payload?.toAgent === agentName && !answeredIds.has(event.payload?.relayId))
    .map((event: any) => ({
      relayId: event.payload?.relayId,
      fromAgent: event.payload?.fromAgent,
      toAgent: event.payload?.toAgent,
      round: event.payload?.round,
      priority: event.payload?.priority || 'medium',
      status: 'pending',
      ageMs: Math.max(0, Date.now() - new Date(event.createdAt).getTime()),
    }));

  const outboundPending = questionEvents
    .filter((event: any) => event.payload?.fromAgent === agentName && !answeredIds.has(event.payload?.relayId))
    .map((event: any) => ({
      relayId: event.payload?.relayId,
      fromAgent: event.payload?.fromAgent,
      toAgent: event.payload?.toAgent,
      round: event.payload?.round,
      priority: event.payload?.priority || 'medium',
      status: 'pending',
      ageMs: Math.max(0, Date.now() - new Date(event.createdAt).getTime()),
    }));

  const consumed = answerEvents
    .filter((event: any) => consumedIds.has(event.payload?.relayId) && event.payload?.toAgent === agentName)
    .map((event: any) => ({
      relayId: event.payload?.relayId,
      fromAgent: event.payload?.fromAgent,
      toAgent: event.payload?.toAgent,
      status: 'consumed',
    }));

  return {
    inboundPending,
    outboundPending,
    consumed,
  };
}

type RelayRoundQuestion = {
  relayId: string;
  fromAgent: string;
  toAgent: string;
  round: number;
  priority: RelayPriority;
  createdAtMs: number;
};

type RelayRoundAnswer = {
  relayId: string;
  fromAgent: string;
  toAgent: string;
  answer: string;
  createdAtMs: number;
};

type RelayRoundState = {
  pendingQuestionsFresh: RelayRoundQuestion[];
  pendingQuestionsStale: RelayRoundQuestion[];
  pendingConsumptionsFresh: RelayRoundAnswer[];
  pendingConsumptionsStale: RelayRoundAnswer[];
  unansweredCount: number;
  unconsumedCount: number;
  staleCount: number;
  blockingCount: number;
};

function normalizePositiveNumber(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? Number(value) : Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== 'string') return '';
  return value.trim();
}

function readRound(payload: Record<string, unknown>, fallback: number): number {
  return normalizePositiveNumber(payload.round, fallback);
}

function buildRelayRoundState(detail: any, round: number): RelayRoundState {
  const events = Array.isArray(detail?.events) ? detail.events : [];
  const nowMs = Date.now();

  const questions = new Map<string, RelayRoundQuestion>();
  const answers = new Map<string, RelayRoundAnswer>();
  const consumed = new Set<string>();

  for (const event of events) {
    if (event?.eventType !== 'relay.question') continue;
    const payload = toRecord(event?.payload);
    if (!payload) continue;
    const createdAtMs = new Date(event?.createdAt || 0).getTime();
    if (!Number.isFinite(createdAtMs)) continue;

    const relayId = readString(payload, 'relayId');
    const fromAgent = readString(payload, 'fromAgent');
    const toAgent = readString(payload, 'toAgent');
    const eventRound = readRound(payload, round);
    if (!relayId || !fromAgent || !toAgent || eventRound !== round) continue;

    questions.set(relayId, {
      relayId,
      fromAgent,
      toAgent,
      round: eventRound,
      priority: normalizeRelayPriority(payload.priority),
      createdAtMs,
    });
  }

  for (const event of events) {
    if (event?.eventType !== 'relay.answer') continue;
    const payload = toRecord(event?.payload);
    if (!payload) continue;
    const createdAtMs = new Date(event?.createdAt || 0).getTime();
    if (!Number.isFinite(createdAtMs)) continue;

    const relayId = readString(payload, 'relayId');
    const fromAgent = readString(payload, 'fromAgent');
    const toAgent = readString(payload, 'toAgent');
    const answer = readString(payload, 'answer');
    if (!relayId || !fromAgent || !toAgent) continue;
    const question = questions.get(relayId);
    if (!question || question.round !== round) continue;

    answers.set(relayId, {
      relayId,
      fromAgent,
      toAgent,
      answer,
      createdAtMs,
    });
  }

  for (const event of events) {
    const payload = toRecord(event?.payload);
    if (!payload) continue;
    if (event?.eventType === 'relay.answer.consumed') {
      const relayId = readString(payload, 'relayId');
      if (!relayId) continue;
      const question = questions.get(relayId);
      if (!question || question.round !== round) continue;
      consumed.add(relayId);
    }
  }

  const pendingQuestionsFresh: RelayRoundQuestion[] = [];
  const pendingQuestionsStale: RelayRoundQuestion[] = [];
  const pendingConsumptionsFresh: RelayRoundAnswer[] = [];
  const pendingConsumptionsStale: RelayRoundAnswer[] = [];

  for (const question of questions.values()) {
    const answer = answers.get(question.relayId);
    if (!answer) {
      if (nowMs - question.createdAtMs >= RELAY_PENDING_MAX_AGE_MS) {
        pendingQuestionsStale.push(question);
      } else {
        pendingQuestionsFresh.push(question);
      }
      continue;
    }

    if (!consumed.has(question.relayId)) {
      if (nowMs - answer.createdAtMs >= RELAY_PENDING_MAX_AGE_MS) {
        pendingConsumptionsStale.push(answer);
      } else {
        pendingConsumptionsFresh.push(answer);
      }
    }
  }

  const unansweredCount = pendingQuestionsFresh.length + pendingQuestionsStale.length;
  const unconsumedCount = pendingConsumptionsFresh.length + pendingConsumptionsStale.length;
  const staleCount = pendingQuestionsStale.length + pendingConsumptionsStale.length;
  const blockingCount = pendingQuestionsFresh.length + pendingConsumptionsFresh.length;

  return {
    pendingQuestionsFresh,
    pendingQuestionsStale,
    pendingConsumptionsFresh,
    pendingConsumptionsStale,
    unansweredCount,
    unconsumedCount,
    staleCount,
    blockingCount,
  };
}

function getDispatchedExternalRunId(detail: any, round: number): number | null {
  const events = Array.isArray(detail?.events) ? detail.events : [];

  for (const event of events) {
    if (event?.eventType !== 'analysis.dispatched_external') continue;

    const payload = toRecord(event?.payload);
    if (!payload) continue;

    const payloadRoundRaw = typeof payload.round === 'string' ? Number(payload.round) : Number(payload.round);
    if (!Number.isFinite(payloadRoundRaw) || payloadRoundRaw <= 0 || payloadRoundRaw !== round) continue;

    const runIdRaw = payload.externalRunId ?? payload.runId ?? payload.run_id;
    const runId = normalizePositiveNumber(runIdRaw, 0);
    if (runId > 0) {
      return Math.trunc(runId);
    }
  }

  return null;
}

async function fetchExternalRunDetail(runId: number): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/runs/${runId}`);
    if (!response.ok) return null;

    const payload = await response.json();
    return toRecord(payload);
  } catch {
    return null;
  }
}

async function fetchLatestExternalRunDetail(applicationId: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/runs?limit=200&offset=0`);
    if (!response.ok) return null;

    const payload = toRecord(await response.json());
    if (!payload) return null;

    const items = Array.isArray(payload.items) ? payload.items : [];
    const matches = items
      .map((item) => toRecord(item))
      .filter((item): item is Record<string, unknown> => {
        if (!item) return false;
        return readString(item, 'application_id') === applicationId;
      })
      .sort((left, right) => normalizePositiveNumber(right.id, 0) - normalizePositiveNumber(left.id, 0));

    if (matches.length === 0) return null;

    const runId = normalizePositiveNumber(matches[0].id, 0);
    if (runId <= 0) return null;

    return fetchExternalRunDetail(Math.trunc(runId));
  } catch {
    return null;
  }
}

async function reconcileExternalFailedRun(applicationId: string): Promise<void> {
  if (agentExecutionMode !== 'external') return;

  const detail = await getApplicationDetail(applicationId);
  if (!detail) return;
  if (detail.status !== 'analyzing') return;

  const round = detail.currentRound > 0 ? detail.currentRound : 1;
  const roundRuns = detail.agentRuns.filter((run: any) => run.round === round);
  const completedAgents = new Set(
    roundRuns.filter((run: any) => run.status === 'completed').map((run: any) => run.agentName),
  );

  if (completedAgents.size >= AGENTS.length) return;
  if (roundRuns.some((run: any) => run.status === 'needs_more_info')) return;

  const openBlockingGaps = detail.gapItems.filter(
    (gap: any) => gap.status === 'open' && (gap.gapType === 'critical' || gap.source === 'agent_request' || gap.source === 'founder_batch'),
  );
  if (openBlockingGaps.length > 0) return;

  const hintedRunId = getDispatchedExternalRunId(detail, round);
  const externalRun = hintedRunId
    ? await fetchExternalRunDetail(hintedRunId)
    : await fetchLatestExternalRunDetail(applicationId);

  if (!externalRun) return;
  if (readString(externalRun, 'application_id') !== applicationId) return;
  const externalRunStatus = readString(externalRun, 'status');
  if (externalRunStatus !== 'failed' && externalRunStatus !== 'completed') return;

  const tasks = Array.isArray(externalRun.tasks) ? externalRun.tasks : [];
  if (tasks.length < Math.max(1, AGENTS.length - 1)) {
    return;
  }

  const externalRunId = normalizePositiveNumber(externalRun.id, 0);
  const synthesizedAgents: string[] = [];

  for (const taskRaw of tasks) {
    const task = toRecord(taskRaw);
    if (!task) continue;

    const agentRole = readString(task, 'agent_role');
    if (!agentRole || !AGENTS.some((agent) => agent.name === agentRole)) continue;
    if (completedAgents.has(agentRole)) continue;

    const externalTaskStatus = readString(task, 'status') || 'failed';
    const errorMessage = readString(task, 'error_message');
    const reportContent = readString(task, 'report_content');
    const fallbackSummary = reportContent
      ? reportContent.slice(0, 600)
      : `External run failed before callback for ${agentRole}.`;

    await prisma.agentRun.create({
      data: {
        applicationId,
        agentName: agentRole,
        round,
        status: 'completed',
        promptSetVersion: 'external-fallback',
        requestPayload: toJson({
          source: 'external_failed_reconciliation',
          externalRunId: externalRunId > 0 ? externalRunId : null,
          externalTaskId: normalizePositiveNumber(task.id, 0) || null,
          externalTaskStatus,
        }),
        responsePayload: toJson({
          summary: fallbackSummary,
          analysis: reportContent || errorMessage || 'External task failed before callback.',
          verdict: 'ERROR_FALLBACK',
          score: 1,
          fallback: true,
          externalTaskStatus,
        }),
        score: 1,
        completedAt: new Date(),
      },
    });

    completedAgents.add(agentRole);
    synthesizedAgents.push(agentRole);
  }

  for (const agent of AGENTS) {
    if (completedAgents.has(agent.name)) continue;

    await prisma.agentRun.create({
      data: {
        applicationId,
        agentName: agent.name,
        round,
        status: 'completed',
        promptSetVersion: 'external-fallback',
        requestPayload: toJson({
          source: 'external_failed_reconciliation',
          externalRunId: externalRunId > 0 ? externalRunId : null,
          externalTaskStatus: 'missing_task',
        }),
        responsePayload: toJson({
          summary: `Fallback completion generated for ${agent.name}.`,
          analysis: 'No external task payload was available for this role in the failed run.',
          verdict: 'ERROR_FALLBACK',
          score: 1,
          fallback: true,
          externalTaskStatus: 'missing_task',
        }),
        score: 1,
        completedAt: new Date(),
      },
    });

    completedAgents.add(agent.name);
    synthesizedAgents.push(agent.name);
  }

  if (synthesizedAgents.length === 0) return;

  await logEvent(applicationId, 'analysis.external_failed_reconciled', 'Synthesized missing agent callbacks from failed external run.', {
    round,
    externalRunId: externalRunId > 0 ? externalRunId : null,
    synthesizedAgents,
    synthesizedCount: synthesizedAgents.length,
  });

  const refreshed = await getApplicationDetail(applicationId);
  if (!refreshed) return;

  const relayState = buildRelayRoundState(refreshed, round);
  const canonicalStatus = computeRoundStatus(
    refreshed.agentRuns,
    refreshed.gapItems,
    round,
    relayState.blockingCount,
  );

  if (canonicalStatus === 'complete') {
    await aggregateApplication(applicationId);
    return;
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: { status: canonicalStatus },
  });
}

function getRelayRetryCount(detail: any, relayId: string, phase: 'question' | 'answer'): number {
  const events = Array.isArray(detail?.events) ? detail.events : [];
  return events.filter((event: any) => {
    if (event?.eventType !== 'relay.dispatch.retry') return false;
    const payload = toRecord(event?.payload);
    if (!payload) return false;
    return readString(payload, 'relayId') === relayId && readString(payload, 'phase') === phase;
  }).length;
}

async function retryStaleRelayWork(detail: any, round: number, state: RelayRoundState) {
  if (agentExecutionMode !== 'external' || RELAY_RETRY_MAX <= 0) {
    return;
  }

  for (const question of state.pendingQuestionsStale) {
    const retries = getRelayRetryCount(detail, question.relayId, 'question');
    if (retries >= RELAY_RETRY_MAX) continue;

    const dispatchResponse = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: detail.id,
        event: 'relay_question',
        targetAgent: question.toAgent,
        relayId: question.relayId,
        sourceAgent: question.fromAgent,
        round,
        priority: question.priority,
        idempotencyKey: question.relayId,
      }),
    });

    if (!dispatchResponse.ok) {
      const body = await dispatchResponse.text();
      await logEvent(detail.id, 'relay.dispatch.retry_failed', `Relay question retry failed for ${question.relayId}.`, {
        relayId: question.relayId,
        phase: 'question',
        httpStatus: dispatchResponse.status,
        details: body.slice(0, 300),
      });
      continue;
    }

    await logEvent(detail.id, 'relay.dispatch.retry', 'Retried stale relay question dispatch.', {
      relayId: question.relayId,
      phase: 'question',
      retry: retries + 1,
      round,
      targetAgent: question.toAgent,
      sourceAgent: question.fromAgent,
    });
  }

  for (const answer of state.pendingConsumptionsStale) {
    const retries = getRelayRetryCount(detail, answer.relayId, 'answer');
    if (retries >= RELAY_RETRY_MAX) continue;

    const dispatchResponse = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicationId: detail.id,
        event: 'relay_answer',
        targetAgent: answer.toAgent,
        relayId: answer.relayId,
        sourceAgent: answer.fromAgent,
        round,
      }),
    });

    if (!dispatchResponse.ok) {
      const body = await dispatchResponse.text();
      await logEvent(detail.id, 'relay.dispatch.retry_failed', `Relay answer retry failed for ${answer.relayId}.`, {
        relayId: answer.relayId,
        phase: 'answer',
        httpStatus: dispatchResponse.status,
        details: body.slice(0, 300),
      });
      continue;
    }

    await logEvent(detail.id, 'relay.dispatch.retry', 'Retried stale relay answer dispatch.', {
      relayId: answer.relayId,
      phase: 'answer',
      retry: retries + 1,
      round,
      targetAgent: answer.toAgent,
      sourceAgent: answer.fromAgent,
    });
  }
}

type ValidationIssue = {
  field: string;
  message: string;
};

function normalizeText(value: string) {
  return value.trim().toLowerCase();
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = normalizeText(value);
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
  }
  return false;
}

function pickFirstTextValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }
    }
  }

  return undefined;
}

function normalizeFounderResponses(value: unknown): Record<string, string> {
  const normalized: Record<string, string> = {};

  const collect = (record: Record<string, unknown>) => {
    for (const [key, rawValue] of Object.entries(record)) {
      const text = pickFirstTextValue(rawValue);
      if (text) {
        normalized[key] = text;
      }
    }
  };

  if (typeof value === 'string') {
    collect(safeParse<Record<string, unknown>>(value, {}));
    return normalized;
  }

  if (value && typeof value === 'object') {
    collect(value as Record<string, unknown>);
  }

  return normalized;
}

function resolveFounderResponseText(
  baseResponses: Record<string, string>,
  body: Record<string, unknown>,
  gapId: string,
): string | undefined {
  const direct = baseResponses[gapId];
  if (direct && direct.trim()) {
    return direct.trim();
  }

  const candidateFields = [`responses.${gapId}`, `responses[${gapId}]`, gapId];
  for (const fieldName of candidateFields) {
    const text = pickFirstTextValue(body[fieldName]);
    if (text) {
      return text;
    }
  }

  return undefined;
}

function parseAndValidateCloudLink(rawUrl: unknown): { valid: boolean; normalizedUrl: string | null; host: string | null } {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { valid: false, normalizedUrl: null, host: null };
  }

  try {
    const parsed = new URL(rawUrl.trim());
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      return { valid: false, normalizedUrl: null, host: null };
    }

    return { valid: true, normalizedUrl: parsed.toString(), host: parsed.hostname.toLowerCase() };
  } catch {
    return { valid: false, normalizedUrl: null, host: null };
  }
}

function isSupportedCloudHost(host: string | null) {
  if (!host) return false;
  return host === 'drive.google.com'
    || host === 'docs.google.com'
    || host === 'notion.so'
    || host.endsWith('.notion.so')
    || host.endsWith('.notion.site');
}

function looksPrivateCloudResponse(finalUrl: string, responseText: string) {
  const urlLower = normalizeText(finalUrl);
  const textLower = normalizeText(responseText);

  if (urlLower.includes('accounts.google.com') || urlLower.includes('servicelogin')) {
    return true;
  }

  const privateMarkers = [
    'you need access',
    'request access',
    'sign in to continue to google drive',
    'вам нужен доступ',
    'запросить доступ',
    'войдите в аккаунт google',
    'page not found',
    'логин',
    'log in',
    'private page',
    'this content is private',
  ];

  return privateMarkers.some((marker) => textLower.includes(marker));
}

async function checkCloudLinkAvailability(url: string): Promise<{ available: boolean; statusCode?: number; error?: string; message?: string }> {
  const timeoutMs = 7000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': 'startup-automation-link-check/1.0',
      },
    });
    clearTimeout(timer);

    const statusCode = response.status;
    if (statusCode < 200 || statusCode >= 400) {
      return {
        available: false,
        statusCode,
        message: `Ссылка вернула HTTP ${statusCode}.`,
      };
    }

    const contentType = normalizeText(response.headers.get('content-type') || '');
    const isTextLike = contentType.includes('text') || contentType.includes('json') || contentType.includes('html') || contentType === '';
    let bodyPreview = '';

    if (isTextLike) {
      const bodyText = await response.text();
      bodyPreview = bodyText.slice(0, 15000);
    }

    const finalUrl = response.url || url;
    if (looksPrivateCloudResponse(finalUrl, bodyPreview)) {
      return {
        available: false,
        statusCode,
        message: 'Ссылка открывается, но доступ ограничен (нужен публичный просмотр по ссылке).',
      };
    }

    return { available: true, statusCode, message: 'Ссылка публично доступна.' };
  } catch (error) {
    clearTimeout(timer);
    return { available: false, error: error instanceof Error ? error.message : 'Cloud link check failed', message: 'Не удалось проверить cloud ссылку.' };
  }
}

async function validateSubmissionInput(args: {
  body: Record<string, unknown>;
  founders: ReturnType<typeof parseFounders>;
  filesCount: number;
}): Promise<{ issues: ValidationIssue[]; driveLinkStatus?: { available: boolean; statusCode?: number; error?: string } }> {
  const { body, founders, filesCount } = args;
  const issues: ValidationIssue[] = [];

  const startupName = typeof body.startupName === 'string' ? body.startupName.trim() : '';
  const startupStage = typeof body.startupStage === 'string' ? body.startupStage : '';
  const activityType = typeof body.activityType === 'string' ? body.activityType.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  const driveLink = typeof body.driveLink === 'string' ? body.driveLink.trim() : '';
  const isTraditionalBusiness = parseBoolean(body.isTraditionalBusiness);

  if (!startupName) {
    issues.push({ field: 'startupName', message: 'Название компании обязательно.' });
  }

  if (!normalizeStartupStage(startupStage)) {
    issues.push({ field: 'startupStage', message: 'Допустимы только стадии Pre-Seed или Seed.' });
  }

  if (!isAllowedIndustry(activityType)) {
    issues.push({ field: 'activityType', message: `Выберите индустрию из утвержденного списка (${ALLOWED_INDUSTRIES.length} направлений).` });
  }

  if (containsForbiddenIndustryKeywords(activityType) || containsForbiddenIndustryKeywords(description)) {
    issues.push({ field: 'activityType', message: 'Направления crypto/gambling и смежные запрещены для этой воронки.' });
  }

  if (isTraditionalBusiness) {
    issues.push({ field: 'isTraditionalBusiness', message: 'Традиционный бизнес не проходит текущий фильтр фонда.' });
  }

  if (founders.length === 0) {
    issues.push({ field: 'founders', message: 'Добавьте минимум одного фаундера с контактами.' });
  } else if (!hasCentralAsiaFounder(founders)) {
    issues.push({ field: 'founders', message: 'Минимум один фаундер должен быть из Центральной Азии (страна или гражданство).' });
  }

  let driveLinkStatus: { available: boolean; statusCode?: number; error?: string } | undefined;
  const hasAnyDataRoomSource = filesCount > 0 || Boolean(driveLink);
  if (!hasAnyDataRoomSource) {
    issues.push({ field: 'driveLink', message: 'Добавьте Google Drive/Notion ссылку или загрузите хотя бы один файл.' });
  }

  if (driveLink) {
    const parsedLink = parseAndValidateCloudLink(driveLink);
    if (!parsedLink.valid || !parsedLink.normalizedUrl) {
      issues.push({ field: 'driveLink', message: 'Некорректная ссылка на cloud dataroom.' });
    } else if (!isSupportedCloudHost(parsedLink.host)) {
      issues.push({ field: 'driveLink', message: 'Поддерживаются только Google Drive/Notion ссылки.' });
    } else {
      driveLinkStatus = await checkCloudLinkAvailability(parsedLink.normalizedUrl);
      if (!driveLinkStatus.available) {
        issues.push({ field: 'driveLink', message: 'Cloud ссылка недоступна. Проверьте права доступа и корректность URL.' });
      }
    }
  }

  return { issues, driveLinkStatus };
}

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve the compiled React application static assets
// Cache hashed assets immutably; never cache index.html
app.use(express.static(publicDir, {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.[a-f0-9]{8}\.(js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// Health check endpoint (used by Docker and load balancers)
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/ping', async (_req, res) => {
  try {
    const applications = await prisma.application.count();
    res.json({ message: 'Master agent demo is running.', applications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Database connection failed.' });
  }
});

app.get('/api/dataroom-guide', (_req, res) => {
  res.json({ items: DATAROOM_GUIDE });
});

app.get('/api/validate-drive-link', async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  const parsed = parseAndValidateCloudLink(url);

  if (!parsed.valid || !parsed.normalizedUrl) {
    return res.status(400).json({ available: false, message: 'Некорректный URL.' });
  }

  if (!isSupportedCloudHost(parsed.host)) {
    return res.status(400).json({ available: false, message: 'Поддерживаются только Google Drive/Notion ссылки.' });
  }

  const status = await checkCloudLinkAvailability(parsed.normalizedUrl);
  return res.json({
    available: status.available,
    statusCode: status.statusCode,
    error: status.error,
    message: status.message,
  });
});

app.all(/^\/agents-proxy(\/.*)?$/, async (req, res) => {
  try {
    const proxiedPath = req.originalUrl.replace(/^\/agents-proxy/, '') || '/';
    const targetUrl = `${AGENTS_PLATFORM_URL}${proxiedPath}`;

    const headers = new Headers();
    const contentTypeHeader = req.headers['content-type'];
    if (typeof contentTypeHeader === 'string' && contentTypeHeader.length > 0) {
      headers.set('content-type', contentTypeHeader);
    }

    let body: string | undefined;
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (typeof req.body === 'string') {
        body = req.body;
      } else if (req.body && Object.keys(req.body).length > 0) {
        body = JSON.stringify(req.body);
        if (!headers.has('content-type')) {
          headers.set('content-type', 'application/json');
        }
      }
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      redirect: 'manual',
    });

    const responseBody = await upstream.text();
    const upstreamContentType = upstream.headers.get('content-type');
    if (upstreamContentType) {
      res.setHeader('content-type', upstreamContentType);
    }
    const upstreamLocation = upstream.headers.get('location');
    if (upstreamLocation) {
      res.setHeader('location', upstreamLocation);
    }

    return res.status(upstream.status).send(responseBody);
  } catch (error) {
    console.error('Agents proxy error:', error);
    return res.status(502).json({ error: 'Agents platform is unavailable.' });
  }
});

app.post('/api/applications', upload.array('documents'), async (req, res) => {
  try {
    const founders = parseFounders(req.body as Record<string, unknown>);
    const founderEmail = typeof req.body.founderEmail === 'string' ? req.body.founderEmail : '';
    const startupName = typeof req.body.startupName === 'string' ? req.body.startupName : '';
    const files = req.files as Express.Multer.File[] | undefined;

    if (!startupName || !founderEmail) {
      return res.status(400).json({ error: 'startupName and founderEmail are required.' });
    }

    const validation = await validateSubmissionInput({
      body: req.body as Record<string, unknown>,
      founders,
      filesCount: files?.length || 0,
    });

    if (validation.issues.length > 0) {
      return res.status(400).json({
        error: 'Application validation failed.',
        details: validation.issues,
        driveLinkStatus: validation.driveLinkStatus,
      });
    }

    const application = await prisma.application.create({
      data: {
        startupName,
        founderEmail,
        startupType: typeof req.body.startupType === 'string' ? req.body.startupType : null,
        startupStage: typeof req.body.startupStage === 'string' ? req.body.startupStage : null,
        activityType: typeof req.body.activityType === 'string' ? req.body.activityType : null,
        description: typeof req.body.description === 'string' ? req.body.description : null,
        businessModel: typeof req.body.businessModel === 'string' ? req.body.businessModel : null,
        financialSummary: typeof req.body.financialSummary === 'string' ? req.body.financialSummary : null,
        websiteUrl: typeof req.body.websiteUrl === 'string' ? req.body.websiteUrl : null,
        driveLink: typeof req.body.driveLink === 'string' ? req.body.driveLink : null,
        investmentAmount: req.body.investmentAmount ? Number(req.body.investmentAmount) : null,
        currency: typeof req.body.currency === 'string' ? req.body.currency : 'USD',
        founders: toJson(founders),
      },
    });

    await uploadFilesToStorage(files, application.id, 'founder_upload');
    const magicLink = await getOrCreateMagicLink(application.id);
    await logEvent(application.id, 'submission.created', 'Founder created a new submission.');

    const linkUrl = buildMagicLinkUrl(magicLink.token, publicBaseUrl);
    console.log(`\n\n[MASTER AGENT] New Startup Submitted: ${startupName}`);
    console.log(`[MAGIC LINK FOR FOUNDER] -> ${linkUrl}\n\n`);

    // Respond immediately — agent dispatch runs in background
    const partialDetail = await prisma.application.findUnique({
      where: { id: application.id },
      include: { documents: true, gapItems: true, magicLinks: true, agentRuns: true, events: true },
    });
    res.status(201).json({
      message: 'Application submitted successfully.',
      application: serializeApplication(partialDetail!, publicBaseUrl),
      magicLinkUrl: linkUrl,
    });

    // Fire-and-forget: run agent dispatch after response is sent
    setImmediate(() => {
      reevaluateAndAdvance(application.id, internalBaseUrl, publicBaseUrl).catch((err) => {
        console.error(`[BG] reevaluateAndAdvance failed for ${application.id}:`, err);
      });
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to create application.' });
  }
});

app.get('/api/applications', async (_req, res) => {
  try {
    const applications = await prisma.application.findMany({
      include: {
        documents: true,
        gapItems: true,
        magicLinks: { orderBy: { createdAt: 'desc' }, take: 1 },
        agentRuns: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json(applications.map((application: any) => ({
      ...application,
      magicLinkUrl: application.magicLinks[0] ? buildMagicLinkUrl(application.magicLinks[0].token, publicBaseUrl) : null,
      openGapCount: application.gapItems.filter((gap: any) => gap.status === 'open').length,
      agentRunCount: application.agentRuns.length,
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch applications.' });
  }
});

app.get('/api/applications/:id', async (req, res) => {
  try {
    const applicationId = normalizeParam(req.params.id);
    if (!applicationId) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }

    await reconcileExternalFailedRun(applicationId);
    const detail = await getApplicationDetail(applicationId);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    return res.json(serializeApplication(detail, publicBaseUrl));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch application.' });
  }
});

app.get('/api/applications/:id/agent-runs', async (req, res) => {
  const detail = await getApplicationDetail(req.params.id);
  if (!detail) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  return res.json(detail.agentRuns);
});

app.get('/api/applications/:id/agent-runs/:runId/report', (req, res) => {
  return res.redirect(301, `/report/agent/${req.params.id}/${req.params.runId}`);
});

app.get('/api/applications/:id/aggregate', async (req, res) => {
  const application = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!application) {
    return res.status(404).json({ error: 'Application not found.' });
  }

  return res.json(application.aggregateReport || null);
});

app.get('/api/applications/:id/report/internal', (req, res) => {
  return res.redirect(301, `/report/internal/${req.params.id}`);
});

app.get('/api/applications/:id/report/founder', (req, res) => {
  return res.redirect(301, `/report/founder/${req.params.id}`);
});

app.post('/api/applications/:id/prepare', async (req, res) => {
  try {
    const detail = await reevaluateAndAdvance(req.params.id, internalBaseUrl, publicBaseUrl);
    return res.json({ message: 'Workflow recomputed.', application: serializeApplication(detail, publicBaseUrl) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to recompute workflow.' });
  }
});

app.get('/api/magic/:token', async (req, res) => {
  try {
    const token = normalizeParam(req.params.token);
    if (!token) {
      return res.status(400).json({ error: 'Invalid token.' });
    }
    const link = await prisma.magicLinkSession.findUnique({ where: { token } });
    if (!link) {
      return res.status(404).json({ error: 'Magic link not found.' });
    }

    await prisma.magicLinkSession.update({ where: { token }, data: { lastAccessedAt: new Date() } });
    await reconcileExternalFailedRun(link.applicationId);
    const detail = await getApplicationDetail(link.applicationId);
    return res.json(serializeApplication(detail, publicBaseUrl));
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to load founder portal.' });
  }
});

app.post('/api/magic/:token/respond', upload.any(), async (req: Request, res: Response) => {
  try {
    const token = normalizeParam(req.params.token);
    if (!token) {
      return res.status(400).json({ error: 'Invalid token.' });
    }
    const link = await prisma.magicLinkSession.findUnique({ where: { token } });
    if (!link) {
      return res.status(404).json({ error: 'Magic link not found.' });
    }

    const requestBody = (req.body || {}) as Record<string, unknown>;
    const responses = normalizeFounderResponses(requestBody.responses);
    const uploadedDocs = await uploadFilesToStorage(req.files as Express.Multer.File[] | undefined, link.applicationId, 'founder_followup');
    const gapDocumentIds = new Map(
      uploadedDocs
        .filter((document) => document.fieldName.startsWith('gapDocument:'))
        .map((document) => [document.fieldName.replace('gapDocument:', ''), document.id]),
    );

    const openGaps = await prisma.gapItem.findMany({
      where: { applicationId: link.applicationId, status: 'open' },
      orderBy: { createdAt: 'asc' },
    });

    let resolvedGapCount = 0;
    let textResponseCount = 0;

    for (const gap of openGaps) {
      const responseText = resolveFounderResponseText(responses, requestBody, gap.id);
      const responseDocumentId = gapDocumentIds.get(gap.id);

      if (responseText || responseDocumentId) {
        await prisma.gapItem.update({
          where: { id: gap.id },
          data: {
            status: 'resolved',
            responseText: responseText || null,
            responseDocumentId: responseDocumentId || null,
            resolvedAt: new Date(),
          },
        });
        resolvedGapCount += 1;
        if (responseText) {
          textResponseCount += 1;
        }
      }
    }

    await logEvent(link.applicationId, 'founder.responded', 'Founder added follow-up materials.', {
      responses: textResponseCount,
      resolvedGaps: resolvedGapCount,
      uploadedDocuments: uploadedDocs.length,
    });

    const detail = await reevaluateAndAdvance(link.applicationId, internalBaseUrl, publicBaseUrl);
    return res.json({ message: 'Founder follow-up saved.', application: serializeApplication(detail, publicBaseUrl) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to save founder follow-up.' });
  }
});

app.get('/api/webhooks/startups/:id/data', async (req, res) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }
    const detail = await getApplicationDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }
    
    const agentName = typeof req.query.agentName === 'string' ? req.query.agentName : undefined;
    const relayRequest = agentName ? getPendingRelayForAgent(detail, agentName) : null;
    const relayAnswer = agentName ? getPendingRelayAnswerForAgent(detail, agentName) : null;
    const relayPending = agentName ? getRelayPendingSnapshot(detail, agentName) : null;

    // Return original submission info and documents for the agents
    return res.json({
      application: {
        id: detail.id,
        startupName: detail.startupName,
        startupType: detail.startupType,
        startupStage: detail.startupStage,
        activityType: detail.activityType,
        description: detail.description,
        businessModel: detail.businessModel,
        financialSummary: detail.financialSummary,
        websiteUrl: detail.websiteUrl,
        driveLink: detail.driveLink,
        investmentAmount: detail.investmentAmount,
        currency: detail.currency,
        founders: detail.founders,
      },
      relayRequest,
      relayAnswer,
      relayPending,
      documents: detail.documents.map((doc: any) => ({
        id: doc.id,
        documentType: doc.documentType,
        category: doc.category,
        classifiedAs: doc.classifiedAs,
        fileUrl: doc.fileUrl,
        originalName: doc.originalName,
        mimeType: doc.mimeType,
        source: doc.source,
      }))
    });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Failed to fetch startup data.' });
  }
});

app.post('/api/webhooks/startups/:id/relay/question', async (req, res) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }
    const detail = await getApplicationDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const payload = parseRelayQuestionEnvelope(
      req.body as Record<string, unknown>,
      detail.currentRound > 0 ? detail.currentRound : 1,
    );

    if (!payload) {
      return res.status(400).json({ error: 'fromAgent, toAgent and question are required.' });
    }

    const existingQuestion = findRelayQuestion(detail, payload.relayId);
    if (existingQuestion) {
      return res.json({
        status: 'duplicate',
        relayId: payload.relayId,
        idempotencyKey: payload.idempotencyKey,
        fromAgent: existingQuestion.fromAgent,
        toAgent: existingQuestion.toAgent,
        round: existingQuestion.round,
      });
    }

    await logEvent(detail.id, 'relay.question', `Relay question ${payload.fromAgent} -> ${payload.toAgent}`, {
      relayId: payload.relayId,
      idempotencyKey: payload.idempotencyKey,
      fromAgent: payload.fromAgent,
      toAgent: payload.toAgent,
      question: payload.question,
      round: payload.round,
      priority: payload.priority,
    });

    if (agentExecutionMode === 'external') {
      const dispatchResponse = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId: detail.id,
          event: 'relay_question',
          targetAgent: payload.toAgent,
          relayId: payload.relayId,
          sourceAgent: payload.fromAgent,
          round: payload.round,
          priority: payload.priority,
          idempotencyKey: payload.idempotencyKey,
        }),
      });

      if (!dispatchResponse.ok) {
        const body = await dispatchResponse.text();
        return res.status(502).json({ error: `Failed to dispatch relay question: ${dispatchResponse.status}`, details: body.slice(0, 300) });
      }
    }

    return res.json({
      status: 'accepted',
      relayId: payload.relayId,
      idempotencyKey: payload.idempotencyKey,
      fromAgent: payload.fromAgent,
      toAgent: payload.toAgent,
      round: payload.round,
      priority: payload.priority,
    });
  } catch (error) {
    console.error('Relay question error:', error);
    return res.status(500).json({ error: 'Failed to register relay question.' });
  }
});

app.post('/api/webhooks/startups/:id/relay/answer', async (req, res) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }
    const detail = await getApplicationDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const payload = parseRelayAnswerEnvelope(req.body as Record<string, unknown>);
    if (!payload) {
      return res.status(400).json({ error: 'relayId, fromAgent and answer are required.' });
    }

    const relayQuestion = findRelayQuestion(detail, payload.relayId);
    if (!relayQuestion) {
      return res.status(404).json({ error: 'Relay question not found for relayId.' });
    }

    const existingAnswer = findRelayAnswer(detail, payload.relayId, payload.fromAgent);
    if (existingAnswer) {
      return res.json({
        status: 'duplicate',
        relayId: payload.relayId,
        fromAgent: payload.fromAgent,
        resumedAgent: relayQuestion.fromAgent,
      });
    }

    await logEvent(detail.id, 'relay.answer', `Relay answer from ${payload.fromAgent}`, {
      relayId: payload.relayId,
      fromAgent: payload.fromAgent,
      toAgent: relayQuestion.fromAgent,
      answer: payload.answer,
    });

    if (agentExecutionMode === 'external') {
      const dispatchResponse = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/webhook/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          applicationId: detail.id,
          event: 'relay_answer',
          targetAgent: relayQuestion.fromAgent,
          relayId: payload.relayId,
          sourceAgent: payload.fromAgent,
          round: relayQuestion.round,
        }),
      });

      if (!dispatchResponse.ok) {
        const body = await dispatchResponse.text();
        return res.status(502).json({ error: `Failed to dispatch relay answer: ${dispatchResponse.status}`, details: body.slice(0, 300) });
      }
    }

    return res.json({
      status: 'accepted',
      relayId: payload.relayId,
      fromAgent: payload.fromAgent,
      resumedAgent: relayQuestion.fromAgent,
    });
  } catch (error) {
    console.error('Relay answer error:', error);
    return res.status(500).json({ error: 'Failed to register relay answer.' });
  }
});

app.post('/api/webhooks/startups/:id/relay/consumed', async (req, res) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }
    const detail = await getApplicationDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const payload = parseRelayConsumedEnvelope(req.body as Record<string, unknown>);
    if (!payload) {
      return res.status(400).json({ error: 'relayId and consumedByAgent are required.' });
    }

    const existingConsumed = findRelayConsumed(detail, payload.relayId, payload.consumedByAgent);
    if (existingConsumed) {
      return res.json({
        status: 'duplicate',
        relayId: payload.relayId,
        consumedByAgent: payload.consumedByAgent,
      });
    }

    await logEvent(detail.id, 'relay.answer.consumed', `Relay answer consumed by ${payload.consumedByAgent}`, {
      relayId: payload.relayId,
      consumedByAgent: payload.consumedByAgent,
    });

    return res.json({
      status: 'accepted',
      relayId: payload.relayId,
      consumedByAgent: payload.consumedByAgent,
    });
  } catch (error) {
    console.error('Relay consumed error:', error);
    return res.status(500).json({ error: 'Failed to register relay consumed event.' });
  }
});

app.post('/api/webhooks/startups/:id/processed', upload.array('documents'), async (req, res) => {
  try {
    const id = normalizeParam(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Invalid application id.' });
    }
    const detail = await getApplicationDetail(id);
    if (!detail) {
      return res.status(404).json({ error: 'Application not found.' });
    }

    const agentName = typeof req.body.agentName === 'string' ? req.body.agentName : 'unknown_agent';
    const postStatus = typeof req.body.status === 'string' ? req.body.status : 'completed';
    let requestedDocs: string[] = [];
    try {
      requestedDocs = req.body.requested_docs ? JSON.parse(req.body.requested_docs) : [];
    } catch (e) {
      if (typeof req.body.requested_docs === 'string') {
        requestedDocs = [req.body.requested_docs];
      }
    }

    const explicitRound = typeof req.body.round === 'string' ? Number(req.body.round) : Number(req.body.round);
    const runRound = Number.isFinite(explicitRound) && explicitRound > 0
      ? explicitRound
      : (detail.currentRound > 0 ? detail.currentRound : 1);

    const responseJson = safeParse<Record<string, unknown>>(req.body.response_json, {});
    const fallbackPayload: Record<string, unknown> = {};
    if (typeof req.body.summary === 'string' && req.body.summary.trim()) fallbackPayload.summary = req.body.summary.trim();
    if (typeof req.body.analysis === 'string' && req.body.analysis.trim()) fallbackPayload.analysis = req.body.analysis.trim();
    if (typeof req.body.verdict === 'string' && req.body.verdict.trim()) fallbackPayload.verdict = req.body.verdict.trim();
    if (req.body.score !== undefined && req.body.score !== null && `${req.body.score}`.trim() !== '') {
      const numericScore = Number(req.body.score);
      if (Number.isFinite(numericScore)) fallbackPayload.score = numericScore;
    }

    const mergedPayload: Record<string, unknown> = Object.keys(responseJson).length > 0 ? { ...responseJson } : { ...fallbackPayload };
    const llmProviderPrimary = typeof req.body.llm_provider_primary === 'string' ? req.body.llm_provider_primary.trim() : '';
    const llmModelPrimary = typeof req.body.llm_model_primary === 'string' ? req.body.llm_model_primary.trim() : '';
    const llmProviderUsed = typeof req.body.llm_provider_used === 'string' ? req.body.llm_provider_used.trim() : '';
    const llmModelUsed = typeof req.body.llm_model_used === 'string' ? req.body.llm_model_used.trim() : '';
    const llmFallbackUsedRaw = typeof req.body.llm_fallback_used === 'string' ? req.body.llm_fallback_used.trim().toLowerCase() : '';
    const llmFallbackUsed = llmFallbackUsedRaw === 'true' || llmFallbackUsedRaw === '1' || llmFallbackUsedRaw === 'yes';
    if (llmProviderPrimary || llmModelPrimary || llmProviderUsed || llmModelUsed || llmFallbackUsedRaw) {
      mergedPayload._llmRouting = {
        primaryProvider: llmProviderPrimary || null,
        primaryModel: llmModelPrimary || null,
        usedProvider: llmProviderUsed || null,
        usedModel: llmModelUsed || null,
        fallbackUsed: llmFallbackUsed,
      };
    }
    const fullContent = typeof req.body.full_content === 'string' && req.body.full_content.trim()
      ? req.body.full_content
      : undefined;
    if (fullContent) mergedPayload._fullContent = fullContent;
    const uploadedDocs = await uploadFilesToStorage(req.files as Express.Multer.File[] | undefined, detail.id, `agent_${agentName}`);

    const payloadScoreRaw = mergedPayload.score;
    let payloadScore = typeof payloadScoreRaw === 'number' && Number.isFinite(payloadScoreRaw) && payloadScoreRaw > 0
      ? payloadScoreRaw
      : undefined;

    // Fallback 1: compute from criteria_breakdown — all agents define score as
    // Σ (criteria_breakdown[i].score × criteria_breakdown[i].weight / 100)
    if (payloadScore === undefined || payloadScore === 0) {
      const breakdown = mergedPayload.criteria_breakdown;
      if (Array.isArray(breakdown) && breakdown.length > 0) {
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
        if (totalWeight > 0) {
          const computed = totalWeight !== 100 ? (total / totalWeight) * 100 : total;
          payloadScore = Math.round(computed * 10) / 10;
        }
      }
    }

    // Fallback 2: extract score from full_content text (e.g. "Итоговый балл 45 / 100")
    if (payloadScore === undefined && fullContent) {
      const scoreMatch = fullContent.match(/[Ии]тогов\S*\s+балл\s*[:\s]\s*\*{0,2}\s*(\d{1,3})\s*\*{0,2}\s*\/\s*100/);
      if (scoreMatch) {
        const extracted = Number(scoreMatch[1]);
        if (Number.isFinite(extracted) && extracted >= 0 && extracted <= 100) {
          payloadScore = extracted;
        }
      }
    }

    const promptSetVersion = typeof req.body.prompt_set_version === 'string' ? req.body.prompt_set_version : undefined;

    await prisma.agentRun.create({
      data: {
        applicationId: detail.id,
        agentName,
        round: runRound,
        status: postStatus === 'needs_info' ? 'needs_more_info' : 'completed',
        promptSetVersion,
        requestPayload: toJson({
          source: 'external_webhook',
          status: postStatus,
          uploadedDocuments: uploadedDocs.length,
          requestedDocuments: requestedDocs,
        }),
        responsePayload: Object.keys(mergedPayload).length > 0 ? toJson(mergedPayload) : undefined,
        requestedDocuments: requestedDocs.length > 0 ? toJson(requestedDocs) : undefined,
        score: payloadScore,
        completedAt: new Date(),
      }
    });

    await logEvent(detail.id, 'agent.response', `Agent ${agentName} responded with status: ${postStatus}.`, {
      uploadedDocuments: uploadedDocs.length,
      agentName,
      status: postStatus,
      promptSetVersion
    });

    if (postStatus === 'needs_info') {
      const batchGap = await syncFounderBatchGap(detail.id, runRound);

      // Suspend and generate magic link
      if (agentExecutionMode === 'external') {
        await prisma.application.update({ where: { id: detail.id }, data: { status: 'awaiting_founder' } });
      } else {
        await reevaluateAndAdvance(detail.id, internalBaseUrl, publicBaseUrl);
      }
      const magicLink = await getOrCreateMagicLink(detail.id);
      const linkUrl = buildMagicLinkUrl(magicLink.token, publicBaseUrl);
      
      console.log(`\n\n[MASTER AGENT] Execution paused for ${detail.startupName}. Sub-agent ${agentName} requested more info.`);
      console.log(`[MAGIC LINK] -> ${linkUrl}\n\n`);
      
      return res.json({ 
        message: 'Paused. Founder batch questions prepared and Magic Link generated.',
        gapItemsCount: requestedDocs.length,
        founderBatchGapId: batchGap?.id || null,
        magicLinkUrl: linkUrl
      });
    }

    // if completed, log and advance
    if (agentExecutionMode === 'external') {
      const updatedDetail = await getApplicationDetail(detail.id);
      if (!updatedDetail) {
        return res.status(404).json({ error: 'Application not found after callback.' });
      }

      const relayState = buildRelayRoundState(updatedDetail, runRound);
      await retryStaleRelayWork(updatedDetail, runRound, relayState);

      // Use deterministic status computation to avoid stuck states
      const canonicalStatus = computeRoundStatus(
        updatedDetail.agentRuns,
        updatedDetail.gapItems,
        runRound,
        relayState.blockingCount,
      );

      if (relayState.blockingCount > 0) {
        await logEvent(detail.id, 'analysis.relay_pending', 'Round waiting on relay completion before aggregation.', {
          round: runRound,
          unanswered: relayState.unansweredCount,
          unconsumed: relayState.unconsumedCount,
          blocking: relayState.blockingCount,
        });
      }

      if (canonicalStatus === 'complete') {
        if (relayState.staleCount > 0) {
          await logEvent(detail.id, 'analysis.continue_with_pending', 'Aggregating despite stale relay pending according to policy.', {
            round: runRound,
            stalePending: relayState.staleCount,
            unanswered: relayState.unansweredCount,
            unconsumed: relayState.unconsumedCount,
          });
        }
        await aggregateApplication(detail.id);
      } else {
        await prisma.application.update({ where: { id: detail.id }, data: { status: canonicalStatus } });
      }
    } else {
      await reevaluateAndAdvance(detail.id, internalBaseUrl, publicBaseUrl);
    }

    return res.json({ 
      message: 'Processed files successfully uploaded.',
      uploaded: uploadedDocs.length
    });
  } catch (error) {
    console.error('Webhook upload error:', error);
    return res.status(500).json({ error: 'Failed to upload processed files.' });
  }
});

// ─── Admin: LLM Settings ──────────────────────────────────────────────────────

app.get('/api/admin/settings', (_req, res) => {
  const s = loadSettings();
  return res.json({
    provider: s.provider,
    model: s.model,
    hasApiKey: Boolean(s.apiKey),
    agentPrompts: s.agentPrompts,
  });
});

app.post('/api/admin/settings/llm', express.json(), async (req, res) => {
  const { provider, model, apiKey } = req.body as Record<string, string>;
  if (!provider || !model || !apiKey) {
    return res.status(400).json({ error: 'provider, model and apiKey are required.' });
  }
  const validProviders = ['anthropic', 'openai', 'google', 'vertex_ai'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
  }
  const s = loadSettings();
  s.provider = provider as 'anthropic' | 'openai' | 'google' | 'vertex_ai';
  s.model = model;
  s.apiKey = apiKey;
  saveSettings(s);
  const sync = await syncModelToAgentsPlatform(provider, model, apiKey);
  return res.json({ ok: true, synced: sync.synced, syncError: sync.syncError });
});

app.post('/api/admin/settings/test', express.json(), async (req, res) => {
  const { provider, model, apiKey } = req.body as Record<string, string>;
  if (!provider || !model || !apiKey) {
    return res.status(400).json({ error: 'provider, model and apiKey are required.' });
  }
  const validProviders = ['anthropic', 'openai', 'google', 'vertex_ai'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `provider must be one of: ${validProviders.join(', ')}` });
  }
  try {
    const result = await testLLMConnection(
      provider as 'anthropic' | 'openai' | 'google' | 'vertex_ai',
      model,
      apiKey,
    );
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err) });
  }
});

/**
 * Wrapper around Node's native https.get to avoid undici (built-in fetch) issues in Docker.
 */
function httpsGetJson(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'Accept': 'application/json', ...headers },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, body: raw }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/**
 * Fetch live model list from provider API.
 * GET /api/admin/settings/models/fetch?provider=X&apiKey=Y
 */
app.get('/api/admin/settings/models/fetch', async (req, res) => {
  const provider = normalizeParam(req.query.provider as string | string[]);
  const apiKey = normalizeParam(req.query.apiKey as string | string[]);
  if (!provider || !apiKey) {
    return res.status(400).json({ error: 'provider and apiKey are required' });
  }
  try {
    if (provider === 'anthropic') {
      const r = await httpsGetJson('https://api.anthropic.com/v1/models', {
        'x-api-key': apiKey, 'anthropic-version': '2023-06-01',
      });
      if (r.status !== 200) return res.status(r.status).json({ error: `Anthropic API error: ${r.status}` });
      const data = r.body as { data: Array<{ id: string; display_name?: string }> };
      const models = (data.data || [])
        .filter((m) => m.id.startsWith('claude'))
        .map((m) => ({ id: m.id, label: m.display_name || m.id }));
      return res.json(models);
    }
    if (provider === 'openai') {
      const r = await httpsGetJson('https://api.openai.com/v1/models', {
        'Authorization': `Bearer ${apiKey}`,
      });
      if (r.status !== 200) return res.status(r.status).json({ error: `OpenAI API error: ${r.status}` });
      const data = r.body as { data: Array<{ id: string }> };
      const models = (data.data || [])
        .filter((m) => m.id.startsWith('gpt'))
        .sort((a, b) => b.id.localeCompare(a.id))
        .map((m) => ({ id: m.id, label: m.id }));
      return res.json(models);
    }
    if (provider === 'google') {
      const r = await httpsGetJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (r.status !== 200) return res.status(r.status).json({ error: `Google API error: ${r.status}` });
      const data = r.body as { models: Array<{ name: string; displayName?: string }> };
      const models = (data.models || [])
        .filter((m) => m.name.includes('gemini'))
        .map((m) => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }));
      return res.json(models);
    }
    if (provider === 'vertex_ai') {
      // Vertex AI Express keys work with the same generativelanguage endpoint
      const r = await httpsGetJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (r.status !== 200) {
        return res.status(r.status).json({
          error: `Vertex AI error: ${r.status}. Убедись что используется ключ Vertex AI Express (не Service Account JSON).`,
        });
      }
      const data = r.body as { models: Array<{ name: string; displayName?: string }> };
      const models = (data.models || [])
        .filter((m) => m.name.includes('gemini'))
        .map((m) => ({ id: m.name.replace('models/', ''), label: m.displayName || m.name.replace('models/', '') }));
      return res.json(models);
    }
    return res.status(400).json({ error: 'Unknown provider' });
  } catch (err) {
    return res.status(502).json({ error: String(err) });
  }
});

// ─── Admin: Agent Prompts ──────────────────────────────────────────────────────

/**
 * Push model_provider + model_version (+ optional api_key) to all agents in agents_platform.
 * Returns { synced: true } on success or { synced: false, syncError } on failure.
 * Never throws — failure is non-blocking.
 */
async function syncModelToAgentsPlatform(
  provider: string,
  model: string,
  apiKey?: string,
): Promise<{ synced: boolean; syncError?: string }> {
  if (agentExecutionMode !== 'external') {
    return { synced: false, syncError: 'Not in external mode' };
  }
  try {
    const listRes = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/agents`);
    if (!listRes.ok) {
      return { synced: false, syncError: `agents_platform list failed: ${listRes.status}` };
    }
    const listData = await listRes.json() as { items: Array<{ id: number; role: string }> };
    const errors: string[] = [];
    // vertex_ai uses the same Google provider in agents_platform (google.generativeai supports both key types)
    const platformProvider = provider === 'vertex_ai' ? 'google' : provider;
    await Promise.all(listData.items.map(async (agent) => {
      const patchBody: Record<string, string> = { model_provider: platformProvider, model_version: model };
      if (apiKey) patchBody.api_key = apiKey;
      const patchRes = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) {
        const body = await patchRes.text();
        errors.push(`${agent.role}: ${patchRes.status} ${body.slice(0, 100)}`);
      }
    }));
    if (errors.length > 0) {
      return { synced: false, syncError: errors.join('; ') };
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, syncError: String(err) };
  }
}

/**
 * Push a prompt to agents_platform via its REST API.
 * Returns { synced: true } on success or { synced: false, syncError } on failure.
 * Never throws — failure is non-blocking.
 */
async function syncPromptToAgentsPlatform(
  agentRole: string,
  promptContent: string,
  comment?: string,
): Promise<{ synced: boolean; syncError?: string }> {
  if (agentExecutionMode !== 'external') {
    return { synced: false, syncError: 'Not in external mode' };
  }
  try {
    // 1. Find the agent id by role
    const listRes = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/agents`);
    if (!listRes.ok) {
      return { synced: false, syncError: `agents_platform list failed: ${listRes.status}` };
    }
    const listData = await listRes.json() as { items: Array<{ id: number; role: string }> };
    const agent = listData.items.find((a) => a.role === agentRole);
    if (!agent) {
      return { synced: false, syncError: `Agent with role "${agentRole}" not found in agents_platform` };
    }

    // 2. Create new prompt version (auto-deactivates old one)
    const promptRes = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/agents/${agent.id}/prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: promptContent,
        format: 'text',
        comment: comment || 'Synced via admin settings',
      }),
    });
    if (!promptRes.ok) {
      const body = await promptRes.text();
      return { synced: false, syncError: `agents_platform prompt update failed: ${promptRes.status} ${body.slice(0, 200)}` };
    }
    return { synced: true };
  } catch (err) {
    return { synced: false, syncError: String(err) };
  }
}

app.get('/api/admin/agents/prompts', async (_req, res) => {
  const s = loadSettings();
  const defaults = listDefaultPrompts();
  const result: Record<string, { prompt: string; isCustom: boolean; syncedToAgentsPlatform?: boolean }> = {};

  // Fetch agents_platform prompt versions and content in external mode
  let platformActiveVersions: Record<string, number> = {};
  let platformPromptContent: Record<string, string> = {};
  if (agentExecutionMode === 'external') {
    try {
      const listRes = await fetch(`${AGENTS_PLATFORM_URL}/api/v1/agents`);
      if (listRes.ok) {
        const listData = await listRes.json() as { items: Array<{ role: string; active_prompt?: { version: number; content?: string | null } | null }> };
        for (const a of listData.items) {
          if (a.active_prompt?.version !== undefined) {
            platformActiveVersions[a.role] = a.active_prompt.version;
          }
          if (a.active_prompt?.content) {
            platformPromptContent[a.role] = a.active_prompt.content;
          }
        }
      }
    } catch {
      // non-blocking — omit syncedToAgentsPlatform field if platform unreachable
    }
  }

  for (const name of AGENTS.map((a) => a.name)) {
    const entry: { prompt: string; isCustom: boolean; syncedToAgentsPlatform?: boolean } = {
      prompt: s.agentPrompts[name] || platformPromptContent[name] || defaults[name] || defaults['__base__'],
      isCustom: Boolean(s.agentPrompts[name]),
    };
    if (agentExecutionMode === 'external') {
      entry.syncedToAgentsPlatform = name in platformActiveVersions;
    }
    result[name] = entry;
  }
  return res.json(result);
});

app.put('/api/admin/agents/:name/prompt', express.json(), async (req, res) => {
  const agentName = decodeURIComponent(req.params.name);
  const validAgents = AGENTS.map((a) => a.name);
  if (!validAgents.includes(agentName)) {
    return res.status(404).json({ error: `Unknown agent: ${agentName}` });
  }
  const { prompt } = req.body as { prompt?: string };
  if (typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt must be a string.' });
  }

  // Save locally first
  const s = loadSettings();
  s.agentPrompts[agentName] = prompt;
  saveSettings(s);

  // Sync to agents_platform (non-blocking on failure)
  const syncResult = await syncPromptToAgentsPlatform(agentName, prompt);
  return res.json({ ok: true, ...syncResult });
});

app.delete('/api/admin/agents/:name/prompt', async (req, res) => {
  const agentName = decodeURIComponent(req.params.name);
  const s = loadSettings();
  delete s.agentPrompts[agentName];
  saveSettings(s);

  // Sync the default/file prompt back to agents_platform
  const defaults = listDefaultPrompts();
  const defaultPrompt = defaults[agentName] || defaults['__base__'] || '';
  if (defaultPrompt) {
    const syncResult = await syncPromptToAgentsPlatform(agentName, defaultPrompt, 'Reset to default via admin settings');
    return res.json({ ok: true, prompt: defaultPromptFor(agentName), ...syncResult });
  }
  return res.json({ ok: true, prompt: defaultPromptFor(agentName), synced: false });
});

// React SPA Fallback Router
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(publicDir, 'index.html'));
});

// ── Global Express error handler ─────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[EXPRESS ERROR]', err.message, err.stack);
  if (res.headersSent) return;
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

_server = http.createServer(app);
_server.setTimeout(300_000);       // 5 min — covers long LLM runs
_server.keepAliveTimeout = 65_000; // slightly above AWS/proxy 60s
_server.headersTimeout = 66_000;   // must exceed keepAliveTimeout

_server.listen(port, '0.0.0.0', () => {
  console.log(`Master agent server running on port ${port}`);

  // Recovery: find apps stuck in 'analyzing' and re-dispatch agents in background
  setImmediate(async () => {
    try {
      const stuckApps = await prisma.application.findMany({
        where: { status: 'analyzing' },
        include: { agentRuns: true },
      });

      if (stuckApps.length === 0) return;
      console.log(`[STARTUP RECOVERY] Found ${stuckApps.length} stuck app(s) in 'analyzing' state — re-triggering.`);

      for (const app of stuckApps) {
        // Mark any pending runs as failed so dispatchAgents won't skip them
        const pendingRuns = app.agentRuns.filter((r: any) => r.status === 'pending');
        if (pendingRuns.length > 0) {
          await prisma.agentRun.updateMany({
            where: { id: { in: pendingRuns.map((r: any) => r.id) } },
            data: { status: 'failed', completedAt: new Date() },
          });
          console.log(`[STARTUP RECOVERY] Marked ${pendingRuns.length} pending run(s) as failed for app ${app.id.slice(0, 8)}`);
        }
        reevaluateAndAdvance(app.id, internalBaseUrl, publicBaseUrl).catch((err) => {
          console.error(`[STARTUP RECOVERY] reevaluateAndAdvance failed for ${app.id}:`, err);
        });
      }
    } catch (err) {
      console.error('[STARTUP RECOVERY] Error during stuck-app recovery:', err);
    }
  });
});
