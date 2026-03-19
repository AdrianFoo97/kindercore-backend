"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLead = createLead;
exports.resetAllLeads = resetAllLeads;
exports.seedDummyLeads = seedDummyLeads;
exports.getLeadPhones = getLeadPhones;
exports.getLeads = getLeads;
exports.getLeadStats = getLeadStats;
exports.deleteLead = deleteLead;
exports.getTrashedLeads = getTrashedLeads;
exports.restoreLead = restoreLead;
exports.permanentDeleteLead = permanentDeleteLead;
exports.updateLead = updateLead;
exports.createAppointment = createAppointment;
exports.confirmAppointment = confirmAppointment;
exports.getUpcomingAppointments = getUpcomingAppointments;
exports.getAnalytics = getAnalytics;
exports.getSalesAnalytics = getSalesAnalytics;
exports.roundUpTo30Min = roundUpTo30Min;
const crypto_1 = require("crypto");
const googleapis_1 = require("googleapis");
const drizzle_orm_1 = require("drizzle-orm");
const client_js_1 = require("../db/client.js");
const schema_js_1 = require("../db/schema.js");
const lead_validator_js_1 = require("../validators/lead.validator.js");
async function createLead(req, res) {
    const parsed = lead_validator_js_1.createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { childName, parentPhone, childDob, enrolmentYear, company, relationship, programme, preferredAppointmentTime, addressLocation, needsTransport, howDidYouKnow, submittedAt: submittedAtRaw } = parsed.data;
    if (company) {
        res.status(400).json({ message: 'Bad request' });
        return;
    }
    console.log('[Lead] New submission received:', JSON.stringify(parsed.data, null, 2));
    const id = (0, crypto_1.randomUUID)();
    const submittedAt = submittedAtRaw ? new Date(submittedAtRaw) : new Date();
    await client_js_1.db.insert(schema_js_1.leads).values({
        id, childName, parentPhone, childDob: new Date(childDob), enrolmentYear,
        relationship, programme, preferredAppointmentTime, addressLocation,
        needsTransport, howDidYouKnow, submittedAt,
    });
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    res.status(201).json(lead);
}
async function resetAllLeads(_req, res) {
    await client_js_1.db.delete(schema_js_1.students);
    await client_js_1.db.delete(schema_js_1.leads);
    res.json({ message: 'All leads deleted' });
}
async function seedDummyLeads(_req, res) {
    const now = new Date();
    const ago = (days) => new Date(now.getTime() - days * 86400000);
    const ahead = (days) => new Date(now.getTime() + days * 86400000);
    const dob = (y, m, d) => new Date(y, m - 1, d);
    const h1 = 60 * 60000;
    const rows = [
        { id: (0, crypto_1.randomUUID)(), childName: 'Aiden Lim', parentPhone: '0123456001', childDob: dob(2021, 3, 15), enrolmentYear: 2026, status: 'NEW', submittedAt: ago(0), howDidYouKnow: 'Facebook', programme: 'Playgroup' },
        { id: (0, crypto_1.randomUUID)(), childName: 'Sophia Tan', parentPhone: '0123456002', childDob: dob(2020, 7, 22), enrolmentYear: 2026, status: 'NEW', submittedAt: ago(2), howDidYouKnow: 'Instagram', programme: 'Nursery' },
        { id: (0, crypto_1.randomUUID)(), childName: 'Ethan Wong', parentPhone: '0123456003', childDob: dob(2020, 11, 8), enrolmentYear: 2026, status: 'NEW', submittedAt: ago(5), howDidYouKnow: 'Friend Referral', programme: 'Nursery' },
        { id: (0, crypto_1.randomUUID)(), childName: 'Mia Ng', parentPhone: '0123456004', childDob: dob(2021, 5, 30), enrolmentYear: 2026, status: 'CONTACTED', submittedAt: ago(4), statusChangedAt: ago(3), howDidYouKnow: 'Google', programme: 'Playgroup', appointmentStart: ahead(3), appointmentEnd: new Date(ahead(3).getTime() + h1), appointmentIsPlaceholder: true },
        { id: (0, crypto_1.randomUUID)(), childName: 'Lucas Chua', parentPhone: '0123456005', childDob: dob(2020, 9, 14), enrolmentYear: 2026, status: 'CONTACTED', submittedAt: ago(6), statusChangedAt: ago(5), howDidYouKnow: 'Facebook', programme: 'Nursery', appointmentStart: ahead(1), appointmentEnd: new Date(ahead(1).getTime() + h1), appointmentIsPlaceholder: true },
        { id: (0, crypto_1.randomUUID)(), childName: 'Ella Ooi', parentPhone: '0123456006', childDob: dob(2021, 1, 18), enrolmentYear: 2026, status: 'CONTACTED', submittedAt: ago(8), statusChangedAt: ago(6), howDidYouKnow: 'Instagram', programme: 'Playgroup', appointmentStart: ahead(7), appointmentEnd: new Date(ahead(7).getTime() + h1), appointmentIsPlaceholder: true },
        { id: (0, crypto_1.randomUUID)(), childName: 'Noah Yap', parentPhone: '0123456007', childDob: dob(2020, 4, 25), enrolmentYear: 2026, status: 'APPOINTMENT_BOOKED', submittedAt: ago(10), statusChangedAt: ago(7), howDidYouKnow: 'Friend Referral', programme: 'Kindergarten', appointmentStart: ahead(1), appointmentEnd: new Date(ahead(1).getTime() + h1), appointmentIsPlaceholder: false },
        { id: (0, crypto_1.randomUUID)(), childName: 'Chloe Lee', parentPhone: '0123456008', childDob: dob(2020, 6, 12), enrolmentYear: 2026, status: 'FOLLOW_UP', submittedAt: ago(14), statusChangedAt: ago(4), howDidYouKnow: 'Google', programme: 'Kindergarten', appointmentStart: ago(3), appointmentEnd: new Date(ago(3).getTime() + h1), appointmentIsPlaceholder: false, notes: 'Parents want to visit again before deciding' },
        { id: (0, crypto_1.randomUUID)(), childName: 'Oliver Loh', parentPhone: '0123456009', childDob: dob(2020, 2, 5), enrolmentYear: 2025, status: 'ENROLLED', submittedAt: ago(90), statusChangedAt: ago(60), howDidYouKnow: 'Google', programme: 'Kindergarten' },
        { id: (0, crypto_1.randomUUID)(), childName: 'Emma Koh', parentPhone: '0123456010', childDob: dob(2021, 8, 19), enrolmentYear: 2026, status: 'LOST', submittedAt: ago(30), statusChangedAt: ago(25), howDidYouKnow: 'Facebook', programme: 'Nursery', lostReason: 'Enrolled at another kindergarten' },
    ];
    await client_js_1.db.insert(schema_js_1.leads).values(rows);
    res.json({ message: `${rows.length} dummy leads created.`, count: rows.length });
}
async function getLeadPhones(_req, res) {
    const rows = await client_js_1.db.select({ id: schema_js_1.leads.id, parentPhone: schema_js_1.leads.parentPhone, childName: schema_js_1.leads.childName, submittedAt: schema_js_1.leads.submittedAt }).from(schema_js_1.leads);
    res.json(rows);
}
async function getLeads(req, res) {
    const page = Math.max(1, parseInt(req.query.page ?? '1') || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize ?? '20') || 20));
    const skip = (page - 1) * pageSize;
    const { status, sortBy, sortOrder } = req.query;
    const validSortFields = ['submittedAt', 'childName', 'childDob', 'enrolmentYear', 'status'];
    const field = validSortFields.includes(sortBy ?? '') ? sortBy : 'submittedAt';
    const order = sortOrder === 'asc' ? 'asc' : 'desc';
    const sortByStatus = field === 'status';
    // Build WHERE clause string for count + raw queries
    let whereStr;
    const whereParams = [];
    if (status === 'active') {
        whereStr = "deletedAt IS NULL AND status NOT IN ('ENROLLED', 'LOST')";
    }
    else if (status === 'inactive') {
        whereStr = "deletedAt IS NULL AND status IN ('ENROLLED', 'LOST')";
    }
    else if (status) {
        whereStr = 'deletedAt IS NULL AND status = ?';
        whereParams.push(status);
    }
    else {
        whereStr = 'deletedAt IS NULL';
    }
    const [[countRow]] = await client_js_1.pool.query(`SELECT COUNT(*) as total FROM \`Lead\` WHERE ${whereStr}`, whereParams);
    const total = Number(countRow.total);
    const needsRawQuery = sortByStatus || status === 'active';
    let items;
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
        const fieldSqlMap = {
            submittedAt: '`submittedAt`',
            childName: '`childName`',
            childDob: '`childDob`',
            enrolmentYear: '`enrolmentYear`',
        };
        const dirStr = order === 'asc' ? 'ASC' : 'DESC';
        const fieldStr = fieldSqlMap[field] ?? '`submittedAt`';
        let orderByStr;
        if (sortByStatus) {
            orderByStr = `${statusCase} ${dirStr}, \`submittedAt\` DESC`;
        }
        else {
            orderByStr = `${statusCase} ASC, ${fieldStr} ${dirStr}`;
        }
        const query = `SELECT * FROM \`Lead\` WHERE ${whereStr} ORDER BY ${orderByStr} LIMIT ${pageSize} OFFSET ${skip}`;
        const [rows] = await client_js_1.pool.query(query, whereParams);
        items = rows;
    }
    else {
        // Drizzle builder for simple cases
        const drizzleWhere = status === 'inactive' ? (0, drizzle_orm_1.inArray)(schema_js_1.leads.status, ['ENROLLED', 'LOST']) :
            status ? (0, drizzle_orm_1.eq)(schema_js_1.leads.status, status) :
                undefined;
        const sortCol = field === 'childName' ? schema_js_1.leads.childName :
            field === 'childDob' ? schema_js_1.leads.childDob :
                field === 'enrolmentYear' ? schema_js_1.leads.enrolmentYear :
                    schema_js_1.leads.submittedAt;
        items = await client_js_1.db.select().from(schema_js_1.leads)
            .where(drizzleWhere)
            .orderBy(order === 'asc' ? (0, drizzle_orm_1.asc)(sortCol) : (0, drizzle_orm_1.desc)(sortCol))
            .limit(pageSize)
            .offset(skip);
    }
    res.json({ items, total, page, pageSize });
}
async function getLeadStats(_req, res) {
    const groups = await client_js_1.db
        .select({ status: schema_js_1.leads.status, count: (0, drizzle_orm_1.sql) `count(*)` })
        .from(schema_js_1.leads)
        .where((0, drizzle_orm_1.sql) `deletedAt IS NULL`)
        .groupBy(schema_js_1.leads.status);
    const counts = {};
    for (const g of groups)
        counts[g.status] = Number(g.count);
    const [[trashRow]] = await client_js_1.pool.query("SELECT COUNT(*) as total FROM `Lead` WHERE deletedAt IS NOT NULL");
    res.json({
        NEW: counts['NEW'] ?? 0,
        CONTACTED: counts['CONTACTED'] ?? 0,
        APPOINTMENT_BOOKED: counts['APPOINTMENT_BOOKED'] ?? 0,
        FOLLOW_UP: counts['FOLLOW_UP'] ?? 0,
        ENROLLED: counts['ENROLLED'] ?? 0,
        LOST: counts['LOST'] ?? 0,
        TRASH: Number(trashRow.total),
    });
}
async function deleteLead(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    await client_js_1.db.update(schema_js_1.leads).set({ deletedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    res.status(204).end();
}
async function getTrashedLeads(_req, res) {
    const [rows] = await client_js_1.pool.query("SELECT * FROM `Lead` WHERE deletedAt IS NOT NULL ORDER BY deletedAt DESC");
    res.json(rows);
}
async function restoreLead(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    await client_js_1.db.update(schema_js_1.leads).set({ deletedAt: null }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    res.json(lead);
}
async function permanentDeleteLead(req, res) {
    const { id } = req.params;
    const [existing] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    await client_js_1.db.delete(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.leadId, id));
    await client_js_1.db.delete(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    res.status(204).end();
}
async function updateLead(req, res) {
    const { id } = req.params;
    const parsed = lead_validator_js_1.updateLeadSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const [existing] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!existing) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    const { childDob, ...rest } = parsed.data;
    const statusChanged = rest.status && rest.status !== existing.status;
    const clearLostReason = rest.status && rest.status !== 'LOST';
    const unenrolling = statusChanged && existing.status === 'ENROLLED' && rest.status !== 'ENROLLED';
    await client_js_1.db.update(schema_js_1.leads).set({
        ...rest,
        ...(childDob ? { childDob: new Date(childDob) } : {}),
        ...(statusChanged ? { statusChangedAt: new Date() } : {}),
        ...(clearLostReason ? { lostReason: null } : {}),
    }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    if (unenrolling) {
        await client_js_1.db.delete(schema_js_1.students).where((0, drizzle_orm_1.eq)(schema_js_1.students.leadId, id));
    }
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    res.json(lead);
}
function roundUpTo30Min(date) {
    const result = new Date(date);
    const minutes = result.getMinutes();
    const remainder = minutes % 30;
    if (remainder === 0)
        return result;
    result.setMinutes(minutes + (30 - remainder), 0, 0);
    return result;
}
async function createAppointment(req, res) {
    await _createAppointment(req, res);
}
function normalizePhone(phone) {
    const cleaned = phone.replace(/[\s\-()]/g, '');
    if (cleaned.startsWith('+'))
        return cleaned.replace(/\D/g, '');
    if (cleaned.startsWith('0'))
        return '60' + cleaned.slice(1);
    return '60' + cleaned;
}
function buildEventDescription(lead, whatsappMessage) {
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
async function _createAppointment(req, res) {
    const { id } = req.params;
    const { appointmentStart: appointmentStartStr, whatsappMessage, isPlaceholder } = req.body;
    const [connection] = await client_js_1.db.select().from(schema_js_1.googleConnections).limit(1);
    if (!connection) {
        res.status(409).json({ message: 'Google calendar not connected' });
        return;
    }
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!lead) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    const start = appointmentStartStr
        ? new Date(appointmentStartStr)
        : roundUpTo30Min(new Date(Date.now() + 2 * 60 * 60 * 1000));
    const [durationSetting] = await client_js_1.db
        .select()
        .from(schema_js_1.systemSettings)
        .where((0, drizzle_orm_1.eq)(schema_js_1.systemSettings.key, 'appointment_duration_minutes'))
        .limit(1);
    const durationMs = (Number(durationSetting?.value) || 30) * 60 * 1000;
    const end = new Date(start.getTime() + durationMs);
    const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
    oauth2Client.setCredentials({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
        expiry_date: Number(connection.expiryDate),
    });
    oauth2Client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
            await client_js_1.db.update(schema_js_1.googleConnections).set({
                accessToken: tokens.access_token,
                updatedAt: new Date(),
                ...(tokens.expiry_date != null ? { expiryDate: BigInt(tokens.expiry_date) } : {}),
            });
        }
    });
    const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    if (lead.googleEventId) {
        try {
            await calendar.events.delete({
                calendarId: process.env.SHARED_CALENDAR_ID,
                eventId: lead.googleEventId,
            });
        }
        catch {
            // Ignore — event may have already been deleted manually
        }
    }
    let event;
    try {
        event = await calendar.events.insert({
            calendarId: process.env.SHARED_CALENDAR_ID,
            requestBody: {
                summary: `${isPlaceholder ? '【PH】' : ''}School Visit - ${lead.childName}`,
                description: buildEventDescription(lead, whatsappMessage),
                location: process.env.KINDER_ADDRESS ?? '',
                start: { dateTime: start.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
                end: { dateTime: end.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
            },
        });
    }
    catch (err) {
        console.error('[Google Calendar] Failed to create event:', err?.response?.data ?? err?.message);
        res.status(502).json({ message: `Google Calendar error: ${err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'}` });
        return;
    }
    await client_js_1.db.update(schema_js_1.leads).set({
        googleEventId: event.data.id,
        googleEventLink: event.data.htmlLink,
        appointmentStart: start,
        appointmentEnd: end,
        appointmentCreatedByUserId: req.user.id,
        appointmentIsPlaceholder: !!isPlaceholder,
        status: isPlaceholder ? 'CONTACTED' : 'APPOINTMENT_BOOKED',
        statusChangedAt: new Date(),
    }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    res.json({ googleEventId: event.data.id, googleEventLink: event.data.htmlLink });
}
async function confirmAppointment(req, res) {
    const { id } = req.params;
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    if (!lead) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    if (!lead.appointmentStart) {
        res.status(400).json({ message: 'No appointment to confirm' });
        return;
    }
    const [connection] = await client_js_1.db.select().from(schema_js_1.googleConnections).limit(1);
    if (!connection) {
        res.status(409).json({ message: 'Google calendar not connected' });
        return;
    }
    const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
    oauth2Client.setCredentials({
        access_token: connection.accessToken,
        refresh_token: connection.refreshToken,
        expiry_date: Number(connection.expiryDate),
    });
    oauth2Client.on('tokens', async (tokens) => {
        if (tokens.access_token) {
            await client_js_1.db.update(schema_js_1.googleConnections).set({
                accessToken: tokens.access_token,
                updatedAt: new Date(),
                ...(tokens.expiry_date != null ? { expiryDate: BigInt(tokens.expiry_date) } : {}),
            });
        }
    });
    const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    if (lead.googleEventId) {
        try {
            await calendar.events.delete({ calendarId: process.env.SHARED_CALENDAR_ID, eventId: lead.googleEventId });
        }
        catch { /* ignore if already deleted */ }
    }
    let event;
    try {
        event = await calendar.events.insert({
            calendarId: process.env.SHARED_CALENDAR_ID,
            requestBody: {
                summary: `School Visit - ${lead.childName}`,
                description: buildEventDescription(lead, undefined),
                location: process.env.KINDER_ADDRESS ?? '',
                start: { dateTime: lead.appointmentStart.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
                end: { dateTime: (lead.appointmentEnd ?? new Date(lead.appointmentStart.getTime() + 30 * 60000)).toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
            },
        });
    }
    catch (err) {
        console.error('[Google Calendar] confirmAppointment failed:', err?.response?.data ?? err?.message);
        res.status(502).json({ message: `Google Calendar error: ${err?.response?.data?.error?.message ?? err?.message ?? 'Unknown error'}` });
        return;
    }
    await client_js_1.db.update(schema_js_1.leads).set({
        googleEventId: event.data.id,
        googleEventLink: event.data.htmlLink,
        appointmentIsPlaceholder: false,
        status: 'APPOINTMENT_BOOKED',
        statusChangedAt: new Date(),
    }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
    res.json({ googleEventId: event.data.id, googleEventLink: event.data.htmlLink });
}
async function getUpcomingAppointments(_req, res) {
    const now = new Date();
    const items = await client_js_1.db
        .select({
        id: schema_js_1.leads.id,
        childName: schema_js_1.leads.childName,
        parentPhone: schema_js_1.leads.parentPhone,
        appointmentStart: schema_js_1.leads.appointmentStart,
        appointmentEnd: schema_js_1.leads.appointmentEnd,
        appointmentIsPlaceholder: schema_js_1.leads.appointmentIsPlaceholder,
    })
        .from(schema_js_1.leads)
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_js_1.leads.appointmentStart, now), (0, drizzle_orm_1.sql) `status NOT IN ('FOLLOW_UP', 'ENROLLED', 'LOST')`, (0, drizzle_orm_1.sql) `deletedAt IS NULL`))
        .orderBy((0, drizzle_orm_1.asc)(schema_js_1.leads.appointmentStart));
    res.json(items);
}
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function getAnalytics(req, res) {
    const selectedYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const prevYear = selectedYear - 1;
    const dateRange = (y) => (0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_js_1.leads.submittedAt, new Date(y, 0, 1)), (0, drizzle_orm_1.lt)(schema_js_1.leads.submittedAt, new Date(y + 1, 0, 1)));
    const [currentLeads, prevLeads] = await Promise.all([
        client_js_1.db.select({
            submittedAt: schema_js_1.leads.submittedAt,
            childDob: schema_js_1.leads.childDob,
            appointmentStart: schema_js_1.leads.appointmentStart,
            addressLocation: schema_js_1.leads.addressLocation,
            howDidYouKnow: schema_js_1.leads.howDidYouKnow,
            status: schema_js_1.leads.status,
            lostReason: schema_js_1.leads.lostReason,
        }).from(schema_js_1.leads).where(dateRange(selectedYear)),
        client_js_1.db.select({ submittedAt: schema_js_1.leads.submittedAt }).from(schema_js_1.leads).where(dateRange(prevYear)),
    ]);
    const totalLeads = currentLeads.length;
    const totalAppointments = currentLeads.filter(l => l.appointmentStart !== null).length;
    const completedLeads = currentLeads.filter(l => l.status === 'ENROLLED' || l.status === 'LOST');
    // "Didn't attend" — covers both system-tracked ("Didn't attend the enquiry") and imported ("Didn't attend")
    const noShowLeads = completedLeads.filter(l => l.status === 'LOST' && l.lostReason != null && l.lostReason.toLowerCase().includes("didn't attend")).length;
    // Attended = all completed leads minus no-shows (works for imported data without appointmentStart)
    const attendedAppointments = completedLeads.length - noShowLeads;
    const appointmentRate = completedLeads.length > 0 ? attendedAppointments / completedLeads.length : 0;
    const currentMonthly = new Array(12).fill(0);
    for (const l of currentLeads)
        currentMonthly[l.submittedAt.getMonth()]++;
    const prevMonthly = new Array(12).fill(0);
    for (const l of prevLeads)
        prevMonthly[l.submittedAt.getMonth()]++;
    const monthlyComparison = MONTH_LABELS.map((label, i) => ({
        month: label, current: currentMonthly[i], previous: prevMonthly[i],
    }));
    const monthMap = new Map();
    for (const lead of currentLeads) {
        const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
        const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
        const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
        const ageKey = age >= 2 && age <= 7 ? String(age) : 'other';
        if (!monthMap.has(monthLabel))
            monthMap.set(monthLabel, {});
        const m = monthMap.get(monthLabel);
        m[ageKey] = (m[ageKey] ?? 0) + 1;
    }
    const monthlyByAge = MONTH_LABELS
        .filter(label => monthMap.has(label))
        .map(label => {
        const ages = monthMap.get(label);
        return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });
    const addressMap = new Map();
    for (const lead of currentLeads) {
        if (lead.addressLocation)
            addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
    }
    const addressBreakdown = Array.from(addressMap.entries())
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count);
    const channelMap = new Map();
    for (const lead of currentLeads) {
        if (lead.howDidYouKnow)
            channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
    }
    const marketingChannelBreakdown = Array.from(channelMap.entries())
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count);
    const leadsDetail = currentLeads.map(l => ({
        monthIdx: l.submittedAt.getMonth(),
        address: l.addressLocation ?? null,
        channel: l.howDidYouKnow ?? null,
    }));
    const [yearRows] = await client_js_1.pool.query('SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC');
    const availableYears = yearRows.map((r) => Number(r.year));
    res.json({
        selectedYear, prevYear,
        totalLeads, totalAppointments, completedLeads: completedLeads.length,
        attendedAppointments, noShowLeads, appointmentRate,
        monthlyComparison, monthlyByAge,
        addressBreakdown, marketingChannelBreakdown,
        leadsDetail, availableYears,
    });
}
async function getSalesAnalytics(req, res) {
    const selectedYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const prevYear = selectedYear - 1;
    const closedWhere = (year) => (0, drizzle_orm_1.and)((0, drizzle_orm_1.gte)(schema_js_1.leads.submittedAt, new Date(`${year}-01-01T00:00:00.000Z`)), (0, drizzle_orm_1.lt)(schema_js_1.leads.submittedAt, new Date(`${year + 1}-01-01T00:00:00.000Z`)), (0, drizzle_orm_1.or)((0, drizzle_orm_1.eq)(schema_js_1.leads.status, 'ENROLLED'), (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.status, 'LOST'), (0, drizzle_orm_1.ne)(schema_js_1.leads.lostReason, "Didn't attend the enquiry"))));
    const [closedLeads, prevLeads] = await Promise.all([
        client_js_1.db.select({
            id: schema_js_1.leads.id, childName: schema_js_1.leads.childName, notes: schema_js_1.leads.notes, lostReason: schema_js_1.leads.lostReason,
            addressLocation: schema_js_1.leads.addressLocation, howDidYouKnow: schema_js_1.leads.howDidYouKnow,
            childDob: schema_js_1.leads.childDob, submittedAt: schema_js_1.leads.submittedAt, status: schema_js_1.leads.status, enrolmentYear: schema_js_1.leads.enrolmentYear,
        }).from(schema_js_1.leads).where(closedWhere(selectedYear)).orderBy((0, drizzle_orm_1.asc)(schema_js_1.leads.submittedAt)),
        client_js_1.db.select({ submittedAt: schema_js_1.leads.submittedAt, status: schema_js_1.leads.status }).from(schema_js_1.leads).where(closedWhere(prevYear)),
    ]);
    const totalLeads = closedLeads.length;
    const enrolledLeads = closedLeads.filter(l => l.status === 'ENROLLED').length;
    const lostLeads = closedLeads.filter(l => l.status === 'LOST').length;
    const closingRate = totalLeads > 0 ? enrolledLeads / totalLeads : 0;
    const enrolledMonthly = new Array(12).fill(0);
    const lostMonthly = new Array(12).fill(0);
    for (const l of closedLeads) {
        const m = l.submittedAt.getMonth();
        if (l.status === 'ENROLLED')
            enrolledMonthly[m]++;
        else if (l.status === 'LOST')
            lostMonthly[m]++;
    }
    const prevMonthly = new Array(12).fill(0);
    for (const l of prevLeads) {
        if (l.status === 'ENROLLED')
            prevMonthly[l.submittedAt.getMonth()]++;
    }
    const monthlyComparison = MONTH_LABELS.map((label, i) => ({
        month: label, enrolled: enrolledMonthly[i], lost: lostMonthly[i], previous: prevMonthly[i],
    }));
    const monthMap = new Map();
    for (const lead of closedLeads) {
        const monthLabel = MONTH_LABELS[lead.submittedAt.getMonth()];
        const ageMs = lead.submittedAt.getTime() - lead.childDob.getTime();
        const age = Math.floor(ageMs / (365.25 * 24 * 3600 * 1000));
        const ageKey = age >= 2 && age <= 7 ? String(age) : 'other';
        if (!monthMap.has(monthLabel))
            monthMap.set(monthLabel, {});
        const m = monthMap.get(monthLabel);
        m[ageKey] = (m[ageKey] ?? 0) + 1;
    }
    const monthlyByAge = MONTH_LABELS
        .filter(l => monthMap.has(l))
        .map(label => {
        const ages = monthMap.get(label);
        return { month: label, ...ages, total: Object.values(ages).reduce((s, v) => s + v, 0) };
    });
    const addressMap = new Map();
    const channelMap = new Map();
    for (const lead of closedLeads) {
        if (lead.addressLocation)
            addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
        if (lead.howDidYouKnow)
            channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
    }
    const addressBreakdown = Array.from(addressMap.entries()).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
    const marketingChannelBreakdown = Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);
    const leadsTable = closedLeads.map(lead => {
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
    const [yearRows] = await client_js_1.pool.query('SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC');
    const availableYears = yearRows.map((r) => Number(r.year));
    res.json({
        selectedYear, prevYear, totalLeads, enrolledLeads, lostLeads, closingRate,
        monthlyComparison, monthlyByAge, addressBreakdown, marketingChannelBreakdown,
        leadsTable, availableYears,
    });
}
//# sourceMappingURL=leads.controller.js.map