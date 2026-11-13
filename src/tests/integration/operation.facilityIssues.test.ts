import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { db, pool } from '../../db/client.js';
import { facilityIssues, users } from '../../db/schema.js';
import {
  createFacilityIssue, getFacilityAttachment, listFacilityIssues, listMyFacilityIssues, updateFacilityIssueStatus,
} from '../../controllers/facility-issues.controller.js';
import { FACILITY_ATTACHMENTS_DIR } from '../../services/facilityAttachments.service.js';
import { resetTables } from './testDb.js';
import { reqWith, res } from './http.js';
import { activeUser } from '../fixtures/users.js';

// Facility issues (Operation → Facilities): any staff member reports
// something broken, facility managers move it Open → In progress → Resolved.
// Real handlers, test DB.

const TEACHER = { id: 'user-teacher', email: 'tina@kindertech.test', role: 'USER', teacherId: 't-1' };
const OTHER = { id: 'user-other', email: 'omar@kindertech.test', role: 'USER', teacherId: 't-2' };
const MANAGER = { id: 'user-admin', email: 'admin@kindertech.test', role: 'ADMIN', teacherId: null };

beforeEach(async () => {
  await resetTables(facilityIssues, users);
  await db.insert(users).values([
    await activeUser({ id: TEACHER.id, email: TEACHER.email, name: 'Tina Teacher', role: 'USER' }),
    await activeUser({ id: OTHER.id, email: OTHER.email, name: 'Omar Other', role: 'USER' }),
    await activeUser({ id: MANAGER.id, email: MANAGER.email, name: 'Ada Admin' }),
  ]);
});
afterAll(async () => {
  for (const f of written) fs.rmSync(f, { force: true });
  await pool.end();
});
const written: string[] = [];

const valid = () => ({ title: 'Toilet door won’t lock', category: 'DOOR_WINDOW', location: 'Level 1 toilet' });

const MB = 1024 * 1024;

/** A file as multer would leave it: written into the attachments folder. Contents are tiny; `size` is what multer reports. */
function upload(originalname: string, mimetype: string, size: number) {
  const filename = `${randomUUID()}${path.extname(originalname)}`;
  const filePath = path.join(FACILITY_ATTACHMENTS_DIR, filename);
  fs.writeFileSync(filePath, 'test');
  written.push(filePath);
  return { filename, path: filePath, originalname, mimetype, size } as Express.Multer.File;
}

/** res() plus the sendFile / setHeader a file download uses. */
function fileRes() {
  const r = res() as ReturnType<typeof res> & { sentFile?: string };
  (r as any).setHeader = () => r;
  (r as any).sendFile = (p: string) => { r.sentFile = p; };
  return r;
}

const report = async (body: object, user = TEACHER, files: Express.Multer.File[] = [upload('photo.jpg', 'image/jpeg', 1024)]) => {
  const r = res();
  const rq = reqWith({ body, user });
  (rq as any).files = files;
  await createFacilityIssue(rq, r);
  return r;
};
const move = async (id: string, body: object, user = MANAGER) => {
  const r = res();
  await updateFacilityIssueStatus(reqWith({ body, params: { id }, user }), r);
  return r;
};
const mine = async (user: typeof TEACHER) => {
  const r = res();
  await listMyFacilityIssues(reqWith({ user }), r);
  return r.body as { id: string }[];
};

