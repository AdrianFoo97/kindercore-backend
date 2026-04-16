import 'dotenv/config';
import mysql from 'mysql2/promise';

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return `'${v.toISOString().replace('T', ' ').slice(0, 23)}'`;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
};

const toInsert = (table: string, rows: any[]): string => {
  if (!rows.length) return `-- No rows in ${table}\n`;
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `\`${c}\``).join(', ');
  const lines = rows.map((row, i) => {
    const vals = cols.map(c => esc(row[c])).join(', ');
    return `  (${vals})${i < rows.length - 1 ? ',' : ';'}`;
  });
  return `INSERT IGNORE INTO \`${table}\` (${colList}) VALUES\n${lines.join('\n')}\n`;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL not set'); process.exit(1); }
  const conn = await mysql.createConnection(url);
  const q = async (sql: string) => (await conn.execute(sql) as any[])[0] as any[];

  const positions       = await q('SELECT * FROM `Position` ORDER BY sortOrder');
  const levelIncentives = await q('SELECT * FROM `LevelIncentive` ORDER BY positionId, level');
  const allowanceTypes  = await q('SELECT * FROM `AllowanceType` ORDER BY sortOrder');
  const teacherAllows   = await q('SELECT * FROM `TeacherAllowance`');
  const careerRecords   = await q('SELECT * FROM `CareerRecord` ORDER BY effectiveDate');
  await conn.end();

  const out = [
    '-- ── Seed: Positions, LevelIncentives, AllowanceTypes, TeacherAllowances, CareerRecords ──',
    '-- Generated from local DB. INSERT IGNORE is safe to run multiple times.',
    '',
    '-- Positions',
    toInsert('Position', positions),
    '-- Level Incentives',
    toInsert('LevelIncentive', levelIncentives),
    '-- Allowance Types',
    toInsert('AllowanceType', allowanceTypes),
    '-- Teacher Allowances',
    toInsert('TeacherAllowance', teacherAllows),
    '-- Career Records',
    toInsert('CareerRecord', careerRecords),
  ];
  console.log(out.join('\n'));
}

main().catch(err => { console.error(err); process.exit(1); });
