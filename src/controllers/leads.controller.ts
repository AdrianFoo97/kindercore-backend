import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { google } from 'googleapis';
import { and, asc, desc, eq, gte, inArray, lt, ne, or, sql } from 'drizzle-orm';
import type { RowDataPacket } from 'mysql2';
import { db, pool } from '../db/client.js';
import { googleConnections, leads, packages, students, systemSettings } from '../db/schema.js';
import { createLeadSchema, updateLeadSchema } from '../validators/lead.validator.js';

const GOOGLE_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSf6qYfHqYruNIVFou3g9_ug_YBWBHdv0F98u1xQxo327TSZNQ/formResponse';

/** Map internal values to Google Form option text */
const RELATIONSHIP_MAP: Record<string, string> = {
  'Mother': 'Mother 母亲',
  'Father': 'Father 父亲',
};
const PROGRAMME_MAP: Record<string, string> = {
  'Core': '普通课程 Basic programme (8.30am - 12.30pm)',
  'Core+Music': '半天制课程 Half day programme (8.30am - 2.30pm)',
  'FullDay': '全天制课程 Full day programme (8.30am - 5.30pm)',
};
const TIME_MAP: Record<string, string> = {
  'Tuesday 3:30pm-4:30pm': 'Tuesday 星期二 (3.30pm - 4.30pm)',
  'Thursday 3:30pm-4:30pm': 'Thursday 星期四 (3.30am - 4.30pm)',
  'Saturday 1:00pm-2:00pm': 'Saturday 星期六 (1.00pm - 2.00pm)',
  'Saturday 2:30pm-3:30pm': 'Saturday 星期六 (2.30pm -3.30pm)',
};
const TRANSPORT_MAP: Record<string, string> = {
  'true': 'Yes 需要',
  'false': 'No 不需要',
};
const SOURCE_MAP: Record<string, string> = {
  'Facebook': 'Facebook',
  'Friend Referral': 'Friend 通过朋友介绍',
  '小红书': '小红书',
  'Instagram': 'Instagram',
  'Pass By': 'Pass By 驾车经过',
  'Google': 'Google',
  'Sibling': 'Sibling Already Studying Here 其他孩子在就读',
  'Billboard': 'Billboard 广告牌',
};

/** Submit lead data to Google Forms as a backup */
async function submitToGoogleForm(data: {
  childName: string; parentPhone: string; childDob: string; enrolmentYear: number;
  relationship?: string; programme?: string; preferredAppointmentTime?: string;
  addressLocation?: string; needsTransport?: boolean | null; howDidYouKnow?: string;
}): Promise<void> {
  try {
    const params = new URLSearchParams();
    params.append('entry.1313190026', data.childName);
    params.append('entry.1010235097', data.parentPhone);
    params.append('entry.589253048', data.childDob);
    params.append('entry.615484233', String(data.enrolmentYear));
    if (data.relationship) {
      const mapped = RELATIONSHIP_MAP[data.relationship];
      params.append('entry.1585350310', mapped || `__other_option__`);
      if (!mapped) params.append('entry.1585350310.other_option_response', data.relationship);
    }
    if (data.programme) params.append('entry.604826077', PROGRAMME_MAP[data.programme] || data.programme);
    if (data.preferredAppointmentTime) {
      for (const time of data.preferredAppointmentTime.split(',')) {
        const t = time.trim();
        params.append('entry.1521018061', TIME_MAP[t] || t);
      }
    }
    if (data.addressLocation) {
      const addr = data.addressLocation;
      const knownAddresses = ['Bukit Indah', 'Taman Perling', 'Nusa Bestari', 'Horizon Hills', 'Medini', 'Eco Botanic', 'Iskandar Puteri'];
      if (knownAddresses.includes(addr)) {
        params.append('entry.945261551', addr);
      } else {
        params.append('entry.945261551', '__other_option__');
        params.append('entry.945261551.other_option_response', addr);
      }
    }
    if (data.needsTransport != null) params.append('entry.1920754796', TRANSPORT_MAP[String(data.needsTransport)] || 'No 不需要');
    if (data.howDidYouKnow) {
      const mapped = SOURCE_MAP[data.howDidYouKnow];
      if (mapped) {
        params.append('entry.306619081', mapped);
      } else {
        params.append('entry.306619081', '__other_option__');
        params.append('entry.306619081.other_option_response', data.howDidYouKnow);
      }
    }

    const resp = await fetch(GOOGLE_FORM_URL, {
      method: 'POST',
      body: params,
    });
    console.log('[Lead] Google Form submission:', resp.status, resp.statusText);
  } catch (err) {
    console.error('[Lead] Google Form submission failed:', err);
  }
}

/** Score lead temperature based on which CTA the user clicked */
function getLeadTemperature(ctaSource?: string): 'COOL' | 'WARM' | 'HOT' {
  switch (ctaSource) {
    case 'hero': return 'COOL';
    case 'story': return 'WARM';
    case 'methods': return 'WARM';
    case 'final': return 'HOT';
    default: return 'COOL';
  }
}

/** Normalize a name: split camelCase, title-case each word */
function normalizeName(name: string): string {
  // Insert space before uppercase letters that follow a lowercase letter (e.g. AdamLevine → Adam Levine)
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Title-case each word
  return spaced
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export async function getLeadById(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }
  res.json(lead);
}

