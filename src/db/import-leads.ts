import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../../../../data/Leads.xlsx');

function excelSerialToDate(serial: number): Date {
  // Excel epoch: Dec 30, 1899 (accounts for the 1900 leap-year bug)
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
}

function normalizePhone(raw: string): string {
  const clean = String(raw).replace(/[\s\-()]/g, '');
  if (clean.startsWith('+')) return clean;
  if (clean.startsWith('60')) return '+' + clean;
  if (clean.startsWith('0')) return '+60' + clean.slice(1);
  return '+60' + clean;
}

function mapStatus(row: Record<string, unknown>): { status: string; lostReason: string | null } {
  const enrolled   = Boolean(row['Enrolled \u62a5\u540d']);
  const declined   = Boolean(row['Declined \u6ca1\u6709\u62a5\u540d']);
  const rejected   = Boolean(row['Reject']);
  const noShow     = Boolean(row["Didn't attend \u6ca1\u6709\u51fa\u5e2d"]);
  const followUp   = Boolean(row['Follow Up']);
  const attended   = Boolean(row['Attended \u51fa\u5e2d']);
  const hasAppt    = Boolean(row['Appointment date']);

  const declineReason = String(row['Reject / Declined Reason'] ?? '').trim();

  if (enrolled)  return { status: 'ENROLLED',          lostReason: null };
  if (declined)  return { status: 'LOST',              lostReason: declineReason || 'Declined' };
  if (rejected)  return { status: 'LOST',              lostReason: declineReason || 'Rejected' };
  if (noShow)    return { status: 'LOST',              lostReason: "Didn't attend the enquiry" };
  if (followUp)  return { status: 'FOLLOW_UP',         lostReason: null };
  if (attended)  return { status: 'FOLLOW_UP',         lostReason: null };
  if (hasAppt)   return { status: 'APPOINTMENT_BOOKED', lostReason: null };
  return           { status: 'NEW',                    lostReason: null };
}

async function main() {
  const wb = XLSX.readFile(DATA_FILE);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  console.log(`Read ${rows.length} rows from ${DATA_FILE}`);

  // Clear existing lead data
  await prisma.student.deleteMany();
  await prisma.lead.deleteMany();
  console.log('Cleared existing leads and students');

  let imported = 0;
  let skipped  = 0;

  for (const row of rows) {
    const childName = String(row["Your child's name  \u60a8\u5b69\u5b50\u7684\u59d3\u540d "] ?? '').trim();
    const phoneRaw  = String(row["Your contact No  \u60a8\u7684\u8054\u7edc\u53f7\u7801 "] ?? '').trim();

    if (!childName || !phoneRaw) { skipped++; continue; }

    const parentPhone = normalizePhone(phoneRaw);

    const tsSerial  = Number(row['Timestamp']);
    const submittedAt = tsSerial ? excelSerialToDate(tsSerial) : new Date();

    const dobSerial = Number(row["Your child's birthday  \u60a8\u5b69\u5b50\u7684\u751f\u65e5"]);
    const childDob  = dobSerial ? excelSerialToDate(dobSerial) : new Date('2020-01-01');

    const apptSerial    = Number(row['Appointment date']);
    const appointmentStart = apptSerial ? excelSerialToDate(apptSerial) : null;
    const appointmentEnd   = appointmentStart ? new Date(appointmentStart.getTime() + 3600000) : null;

    const enrolmentYear = Number(row['Enrolment year \u5165\u5b66\u5e74\u4efd']) || submittedAt.getFullYear() + 1;

    const { status, lostReason } = mapStatus(row);

    const relationship           = String(row["What's your relationship with your children  \u60a8\u4e0e\u5b69\u5b50\u7684\u5173\u7cfb "] ?? '').trim() || null;
    const programme              = String(row["Which programme are you interested?  \u60a8\u5bf9\u54ea\u4e2a\u8bfe\u7a0b\u611f\u5174\u8da3\uff1f"] ?? '').trim() || null;
    const preferredAppointmentTime = String(row["Your preferred appointment time  \u60a8\u65b9\u4fbf\u9884\u7ea6\u7684\u65f6\u95f4"] ?? '').trim() || null;
    const addressLocation        = String(row["Your address location  \u60a8\u7684\u4f4f\u5bb6\u82b1\u56ed "] ?? '').trim() || null;
    const howDidYouKnow          = String(row["How do you know about Ten Toes Bukit Indah?  \u60a8\u662f\u600e\u4e48\u77e5\u9053Ten Toes Bukit Indah\u5462\uff1f"] ?? '').trim() || null;

    const transportRaw = String(row["Do you need transport service? \u60a8\u9700\u8981\u6821\u8f66\u670d\u52a1\u5417\uff1f "] ?? '');
    const needsTransport = transportRaw.toLowerCase().includes('yes') || transportRaw.includes('\u662f\u7684') ? true
                         : transportRaw.toLowerCase().includes('no')  || transportRaw.includes('\u4e0d\u9700\u8981') ? false
                         : null;

    const notes = String(row['Remarks'] ?? '').trim() || null;

    try {
      await prisma.lead.create({
        data: {
          submittedAt,
          childName,
          parentPhone,
          childDob,
          enrolmentYear,
          status: status as Parameters<typeof prisma.lead.create>[0]['data']['status'],
          notes,
          appointmentStart,
          appointmentEnd,
          lostReason,
          relationship,
          programme,
          preferredAppointmentTime,
          addressLocation,
          needsTransport,
          howDidYouKnow,
        },
      });
      imported++;
    } catch (err) {
      console.error(`  Skipped "${childName}": ${(err as Error).message}`);
      skipped++;
    }
  }

  console.log(`Done — imported: ${imported}, skipped: ${skipped}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
