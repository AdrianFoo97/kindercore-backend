import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../db/client.js';
import {
  pointsEarningRules, pointsRewardItems, pointsTransactions,
  rewardRedemptions, teacherRewardGoals, teachers, positions,
} from '../db/schema.js';

// ─────────────────────────────────────────────────────────────────────────────
// Points & Rewards. Points only ever move via a manual supervisor grant
// (inflow) or a reward redemption (outflow); there is no auto-earn.
// Earning rules are an admin-curated reference / grant-template list.
// ─────────────────────────────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);

// Balance is derived from the ledger — small per-teacher row counts make
// summing in JS fine and keeps a single source of truth.
async function computeBalance(teacherId: string): Promise<{
  current: number; earnedThisMonth: number; lifetimeEarned: number;
}> {
  const rows = await db.select().from(pointsTransactions)
    .where(eq(pointsTransactions.teacherId, teacherId));
  const month = todayISO().slice(0, 7); // YYYY-MM
  let current = 0, earnedThisMonth = 0, lifetimeEarned = 0;
  for (const r of rows) {
    current += r.delta;
    if (r.delta > 0) {
      lifetimeEarned += r.delta;
      if (r.date.slice(0, 7) === month) earnedThisMonth += r.delta;
    }
  }
  return { current, earnedThisMonth, lifetimeEarned };
}

async function ensureTeacher(teacherId: string, res: Response): Promise<boolean> {
  const [t] = await db.select().from(teachers).where(eq(teachers.id, teacherId));
  if (!t) { res.status(404).json({ message: 'Teacher not found' }); return false; }
  return true;
}

// ── Earning rules (admin global CRUD) ────────────────────────────────────────

export async function listRules(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(pointsEarningRules)
    .orderBy(desc(pointsEarningRules.createdAt));
  res.json(rows);
}

const ruleSchema = z.object({
  icon: z.string().min(1).max(40),
  label: z.string().min(1).max(191),
  description: z.string().max(2000).nullable().optional(),
  amount: z.number().int(),
  category: z.string().min(1).max(20).optional(),
  active: z.boolean().optional(),
});

export async function createRule(req: Request, res: Response): Promise<void> {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(pointsEarningRules).values({
    id,
    icon: parsed.data.icon,
    label: parsed.data.label,
    description: parsed.data.description ?? null,
    amount: parsed.data.amount,
    category: parsed.data.category ?? 'other',
    active: parsed.data.active ?? true,
    createdAt: now,
    updatedAt: now,
  });
  const [created] = await db.select().from(pointsEarningRules).where(eq(pointsEarningRules.id, id));
  res.status(201).json(created);
}

export async function updateRule(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = ruleSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(pointsEarningRules).where(eq(pointsEarningRules.id, id));
  if (!existing) { res.status(404).json({ message: 'Rule not found' }); return; }
  await db.update(pointsEarningRules).set({
    ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    ...(parsed.data.description !== undefined ? { description: parsed.data.description ?? null } : {}),
    ...(parsed.data.amount !== undefined ? { amount: parsed.data.amount } : {}),
    ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    updatedAt: new Date(),
  }).where(eq(pointsEarningRules.id, id));
  const [updated] = await db.select().from(pointsEarningRules).where(eq(pointsEarningRules.id, id));
  res.json(updated);
}

export async function deleteRule(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await db.delete(pointsEarningRules).where(eq(pointsEarningRules.id, id));
  res.json({ ok: true });
}

// ── Reward catalog (admin global CRUD) ───────────────────────────────────────

export async function listRewards(_req: Request, res: Response): Promise<void> {
  const rows = await db.select().from(pointsRewardItems)
    .orderBy(desc(pointsRewardItems.createdAt));
  res.json(rows);
}

