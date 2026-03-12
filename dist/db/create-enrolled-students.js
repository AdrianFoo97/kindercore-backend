import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
function mapProgramme(raw) {
    if (!raw)
        return 'Half Day';
    const s = raw.toLowerCase();
    if (s.includes('full day') || s.includes('全天'))
        return 'Full Day';
    if (s.includes('enrichment') || s.includes('6 hour') || s.includes('6hour'))
        return 'Half Day + Enrichment';
    return 'Half Day';
}
async function main() {
    const enrolledLeads = await prisma.lead.findMany({
        where: { status: 'ENROLLED' },
        include: { student: true },
    });
    console.log(`Found ${enrolledLeads.length} enrolled leads`);
    let created = 0;
    let skipped = 0;
    for (const lead of enrolledLeads) {
        if (lead.student) {
            skipped++;
            continue;
        }
        // Derive package fields
        const enrolmentYear = lead.enrolmentYear || new Date(lead.submittedAt).getFullYear() + 1;
        const programme = mapProgramme(lead.programme);
        const birthYear = new Date(lead.childDob).getFullYear();
        const age = Math.max(1, enrolmentYear - birthYear);
        const enrolmentMonth = lead.appointmentStart
            ? new Date(lead.appointmentStart).getMonth() + 1
            : 1;
        // Find or create the package
        let pkg = await prisma.package.findUnique({
            where: { year_programme_age: { year: enrolmentYear, programme, age } },
        });
        if (!pkg) {
            pkg = await prisma.package.create({
                data: {
                    year: enrolmentYear,
                    programme,
                    age,
                    name: `${enrolmentYear} ${programme} (Age ${age})`,
                    price: null,
                },
            });
            console.log(`  Created package: ${pkg.name}`);
        }
        await prisma.student.create({
            data: {
                leadId: lead.id,
                enrolmentYear,
                enrolmentMonth,
                packageId: pkg.id,
            },
        });
        created++;
    }
    console.log(`Done — students created: ${created}, already had student: ${skipped}`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
//# sourceMappingURL=create-enrolled-students.js.map