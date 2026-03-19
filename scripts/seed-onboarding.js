require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const tasks = [
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
  await conn.execute('UPDATE `SystemSetting` SET `value` = ?, `updatedAt` = NOW() WHERE `key` = ?', [JSON.stringify(tasks), 'onboarding_tasks']);
  const [rows] = await conn.execute('SELECT `value` FROM `SystemSetting` WHERE `key` = ?', ['onboarding_tasks']);
  const stored = rows[0].value;
  const arr = Array.isArray(stored) ? stored : JSON.parse(stored);
  console.log('Updated:', arr.length, 'tasks');
  arr.forEach((t, i) => console.log(`  ${i + 1}. ${t}`));
  await conn.end();
}

run().catch(console.error);