export async function createLead(req: Request, res: Response): Promise<void> {
  const parsed = createLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const { childName, parentPhone, childDob, enrolmentYear, company,
          relationship, programme, preferredAppointmentTime, addressLocation,
          needsTransport, howDidYouKnow, ctaSource, submittedAt: submittedAtRaw } = parsed.data;
  if (company) {
    res.status(400).json({ message: 'Bad request' });
    return;
  }

  console.log('[Lead] New submission received:', JSON.stringify(parsed.data, null, 2));

  const id = randomUUID();
  const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : new Date();
  await db.insert(leads).values({
    id, childName: normalizeName(childName), parentPhone, childDob: new Date(childDob), enrolmentYear,
    relationship, programme, preferredAppointmentTime, addressLocation,
    needsTransport, howDidYouKnow, ctaSource, leadTemperature: getLeadTemperature(ctaSource), submittedAt,
  });
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);

  // Fire-and-forget: submit to Google Forms as backup
  submitToGoogleForm({
    childName, parentPhone, childDob, enrolmentYear,
    relationship, programme, preferredAppointmentTime, addressLocation,
    needsTransport, howDidYouKnow,
  });

  res.status(201).json(lead);
}

export async function resetAllLeads(_req: Request, res: Response): Promise<void> {
  await db.delete(students);
  await db.delete(leads);
  res.json({ message: 'All leads deleted' });
}

