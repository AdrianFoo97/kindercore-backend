import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db, pool } from '../../db/client.js';
import { aiRequests, operatingCostImports, userAuthRoles, users } from '../../db/schema.js';
import { useAiForTests } from '../../services/ai/run.js';
import { resetTables } from './testDb.js';
import { signIn, startLiveServer, type Caller, type LiveServer } from './liveServer.js';
import { PASSWORD, activeUser } from '../fixtures/users.js';
import { makePdf, SAMPLE_PNL_LINES, SAMPLE_PNL_READING } from '../fixtures/pnlPdf.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE } from '../../services/session.service.js';

// The live server's host (Hostinger) has a firewall that answers a PDF *file
// upload* with a bare 403 before it reaches the app, so the app sends the P&L
// as base64 inside JSON. Over real HTTP: that form reads the same, with the
// same checks, and nobody signed out can make the server read a big body.

const NOW = new Date('2026-01-01T00:00:00Z');
const FIN = { id: 'u-json-fin', email: 'json-fin@kindertech.test' };
const PDF = makePdf(SAMPLE_PNL_LINES);

let server: LiveServer;
let finance: Caller;

beforeAll(async () => {
  await resetTables(aiRequests, operatingCostImports, userAuthRoles, users);
  await db.insert(users).values(await activeUser({ id: FIN.id, email: FIN.email, name: 'Fina Finance', role: 'USER' }));
  await db.insert(userAuthRoles).values({ id: 'uar-json-fin', userId: FIN.id, authRoleId: 'builtin:ACCOUNTS_EXECUTIVE', createdAt: NOW });
  useAiForTests({ primary: { provider: 'fake', model: 'fake-1', runJson: async () => ({ data: SAMPLE_PNL_READING, usage: null }) } });
  server = await startLiveServer();
  finance = await signIn(server.base, FIN.email, PASSWORD);
}, 120_000);
afterAll(async () => { useAiForTests(null); await server?.close(); await pool.end(); });

const read = (body: unknown, who: Caller | null = finance) => fetch(`${server.base}/api/operating-cost/import/read`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', [APP_REQUEST_HEADER]: APP_REQUEST_VALUE, ...(who ? { cookie: who.cookie! } : {}) },
  body: JSON.stringify(body),
});

describe('Import P&L — the PDF sent as JSON (past the host’s firewall)', () => {
  it('reads a P&L sent as base64 JSON exactly like an uploaded file, with or without AI', async () => {
    const res = await read({ fileName: 'sep.pdf', pdfBase64: PDF.toString('base64') });
    expect(res.status).toBe(200);
    const preview = await res.json() as { fileName: string; lines: unknown[]; hasText: boolean };
    expect(preview).toMatchObject({ fileName: 'sep.pdf', hasText: true });
    expect(preview.lines.length).toBeGreaterThan(0);
    const withoutAi = await read({ fileName: 'sep.pdf', pdfBase64: PDF.toString('base64'), withoutAi: true });
    expect(withoutAi.status).toBe(200);
    expect(await withoutAi.json()).toMatchObject({ provider: 'none' });
  });

  it('refuses a non-PDF or a missing file in the JSON form too', async () => {
    const notPdf = await read({ pdfBase64: Buffer.from('<?php system($_GET["c"]); ?>').toString('base64') });
    expect(notPdf.status).toBe(400);
    expect(await notPdf.json()).toMatchObject({ message: 'That file isn’t a PDF.' });
    expect((await read({ fileName: 'x.pdf' })).status).toBe(400);
  });

  it('never reads a big JSON body for someone not signed in', async () => {
    const res = await read({ pdfBase64: 'A'.repeat(5 * 1024 * 1024) }, null);
    expect(res.status).toBe(401);
  });
});