const rewardSchema = z.object({
  icon: z.string().min(1).max(40),
  label: z.string().min(1).max(191),
  sub: z.string().max(191).nullable().optional(),
  cost: z.number().int().min(0),
  stock: z.enum(['in', 'limited', 'out']).optional(),
  category: z.string().min(1).max(20).optional(),
  active: z.boolean().optional(),
});

export async function createReward(req: Request, res: Response): Promise<void> {
  const parsed = rewardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(pointsRewardItems).values({
    id,
    icon: parsed.data.icon,
    label: parsed.data.label,
    sub: parsed.data.sub ?? null,
    cost: parsed.data.cost,
    stock: parsed.data.stock ?? 'in',
    category: parsed.data.category ?? 'other',
    active: parsed.data.active ?? true,
    createdAt: now,
    updatedAt: now,
  });
  const [created] = await db.select().from(pointsRewardItems).where(eq(pointsRewardItems.id, id));
  res.status(201).json(created);
}

export async function updateReward(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = rewardSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(pointsRewardItems).where(eq(pointsRewardItems.id, id));
  if (!existing) { res.status(404).json({ message: 'Reward not found' }); return; }
  await db.update(pointsRewardItems).set({
    ...(parsed.data.icon !== undefined ? { icon: parsed.data.icon } : {}),
    ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
    ...(parsed.data.sub !== undefined ? { sub: parsed.data.sub ?? null } : {}),
    ...(parsed.data.cost !== undefined ? { cost: parsed.data.cost } : {}),
    ...(parsed.data.stock !== undefined ? { stock: parsed.data.stock } : {}),
    ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
    ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    updatedAt: new Date(),
  }).where(eq(pointsRewardItems.id, id));
  const [updated] = await db.select().from(pointsRewardItems).where(eq(pointsRewardItems.id, id));
  res.json(updated);
}

export async function deleteReward(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  await db.delete(pointsRewardItems).where(eq(pointsRewardItems.id, id));
  res.json({ ok: true });
}

