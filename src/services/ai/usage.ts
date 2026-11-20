import { randomUUID } from 'crypto';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { aiRequests } from '../../db/schema.js';
import type { AiUsage } from './types.js';

// Every AI request, from every feature — for the monthly limit, usage in
// Settings → AI, and comparing providers (how often each passes first time).

export interface AiRequestRecord {
  feature: string;
  provider: string;
  model: string;
  userId: string;
  /** The answer fitted the feature's format. */
  ok: boolean;
  /** It also passed the feature's own checks. */
  passedChecks: boolean;
  usage: AiUsage | null;
}

export async function recordAiRequest(r: AiRequestRecord): Promise<void> {
  await db.insert(aiRequests).values({
    id: randomUUID(), feature: r.feature, provider: r.provider, model: r.model, userId: r.userId, ok: r.ok, passedChecks: r.passedChecks,
    inputTokens: r.usage?.inputTokens ?? null, outputTokens: r.usage?.outputTokens ?? null, createdAt: new Date(),
  });
}

/** Start of this calendar month (server time). */
export const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

/** Requests to a provider this month, across every feature (the limit is per provider). */
export async function requestsThisMonth(provider: string, now = new Date()): Promise<number> {
  const [{ n }] = await db.select({ n: sql<number>`COUNT(*)` }).from(aiRequests)
    .where(and(eq(aiRequests.provider, provider), gte(aiRequests.createdAt, monthStart(now))));
  return Number(n);
}

/** This month's requests and tokens, by provider and by feature — shown in Settings → AI. */
export async function usageThisMonth(now = new Date()) {
  const rows = await db.select({
    feature: aiRequests.feature, provider: aiRequests.provider,
    requests: sql<number>`COUNT(*)`,
    inputTokens: sql<number>`COALESCE(SUM(${aiRequests.inputTokens}), 0)`,
    outputTokens: sql<number>`COALESCE(SUM(${aiRequests.outputTokens}), 0)`,
  }).from(aiRequests).where(gte(aiRequests.createdAt, monthStart(now))).groupBy(aiRequests.feature, aiRequests.provider);
  type Totals = { requests: number; inputTokens: number; outputTokens: number };
  const add = (map: Record<string, Totals>, key: string, r: (typeof rows)[number]) => {
    const t = map[key] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
    map[key] = { requests: t.requests + Number(r.requests), inputTokens: t.inputTokens + Number(r.inputTokens), outputTokens: t.outputTokens + Number(r.outputTokens) };
  };
  const byProvider: Record<string, Totals> = {};
  const byFeature: Record<string, Totals> = {};
  for (const r of rows) { add(byProvider, r.provider, r); add(byFeature, r.feature, r); }
  return { byProvider, byFeature };
}

/**
 * How each provider + model did for each feature THIS calendar month (it
 * starts again on the 1st): requests, answers in the right format, answers
 * that also passed the feature's checks, total tokens, last used.
 */
export async function providerStats(now = new Date()) {
  const since = monthStart(now);
  const rows = await db.select({
    feature: aiRequests.feature, provider: aiRequests.provider, model: aiRequests.model,
    requests: sql<number>`COUNT(*)`,
    answered: sql<number>`SUM(${aiRequests.ok})`,
    passed: sql<number>`SUM(${aiRequests.passedChecks})`,
    inputTokens: sql<number>`COALESCE(SUM(${aiRequests.inputTokens}), 0)`,
    outputTokens: sql<number>`COALESCE(SUM(${aiRequests.outputTokens}), 0)`,
    lastAt: sql<Date>`MAX(${aiRequests.createdAt})`,
  }).from(aiRequests).where(gte(aiRequests.createdAt, since))
    .groupBy(aiRequests.feature, aiRequests.provider, aiRequests.model);
  return rows.map(r => ({
    feature: r.feature, provider: r.provider, model: r.model,
    requests: Number(r.requests), answered: Number(r.answered), passed: Number(r.passed),
    inputTokens: Number(r.inputTokens), outputTokens: Number(r.outputTokens),
    lastAt: r.lastAt,
  }));
}