export async function seedDummyLeads(_req: Request, res: Response): Promise<void> {
  type LeadStatus = 'NEW' | 'CONTACTED' | 'APPOINTMENT_BOOKED' | 'FOLLOW_UP' | 'ENROLLED' | 'LOST' | 'REJECTED';
  type DummyLead = {
    id: string; childName: string; parentPhone: string; childDob: Date; enrolmentYear: number;
    status: LeadStatus; submittedAt: Date; statusChangedAt?: Date; howDidYouKnow?: string; programme?: string;
    appointmentStart?: Date; appointmentEnd?: Date; appointmentIsPlaceholder?: boolean;
    notes?: string; lostReason?: string; relationship?: string;
  };

  const now = new Date();
  const ago = (days: number) => new Date(now.getTime() - days * 86400000);
  const ahead = (days: number) => new Date(now.getTime() + days * 86400000);
  const dob = (y: number, m: number, d: number) => new Date(y, m - 1, d);
  const h1 = 60 * 60000;

  const rows: DummyLead[] = [
    // Pipeline leads
    { id: randomUUID(), childName: 'Aiden Lim',    parentPhone: '0123456001', childDob: dob(2021, 3, 15), enrolmentYear: 2026, status: 'NEW',                submittedAt: ago(0),   howDidYouKnow: 'Facebook',        programme: 'Playgroup',    relationship: 'Mother' },
    { id: randomUUID(), childName: 'Sophia Tan',   parentPhone: '0123456002', childDob: dob(2020, 7, 22), enrolmentYear: 2026, status: 'NEW',                submittedAt: ago(2),   howDidYouKnow: 'Instagram',       programme: 'Nursery',      relationship: 'Father' },
    { id: randomUUID(), childName: 'Ethan Wong',   parentPhone: '0123456003', childDob: dob(2020, 11, 8), enrolmentYear: 2026, status: 'NEW',                submittedAt: ago(5),   howDidYouKnow: 'Friend Referral', programme: 'Nursery',      relationship: 'Mother' },
    { id: randomUUID(), childName: 'Mia Ng',       parentPhone: '0123456004', childDob: dob(2021, 5, 30), enrolmentYear: 2026, status: 'CONTACTED',          submittedAt: ago(4),   statusChangedAt: ago(3),  howDidYouKnow: 'Google',          programme: 'Playgroup',    relationship: 'Father',    appointmentStart: ahead(3), appointmentEnd: new Date(ahead(3).getTime() + h1), appointmentIsPlaceholder: true },
    { id: randomUUID(), childName: 'Lucas Chua',   parentPhone: '0123456005', childDob: dob(2020, 9, 14), enrolmentYear: 2026, status: 'CONTACTED',          submittedAt: ago(6),   statusChangedAt: ago(5),  howDidYouKnow: 'Facebook',        programme: 'Nursery',      relationship: 'Mother',    appointmentStart: ahead(1), appointmentEnd: new Date(ahead(1).getTime() + h1), appointmentIsPlaceholder: true },
    { id: randomUUID(), childName: 'Ella Ooi',     parentPhone: '0123456006', childDob: dob(2021, 1, 18), enrolmentYear: 2026, status: 'CONTACTED',          submittedAt: ago(8),   statusChangedAt: ago(6),  howDidYouKnow: 'Instagram',       programme: 'Playgroup',    relationship: 'Guardian',  appointmentStart: ahead(7), appointmentEnd: new Date(ahead(7).getTime() + h1), appointmentIsPlaceholder: true },
    { id: randomUUID(), childName: 'Noah Yap',     parentPhone: '0123456007', childDob: dob(2020, 4, 25), enrolmentYear: 2026, status: 'APPOINTMENT_BOOKED', submittedAt: ago(10),  statusChangedAt: ago(7),  howDidYouKnow: 'Friend Referral', programme: 'Kindergarten', relationship: 'Father',    appointmentStart: ahead(1), appointmentEnd: new Date(ahead(1).getTime() + h1), appointmentIsPlaceholder: false },
    { id: randomUUID(), childName: 'Chloe Lee',    parentPhone: '0123456008', childDob: dob(2020, 6, 12), enrolmentYear: 2026, status: 'FOLLOW_UP',          submittedAt: ago(14),  statusChangedAt: ago(4),  howDidYouKnow: 'Google',          programme: 'Kindergarten', relationship: 'Mother',    appointmentStart: ago(3),  appointmentEnd: new Date(ago(3).getTime() + h1), appointmentIsPlaceholder: false, notes: 'Parents want to visit again before deciding' },
    // Enrolled leads (active students — currently attending)
    { id: randomUUID(), childName: 'Oliver Loh',   parentPhone: '0123456009', childDob: dob(2020, 2, 5),  enrolmentYear: 2025, status: 'ENROLLED', submittedAt: ago(400), statusChangedAt: ago(370), howDidYouKnow: 'Google',          programme: 'Kindergarten', relationship: 'Mother' },
    { id: randomUUID(), childName: 'Isabella Chan', parentPhone: '0123456011', childDob: dob(2021, 4, 10), enrolmentYear: 2025, status: 'ENROLLED', submittedAt: ago(380), statusChangedAt: ago(350), howDidYouKnow: 'Facebook',        programme: 'Nursery',      relationship: 'Father' },
    { id: randomUUID(), childName: 'Ryan Lim',     parentPhone: '0123456012', childDob: dob(2022, 6, 20), enrolmentYear: 2025, status: 'ENROLLED', submittedAt: ago(365), statusChangedAt: ago(340), howDidYouKnow: 'Instagram',       programme: 'Playgroup',    relationship: 'Mother' },
    { id: randomUUID(), childName: 'Natalie Goh',  parentPhone: '0123456013', childDob: dob(2020, 9, 3),  enrolmentYear: 2025, status: 'ENROLLED', submittedAt: ago(420), statusChangedAt: ago(400), howDidYouKnow: 'Friend Referral', programme: 'Kindergarten', relationship: 'Father' },
    { id: randomUUID(), childName: 'Marcus Teo',   parentPhone: '0123456014', childDob: dob(2021, 11, 25), enrolmentYear: 2026, status: 'ENROLLED', submittedAt: ago(60),  statusChangedAt: ago(45),  howDidYouKnow: 'Google',          programme: 'Nursery',      relationship: 'Mother' },
    // Enrolled lead — upcoming enrollment (shows as "Enrolled" not "Active" on Students page)
    { id: randomUUID(), childName: 'Zoe Ng',       parentPhone: '0123456015', childDob: dob(2022, 1, 8),  enrolmentYear: 2026, status: 'ENROLLED', submittedAt: ago(20),  statusChangedAt: ago(10),  howDidYouKnow: 'Instagram',       programme: 'Playgroup',    relationship: 'Guardian' },
    // Lost
    { id: randomUUID(), childName: 'Emma Koh',     parentPhone: '0123456010', childDob: dob(2021, 8, 19), enrolmentYear: 2026, status: 'LOST',     submittedAt: ago(30),  statusChangedAt: ago(25), howDidYouKnow: 'Facebook',        programme: 'Nursery',      relationship: 'Mother', lostReason: 'Enrolled at another kindergarten' },
  ];

  await db.insert(leads).values(rows);

  // Create student records for all ENROLLED leads
  const enrolledRows = rows.filter(r => r.status === 'ENROLLED');
  let allPackages = await db.select().from(packages);

  // If no packages exist, seed dummy packages so students can be created
  if (allPackages.length === 0) {
    const dummyPackages = [
      { id: randomUUID(), year: now.getFullYear(), programme: 'Playgroup',    age: 4, name: 'Playgroup Basic',    price: 500, updatedAt: now },
      { id: randomUUID(), year: now.getFullYear(), programme: 'Nursery',      age: 5, name: 'Nursery Basic',      price: 600, updatedAt: now },
      { id: randomUUID(), year: now.getFullYear(), programme: 'Kindergarten', age: 6, name: 'Kindergarten Basic', price: 700, updatedAt: now },
    ];
    await db.insert(packages).values(dummyPackages);
    allPackages = await db.select().from(packages);
  }

  // Map packages by programme (pick first match per programme)
  const pkgByProgramme = new Map<string, typeof allPackages[number]>();
  for (const pkg of allPackages) {
    if (!pkgByProgramme.has(pkg.programme)) pkgByProgramme.set(pkg.programme, pkg);
  }
  const fallbackPkg = allPackages[0] ?? null;

  const studentRows = enrolledRows
    .map(lead => {
      const pkg = pkgByProgramme.get(lead.programme ?? '') ?? fallbackPkg;
      if (!pkg) return null;
      return {
        id: randomUUID(),
        leadId: lead.id,
        enrolmentYear: lead.enrolmentYear,
        enrolmentMonth: 1,
        packageId: pkg.id,
        enrolledAt: lead.statusChangedAt ?? lead.submittedAt,
        createdAt: lead.statusChangedAt ?? lead.submittedAt,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (studentRows.length > 0) {
    await db.insert(students).values(studentRows);
  }

  res.json({
    message: `${rows.length} dummy leads created, ${studentRows.length} student records created.`,
    count: rows.length,
    students: studentRows.length,
    skippedStudents: enrolledRows.length - studentRows.length,
    ...(enrolledRows.length > studentRows.length ? { note: 'Some students skipped — no matching packages found. Add packages first.' } : {}),
  });
}

export async function getLeadPhones(_req: Request, res: Response): Promise<void> {
  const rows = await db.select({ id: leads.id, parentPhone: leads.parentPhone, childName: leads.childName, submittedAt: leads.submittedAt }).from(leads);
  res.json(rows);
}

export async function getLeads(req: Request, res: Response): Promise<void> {
  const page = Math.max(1, parseInt((req.query.page as string) ?? '1') || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt((req.query.pageSize as string) ?? '20') || 20));
  const skip = (page - 1) * pageSize;

  const { status, sortBy, sortOrder, search, year } = req.query as Record<string, string | undefined>;
  const searchTerm = (search ?? '').trim();
  const yearFilter = year ? parseInt(year) : undefined;

  const validSortFields = ['submittedAt', 'childName', 'childDob', 'enrolmentYear', 'status'];
  const field = validSortFields.includes(sortBy ?? '') ? sortBy! : 'submittedAt';
  const order: 'asc' | 'desc' = sortOrder === 'asc' ? 'asc' : 'desc';
  const sortByStatus = field === 'status';

  // Build WHERE clause string for count + raw queries
  let whereStr: string;
  const whereParams: any[] = [];
  if (status === 'active') {
    whereStr = "deletedAt IS NULL AND status NOT IN ('ENROLLED', 'LOST', 'REJECTED')";
  } else if (status === 'inactive') {
    whereStr = "deletedAt IS NULL AND status IN ('ENROLLED', 'LOST', 'REJECTED')";
  } else if (status) {
    whereStr = 'deletedAt IS NULL AND status = ?';
    whereParams.push(status);
  } else {
    whereStr = 'deletedAt IS NULL';
  }

  // Year filter (by submittedAt year)
  if (yearFilter) {
    whereStr += ' AND YEAR(`submittedAt`) = ?';
    whereParams.push(yearFilter);
  }

  // Search by name or phone
  if (searchTerm) {
    whereStr += ' AND (`childName` LIKE ? OR `parentPhone` LIKE ?)';
    const like = `%${searchTerm}%`;
    whereParams.push(like, like);
  }

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) as total FROM \`Lead\` WHERE ${whereStr}`,
    whereParams,
  ) as any;
  const total = Number((countRow as any).total);

  const needsRawQuery = sortByStatus || status === 'active';
  let items: unknown[];

  if (needsRawQuery) {
    const statusCase = `CASE status
      WHEN 'NEW' THEN 1
      WHEN 'CONTACTED' THEN 2
      WHEN 'APPOINTMENT_BOOKED' THEN 3
      WHEN 'FOLLOW_UP' THEN 4
      WHEN 'ENROLLED' THEN 5
      WHEN 'LOST' THEN 6
      ELSE 7
    END`;
    const fieldSqlMap: Record<string, string> = {
      submittedAt: '`submittedAt`',
      childName: '`childName`',
      childDob: '`childDob`',
      enrolmentYear: '`enrolmentYear`',
    };
    const dirStr = order === 'asc' ? 'ASC' : 'DESC';
    const fieldStr = fieldSqlMap[field] ?? '`submittedAt`';

    let orderByStr: string;
    if (sortByStatus) {
      orderByStr = `${statusCase} ${dirStr}, \`submittedAt\` DESC`;
    } else {
      orderByStr = `${statusCase} ASC, ${fieldStr} ${dirStr}`;
    }

    const query = `SELECT * FROM \`Lead\` WHERE ${whereStr} ORDER BY ${orderByStr} LIMIT ${pageSize} OFFSET ${skip}`;
    const [rows] = await pool.query<RowDataPacket[]>(query, whereParams) as any;
    items = rows as unknown[];
  } else {
    // Drizzle builder for simple cases
    const notDeleted = sql`${leads.deletedAt} IS NULL`;
    const searchFilter = searchTerm ? sql`(${leads.childName} LIKE ${`%${searchTerm}%`} OR ${leads.parentPhone} LIKE ${`%${searchTerm}%`})` : undefined;
    const baseWhere =
      status === 'inactive' ? and(notDeleted, inArray(leads.status, ['ENROLLED', 'LOST', 'REJECTED'])) :
      status ? and(notDeleted, eq(leads.status, status as any)) :
      notDeleted;
    const yearFilterDrizzle = yearFilter ? sql`YEAR(${leads.submittedAt}) = ${yearFilter}` : undefined;
    const drizzleWhere = and(baseWhere, searchFilter, yearFilterDrizzle);

    const sortCol =
      field === 'childName' ? leads.childName :
      field === 'childDob' ? leads.childDob :
      field === 'enrolmentYear' ? leads.enrolmentYear :
      leads.submittedAt;

    items = await db.select().from(leads)
      .where(drizzleWhere)
      .orderBy(order === 'asc' ? asc(sortCol) : desc(sortCol))
      .limit(pageSize)
      .offset(skip);
  }

  res.json({ items, total, page, pageSize });
}

