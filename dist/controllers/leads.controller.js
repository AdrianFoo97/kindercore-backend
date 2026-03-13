"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLead = createLead;
exports.getLeads = getLeads;
exports.getLeadStats = getLeadStats;
exports.updateLead = updateLead;
exports.createAppointment = createAppointment;
exports.getUpcomingAppointments = getUpcomingAppointments;
exports.getAnalytics = getAnalytics;
exports.getSalesAnalytics = getSalesAnalytics;
exports.roundUpTo30Min = roundUpTo30Min;
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
    const { childName, parentPhone, childDob, enrolmentYear, company, relationship, programme, preferredAppointmentTime, addressLocation, needsTransport, howDidYouKnow } = parsed.data;
    if (company) {
        res.status(400).json({ message: 'Bad request' });
        return;
    }
    const now = new Date();
    const id = crypto.randomUUID();
    await client_js_1.db.insert(schema_js_1.leads).values({
        id, childName, parentPhone, childDob: new Date(childDob), enrolmentYear,
        relationship, programme, preferredAppointmentTime, addressLocation,
        needsTransport, howDidYouKnow, submittedAt: now,
    });
    const [lead] = await client_js_1.db.select().from(schema_js_1.leads).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id)).limit(1);
    res.status(201).json(lead);
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
    // Auto-advance past appointments to FOLLOW_UP
    await client_js_1.db.update(schema_js_1.leads)
        .set({ status: 'FOLLOW_UP' })
        .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_js_1.leads.status, 'APPOINTMENT_BOOKED'), (0, drizzle_orm_1.sql) `${schema_js_1.leads.appointmentStart} < NOW()`));
    // Build WHERE clause string for count + raw queries
    let whereStr;
    const whereParams = [];
    if (status === 'active') {
        whereStr = "status NOT IN ('ENROLLED', 'LOST')";
    }
    else if (status === 'inactive') {
        whereStr = "status IN ('ENROLLED', 'LOST')";
    }
    else if (status) {
        whereStr = 'status = ?';
        whereParams.push(status);
    }
    else {
        whereStr = '1=1';
    }
    const [[countRow]] = await client_js_1.pool.execute(`SELECT COUNT(*) as total FROM \`Lead\` WHERE ${whereStr}`, whereParams);
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
        const query = `SELECT * FROM \`Lead\` WHERE ${whereStr} ORDER BY ${orderByStr} LIMIT ? OFFSET ?`;
        const [rows] = await client_js_1.pool.execute(query, [...whereParams, pageSize, skip]);
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
        .groupBy(schema_js_1.leads.status);
    const counts = {};
    for (const g of groups)
        counts[g.status] = Number(g.count);
    res.json({
        NEW: counts['NEW'] ?? 0,
        CONTACTED: counts['CONTACTED'] ?? 0,
        APPOINTMENT_BOOKED: counts['APPOINTMENT_BOOKED'] ?? 0,
        FOLLOW_UP: counts['FOLLOW_UP'] ?? 0,
        ENROLLED: counts['ENROLLED'] ?? 0,
        LOST: counts['LOST'] ?? 0,
    });
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
    await client_js_1.db.update(schema_js_1.leads).set({
        ...rest,
        ...(childDob ? { childDob: new Date(childDob) } : {}),
    }).where((0, drizzle_orm_1.eq)(schema_js_1.leads.id, id));
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
async function createAppointment(req, res, next) {
    try {
        await _createAppointment(req, res);
    }
    catch (err) {
        next(err);
    }
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
    const event = await calendar.events.insert({
        calendarId: process.env.SHARED_CALENDAR_ID,
        requestBody: {
            summary: `${isPlaceholder ? '【PH】' : ''}School Visit - ${lead.childName}`,
            description: buildEventDescription(lead, whatsappMessage),
            location: process.env.KINDER_ADDRESS ?? '',
            start: { dateTime: start.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
            end: { dateTime: end.toISOString(), timeZone: 'Asia/Kuala_Lumpur' },
        },
    });
    await client_js_1.db.update(schema_js_1.leads).set({
        googleEventId: event.data.id,
        googleEventLink: event.data.htmlLink,
        appointmentStart: start,
        appointmentEnd: end,
        appointmentCreatedByUserId: req.user.id,
        appointmentIsPlaceholder: !!isPlaceholder,
        status: isPlaceholder ? 'CONTACTED' : 'APPOINTMENT_BOOKED',
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
        .where((0, drizzle_orm_1.gte)(schema_js_1.leads.appointmentStart, now))
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
    const noShowLeads = currentLeads.filter(l => l.status === 'LOST' && l.lostReason === "Didn't attend the enquiry").length;
    const attendedAppointments = completedLeads.filter(l => l.appointmentStart !== null &&
        !(l.status === 'LOST' && l.lostReason === "Didn't attend the enquiry")).length;
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
    const [yearRows] = await client_js_1.pool.execute('SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC');
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
    const [yearRows] = await client_js_1.pool.execute('SELECT DISTINCT YEAR(submittedAt) AS year FROM `Lead` ORDER BY year DESC');
    const availableYears = yearRows.map((r) => Number(r.year));
    res.json({
        selectedYear, prevYear, totalLeads, enrolledLeads, lostLeads, closingRate,
        monthlyComparison, monthlyByAge, addressBreakdown, marketingChannelBreakdown,
        leadsTable, availableYears,
    });
}
//# sourceMappingURL=leads.controller.js.map