// ── Monthly standings — the recognition surface for points earned. ──────────
// Resets every calendar month. No money / no perks attached: positions are
// for social motivation only. Returns full ordering so non-top-3 teachers
// can see their movement (the real motivational lever).
export async function getStandings(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const period: 'current' | 'previous' =
    req.query.period === 'previous' ? 'previous' : 'current';

  // Calendar-month windows (local server time — same convention as the
  // existing `earnedThisMonth` balance, so the two never disagree).
  const now = new Date();
  const baseY = now.getFullYear();
  const baseM = now.getMonth();
  const targetY = period === 'current' ? baseY : (baseM === 0 ? baseY - 1 : baseY);
  const targetM = period === 'current' ? baseM : (baseM === 0 ? 11 : baseM - 1);
  const compareY = targetM === 0 ? targetY - 1 : targetY;
  const compareM = targetM === 0 ? 11 : targetM - 1;
  const ym = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const targetYM = ym(targetY, targetM);
  const compareYM = ym(compareY, compareM);
  const targetStart = new Date(targetY, targetM, 1);
  const targetEndEx = new Date(targetY, targetM + 1, 1);
  const targetEnd   = new Date(targetY, targetM + 1, 0);

  // One pass over the ledger; counts are small per school.
  const txs = await db.select().from(pointsTransactions);
  const sumFor = (yyyymm: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (const t of txs) {
      if (t.kind !== 'earned') continue;
      if (t.date.slice(0, 7) !== yyyymm) continue;
      out.set(t.teacherId, (out.get(t.teacherId) ?? 0) + t.delta);
    }
    return out;
  };
  const targetSums = sumFor(targetYM);
  const compareSums = sumFor(compareYM);

  // Visible universe — only career-path teachers at the entry tiers
  // (titleWeight 1, 2, 3 + inCareerProgression). Keeps the competition
  // fair: senior/management roles aren't in the same race as juniors,
  // and non-progression positions (e.g. STAFF) sit outside the ladder.
  // Resigned teachers vanish — they're no longer competing.
  const [allTeachers, allPositions] = await Promise.all([
    db.select().from(teachers),
    db.select().from(positions),
  ]);
  const eligiblePositionIds = new Set(
    allPositions
      .filter(p => p.inCareerProgression && [1, 2, 3].includes(p.titleWeight))
      .map(p => p.positionId),
  );
  const visible = allTeachers.filter(t =>
    (!t.resignedAt || new Date(t.resignedAt) >= targetStart)
    && t.positionId !== null
    && eligiblePositionIds.has(t.positionId),
  );

  // Sort by pts desc, with name as a deterministic tiebreaker (matters
  // mostly at the 0-pts tail of the standings).
  const sortPts = (pts: Map<string, number>) =>
    [...visible]
      .map(t => ({ t, pts: pts.get(t.id) ?? 0 }))
      .sort((a, b) => b.pts - a.pts || a.t.name.localeCompare(b.t.name));

  const ranked = sortPts(targetSums);
  const prevRanked = sortPts(compareSums);
  const prevRankByTeacher = new Map<string, number>();
  prevRanked.forEach((r, i) => prevRankByTeacher.set(r.t.id, i + 1));

  // A teacher is "new this period" when they were created within the
  // target month — they have no prev-month rank to compare against.
  const isNewThisPeriod = (t: typeof visible[0]) => {
    if (!t.createdAt) return false;
    const c = new Date(t.createdAt);
    return c >= targetStart && c < targetEndEx;
  };

  const rows = ranked.map((r, i) => {
    const rank = i + 1;
    const isNew = isNewThisPeriod(r.t);
    const prevRank = isNew ? null : (prevRankByTeacher.get(r.t.id) ?? null);
    const delta = prevRank !== null ? prevRank - rank : null;
    const ptsToAbove = i === 0 ? 0 : Math.max(0, ranked[i - 1].pts - r.pts);
    return {
      teacherId: r.t.id,
      displayName: r.t.name,
      color: r.t.color,
      pts: r.pts,
      rank, prevRank, delta, ptsToAbove,
      isMe: r.t.id === teacherId,
    };
  });

  const sumValues = (m: Map<string, number>) =>
    [...m.values()].reduce((s, v) => s + v, 0);
  const teamTotal = sumValues(targetSums);
  const teamPrev  = sumValues(compareSums);

  // Biggest climbers — positive rank delta only. The equaliser tile:
  // recognises the teachers who pushed hardest, not just the leaders.
  const climbers = rows
    .filter(r => (r.delta ?? 0) > 0)
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0) || a.rank - b.rank)
    .slice(0, 3)
    .map(r => ({ teacherId: r.teacherId, displayName: r.displayName, delta: r.delta as number }));

  const monthLabel = targetStart.toLocaleString('en-MY', { month: 'long', year: 'numeric' });

  res.json({
    period: {
      start: targetStart.toISOString().slice(0, 10),
      end: targetEnd.toISOString().slice(0, 10),
      label: monthLabel,
      kind: period,
    },
    team: { totalPts: teamTotal, vsPrevious: teamTotal - teamPrev },
    rows,
    climbers,
  });
}

// ── Teacher: balance + goal ──────────────────────────────────────────────────

export async function getTeacherPoints(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const balance = await computeBalance(teacherId);
  const [goal] = await db.select().from(teacherRewardGoals)
    .where(eq(teacherRewardGoals.teacherId, teacherId));
  // pointsLastSeenAt drives the "new grants" banner on the Rewards
  // hub — earned transactions newer than this timestamp are "new".
  const [teacher] = await db.select({ pointsLastSeenAt: teachers.pointsLastSeenAt })
    .from(teachers).where(eq(teachers.id, teacherId));
  res.json({
    balance,
    goal: goal ? { rewardId: goal.rewardId, setAt: goal.setAt } : null,
    pointsLastSeenAt: teacher?.pointsLastSeenAt ?? null,
  });
}