export async function getLeadStats(req: Request, res: Response): Promise<void> {
  const year = req.query.year ? Number(req.query.year) : undefined;

  // Active stages: no year filter (always show all)
  const activeGroups = await db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .where(sql`deletedAt IS NULL AND status IN ('NEW','CONTACTED','APPOINTMENT_BOOKED','FOLLOW_UP')`)
    .groupBy(leads.status);

  const counts: Record<string, number> = {};
  for (const g of activeGroups) counts[g.status] = Number(g.count);

  // Closed stages: filter by submittedAt year if provided
  const yearCond = year ? sql`AND YEAR(submittedAt) = ${year}` : sql``;
  const closedGroups = await db
    .select({ status: leads.status, count: sql<number>`count(*)` })
    .from(leads)
    .where(sql`deletedAt IS NULL AND status IN ('ENROLLED','LOST','REJECTED') ${yearCond}`)
    .groupBy(leads.status);

  for (const g of closedGroups) counts[g.status] = Number(g.count);

  const [[trashRow]] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) as total FROM `Lead` WHERE deletedAt IS NOT NULL",
  ) as any;

  res.json({
    NEW: counts['NEW'] ?? 0,
    CONTACTED: counts['CONTACTED'] ?? 0,
    APPOINTMENT_BOOKED: counts['APPOINTMENT_BOOKED'] ?? 0,
    FOLLOW_UP: counts['FOLLOW_UP'] ?? 0,
    ENROLLED: counts['ENROLLED'] ?? 0,
    LOST: counts['LOST'] ?? 0,
    REJECTED: counts['REJECTED'] ?? 0,
    TRASH: Number((trashRow as any).total),
  });
}

