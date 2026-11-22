import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { pool, db } from '../../db/client.js';
import { candidates, leads, notifications } from '../../db/schema.js';
import fs from 'fs';
import path from 'path';
import { PRIVATE_UPLOAD_ROOT } from '../../routes/upload.routes.js';
import { makePdf } from '../fixtures/pnlPdf.js';
import { resetTables } from './testDb.js';
import { startLiveServer, type LiveServer } from './liveServer.js';
import { APP_REQUEST_HEADER, APP_REQUEST_VALUE, SESSION_COOKIE } from '../../services/session.service.js';

// The bot attacks most common on websites today, aimed at KinderCore's public
// forms: spam floods (and tricks to dodge the limit), promo-code guessing,
// oversized junk, booby-trapped links for staff to click, and back-dated
// fake enquiries. Each test is an attack that must FAIL.

let server: LiveServer;
beforeAll(async () => {
  await resetTables(notifications, leads, candidates);
  server = await startLiveServer();
}, 120_000);
afterAll(async () => { await server?.close(); await pool.end(); });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(`${server.base}${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const nextYear = new Date().getFullYear() + 1;
const lead = (n: number) => ({ childName: `Bot Child ${n}`, parentPhone: `01200${String(n).padStart(5, '0')}`, childDob: '2022-01-01', enrolmentYear: nextYear });
const application = (extra: object = {}) => ({
  fullName: 'Bot Applicant', phone: '0120000000', dob: '1999-01-01', addressLocation: 'Puchong', commuteTime: 'UNDER_15',
  availableFrom: '2027-01-01', preferredStartDate: '2027-01-01', desiredPosition: 'Teacher', experienceRange: '1-2 years',
  qualification: 'Diploma', expectedSalary: 2500, salaryJustification: 'x', careerGoals: 'x', whyKindergartenTeacher: 'x', howDidYouKnow: 'Facebook',
  ...extra,
});
/** One IP for the whole flood, so the per-IP limit is what's being tested. */
const sameIp = { 'X-Forwarded-For': '198.51.100.7' };

describe('Bots — spam floods on the public forms', () => {
  it('a made-up session cookie doesn’t let a bot skip the enquiry form’s limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await post('/api/leads', lead(i), { ...sameIp, Cookie: `${SESSION_COOKIE}=not-a-real-session`, [APP_REQUEST_HEADER]: APP_REQUEST_VALUE })).status);
    expect(statuses).toContain(429);
  });

  it('a made-up “Bearer” token doesn’t let a bot skip the job form’s limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) statuses.push((await post('/api/candidates', application(), { 'X-Forwarded-For': '198.51.100.8', Authorization: 'Bearer junk' })).status);
    expect(statuses).toContain(429);
  });

  it('a bot can’t guess promo codes without limit', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((await fetch(`${server.base}/api/marketing-campaigns/check?code=GUESS${i}`, { headers: { 'X-Forwarded-For': '198.51.100.9' } })).status);
    expect(statuses).toContain(429);
  });
});

describe('Bots — junk and traps in what the forms store', () => {
  it('oversized text is refused, not stored (and never crashes the server)', async () => {
    const huge = 'A'.repeat(200_000);
    expect((await post('/api/candidates', application({ careerGoals: huge }), { 'X-Forwarded-For': '198.51.100.10' })).status).toBe(400);
    expect((await post('/api/candidates', application({ fullName: 'B'.repeat(300) }), { 'X-Forwarded-For': '198.51.100.10' })).status).toBe(400);
    expect((await post('/api/leads', { ...lead(900), notes: huge }, { 'X-Forwarded-For': '198.51.100.10' })).status).toBe(400);
    expect((await post('/api/leads', { ...lead(901), childName: 'C'.repeat(300) }, { 'X-Forwarded-For': '198.51.100.10' })).status).toBe(400);
  });

  it('a job application can’t plant a script or phishing link as its “resume” for HR to click', async () => {
    for (const resumeUrl of ['javascript:alert(document.cookie)', 'https://evil.example/login-to-view-resume', 'http://drive.google.com/file/d/1']) {
      const res = await post('/api/candidates', application({ resumeUrl }), { 'X-Forwarded-For': '198.51.100.11' });
      expect(res.status, resumeUrl).toBe(400);
    }
    const drive = await post('/api/candidates', application({ resumeUrl: 'https://drive.google.com/open?id=abc' }), { 'X-Forwarded-For': '198.51.100.11' });
    expect(drive.status).toBe(201);
  });

  it('a bot can’t back-date fake enquiries to hide them among old leads', async () => {
    const res = await post('/api/leads', { ...lead(950), submittedAt: '2020-01-01T00:00:00Z' }, { 'X-Forwarded-For': '198.51.100.12' });
    expect(res.status).toBe(201);
    const [row] = await db.select({ submittedAt: leads.submittedAt }).from(leads).where(eq(leads.childName, 'Bot Child 950'));
    expect(row.submittedAt.getFullYear()).toBe(new Date().getFullYear());
  });
});

describe('Bots — the real applicant still gets through', () => {
  it('a real applicant can still apply with full answers and attach a PDF resume', async () => {
    const answer = 'I love working with young children. '.repeat(25); // ~900 characters, near the form’s 1,000 cap
    const res = await post('/api/candidates', application({ careerGoals: answer, whyKindergartenTeacher: answer, salaryJustification: answer }), { 'X-Forwarded-For': '198.51.100.20' });
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    const form = new FormData();
    form.append('resume', new Blob([makePdf(['Curriculum vitae'])], { type: 'application/pdf' }), 'resume.pdf');
    const upload = await fetch(`${server.base}/api/candidates/${id}/resume`, { method: 'POST', body: form, headers: { 'X-Forwarded-For': '198.51.100.20' } });
    expect(upload.status).toBeLessThan(300);
    const [row] = await db.select({ resumePath: candidates.resumePath }).from(candidates).where(eq(candidates.id, id));
    expect(row.resumePath).toBeTruthy();
    // Leave no test file behind: remove this applicant's resume folder.
    fs.rmSync(path.dirname(path.resolve(PRIVATE_UPLOAD_ROOT, row.resumePath!)), { recursive: true, force: true });
  });
});