describe('Operation — facility issues', () => {
  it('files a report as Open, reported by whoever is signed in', async () => {
    const r = await report({ ...valid(), urgency: 'URGENT', description: 'Kids can walk in.' });
    expect(r.statusCode).toBe(201);
    expect(r.body).toMatchObject({
      title: 'Toilet door won’t lock', category: 'DOOR_WINDOW', urgency: 'URGENT', status: 'OPEN',
      reportedByUserId: TEACHER.id, reportedByName: 'Tina Teacher', description: 'Kids can walk in.',
    });
  });

  it('needs a title, a kind of problem, a location and a photo or video', async () => {
    expect((await report(valid(), TEACHER, [])).body).toMatchObject({ message: 'Add a photo or video of the problem' });
    expect((await report({ ...valid(), title: '  ' })).statusCode).toBe(400);
    expect((await report({ ...valid(), category: 'ROOF' })).statusCode).toBe(400);
    expect((await report({ ...valid(), location: '' })).statusCode).toBe(400);
    expect(await db.select().from(facilityIssues)).toHaveLength(0);
  });

  it('shows each person only the issues they reported; managers see them all', async () => {
    await report(valid(), TEACHER);
    await report({ ...valid(), title: 'Tap dripping' }, OTHER);
    expect(await mine(TEACHER)).toHaveLength(1);
    const all = res();
    await listFacilityIssues(reqWith({ user: MANAGER }), all);
    expect(all.body).toHaveLength(2);
  });

  it('moves Open → In progress → Resolved, with a note the reporter sees', async () => {
    const { id } = (await report(valid())).body as { id: string };
    const started = await move(id, { status: 'IN_PROGRESS', note: 'Locksmith coming Thursday' });
    expect(started.body).toMatchObject({ status: 'IN_PROGRESS', statusNote: 'Locksmith coming Thursday', statusUpdatedByName: 'Ada Admin', resolvedAt: null });

    const done = await move(id, { status: 'RESOLVED', note: 'Lock replaced' });
    expect(done.body).toMatchObject({ status: 'RESOLVED', statusNote: 'Lock replaced' });
    expect((done.body as { resolvedAt: Date | null }).resolvedAt).not.toBeNull();
    expect(await mine(TEACHER)).toEqual([expect.objectContaining({ status: 'RESOLVED', statusNote: 'Lock replaced' })]);
  });

  it('can reopen a resolved issue, which clears the resolved time', async () => {
    const { id } = (await report(valid())).body as { id: string };
    await move(id, { status: 'RESOLVED' });
    const reopened = await move(id, { status: 'OPEN', note: 'Broke again' });
    expect(reopened.body).toMatchObject({ status: 'OPEN', resolvedAt: null, statusNote: 'Broke again' });
  });

  it('keeps attached photos and videos with the report', async () => {
    const files = [upload('photo.jpg', 'image/jpeg', 2 * MB), upload('leak.mp4', 'video/mp4', 30 * MB)];
    const r = await report(valid(), TEACHER, files);
    expect(r.statusCode).toBe(201);
    expect(r.body.attachments).toEqual([
      { id: files[0].filename, kind: 'image', mime: 'image/jpeg', size: 2 * MB, name: 'photo.jpg' },
      { id: files[1].filename, kind: 'video', mime: 'video/mp4', size: 30 * MB, name: 'leak.mp4' },
    ]);
    expect(files.every(f => fs.existsSync(f.path))).toBe(true);
  });

  it('refuses an oversized photo or a refused report, and deletes the uploaded files', async () => {
    const big = [upload('huge.jpg', 'image/jpeg', 12 * MB)];
    expect((await report(valid(), TEACHER, big)).statusCode).toBe(400);
    const orphan = [upload('door.jpg', 'image/jpeg', MB)];
    expect((await report({ ...valid(), title: '' }, TEACHER, orphan)).statusCode).toBe(400);
    await new Promise(r => setTimeout(r, 50)); // deletion is fire-and-forget
    expect([...big, ...orphan].some(f => fs.existsSync(f.path))).toBe(false);
    expect(await db.select().from(facilityIssues)).toHaveLength(0);
  });

  it('shows a photo only to the person who reported it and to facility managers', async () => {
    const files = [upload('photo.jpg', 'image/jpeg', MB)];
    const { id } = (await report(valid(), TEACHER, files)).body as { id: string };
    const fetchFile = async (user: typeof TEACHER, fileId = files[0].filename) => {
      const r = fileRes();
      await getFacilityAttachment(reqWith({ params: { id, fileId }, user }), r);
      return r;
    };
    expect((await fetchFile(TEACHER)).sentFile).toBe(files[0].path);
    expect((await fetchFile(MANAGER)).sentFile).toBe(files[0].path);
    expect((await fetchFile(OTHER)).statusCode).toBe(403);
    expect((await fetchFile(TEACHER, '../../etc/passwd')).statusCode).toBe(404);
  });

  it('refuses an update that changes nothing, and an unknown issue', async () => {
    const { id } = (await report(valid())).body as { id: string };
    expect((await move(id, { status: 'OPEN' })).statusCode).toBe(400);
    expect((await move('nope', { status: 'RESOLVED' })).statusCode).toBe(404);
  });
});