export async function deleteLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }
  await db.update(students).set({ withdrawnAt: new Date(), withdrawReason: 'Lead deleted' }).where(eq(students.leadId, id));
  await db.update(leads).set({ deletedAt: new Date() }).where(eq(leads.id, id));
  res.status(204).end();
}

export async function getTrashedLeads(_req: Request, res: Response): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM `Lead` WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC",
  ) as any;
  res.json(rows as unknown[]);
}

export async function restoreLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }
  await db.update(leads).set({ deletedAt: null }).where(eq(leads.id, id));
  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  res.json(lead);
}

export async function permanentDeleteLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }
  await db.delete(students).where(eq(students.leadId, id));
  await db.delete(leads).where(eq(leads.id, id));
  res.status(204).end();
}

export async function updateLead(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const parsed = updateLeadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
    return;
  }

  const [existing] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!existing) { res.status(404).json({ message: 'Lead not found' }); return; }

  const { childDob, childName, appointmentStart, appointmentEnd, ...rest } = parsed.data;
  const statusChanged = rest.status && rest.status !== existing.status;
  const clearLostReason = rest.status && rest.status !== 'LOST';
  const unenrolling = statusChanged && existing.status === 'ENROLLED' && rest.status !== 'ENROLLED';

  await db.update(leads).set({
    ...rest,
    ...(childName ? { childName: normalizeName(childName) } : {}),
    ...(childDob ? { childDob: new Date(childDob) } : {}),
    ...(appointmentStart ? { appointmentStart: new Date(appointmentStart) } : {}),
    ...(appointmentEnd ? { appointmentEnd: new Date(appointmentEnd) } : {}),
    ...(statusChanged ? { statusChangedAt: new Date() } : {}),
    ...(clearLostReason ? { lostReason: null } : {}),
  } as any).where(eq(leads.id, id));

  if (unenrolling) {
    await db.delete(students).where(eq(students.leadId, id));
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  res.json(lead);
}

function roundUpTo30Min(date: Date): Date {
  const result = new Date(date);
  const minutes = result.getMinutes();
  const remainder = minutes % 30;
  if (remainder === 0) return result;
  result.setMinutes(minutes + (30 - remainder), 0, 0);
  return result;
}

export async function createAppointment(req: Request, res: Response): Promise<void> {
  await _createAppointment(req, res);
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s\-()]/g, '');
  if (cleaned.startsWith('+')) return cleaned.replace(/\D/g, '');
  if (cleaned.startsWith('0')) return '60' + cleaned.slice(1);
  return '60' + cleaned;
}

function buildEventDescription(
  lead: { parentPhone: string; childDob: Date; enrolmentYear: number; submittedAt: Date },
  whatsappMessage?: string,
): string {
  const lines = [
    `Parent Phone: ${lead.parentPhone}`,
    `Date of Birth: ${lead.childDob.toISOString().split('T')[0]}`,
    `Enrolment Year: ${lead.enrolmentYear}`,
    `Submitted: ${lead.submittedAt.toISOString()}`,
  ];
  if (whatsappMessage) {
    const waLink = `https://web.whatsapp.com/send?phone=${normalizePhone(lead.parentPhone)}`;
    lines.push(`\nWhatsApp: ${waLink}`);
  }
  return lines.join('\n');
}

