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
const client_1 = require("@prisma/client");
const client_js_1 = require("../db/client.js");
const lead_validator_js_1 = require("../validators/lead.validator.js");
async function createLead(req, res) {
    const parsed = lead_validator_js_1.createLeadSchema.safeParse(req.body);
    if (!parsed.success) {
        res
            .status(400)
            .json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { childName, parentPhone, childDob, enrolmentYear, company, relationship, programme, preferredAppointmentTime, addressLocation, needsTransport, howDidYouKnow } = parsed.data;
    if (company) {
        res.status(400).json({ message: 'Bad request' });
        return;
    }
    const lead = await client_js_1.prisma.lead.create({
        data: {
            childName, parentPhone, childDob: new Date(childDob), enrolmentYear,
            relationship, programme, preferredAppointmentTime, addressLocation,
            needsTransport, howDidYouKnow,
        },
    });
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
    await client_js_1.prisma.lead.updateMany({
        where: { status: 'APPOINTMENT_BOOKED', appointmentStart: { lt: new Date() } },
        data: { status: 'FOLLOW_UP' },
    });
    const where = status === 'active' ? { status: { notIn: ['ENROLLED', 'LOST'] } } :
        status === 'inactive' ? { status: { in: ['ENROLLED', 'LOST'] } } :
            status ? { status: status } :
                {};
    const total = await client_js_1.prisma.lead.count({ where });
    // Status sort uses CASE WHEN for custom enum order; active filter also enforces status as primary sort
    const needsRawQuery = sortByStatus || status === 'active';
    let items;
    if (needsRawQuery) {
        const fieldSqlMap = {
            submittedAt: client_1.Prisma.sql `\`submittedAt\``,
            childName: client_1.Prisma.sql `\`childName\``,
            childDob: client_1.Prisma.sql `\`childDob\``,
            enrolmentYear: client_1.Prisma.sql `\`enrolmentYear\``,
        };
        const dir = order === 'asc' ? client_1.Prisma.sql `ASC` : client_1.Prisma.sql `DESC`;
        const revDir = order === 'asc' ? client_1.Prisma.sql `DESC` : client_1.Prisma.sql `ASC`;
        // Status CASE expression (asc = NEW first, desc = FOLLOW_UP first)
        const statusCase = client_1.Prisma.sql `CASE status
      WHEN 'NEW' THEN 1
      WHEN 'CONTACTED' THEN 2
      WHEN 'APPOINTMENT_BOOKED' THEN 3
      WHEN 'FOLLOW_UP' THEN 4
      WHEN 'ENROLLED' THEN 5
      WHEN 'LOST' THEN 6
      ELSE 7
    END`;
        // Build WHERE clause
        const whereClause = status === 'active' ? client_1.Prisma.sql `status NOT IN ('ENROLLED', 'LOST')` :
            status === 'inactive' ? client_1.Prisma.sql `status IN ('ENROLLED', 'LOST')` :
                status ? client_1.Prisma.sql `status = ${status}` :
                    client_1.Prisma.sql `1=1`;
        if (sortByStatus) {
            // Sorting by status column: use custom order, secondary by submittedAt desc
            items = await client_js_1.prisma.$queryRaw `
        SELECT * FROM \`Lead\`
        WHERE ${whereClause}
        ORDER BY ${statusCase} ${dir}, \`submittedAt\` DESC
        LIMIT ${pageSize} OFFSET ${skip}
      `;
        }
        else {
            // Active filter with non-status sort: status as primary, chosen field as secondary
            const secondaryField = fieldSqlMap[field] ?? client_1.Prisma.sql `\`submittedAt\``;
            items = await client_js_1.prisma.$queryRaw `
        SELECT * FROM \`Lead\`
        WHERE ${whereClause}
        ORDER BY ${statusCase} ASC, ${secondaryField} ${dir}
        LIMIT ${pageSize} OFFSET ${skip}
      `;
        }
    }
    else {
        items = await client_js_1.prisma.lead.findMany({
            skip,
            take: pageSize,
            where,
            orderBy: { [field]: order },
        });
    }
    res.json({ items, total, page, pageSize });
}
async function getLeadStats(req, res) {
    const groups = await client_js_1.prisma.lead.groupBy({
        by: ['status'],
        _count: { id: true },
    });
    const counts = {};
    for (const g of groups)
        counts[g.status] = g._count.id;
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
        res
            .status(400)
            .json({ message: 'Validation error', errors: parsed.error.errors });
        return;
    }
    const { childDob, ...rest } = parsed.data;
    try {
        const lead = await client_js_1.prisma.lead.update({
            where: { id },
            data: {
                ...rest,
                ...(childDob ? { childDob: new Date(childDob) } : {}),
            },
        });
        res.json(lead);
    }
    catch {
        res.status(404).json({ message: 'Lead not found' });
    }
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
    const connection = await client_js_1.prisma.googleConnection.findFirst();
    if (!connection) {
        res.status(409).json({ message: 'Google calendar not connected' });
        return;
    }
    const lead = await client_js_1.prisma.lead.findUnique({ where: { id } });
    if (!lead) {
        res.status(404).json({ message: 'Lead not found' });
        return;
    }
    const start = appointmentStartStr
        ? new Date(appointmentStartStr)
        : roundUpTo30Min(new Date(Date.now() + 2 * 60 * 60 * 1000));
    const durationSetting = await client_js_1.prisma.systemSetting.findUnique({
        where: { key: 'appointment_duration_minutes' },
    });
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
            await client_js_1.prisma.googleConnection.updateMany({
                data: {
                    accessToken: tokens.access_token,
                    ...(tokens.expiry_date != null
                        ? { expiryDate: BigInt(tokens.expiry_date) }
                        : {}),
                },
            });
        }
    });
    const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    // Delete existing calendar event if rescheduling
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
            start: {
                dateTime: start.toISOString(),
                timeZone: 'Asia/Kuala_Lumpur',
            },
            end: {
                dateTime: end.toISOString(),
                timeZone: 'Asia/Kuala_Lumpur',
            },
        },
    });
    await client_js_1.prisma.lead.update({
        where: { id },
        data: {
            googleEventId: event.data.id,
            googleEventLink: event.data.htmlLink,
            appointmentStart: start,
            appointmentEnd: end,
            appointmentCreatedByUserId: req.user.id,
            appointmentIsPlaceholder: !!isPlaceholder,
            status: isPlaceholder ? 'CONTACTED' : 'APPOINTMENT_BOOKED',
        },
    });
    res.json({
        googleEventId: event.data.id,
        googleEventLink: event.data.htmlLink,
    });
}
async function getUpcomingAppointments(req, res) {
    const now = new Date();
    const items = await client_js_1.prisma.lead.findMany({
        where: { appointmentStart: { gte: now } },
        orderBy: { appointmentStart: 'asc' },
        select: {
            id: true,
            childName: true,
            parentPhone: true,
            appointmentStart: true,
            appointmentEnd: true,
            appointmentIsPlaceholder: true,
        },
    });
    res.json(items);
}
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function getAnalytics(req, res) {
    const selectedYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const prevYear = selectedYear - 1;
    const dateRange = (y) => ({
        submittedAt: { gte: new Date(y, 0, 1), lt: new Date(y + 1, 0, 1) },
    });
    // Fetch current-year leads (full fields) and previous-year leads (submittedAt only)
    const [currentLeads, prevLeads] = await Promise.all([
        client_js_1.prisma.lead.findMany({
            where: dateRange(selectedYear),
            select: { submittedAt: true, childDob: true, appointmentStart: true, addressLocation: true, howDidYouKnow: true, status: true, lostReason: true },
        }),
        client_js_1.prisma.lead.findMany({
            where: dateRange(prevYear),
            select: { submittedAt: true },
        }),
    ]);
    const totalLeads = currentLeads.length;
    const totalAppointments = currentLeads.filter(l => l.appointmentStart !== null).length;
    const completedLeads = currentLeads.filter(l => l.status === 'ENROLLED' || l.status === 'LOST');
    const noShowLeads = currentLeads.filter(l => l.status === 'LOST' && l.lostReason === "Didn't attend the enquiry").length;
    // Attended = completed lead with appointment AND not "Didn't attend the enquiry"
    const attendedAppointments = completedLeads.filter(l => l.appointmentStart !== null &&
        !(l.status === 'LOST' && l.lostReason === "Didn't attend the enquiry")).length;
    const appointmentRate = completedLeads.length > 0 ? attendedAppointments / completedLeads.length : 0;
    // Year-over-year monthly comparison (Jan–Dec, 12 entries)
    const currentMonthly = new Array(12).fill(0);
    for (const l of currentLeads)
        currentMonthly[l.submittedAt.getMonth()]++;
    const prevMonthly = new Array(12).fill(0);
    for (const l of prevLeads)
        prevMonthly[l.submittedAt.getMonth()]++;
    const monthlyComparison = MONTH_LABELS.map((label, i) => ({
        month: label, current: currentMonthly[i], previous: prevMonthly[i],
    }));
    // Monthly enquiries broken down by child age
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
    // Address breakdown
    const addressMap = new Map();
    for (const lead of currentLeads) {
        if (lead.addressLocation)
            addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
    }
    const addressBreakdown = Array.from(addressMap.entries())
        .map(([location, count]) => ({ location, count }))
        .sort((a, b) => b.count - a.count);
    // Marketing channel breakdown
    const channelMap = new Map();
    for (const lead of currentLeads) {
        if (lead.howDidYouKnow)
            channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
    }
    const marketingChannelBreakdown = Array.from(channelMap.entries())
        .map(([channel, count]) => ({ channel, count }))
        .sort((a, b) => b.count - a.count);
    // Per-lead detail for frontend month filtering
    const leadsDetail = currentLeads.map(l => ({
        monthIdx: l.submittedAt.getMonth(),
        address: l.addressLocation ?? null,
        channel: l.howDidYouKnow ?? null,
    }));
    // Available submission years for the dropdown
    const yearRows = await client_js_1.prisma.$queryRaw `
    SELECT DISTINCT YEAR(submittedAt) AS year FROM \`Lead\` ORDER BY year DESC
  `;
    const availableYears = yearRows.map(r => r.year);
    res.json({
        selectedYear, prevYear,
        totalLeads, totalAppointments, completedLeads: completedLeads.length, attendedAppointments, noShowLeads, appointmentRate,
        monthlyComparison, monthlyByAge,
        addressBreakdown, marketingChannelBreakdown,
        leadsDetail,
        availableYears,
    });
}
async function getSalesAnalytics(req, res) {
    const selectedYear = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();
    const prevYear = selectedYear - 1;
    // Sales funnel: ENROLLED (closed) + LOST where reason ≠ "Didn't attend the enquiry" (lost sales)
    // Filtered by the year leads were submitted (submittedAt), not enrolment year
    // Leads lost with "Didn't attend the enquiry" are excluded from the funnel entirely
    const closedFilter = (year) => ({
        submittedAt: {
            gte: new Date(`${year}-01-01T00:00:00.000Z`),
            lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
        OR: [
            { status: 'ENROLLED' },
            { status: 'LOST', NOT: { lostReason: "Didn't attend the enquiry" } },
        ],
    });
    const [leads, prevLeads] = await Promise.all([
        client_js_1.prisma.lead.findMany({
            where: closedFilter(selectedYear),
            select: {
                id: true, childName: true, notes: true, lostReason: true,
                addressLocation: true, howDidYouKnow: true,
                childDob: true, submittedAt: true, status: true, enrolmentYear: true,
            },
            orderBy: { submittedAt: 'asc' },
        }),
        client_js_1.prisma.lead.findMany({
            where: closedFilter(prevYear),
            select: { submittedAt: true, status: true },
        }),
    ]);
    const totalLeads = leads.length;
    const enrolledLeads = leads.filter(l => l.status === 'ENROLLED').length;
    const lostLeads = leads.filter(l => l.status === 'LOST').length;
    const closingRate = totalLeads > 0 ? enrolledLeads / totalLeads : 0;
    // Year-over-year monthly comparison — stacked enrolled + lost, previous year as line
    const enrolledMonthly = new Array(12).fill(0);
    const lostMonthly = new Array(12).fill(0);
    for (const l of leads) {
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
    // Monthly breakdown by age (all leads for this enrolment year, grouped by submission month)
    const monthMap = new Map();
    for (const lead of leads) {
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
    // Address & channel breakdowns
    const addressMap = new Map();
    const channelMap = new Map();
    for (const lead of leads) {
        if (lead.addressLocation)
            addressMap.set(lead.addressLocation, (addressMap.get(lead.addressLocation) ?? 0) + 1);
        if (lead.howDidYouKnow)
            channelMap.set(lead.howDidYouKnow, (channelMap.get(lead.howDidYouKnow) ?? 0) + 1);
    }
    const addressBreakdown = Array.from(addressMap.entries()).map(([location, count]) => ({ location, count })).sort((a, b) => b.count - a.count);
    const marketingChannelBreakdown = Array.from(channelMap.entries()).map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);
    // Leads table (includes calculated age)
    const leadsTable = leads.map(lead => {
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
    // Available years based on submittedAt
    const allYears = await client_js_1.prisma.$queryRaw `
    SELECT DISTINCT YEAR(submittedAt) AS year FROM \`Lead\` ORDER BY year DESC
  `;
    const availableYears = allYears.map(r => r.year);
    res.json({ selectedYear, prevYear, totalLeads, enrolledLeads, lostLeads, closingRate, monthlyComparison, monthlyByAge, addressBreakdown, marketingChannelBreakdown, leadsTable, availableYears });
}
//# sourceMappingURL=leads.controller.js.map