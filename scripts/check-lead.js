require('dotenv').config();
const mysql = require('mysql2/promise');
async function run() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  const [rows] = await conn.execute('SELECT childName, submittedAt, status FROM `Lead` WHERE childName LIKE ?', ['%Hii King Yik%']);
  console.log(JSON.stringify(rows, null, 2));
  await conn.end();
}
run().catch(console.error);