async function _createAppointment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { appointmentStart: appointmentStartStr, whatsappMessage, isPlaceholder } = req.body as {
    appointmentStart?: string; whatsappMessage?: string; isPlaceholder?: boolean;
  };

  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) {
    res.status(409).json({ message: 'Google calendar not connected' });
    return;
  }

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) {
    res.status(404).json({ message: 'Lead not found' });
    return;
  }

  const start = appointmentStartStr
    ? new Date(appointmentStartStr)
    : roundUpTo30Min(new Date(Date.now() + 2 * 60 * 60 * 1000));

  const [durationSetting, calendarSetting, addressSetting] = await Promise.all([
    db.select().from(systemSettings).where(eq(systemSettings.key, 'appointment_duration_minutes')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'kinder_address')).limit(1).then(r => r[0]),
  ]);
  const calendarId = String(calendarSetting?.value ?? 'primary').replace(/^"|"$/g, '');
  const kinderAddress = (addressSetting?.value as string | undefined) ?? '';
  const durationMs = (Number(durationSetting?.value) || 30) * 60 * 1000;
  const end = new Date(start.getTime() + durationMs);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: Number(connection.expiryDate),
  });

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await db.update(googleConnections).set({
        accessToken: tokens.access_token,
        updatedAt: new Date(),
        ...(tokens.expiry_date != null ? { expiryDate: BigInt(tokens.expiry_date) } : {}),
      });
    }
  });

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  if (lead.googleEventId) {
    try {
      await calendar.events.delete({
        calendarId,
        eventId: lead.googleEventId,
      });
    } catch {
      // Ignore — event may have already been deleted manually
    }
  }

  let event;
  try {
    event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `${isPlaceholder ? '【PH】' : ''}School Visit - ${lead.childName}`,
        description: buildEventDescription(lead, whatsappMessage),
        location: kinderAddress,
        start: { dateTime: start.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
        end: { dateTime: end.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
      },
    });
  } catch (err: any) {
    console.log('[Google Calendar] Failed to create event:', err?.response?.data ?? err?.message);
    res.status(502).json({ message: `Google Calendar error: ${err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'}` });
    return;
  }

  await db.update(leads).set({
    googleEventId: event.data.id,
    googleEventLink: event.data.htmlLink,
    appointmentStart: start,
    appointmentEnd: end,
    appointmentCreatedByUserId: req.user!.id,
    appointmentIsPlaceholder: !!isPlaceholder,
    status: isPlaceholder ? 'CONTACTED' : 'APPOINTMENT_BOOKED',
    statusChangedAt: new Date(),
  }).where(eq(leads.id, id));

  res.json({ googleEventId: event.data.id, googleEventLink: event.data.htmlLink });
}

export async function confirmAppointment(req: Request, res: Response): Promise<void> {
  const { id } = req.params;

  const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!lead) { res.status(404).json({ message: 'Lead not found' }); return; }
  if (!lead.appointmentStart) { res.status(400).json({ message: 'No appointment to confirm' }); return; }

  const [connection] = await db.select().from(googleConnections).limit(1);
  if (!connection) { res.status(409).json({ message: 'Google calendar not connected' }); return; }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    process.env.GOOGLE_REDIRECT_URI!,
  );
  oauth2Client.setCredentials({
    access_token: connection.accessToken,
    refresh_token: connection.refreshToken,
    expiry_date: Number(connection.expiryDate),
  });
  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await db.update(googleConnections).set({
        accessToken: tokens.access_token,
        updatedAt: new Date(),
        ...(tokens.expiry_date != null ? { expiryDate: BigInt(tokens.expiry_date) } : {}),
      });
    }
  });

  const [calendarSetting, addressSetting2] = await Promise.all([
    db.select().from(systemSettings).where(eq(systemSettings.key, 'shared_calendar_id')).limit(1).then(r => r[0]),
    db.select().from(systemSettings).where(eq(systemSettings.key, 'kinder_address')).limit(1).then(r => r[0]),
  ]);
  const calendarId = String(calendarSetting?.value ?? 'primary').replace(/^"|"$/g, '');
  const kinderAddress = (addressSetting2?.value as string | undefined) ?? '';

  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  if (lead.googleEventId) {
    try {
      await calendar.events.delete({ calendarId, eventId: lead.googleEventId });
    } catch { /* ignore if already deleted */ }
  }

  let event;
  try {
    event = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: `School Visit - ${lead.childName}`,
        description: buildEventDescription(lead, undefined),
        location: kinderAddress,
        start: { dateTime: lead.appointmentStart.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
        end: { dateTime: (lead.appointmentEnd ?? new Date(lead.appointmentStart.getTime() + 30 * 60000)).toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
      },
    });
  } catch (err: any) {
    console.log('[Google Calendar] confirmAppointment failed:', err?.response?.data ?? err?.message);
    res.status(502).json({ message: `Google Calendar error: ${err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'}` });
    return;
  }

  await db.update(leads).set({
    googleEventId: event.data.id,
    googleEventLink: event.data.htmlLink,
    appointmentIsPlaceholder: false,
    status: 'APPOINTMENT_BOOKED',
    statusChangedAt: new Date(),
  }).where(eq(leads.id, id));

  res.json({ googleEventId: event.data.id, googleEventLink: event.data.htmlLink });
}

