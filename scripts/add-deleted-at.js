require('dotenv').config();
const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    await conn.execute('ALTER TABLE `Lead` ADD COLUMN `deletedAt` DATETIME(3) NULL');
    console.log('Column deletedAt added');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('Column already exists');
    else throw e;
  }
  await conn.end();
}
run().catch(console.error);