// Acknowledge the points ledger — sets pointsLastSeenAt = now. The
// teacher's Rewards hub calls this when they tap "Got it" on the
// new-grants banner.
export async function markPointsSeen(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const now = new Date();
  await db.update(teachers)
    .set({ pointsLastSeenAt: now, updatedAt: now })
    .where(eq(teachers.id, teacherId));
  res.json({ pointsLastSeenAt: now });
}

export async function listTransactions(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const rows = await db.select().from(pointsTransactions)
    .where(eq(pointsTransactions.teacherId, teacherId))
    .orderBy(desc(pointsTransactions.date), desc(pointsTransactions.createdAt));
  res.json(rows);
}

// Manual supervisor grant / adjustment. `amount` may be negative for a
// correction. This is the only inflow path.
const grantSchema = z.object({
  amount: z.number().int().refine(n => n !== 0, 'Amount cannot be zero'),
  label: z.string().min(1).max(191),
  ruleId: z.string().max(36).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function grantPoints(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const { current } = await computeBalance(teacherId);
  const balanceAfter = current + parsed.data.amount;
  if (balanceAfter < 0) {
    res.status(400).json({ message: 'Adjustment would make the balance negative' });
    return;
  }
  const now = new Date();
  const id = randomUUID();
  await db.insert(pointsTransactions).values({
    id,
    teacherId,
    kind: 'earned',
    label: parsed.data.label,
    delta: parsed.data.amount,
    balanceAfter,
    date: todayISO(),
    ruleId: parsed.data.ruleId ?? null,
    redemptionId: null,
    note: parsed.data.note ?? null,
    createdBy: req.user?.email ?? null,
    createdAt: now,
  });
  const [created] = await db.select().from(pointsTransactions).where(eq(pointsTransactions.id, id));
  res.status(201).json(created);
}

// Walk a teacher's ledger in chronological order and rewrite each row's
// balanceAfter so the displayed running balance stays correct after
// an edit or delete. balanceAfter is a UI helper — the real balance is
// always derived from sum(delta) via computeBalance — but if we leave
// it stale, the per-row history reads as nonsense to HR and teachers.
async function recomputeBalanceAfter(teacherId: string): Promise<number> {
  const rows = await db.select().from(pointsTransactions)
    .where(eq(pointsTransactions.teacherId, teacherId))
    .orderBy(asc(pointsTransactions.date), asc(pointsTransactions.createdAt));
  let running = 0;
  for (const r of rows) {
    running += r.delta;
    if (r.balanceAfter !== running) {
      await db.update(pointsTransactions)
        .set({ balanceAfter: running })
        .where(eq(pointsTransactions.id, r.id));
    }
  }
  return running;
}

// Edit a manual grant (kind='earned'). Redemption-linked rows are
// rejected — those mirror the RewardRedemption record and should
// only change via the redemption flow.
const updateTxSchema = z.object({
  amount: z.number().int().refine(n => n !== 0, 'Amount cannot be zero').optional(),
  label: z.string().min(1).max(191).optional(),
  note: z.string().max(2000).nullable().optional(),
});

export async function updateTransaction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(pointsTransactions).where(eq(pointsTransactions.id, id));
  if (!existing) { res.status(404).json({ message: 'Transaction not found' }); return; }
  if (existing.redemptionId) {
    res.status(400).json({ message: 'Redemption transactions cannot be edited here.' });
    return;
  }

  const patch: Record<string, unknown> = {};
  if (parsed.data.amount !== undefined) patch.delta = parsed.data.amount;
  if (parsed.data.label !== undefined) patch.label = parsed.data.label;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;
  if (Object.keys(patch).length === 0) {
    res.json(existing);
    return;
  }

  // Simulate the new total before applying. If it would dip negative,
  // reject — the ledger must stay non-negative as a whole.
  if (parsed.data.amount !== undefined) {
    const all = await db.select().from(pointsTransactions)
      .where(eq(pointsTransactions.teacherId, existing.teacherId));
    const newTotal = all.reduce((sum, r) =>
      sum + (r.id === id ? parsed.data.amount! : r.delta), 0);
    if (newTotal < 0) {
      res.status(400).json({ message: 'This edit would take the balance below zero.' });
      return;
    }
  }

  await db.update(pointsTransactions).set(patch).where(eq(pointsTransactions.id, id));
  await recomputeBalanceAfter(existing.teacherId);
  const [updated] = await db.select().from(pointsTransactions).where(eq(pointsTransactions.id, id));
  res.json(updated);
}

// Delete a manual grant. Redemption-linked rows are rejected.
export async function deleteTransaction(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(pointsTransactions).where(eq(pointsTransactions.id, id));
  if (!existing) { res.status(404).json({ message: 'Transaction not found' }); return; }
  if (existing.redemptionId) {
    res.status(400).json({ message: 'Redemption transactions cannot be deleted here.' });
    return;
  }

  // Simulate the total without this row. Removing a positive grant
  // mustn't drive the running balance below zero overall.
  const all = await db.select().from(pointsTransactions)
    .where(eq(pointsTransactions.teacherId, existing.teacherId));
  const newTotal = all.reduce((sum, r) => r.id === id ? sum : sum + r.delta, 0);
  if (newTotal < 0) {
    res.status(400).json({ message: 'Removing this would take the balance below zero.' });
    return;
  }

  await db.delete(pointsTransactions).where(eq(pointsTransactions.id, id));
  await recomputeBalanceAfter(existing.teacherId);
  res.json({ ok: true });
}

// ── Teacher: rewards / redemptions ───────────────────────────────────────────

export async function listRedemptions(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const rows = await db.select().from(rewardRedemptions)
    .where(eq(rewardRedemptions.teacherId, teacherId))
    .orderBy(desc(rewardRedemptions.redeemedDate), desc(rewardRedemptions.createdAt));
  res.json(rows);
}

// Admin workbench — every redemption across all teachers, newest
// first, each carrying the teacher's name so HR can fulfil without a
// per-teacher drill-down.
export async function listAllRedemptions(_req: Request, res: Response): Promise<void> {
  const rows = await db.select({
    id: rewardRedemptions.id,
    teacherId: rewardRedemptions.teacherId,
    teacherName: teachers.name,
    rewardId: rewardRedemptions.rewardId,
    label: rewardRedemptions.label,
    icon: rewardRedemptions.icon,
    pointsSpent: rewardRedemptions.pointsSpent,
    status: rewardRedemptions.status,
    voucherCode: rewardRedemptions.voucherCode,
    redemptionCode: rewardRedemptions.redemptionCode,
    instructions: rewardRedemptions.instructions,
    redeemedDate: rewardRedemptions.redeemedDate,
  })
    .from(rewardRedemptions)
    .leftJoin(teachers, eq(rewardRedemptions.teacherId, teachers.id))
    .orderBy(desc(rewardRedemptions.redeemedDate), desc(rewardRedemptions.createdAt));
  res.json(rows);
}

// Lookup by internal id OR human redemption code (the teacher detail
// page may navigate with either).
export async function getRedemption(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [byId] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id));
  const row = byId
    ?? (await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.redemptionCode, id)))[0];
  if (!row) { res.status(404).json({ message: 'Redemption not found' }); return; }
  res.json(row);
}

