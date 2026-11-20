// A tiny made-up P&L as a real PDF with a text layer, built in code — so
// import tests never use the real statements in `test data/`.

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/** One page of plain text lines, as a valid PDF. */
export function makePdf(lines: string[]): Buffer {
  const stream = `BT /F1 10 Tf 14 TL 50 800 Td ${lines.map(l => `(${esc(l)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/** The made-up September 2026 P&L used by the import tests, as printed text… */
export const SAMPLE_PNL_LINES = [
  'Sunflower Kindergarten - Profit & Loss', 'Current Month 30/09/2026',
  'REVENUE', 'Sales 5,000.00', '5,000.00',
  'Administrative Expenses', 'Rental 4,200.00', 'Petrol 179.86', 'Fire Extinguisher 1,570.00', '5,949.86',
  'Staff Cost', 'Salaries 2,500.00', '2,500.00',
];

/** …and what a provider reading it should return. */
export const SAMPLE_PNL_READING = {
  period: { year: 2026, month: 9 },
  sections: [
    { title: 'Revenue', kind: 'REVENUE', printedSubtotal: 5000, lines: [{ name: 'Sales', amount: 5000 }] },
    { title: 'Administrative Expenses', kind: 'EXPENSE', printedSubtotal: 5949.86, lines: [
      { name: 'Rental', amount: 4200 }, { name: 'Petrol', amount: 179.86 }, { name: 'Fire Extinguisher', amount: 1570 },
    ] },
    { title: 'Staff Cost', kind: 'EXPENSE', printedSubtotal: 2500, lines: [{ name: 'Salaries', amount: 2500 }] },
  ],
};