export async function getUpcomingAppointments(_req: Request, res: Response): Promise<void> {
  const now = new Date();
  const items = await db
    .select({
      id: leads.id,
      childName: leads.childName,
      parentPhone: leads.parentPhone,
      appointmentStart: leads.appointmentStart,
      appointmentEnd: leads.appointmentEnd,
      appointmentIsPlaceholder: leads.appointmentIsPlaceholder,
    })
    .from(leads)
    .where(and(
      gte(leads.appointmentStart, now),
      sql`status NOT IN ('FOLLOW_UP', 'ENROLLED', 'LOST', 'REJECTED')`,
      sql`deletedAt IS NULL`,
    ))
    .orderBy(asc(leads.appointmentStart));
  res.json(items);
}

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export async function getAnalytics(req: Request, res: Response): Promise<void> {
  const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
  const prevYear = selectedYear - 1;

  const dateRange = (y: number) => and(
    gte(leads.submittedAt, new Date(y, 0, 1)),
    lt(leads.submittedAt, new Date(y + 1, 0, 1)),
  );

  const [currentLeads, prevLeads] = await Promise.all([
    db.select({
      submittedAt: leads.submittedAt,
      childDob: leads.childDob,
      appointmentStart: leads.appointmentStart,
      addressLocation: leads.addressLocation,
      howDidYouKnow: leads.howDidYouKnow,
      status: leads.status,
      lostReason: leads.lostReason,
      attended: leads.attended,
    }).from(leads).where(dateRange(selectedYear)),
    db.select({ submittedAt: leads.submittedAt }).from(leads).where(dateRange(prevYear)),
  ]);

  const totalLeads = currentLeads.length;
  const totalAppointments = currentLeads.filter(l => l.appointmentStart !== null).length;
  const completedLeads = currentLeads.filter(l => l.status === 'ENROLLED' || l.status === 'LOST' || l.status === 'REJECTED');
  // Attended — use the attended flag, exclude rejected and active leads
  const attendedAppointments = currentLeads.filter(l => l.attended && (l.status === 'ENROLLED' || l.status === 'LOST')).length;
  // Didn't attend — had appointment but didn't attend, exclude rejected
  const noShowLeads = currentLeads.filter(l =>
    l.appointmentStart !== null && !l.attended && l.status !== 'REJECTED'
  ).length;
  const totalWithAppointment = attendedAppointments + noShowLeads;
  const appointmentRate = totalWithAppointment > 0 ? attendedAppointments / totalWithAppointment : 0;
  // Pending = not attended, not didn't-attend, not enrolled, not lost, not rejected
  const pendingLeads = currentLeads.filter(l =>
    !l.attended && l.appointmentStart === null && l.status !== 'ENROLLED' && l.status !== 'LOST' && l.status !== 'REJECTED'
  ).length;
  const rejectedLeads = currentLeads.filter(l => l.status === 'REJECTED').length;

  const currentMonthly = new Array(12).fill(0);
  for (const l of currentLeads) currentMonthly[l.submittedAt.getMonth()]++;
  const prevMonthly = new Array(12).fill(0);
  for (const l of prevLeads) prevMonthly[l.submittedAt.getMonth()]++;
  const monthlyComparison = MONTH_LABELS.map((label, i) => ({
    month: label, current: currentMonthly[i], previous: prevMonthly[i],
  }));

  const monthMap = new Map<string, Record<string, number>>();
  for (const lead of currentLeads) {
    const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
    const birthYear = lead.childDob.getFullYear();
    const age = lead.enrolmentYear - birthYear;
    const ageKey = age < 2 ? 'Below 2' : age >= 2 && age <= 7 ? String(age) : 'Above 7';
    if (!monthMap.has(monthLabel)) monthMap.set(monthLabel, {});
    const m = monthMap.get(monthLabel)!;
    m[ageKey] = (m[ageKey] ?? 0) + 1;
  }
  const monthlyByAge = MONTH_LABELS
    .filter(label => monthMap.has(label))
    .map(label => {
      const ages = monthMap.get(label)!;
      return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });

  const addressMap = new Map<string, number>();
  for (const lead of currentLeads) {
    if (lead.addressLocation) addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
  }
  const addressBreakdown = Array.from(addressMap.entries())
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count);

  const channelMap = new Map<string, number>();
  for (const lead of currentLeads) {
    if (lead.howDidYouKnow) channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
  }
  const marketingChannelBreakdown = Array.from(channelMap.entries())
    .map(([channel, count]) => ({ channel, count }))
    .sort((a, b) => b.count - a.count);

  const leadsDetail = currentLeads.map(l => ({
    monthIdx: l.submittedAt.getMonth(),
    address: l.addressLocation ?? null,
    channel: l.howDidYouKnow ?? null,
  }));

  const [yearRows] = await pool.query<RowDataPacket[]>(
    'SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC',
  ) as any;
  const availableYears = (yearRows as any[]).map((r: any) => Number(r.year));

  res.json({
    selectedYear, prevYear,
    totalLeads, totalAppointments, completedLeads: completedLeads.length,
    attendedAppointments, noShowLeads, appointmentRate, pendingLeads, rejectedLeads,
    monthlyComparison, monthlyByAge,
    addressBreakdown, marketingChannelBreakdown,
    leadsDetail, availableYears,
  });
}