const redeemSchema = z.object({ rewardId: z.string().min(1).max(36) });

export async function redeemReward(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [item] = await db.select().from(pointsRewardItems)
    .where(eq(pointsRewardItems.id, parsed.data.rewardId));
  if (!item || !item.active) { res.status(404).json({ message: 'Reward not available' }); return; }
  if (item.stock === 'out') { res.status(409).json({ message: 'Reward is out of stock' }); return; }
  const { current } = await computeBalance(teacherId);
  if (current < item.cost) { res.status(409).json({ message: 'Not enough points' }); return; }

  const now = new Date();
  const today = todayISO();
  const redemptionId = randomUUID();
  const isVoucher = /voucher|merch/i.test(item.label);
  const voucherCode = isVoucher
    ? `${item.label.split(' ')[0].toUpperCase()}-${redemptionId.replace(/-/g, '').slice(-7).toUpperCase()}`
    : null;
  const redemptionCode = `RDM-${today.replace(/-/g, '').slice(2)}-${redemptionId.slice(0, 4).toUpperCase()}`;

  await db.insert(rewardRedemptions).values({
    id: redemptionId,
    teacherId,
    rewardId: item.id,
    label: item.label,
    icon: item.icon,
    pointsSpent: item.cost,
    status: 'redeemed',
    voucherCode,
    redemptionCode,
    instructions: 'Submitted for approval. HR will follow up to issue or schedule this reward — check your email for next steps.',
    redeemedDate: today,
    createdAt: now,
    updatedAt: now,
  });

  const balanceAfter = current - item.cost;
  await db.insert(pointsTransactions).values({
    id: randomUUID(),
    teacherId,
    kind: 'redeemed',
    label: item.label,
    delta: -item.cost,
    balanceAfter,
    date: today,
    ruleId: null,
    redemptionId,
    note: null,
    createdBy: req.user?.email ?? null,
    createdAt: now,
  });

  const [created] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, redemptionId));
  res.status(201).json(created);
}

