"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const xlsx_1 = __importDefault(require("xlsx"));
const path_1 = __importDefault(require("path"));
const url_1 = require("url");
const prisma = new client_1.PrismaClient();
const __dirname = path_1.default.dirname((0, url_1.fileURLToPath)(import.meta.url));
// Convert Excel serial date to JS Date
function excelDateToJs(serial) {
    return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}
// Normalize phone to +60xxx format
function normalizePhone(raw) {
    const cleaned = String(raw).replace(/[\s\-()]/g, '').trim();
    if (cleaned.startsWith('+'))
        return cleaned;
    if (cleaned.startsWith('0'))
        return '+60' + cleaned.slice(1);
    return '+60' + cleaned;
}
// Map status flags to LeadStatus
function resolveStatus(row) {
    const enrolled = !!row[15];
    const declined = !!row[16];
    const rejected = !!row[17];
    const didntAttend = !!row[14];
    const attended = !!row[13];
    const hasAppt = !!row[11];
    const reason = row[22] ? String(row[22]).trim() : undefined;
    if (enrolled)
        return { status: 'ENROLLED' };
    if (declined)
        return { status: 'LOST', lostReason: reason };
    if (rejected)
        return { status: 'LOST', lostReason: reason };
    if (didntAttend)
        return { status: 'LOST', lostReason: "Didn't attend the enquiry" };
    if (attended)
        return { status: 'FOLLOW_UP' };
    if (hasAppt)
        return { status: 'APPOINTMENT_BOOKED' };
    return { status: 'NEW' };
}
async function main() {
    console.log('Resetting database...');
    await prisma.student.deleteMany();
    await prisma.lead.deleteMany();
    await prisma.googleConnection.deleteMany();
    await prisma.systemSetting.deleteMany();
    await prisma.package.deleteMany();
    await prisma.user.deleteMany();
    // Re-seed users
    console.log('Seeding users...');
    const adminHash = await bcryptjs_1.default.hash('Admin123!', 10);
    const staffHash = await bcryptjs_1.default.hash('Staff123!', 10);
    await prisma.user.createMany({
        data: [
            { email: 'admin@kinderCore.local', name: 'Admin', passwordHash: adminHash, role: 'ADMIN' },
            { email: 'staff@kinderCore.local', name: 'Staff', passwordHash: staffHash, role: 'STAFF' },
        ],
    });
    // Re-seed system settings
    await prisma.systemSetting.createMany({
        data: [
            { key: 'whatsapp_template', value: JSON.stringify('Hi, this is Ten Toes Preschool. Thanks for your enquiry for {{childName}}. Would you like to arrange a school visit?'), description: 'WhatsApp message template.' },
            { key: 'appointment_duration_minutes', value: JSON.stringify(30), description: 'Default appointment duration in minutes.' },
            { key: 'appointment_lead_time_hours', value: JSON.stringify(2), description: 'Hours ahead to schedule appointment from now.' },
            { key: 'kinder_address', value: JSON.stringify('Bukit Indah, Johor Bahru'), description: 'Kindergarten address used in Google Calendar events.' },
            { key: 'lost_reasons', value: JSON.stringify(["Class full", "Price", "Location", "Programme not suitable", "No response", "Didn't attend the enquiry", "Others"]), description: 'Selectable lost/declined reasons.' },
            { key: 'onboarding_tasks', value: JSON.stringify([]), description: 'Onboarding task checklist template.' },
        ],
    });
    // Load Excel
    console.log('Reading Leads.xlsx...');
    const wb = xlsx_1.default.readFile(path_1.default.resolve(__dirname, '../../../../../data/Leads.xlsx'));
    const ws = wb.Sheets['Responses'];
    const rows = xlsx_1.default.utils.sheet_to_json(ws, { header: 1 });
    let imported = 0;
    let skipped = 0;
    for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        // Skip empty rows
        if (!row || !row[0] || !row[1] || !row[2] || !row[3]) {
            skipped++;
            continue;
        }
        const timestamp = row[0];
        const childName = String(row[1]).trim();
        const rawPhone = String(row[2]).trim();
        const dobSerial = row[3];
        const relationship = row[4] ? String(row[4]).trim() : undefined;
        const programme = row[5] ? String(row[5]).trim() : undefined;
        const prefTime = row[6] ? String(row[6]).trim() : undefined;
        const address = row[7] ? String(row[7]).trim() : undefined;
        const transportRaw = row[8] ? String(row[8]).trim() : '';
        const howKnow = row[9] ? String(row[9]).trim() : undefined;
        const apptSerial = row[11];
        const details = row[19] ? String(row[19]).trim() : undefined;
        const enrolYear = row[20] ? Number(row[20]) : undefined;
        const remarks = row[21] ? String(row[21]).trim() : undefined;
        if (!childName || !rawPhone || typeof timestamp !== 'number' || typeof dobSerial !== 'number') {
            skipped++;
            continue;
        }
        const submittedAt = excelDateToJs(timestamp);
        const childDob = excelDateToJs(dobSerial);
        const parentPhone = normalizePhone(rawPhone);
        const needsTransport = transportRaw.toLowerCase().startsWith('yes');
        const enrolmentYear = enrolYear ?? submittedAt.getFullYear();
        const notes = [details, remarks].filter(Boolean).join('\n') || undefined;
        const { status, lostReason } = resolveStatus(row);
        let appointmentStart;
        let appointmentEnd;
        if (typeof apptSerial === 'number' && apptSerial > 0) {
            appointmentStart = excelDateToJs(apptSerial);
            appointmentEnd = new Date(appointmentStart.getTime() + 30 * 60 * 1000);
        }
        try {
            await prisma.lead.create({
                data: {
                    submittedAt,
                    childName,
                    parentPhone,
                    childDob,
                    enrolmentYear,
                    status: status,
                    notes,
                    lostReason,
                    relationship,
                    programme,
                    preferredAppointmentTime: prefTime,
                    addressLocation: address,
                    needsTransport,
                    howDidYouKnow: howKnow,
                    ...(appointmentStart ? { appointmentStart, appointmentEnd } : {}),
                },
            });
            imported++;
        }
        catch (err) {
            console.warn(`Row ${i} skipped: ${err.message}`);
            skipped++;
        }
    }
    console.log(`\nDone. Imported: ${imported} leads | Skipped: ${skipped} rows`);
    console.log('Logins: admin@kinderCore.local / Admin123!  |  staff@kinderCore.local / Staff123!');
}
main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
//# sourceMappingURL=import-leads.js.map