export async function getSalesAnalytics(req: Request, res: Response): Promise<void> {
  const selectedYear = req.query.year ? parseInt(req.query.year as string) : new Date().getFullYear();
  const prevYear = selectedYear - 1;

  const closedWhere = (year: number) => and(
    gte(leads.submittedAt, new Date(`${year}-01-01T00:00:00.000Z`)),
    lt(leads.submittedAt, new Date(`${year + 1}-01-01T00:00:00.000Z`)),
    or(
      eq(leads.status, 'ENROLLED'),
      and(eq(leads.status, 'LOST'), ne(leads.lostReason as any, "Didn't attend the enquiry")),
    ),
  );

  const [closedLeads, prevLeads] = await Promise.all([
    db.select({
      id: leads.id, childName: leads.childName, notes: leads.notes, lostReason: leads.lostReason,
      addressLocation: leads.addressLocation, howDidYouKnow: leads.howDidYouKnow,
      childDob: leads.childDob, submittedAt: leads.submittedAt, status: leads.status, enrolmentYear: leads.enrolmentYear,
      attended: leads.attended,
    }).from(leads).where(closedWhere(selectedYear)).orderBy(asc(leads.submittedAt)),
    db.select({ submittedAt: leads.submittedAt, status: leads.status, attended: leads.attended }).from(leads).where(closedWhere(prevYear)),
  ]);

  const salesLeads = closedLeads.filter(l => l.status !== 'REJECTED' && l.attended);
  const totalLeads = salesLeads.length;
  const enrolledLeads = salesLeads.filter(l => l.status === 'ENROLLED').length;
  const lostLeads = salesLeads.filter(l => l.status === 'LOST').length;
  const closingRate = totalLeads > 0 ? enrolledLeads / totalLeads : 0;

  const enrolledMonthly = new Array(12).fill(0);
  const lostMonthly = new Array(12).fill(0);
  for (const l of salesLeads) {
    const m = l.submittedAt.getMonth();
    if (l.status === 'ENROLLED') enrolledMonthly[m]++;
    else if (l.status === 'LOST') lostMonthly[m]++;
  }
  const prevMonthlyEnrolled = new Array(12).fill(0);
  const prevMonthlyLost = new Array(12).fill(0);
  for (const l of prevLeads) {
    if (l.attended && (l.status === 'ENROLLED' || l.status === 'LOST')) {
      if (l.status === 'ENROLLED') prevMonthlyEnrolled[l.submittedAt.getMonth()]++;
      else prevMonthlyLost[l.submittedAt.getMonth()]++;
    }
  }
  const monthlyComparison = MONTH_LABELS.map((label, i) => ({
    month: label, enrolled: enrolledMonthly[i], lost: lostMonthly[i],
    prevEnrolled: prevMonthlyEnrolled[i], prevLost: prevMonthlyLost[i],
    previousTalks: prevMonthlyEnrolled[i] + prevMonthlyLost[i], previousClosed: prevMonthlyEnrolled[i],
  }));

  const monthMap = new Map<string, Record<string, number>>();
  for (const lead of closedLeads) {
    const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
    const birthYear = lead.childDob.getFullYear();
    const age = lead.enrolmentYear - birthYear;
    const ageKey = age < 2 ? 'Below 2' : age >= 2 && age <= 7 ? String(age) : 'Above 7';
    if (!monthMap.has(monthLabel)) monthMap.set(monthLabel, {});
    const m = monthMap.get(monthLabel)!;
    m[ageKey] = (m[ageKey] ?? 0) + 1;
  }
  const monthlyByAge = MONTH_LABELS
    .filter(l => monthMap.has(l))
    .map(label => {
      const ages = monthMap.get(label)!;
      return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });

  const addressMap = new Map<string, number>();
  const channelMap = new Map<string, number>();
  for (const lead of salesLeads) {
    if (lead.addressLocation) addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
    if (lead.howDidYouKnow) channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
  }
  const addressBreakdown = Array.from(addressMap.entries()).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
  const marketingChannelBreakdown = Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);

  const leadsTable = salesLeads.map(lead => {
    const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
    return {
      id: lead.id,
      childName: lead.childName,
      status: lead.status,
      enrolmentYear: lead.enrolmentYear,
      notes: lead.notes ?? lead.lostReason ?? null,
      addressLocation: lead.addressLocation,
      howDidYouKnow: lead.howDidYouKnow,
      age: Math.floor(ageMs / (365.25 * 24 * 3600 * 1000)),
      submittedAt: lead.submittedAt,
    };
  });

  const [yearRows] = await pool.query<RowDataPacket[]>(
    'SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC',
  ) as any;
  const availableYears = (yearRows as any[]).map((r: any) => Number(r.year));

  res.json({
    selectedYear, prevYear, totalLeads, enrolledLeads, lostLeads, closingRate,
    monthlyComparison, monthlyByAge, addressBreakdown, marketingChannelBreakdown,
    leadsTable, availableYears,
  });
}

export { roundUpTo30Min };