// Admin fulfilment — move status forward, attach voucher / instructions.
const fulfilSchema = z.object({
  status: z.enum(['redeemed', 'pending', 'delivered']).optional(),
  voucherCode: z.string().max(60).nullable().optional(),
  instructions: z.string().max(2000).nullable().optional(),
});

export async function updateRedemption(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = fulfilSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [existing] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id));
  if (!existing) { res.status(404).json({ message: 'Redemption not found' }); return; }
  await db.update(rewardRedemptions).set({
    ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {}),
    ...(parsed.data.voucherCode !== undefined ? { voucherCode: parsed.data.voucherCode ?? null } : {}),
    ...(parsed.data.instructions !== undefined ? { instructions: parsed.data.instructions ?? null } : {}),
    updatedAt: new Date(),
  }).where(eq(rewardRedemptions.id, id));
  const [updated] = await db.select().from(rewardRedemptions).where(eq(rewardRedemptions.id, id));
  res.json(updated);
}

// ── Teacher: goal ────────────────────────────────────────────────────────────

const goalSchema = z.object({ rewardId: z.string().min(1).max(36) });

export async function setGoal(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  if (!(await ensureTeacher(teacherId, res))) return;
  const parsed = goalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }
  const [item] = await db.select().from(pointsRewardItems)
    .where(eq(pointsRewardItems.id, parsed.data.rewardId));
  if (!item || !item.active) { res.status(404).json({ message: 'Reward not available' }); return; }

  const now = new Date();
  const setAt = todayISO();
  const [existing] = await db.select().from(teacherRewardGoals)
    .where(eq(teacherRewardGoals.teacherId, teacherId));
  if (existing) {
    await db.update(teacherRewardGoals)
      .set({ rewardId: parsed.data.rewardId, setAt, updatedAt: now })
      .where(eq(teacherRewardGoals.teacherId, teacherId));
  } else {
    await db.insert(teacherRewardGoals).values({
      teacherId, rewardId: parsed.data.rewardId, setAt, updatedAt: now,
    });
  }
  res.json({ rewardId: parsed.data.rewardId, setAt });
}

export async function clearGoal(req: Request, res: Response): Promise<void> {
  const { teacherId } = req.params;
  await db.delete(teacherRewardGoals).where(eq(teacherRewardGoals.teacherId, teacherId));
  res.json({ ok: true });
}
