// Full database seed — run after setup.sql to populate test data.
// Usage: node scripts/seed.js
require('dotenv').config();
const mysql = require('mysql2/promise');
const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');

// ── Onboarding tasks ────────────────────────────────────────────────────────
const ONBOARDING_TASKS = [
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
  'Send Checklist for Completed Facebook Group Joining (shortcut: newparentsfbdone)',
  'Order book, bag, uniform for new students',
  'Send Reminder for Bag & Uniform Collection (shortcut: newparentsbag)',
  'Send Checklist for Completed Bag & Uniform Collection',
];

function makeProgress(doneCnt = 0) {
  return ONBOARDING_TASKS.map((task, i) => ({ task, done: i < doneCnt }));
}

function dt(y, m, day) { return new Date(y, m - 1, day); }
function at(y, m, day) { return new Date(y, m - 1, day, 10, 0, 0); }

// ── Lead data ────────────────────────────────────────────────────────────────
// enrolled: true → student record auto-created with startDate + onboarding progress
const LEADS = [
  // ══ JANUARY 2026 ══
  { childName: 'Priya Nair',    parentPhone: '0111234001', childDob: dt(2021,9,12),  enrolmentYear: 2026, submittedAt: at(2026,1,6),  status: 'ENROLLED',          appointmentStart: at(2026,1,13), relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Facebook',       ctaSource: 'final',   enrolled: { doneTasks: 3,                     notes: null } },
  { childName: 'Darren Lim',    parentPhone: '0121234002', childDob: dt(2020,4,25),  enrolmentYear: 2026, submittedAt: at(2026,1,8),  status: 'ENROLLED',          appointmentStart: at(2026,1,15), relationship: 'Father', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Medini',           needsTransport: true,  howDidYouKnow: 'Google',         ctaSource: 'courses', enrolled: { doneTasks: 8,                     notes: null } },
  { childName: 'Lucas Ong',     parentPhone: '0131234003', childDob: dt(2022,11,8),  enrolmentYear: 2026, submittedAt: at(2026,1,10), status: 'ENROLLED',          appointmentStart: at(2026,1,17), relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Word of mouth',  ctaSource: 'final',   enrolled: { doneTasks: 0,                     notes: 'First child, parents need extra support' } },
  { childName: 'Nadia Ismail',  parentPhone: '0141234004', childDob: dt(2020,10,5),  enrolmentYear: 2026, submittedAt: at(2026,1,13), status: 'ENROLLED',          appointmentStart: at(2026,1,20), relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Nusajaya',         needsTransport: true,  howDidYouKnow: 'Word of mouth',  ctaSource: 'courses', enrolled: { doneTasks: ONBOARDING_TASKS.length, notes: 'Sibling discount applied' } },
  { childName: 'Wei Jie Tan',   parentPhone: '0151234005', childDob: dt(2020,1,30),  enrolmentYear: 2026, submittedAt: at(2026,1,16), status: 'FOLLOW_UP',         appointmentStart: at(2026,1,23), relationship: 'Father', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Google',         ctaSource: 'methods', notes: 'Visited, parent considering options' },
  { childName: 'Fatimah Zahra', parentPhone: '0161234006', childDob: dt(2022,7,22),  enrolmentYear: 2026, submittedAt: at(2026,1,19), status: 'FOLLOW_UP',         appointmentStart: at(2026,1,26), relationship: 'Mother', programme: 'Basic (8:30am–12:30pm)',   addressLocation: 'Iskandar Puteri',  needsTransport: false, howDidYouKnow: 'Instagram',      ctaSource: 'story',   notes: 'Called after visit, still undecided' },
  { childName: 'Harish Kumar',  parentPhone: '0171234007', childDob: dt(2021,3,14),  enrolmentYear: 2026, submittedAt: at(2026,1,22), status: 'LOST',              lostReason: 'Enrolled in another school', relationship: 'Father', programme: 'Full day (8:30am–5:30pm)', addressLocation: 'Permas Jaya', needsTransport: true, howDidYouKnow: 'Facebook', ctaSource: 'hero' },
  { childName: 'Kavitha Raj',   parentPhone: '0181234008', childDob: dt(2021,6,17),  enrolmentYear: 2027, submittedAt: at(2026,1,27), status: 'APPOINTMENT_BOOKED', appointmentStart: at(2026,4,7),  relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Facebook',       ctaSource: 'final' },
  // ══ FEBRUARY 2026 ══
  { childName: 'Nurul Aina',    parentPhone: '0191234009', childDob: dt(2022,8,20),  enrolmentYear: 2026, submittedAt: at(2026,2,3),  status: 'FOLLOW_UP',         appointmentStart: at(2026,2,10), relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Facebook',       ctaSource: 'courses', notes: 'Visited, waiting for spouse confirmation' },
  { childName: 'Siti Rahmah',   parentPhone: '0111234010', childDob: dt(2021,12,3),  enrolmentYear: 2026, submittedAt: at(2026,2,6),  status: 'CONTACTED',         appointmentStart: at(2026,4,14), appointmentIsPlaceholder: true, relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)', addressLocation: 'Medini', needsTransport: true, howDidYouKnow: 'Google', ctaSource: 'methods', notes: 'Replied via WhatsApp, placeholder scheduled' },
  { childName: 'Danish Hakim',  parentPhone: '0121234011', childDob: dt(2020,7,16),  enrolmentYear: 2026, submittedAt: at(2026,2,10), status: 'APPOINTMENT_BOOKED', appointmentStart: at(2026,4,9),  relationship: 'Father', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Instagram',      ctaSource: 'final' },
  { childName: 'Aryan Singh',   parentPhone: '0131234012', childDob: dt(2019,11,28), enrolmentYear: 2026, submittedAt: at(2026,2,13), status: 'CONTACTED',         appointmentStart: at(2026,4,16), appointmentIsPlaceholder: true, relationship: 'Father', programme: 'Full day (8:30am–5:30pm)', addressLocation: 'Bukit Indah', needsTransport: false, howDidYouKnow: 'Google', ctaSource: 'story' },
  { childName: 'Jasmine Lee',   parentPhone: '0141234013', childDob: dt(2021,5,9),   enrolmentYear: 2026, submittedAt: at(2026,2,17), status: 'FOLLOW_UP',         appointmentStart: at(2026,2,24), relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Permas Jaya',      needsTransport: true,  howDidYouKnow: 'Facebook',       ctaSource: 'courses', notes: 'Interested in full day, price is a concern' },
  { childName: 'Zulkifli Ahmad',parentPhone: '0151234014', childDob: dt(2020,9,14),  enrolmentYear: 2026, submittedAt: at(2026,2,19), status: 'LOST',              lostReason: 'Fee too expensive', relationship: 'Father', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah', needsTransport: false, howDidYouKnow: 'Word of mouth', ctaSource: 'hero' },
  { childName: 'Alicia Tan',    parentPhone: '0161234015', childDob: dt(2022,4,27),  enrolmentYear: 2027, submittedAt: at(2026,2,22), status: 'NEW',               relationship: 'Mother', programme: 'Basic (8:30am–12:30pm)',   addressLocation: 'Medini',           needsTransport: false, howDidYouKnow: 'Flyer / Banner', ctaSource: 'hero' },
  { childName: 'Emma Chong',    parentPhone: '0171234016', childDob: dt(2023,2,11),  enrolmentYear: 2027, submittedAt: at(2026,2,25), status: 'NEW',               relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Skudai',           needsTransport: true,  howDidYouKnow: 'Word of mouth',  ctaSource: 'story' },
  // ══ MARCH 2026 ══
  { childName: 'Amir Haziq',    parentPhone: '0181234017', childDob: dt(2022,12,10), enrolmentYear: 2026, submittedAt: at(2026,3,3),  status: 'NEW',               relationship: 'Father', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Facebook',       ctaSource: 'final' },
  { childName: 'Izzatul Husna', parentPhone: '0191234018', childDob: dt(2021,8,3),   enrolmentYear: 2026, submittedAt: at(2026,3,5),  status: 'CONTACTED',         appointmentStart: at(2026,4,21), appointmentIsPlaceholder: true, relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)', addressLocation: 'Iskandar Puteri', needsTransport: false, howDidYouKnow: 'Google', ctaSource: 'courses' },
  { childName: 'Mei Ling Cheah',parentPhone: '0111234019', childDob: dt(2020,5,19),  enrolmentYear: 2026, submittedAt: at(2026,3,7),  status: 'NEW',               relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Facebook',       ctaSource: 'methods' },
  { childName: 'Farhan Aziz',   parentPhone: '0121234020', childDob: dt(2021,10,7),  enrolmentYear: 2026, submittedAt: at(2026,3,9),  status: 'APPOINTMENT_BOOKED', appointmentStart: at(2026,4,24), relationship: 'Father', programme: 'Full day (8:30am–5:30pm)', addressLocation: 'Medini', needsTransport: true, howDidYouKnow: 'Word of mouth', ctaSource: 'final' },
  { childName: 'Sofia Yusof',   parentPhone: '0131234021', childDob: dt(2020,3,22),  enrolmentYear: 2027, submittedAt: at(2026,3,11), status: 'NEW',               relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Nusajaya',         needsTransport: false, howDidYouKnow: 'Google',         ctaSource: 'story' },
  { childName: 'Husni Yusof',   parentPhone: '0141234022', childDob: dt(2019,6,14),  enrolmentYear: 2026, submittedAt: at(2026,3,13), status: 'NEW',               relationship: 'Father', programme: 'Basic (8:30am–12:30pm)',   addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Flyer / Banner', ctaSource: 'hero' },
  { childName: 'Syafiq Razali', parentPhone: '0151234023', childDob: dt(2021,7,31),  enrolmentYear: 2026, submittedAt: at(2026,3,15), status: 'NEW',               relationship: 'Father', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Permas Jaya',      needsTransport: true,  howDidYouKnow: 'Facebook',       ctaSource: 'methods' },
  { childName: 'Erica Lim',     parentPhone: '0161234024', childDob: dt(2023,1,25),  enrolmentYear: 2027, submittedAt: at(2026,3,17), status: 'NEW',               relationship: 'Mother', programme: 'Full day (8:30am–5:30pm)',  addressLocation: 'Bukit Indah',      needsTransport: false, howDidYouKnow: 'Instagram',      ctaSource: 'courses' },
  { childName: 'Tan Wei Xuan',  parentPhone: '0171234025', childDob: dt(2022,5,16),  enrolmentYear: 2026, submittedAt: at(2026,3,8), status: 'NEW',               relationship: 'Mother', programme: 'Half day (8:30am–2:30pm)', addressLocation: 'Medini',           needsTransport: false, howDidYouKnow: 'Word of mouth',  ctaSource: 'final' },
];

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // ── Clear (order respects FK constraints) ──────────────────────────────────
  await conn.execute('DELETE FROM `Student`');
  await conn.execute('DELETE FROM `Lead`');
  await conn.execute('DELETE FROM `Package`');
  await conn.execute('DELETE FROM `SystemSetting`');
  await conn.execute('DELETE FROM `User`');
  console.log('✓ Cleared all tables\n');

  // ── Users ──────────────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('Admin123!', 10);
  const staffHash = await bcrypt.hash('Staff123!', 10);
  await conn.execute(
    'INSERT INTO `User` (id, email, name, passwordHash, role, createdAt, updatedAt) VALUES (?,?,?,?,?,NOW(),NOW()),(?,?,?,?,?,NOW(),NOW())',
    [randomUUID(), 'admin@kindercore.com', 'Admin', adminHash, 'ADMIN',
     randomUUID(), 'staff@kinderCore.local', 'Staff', staffHash, 'STAFF']
  );
  console.log('✓ Users');

  // ── System Settings ────────────────────────────────────────────────────────
  const settings = [
    ['whatsapp_template',             JSON.stringify('Hi, this is Ten Toes Preschool. Thanks for your enquiry for {{childName}}. Would you like to arrange a school visit?'), 'WhatsApp message template.'],
    ['whatsapp_template_zh',          JSON.stringify('您好，这是Ten Toes Preschool。感谢您对{{childName}}的询问。您想安排参观学校吗？'), 'WhatsApp Chinese template.'],
    ['whatsapp_followup_template',    JSON.stringify('Hi, just following up on your enquiry for {{childName}}. Are you still interested?'), 'Follow-up WhatsApp template.'],
    ['whatsapp_followup_template_zh', JSON.stringify('您好，我想跟进一下您对{{childName}}的询问。您还有兴趣吗？'), 'Follow-up Chinese template.'],
    ['interview_wa_template',         JSON.stringify('Hi {{firstName}}, thank you for applying{{positionSuffix}} at our kindergarten.\n\nWe would like to invite you for an interview:\n\nDate: {{interviewDay}}, {{interviewDate}}\nTime: {{interviewTime}} – {{interviewEndTime}}\n\nPlease reply to confirm, or let us know if you need to reschedule.\n\nThank you!'), 'Interview invitation WhatsApp template (English).'],
    ['interview_wa_template_zh',      JSON.stringify('您好{{firstName}}，感谢您申请我们幼儿园的{{position}}职位。\n\n我们诚意邀请您前来面试：\n\n日期：{{interviewDay}}，{{interviewDate}}\n时间：{{interviewTime}} – {{interviewEndTime}}\n\n请回复确认，如需改期请告知我们。\n\n谢谢！'), 'Interview invitation WhatsApp template (Chinese).'],
    ['appointment_duration_minutes',  '30',  'Default appointment duration in minutes.'],
    ['appointment_lead_time_hours',   '2',   'Hours ahead to schedule appointment from now.'],
    ['kinder_address',                JSON.stringify('Bukit Indah, Johor Bahru'), 'Kindergarten address.'],
    ['lost_reasons',                  JSON.stringify(['Transportation','Operating Hours','Distance','Enrolled other school','Fee too expensive','Special Need','Class Full',"Didn't reply",'Under Age',"Didn't attend the enquiry"]), 'Lost reason options.'],
    ['onboarding_tasks',              JSON.stringify(ONBOARDING_TASKS), 'Onboarding checklist tasks.'],
  ];
  for (const [key, value, description] of settings) {
    await conn.execute(
      'INSERT INTO `SystemSetting` (id, `key`, `value`, description, updatedAt) VALUES (?,?,?,?,NOW())',
      [randomUUID(), key, value, description]
    );
  }
  console.log('✓ System settings');

  // ── Packages ───────────────────────────────────────────────────────────────
  const programmes = ['Half Day', 'Full Day', 'Half Day + Enrichment'];
  const ages = [2, 3, 4, 5, 6];
  for (const year of [2026, 2027]) {
    for (const programme of programmes) {
      for (const age of ages) {
        await conn.execute(
          'INSERT INTO `Package` (id, year, programme, age, name, price, updatedAt) VALUES (?,?,?,?,?,NULL,NOW())',
          [randomUUID(), year, programme, age, `${year} ${programme} (${age}Y)`]
        );
      }
    }
  }
  console.log('✓ Packages (30)');

  // ── Leads + Students ───────────────────────────────────────────────────────
  let leadCount = 0, studentCount = 0;

  for (const lead of LEADS) {
    const leadId = randomUUID();
    await conn.execute(
      `INSERT INTO \`Lead\`
         (id, submittedAt, childName, parentPhone, childDob, enrolmentYear, status, notes,
          appointmentStart, appointmentEnd, appointmentIsPlaceholder, lostReason,
          relationship, programme, addressLocation, needsTransport, howDidYouKnow, ctaSource)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        leadId,
        lead.submittedAt,
        lead.childName,
        lead.parentPhone,
        lead.childDob,
        lead.enrolmentYear,
        lead.status,
        lead.notes ?? null,
        lead.appointmentStart ?? null,
        lead.appointmentStart ?? null,   // appointmentEnd mirrors start
        lead.appointmentIsPlaceholder ? 1 : 0,
        lead.lostReason ?? null,
        lead.relationship ?? null,
        lead.programme ?? null,
        lead.addressLocation ?? null,
        lead.needsTransport ? 1 : 0,
        lead.howDidYouKnow ?? null,
        lead.ctaSource ?? null,
      ]
    );
    leadCount++;

    // Auto-create student for ENROLLED leads
    if (lead.enrolled) {
      const { doneTasks, notes: studentNotes } = lead.enrolled;
      const childYear = lead.childDob.getFullYear();
      const age = lead.enrolmentYear - childYear;

      // Match package by year + age (programme from lead is verbose, match on Full/Half Day)
      const prog = lead.programme?.includes('Full') ? 'Full Day' : 'Half Day';
      const [[pkg]] = await conn.execute(
        'SELECT id FROM `Package` WHERE year = ? AND age = ? AND programme = ? LIMIT 1',
        [lead.enrolmentYear, age, prog]
      );
      const packageId = pkg?.id ?? (await conn.execute(
        'SELECT id FROM `Package` WHERE year = ? LIMIT 1', [lead.enrolmentYear]
      ))[0][0]?.id;

      if (!packageId) { console.warn(`  ⚠ No package for ${lead.childName}, skipping student`); continue; }

      // startDate = appointmentStart + 7 days (matching enrollment modal business rule)
      const base = new Date(lead.appointmentStart ?? lead.submittedAt);
      base.setDate(base.getDate() + 7);
      base.setHours(0, 0, 0, 0);
      const startDate    = base;
      const month        = startDate.getMonth() + 1;
      const enrolledAt   = lead.appointmentStart ?? lead.submittedAt;
      const progress     = makeProgress(doneTasks);

      await conn.execute(
        `INSERT INTO \`Student\`
           (id, leadId, enrolmentYear, enrolmentMonth, packageId, enrolledAt, startDate,
            notes, onboardingProgress, onboardingCompleted, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?,0,NOW())`,
        [
          randomUUID(), leadId, lead.enrolmentYear, month, packageId,
          enrolledAt, startDate, studentNotes ?? null, JSON.stringify(progress),
        ]
      );
      studentCount++;
      console.log(`  ✓ ${lead.childName.padEnd(16)} tasks ${doneTasks}/${ONBOARDING_TASKS.length}  starts ${startDate.toDateString()}`);
    }
  }

  console.log(`\n✓ Leads (${leadCount})  ✓ Students (${studentCount})`);
  console.log('\nLogins:  admin@kindercore.com / Admin123!   |   staff@kinderCore.local / Staff123!');
  await conn.end();
}

run().catch(console.error);
