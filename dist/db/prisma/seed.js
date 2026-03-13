"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function main() {
    // ── Users ────────────────────────────────────────────────────────
    const adminHash = await bcryptjs_1.default.hash('Admin123!', 10);
    const staffHash = await bcryptjs_1.default.hash('Staff123!', 10);
    await prisma.user.upsert({
        where: { email: 'admin@kinderCore.local' },
        update: {},
        create: { email: 'admin@kinderCore.local', name: 'Admin', passwordHash: adminHash, role: 'ADMIN' },
    });
    await prisma.user.upsert({
        where: { email: 'staff@kinderCore.local' },
        update: {},
        create: { email: 'staff@kinderCore.local', name: 'Staff', passwordHash: staffHash, role: 'STAFF' },
    });
    // ── System settings ───────────────────────────────────────────────
    const defaultSettings = [
        { key: 'whatsapp_template', value: 'Hi, this is Ten Toes Preschool. Thanks for your enquiry for {{childName}}. Would you like to arrange a school visit?', description: 'WhatsApp message template. Use {{childName}} as placeholder.' },
        { key: 'appointment_duration_minutes', value: 30, description: 'Default appointment duration in minutes.' },
        { key: 'appointment_lead_time_hours', value: 2, description: 'Hours ahead to schedule appointment from now.' },
        { key: 'kinder_address', value: 'Bukit Indah, Johor Bahru', description: 'Kindergarten address used in Google Calendar events.' },
        { key: 'lost_reasons', value: [
                'Transportation', 'Operating Hours', 'Distance', 'Enrolled other school',
                'Fee too expensive', 'Special Need', 'Class Full', "Didn't reply",
                'Under Age', "Didn't attend the enquiry",
            ], description: 'Dropdown options for marking a lead as Lost.' },
        { key: 'onboarding_tasks', value: [
                'Create parents group (format: Year_ClassName_ChildrenName)',
                'Send welcome message (shortcut: newparentswelcome)',
                'Send registration link (shortcut: newparentsregistration)',
                'Enroll student to app (New enrollment => raw lead => enrolled)',
                'Send Checklist for Completed Registration (shortcut: newparentsregdone)',
                'Assign student to a class and add tag',
                'Send App Invitation Link',
                'Ask Parents to Set Up the Ten Toes App (shortcut: newparentsapp)',
                'Send Checklist for Completed App Setup (shortcut: newparentsappdone)',
                'Send invoice to new parents',
                'Ask Parents to Join the Facebook Group (shortcut: newparentsfb)',
                'Add Parents to the Facebook Group',
            ], description: 'Checklist of tasks to complete when onboarding a new student.' },
    ];
    for (const s of defaultSettings) {
        await prisma.systemSetting.upsert({ where: { key: s.key }, update: {}, create: s });
    }
    // ── Leads — always refresh ────────────────────────────────────────
    await prisma.lead.deleteMany();
    // Helpers
    const d = (y, m, day) => new Date(y, m - 1, day); // childDob
    const at = (y, m, day) => new Date(y, m - 1, day, 10); // submittedAt
    const appt = (y, m, day) => new Date(y, m - 1, day, 10, 0); // appointmentStart/End
    await prisma.lead.createMany({ data: [
            // ════════════════════ JANUARY 2026 (8 leads) ══════════════════════
            {
                childName: 'Priya Nair', parentPhone: '0111234001',
                childDob: d(2021, 9, 12), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 6),
                status: 'ENROLLED',
                appointmentStart: appt(2026, 1, 13), appointmentEnd: appt(2026, 1, 13),
                appointmentIsPlaceholder: false,
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Darren Lim', parentPhone: '0121234002',
                childDob: d(2020, 4, 25), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 8),
                status: 'ENROLLED',
                appointmentStart: appt(2026, 1, 15), appointmentEnd: appt(2026, 1, 15),
                appointmentIsPlaceholder: false,
                relationship: 'Father', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Medini',
                needsTransport: true, howDidYouKnow: 'Google',
            },
            {
                childName: 'Lucas Ong', parentPhone: '0131234003',
                childDob: d(2022, 11, 8), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 10),
                status: 'ENROLLED',
                appointmentStart: appt(2026, 1, 17), appointmentEnd: appt(2026, 1, 17),
                appointmentIsPlaceholder: false,
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Word of mouth',
            },
            {
                childName: 'Nadia Ismail', parentPhone: '0141234004',
                childDob: d(2020, 10, 5), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 13),
                status: 'ENROLLED',
                appointmentStart: appt(2026, 1, 20), appointmentEnd: appt(2026, 1, 20),
                appointmentIsPlaceholder: false,
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Nusajaya',
                needsTransport: true, howDidYouKnow: 'Word of mouth',
            },
            {
                childName: 'Wei Jie Tan', parentPhone: '0151234005',
                childDob: d(2020, 1, 30), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 16),
                status: 'FOLLOW_UP',
                appointmentStart: appt(2026, 1, 23), appointmentEnd: appt(2026, 1, 23),
                appointmentIsPlaceholder: false,
                notes: 'Visited, parent considering options',
                relationship: 'Father', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Google',
            },
            {
                childName: 'Fatimah Zahra', parentPhone: '0161234006',
                childDob: d(2022, 7, 22), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 19),
                status: 'FOLLOW_UP',
                appointmentStart: appt(2026, 1, 26), appointmentEnd: appt(2026, 1, 26),
                appointmentIsPlaceholder: false,
                notes: 'Called after visit, still undecided',
                relationship: 'Mother', programme: 'Basic (8:30am–12:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Iskandar Puteri',
                needsTransport: false, howDidYouKnow: 'Instagram',
            },
            {
                childName: 'Harish Kumar', parentPhone: '0171234007',
                childDob: d(2021, 3, 14), enrolmentYear: 2026,
                submittedAt: at(2026, 1, 22),
                status: 'LOST',
                lostReason: 'Enrolled in another school',
                relationship: 'Father', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Permas Jaya',
                needsTransport: true, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Kavitha Raj', parentPhone: '0181234008',
                childDob: d(2021, 6, 17), enrolmentYear: 2027,
                submittedAt: at(2026, 1, 27),
                status: 'APPOINTMENT_BOOKED',
                appointmentStart: appt(2026, 4, 7), appointmentEnd: appt(2026, 4, 7),
                appointmentIsPlaceholder: false,
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Facebook',
            },
            // ════════════════════ FEBRUARY 2026 (8 leads) ═════════════════════
            {
                childName: 'Nurul Aina', parentPhone: '0191234009',
                childDob: d(2022, 8, 20), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 3),
                status: 'FOLLOW_UP',
                appointmentStart: appt(2026, 2, 10), appointmentEnd: appt(2026, 2, 10),
                appointmentIsPlaceholder: false,
                notes: 'Visited, waiting for spouse confirmation',
                relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Siti Rahmah', parentPhone: '0111234010',
                childDob: d(2021, 12, 3), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 6),
                status: 'CONTACTED',
                appointmentStart: appt(2026, 4, 14), appointmentEnd: appt(2026, 4, 14),
                appointmentIsPlaceholder: true,
                notes: 'Replied via WhatsApp, placeholder scheduled',
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Medini',
                needsTransport: true, howDidYouKnow: 'Google',
            },
            {
                childName: 'Danish Hakim', parentPhone: '0121234011',
                childDob: d(2020, 7, 16), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 10),
                status: 'APPOINTMENT_BOOKED',
                appointmentStart: appt(2026, 4, 9), appointmentEnd: appt(2026, 4, 9),
                appointmentIsPlaceholder: false,
                relationship: 'Father', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Instagram',
            },
            {
                childName: 'Aryan Singh', parentPhone: '0131234012',
                childDob: d(2019, 11, 28), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 13),
                status: 'CONTACTED',
                appointmentStart: appt(2026, 4, 16), appointmentEnd: appt(2026, 4, 16),
                appointmentIsPlaceholder: true,
                relationship: 'Father', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Google',
            },
            {
                childName: 'Jasmine Lee', parentPhone: '0141234013',
                childDob: d(2021, 5, 9), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 17),
                status: 'FOLLOW_UP',
                appointmentStart: appt(2026, 2, 24), appointmentEnd: appt(2026, 2, 24),
                appointmentIsPlaceholder: false,
                notes: 'Interested in full day, price is a concern',
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Permas Jaya',
                needsTransport: true, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Zulkifli Ahmad', parentPhone: '0151234014',
                childDob: d(2020, 9, 14), enrolmentYear: 2026,
                submittedAt: at(2026, 2, 19),
                status: 'LOST',
                lostReason: 'Fee too expensive',
                relationship: 'Father', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Word of mouth',
            },
            {
                childName: 'Alicia Tan', parentPhone: '0161234015',
                childDob: d(2022, 4, 27), enrolmentYear: 2027,
                submittedAt: at(2026, 2, 22),
                status: 'NEW',
                relationship: 'Mother', programme: 'Basic (8:30am–12:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Medini',
                needsTransport: false, howDidYouKnow: 'Flyer / Banner',
            },
            {
                childName: 'Emma Chong', parentPhone: '0171234016',
                childDob: d(2023, 2, 11), enrolmentYear: 2027,
                submittedAt: at(2026, 2, 25),
                status: 'NEW',
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Skudai',
                needsTransport: true, howDidYouKnow: 'Word of mouth',
            },
            // ════════════════════ MARCH 2026 (9 leads) ════════════════════════
            {
                childName: 'Amir Haziq', parentPhone: '0181234017',
                childDob: d(2022, 12, 10), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 3),
                status: 'NEW',
                relationship: 'Father', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Izzatul Husna', parentPhone: '0191234018',
                childDob: d(2021, 8, 3), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 5),
                status: 'CONTACTED',
                appointmentStart: appt(2026, 4, 21), appointmentEnd: appt(2026, 4, 21),
                appointmentIsPlaceholder: true,
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Iskandar Puteri',
                needsTransport: false, howDidYouKnow: 'Google',
            },
            {
                childName: 'Mei Ling Cheah', parentPhone: '0111234019',
                childDob: d(2020, 5, 19), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 7),
                status: 'NEW',
                relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Farhan Aziz', parentPhone: '0121234020',
                childDob: d(2021, 10, 7), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 9),
                status: 'APPOINTMENT_BOOKED',
                appointmentStart: appt(2026, 4, 24), appointmentEnd: appt(2026, 4, 24),
                appointmentIsPlaceholder: false,
                relationship: 'Father', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Medini',
                needsTransport: true, howDidYouKnow: 'Word of mouth',
            },
            {
                childName: 'Gina Soh', parentPhone: '0131234021',
                childDob: d(2020, 3, 22), enrolmentYear: 2027,
                submittedAt: at(2026, 3, 11),
                status: 'NEW',
                relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Nusajaya',
                needsTransport: false, howDidYouKnow: 'Google',
            },
            {
                childName: 'Husni Yusof', parentPhone: '0141234022',
                childDob: d(2019, 6, 14), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 13),
                status: 'NEW',
                relationship: 'Father', programme: 'Basic (8:30am–12:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Flyer / Banner',
            },
            {
                childName: 'Syafiq Razali', parentPhone: '0151234023',
                childDob: d(2021, 7, 31), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 15),
                status: 'NEW',
                relationship: 'Father', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Thursday', addressLocation: 'Permas Jaya',
                needsTransport: true, howDidYouKnow: 'Facebook',
            },
            {
                childName: 'Erica Lim', parentPhone: '0161234024',
                childDob: d(2023, 1, 25), enrolmentYear: 2027,
                submittedAt: at(2026, 3, 17),
                status: 'NEW',
                relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',
                preferredAppointmentTime: 'Tuesday', addressLocation: 'Bukit Indah',
                needsTransport: false, howDidYouKnow: 'Instagram',
            },
            {
                childName: 'Tan Wei Xuan', parentPhone: '0171234025',
                childDob: d(2022, 5, 16), enrolmentYear: 2026,
                submittedAt: at(2026, 3, 19),
                status: 'NEW',
                relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)',
                preferredAppointmentTime: 'Saturday', addressLocation: 'Medini',
                needsTransport: false, howDidYouKnow: 'Word of mouth',
            },
        ] });
    // ── Packages ──────────────────────────────────────────────────────
    await prisma.package.deleteMany();
    const programmes = ['Half Day', 'Full Day', 'Half Day + Enrichment'];
    const ages = [2, 3, 4, 5, 6];
    const packageYears = [2026, 2027];
    const packageData = packageYears.flatMap((year) => programmes.flatMap((programme) => ages.map((age) => ({
        year,
        programme,
        age,
        name: `${year} ${programme} (${age}Y)`,
        price: null,
    }))));
    await prisma.package.createMany({ data: packageData });
    console.log(`Seed complete: 25 test leads + ${packageData.length} packages created.`);
    console.log('Logins: admin@kinderCore.local / Admin123!  |  staff@kinderCore.local / Staff123!');
}
main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=seed.js.map