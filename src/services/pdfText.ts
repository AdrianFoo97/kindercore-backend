// The text printed in a PDF — used to prove an AI reading against the file
// itself. Text only (Mozilla's pdf.js): nothing is rendered and no script in
// the file ever runs. A scanned PDF has no text, so this returns '' (never
// throws): the import then marks every amount "check by eye" instead.

interface TextItem { str?: string; hasEOL?: boolean }
interface PdfJs {
  getDocument(src: { data: Uint8Array; isEvalSupported: boolean; disableFontFace: boolean; useSystemFonts: boolean; verbosity: number }): {
    promise: Promise<{ numPages: number; getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }>; destroy(): Promise<void> }>;
  };
}

/**
 * pdf.js ships as an ES module only. This backend compiles to CommonJS, where
 * import() becomes require() — which loads ES modules on Node 20.19+ / 22.12+.
 * (A non-literal specifier keeps TypeScript from resolving pdf.js's own types.)
 */
const PDFJS_MODULE: string = 'pdfjs-dist/legacy/build/pdf.mjs';
let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjs ??= import(PDFJS_MODULE) as Promise<PdfJs>);

/** Quietest pdf.js logging (errors only). */
const VERBOSITY_ERRORS = 0;

export async function pdfText(pdf: Buffer): Promise<string> {
  try {
    const { getDocument } = await loadPdfJs();
    const doc = await getDocument({
      data: new Uint8Array(pdf), isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: VERBOSITY_ERRORS,
    }).promise;
    try {
      const pages: string[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { items } = await (await doc.getPage(n)).getTextContent();
        pages.push(items.map(i => (i.str ?? '') + (i.hasEOL ? '\n' : ' ')).join(''));
      }
      return pages.join('\n');
    } finally {
      await doc.destroy().catch(() => undefined);
    }
  } catch (e) {
    // Not fatal: the import still works, but every amount is "check by eye".
    console.warn('[pnl-import] Couldn’t read the PDF’s text:', e instanceof Error ? e.message : e);
    return '';
  }
}
