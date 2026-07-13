// Generates sample PDFs used by the e2e test.
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
await mkdir(dir, { recursive: true });

async function makePdf(label, pageCount) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pageCount; i++) {
    const page = doc.addPage([300, 400]);
    page.drawText(`${label} — page ${i}/${pageCount}`, { x: 30, y: 350, size: 16, font, color: rgb(0.05, 0.3, 0.29) });
    page.drawRectangle({ x: 20, y: 20, width: 260, height: 360, borderColor: rgb(0.08, 0.6, 0.55), borderWidth: 1 });
  }
  return doc.save();
}

const specs = [
  ["doc-A.pdf", "Document A", 3],
  ["doc-B.pdf", "Document B", 1],
  ["doc-C.pdf", "Document C", 2],
];

for (const [name, label, pages] of specs) {
  await writeFile(join(dir, name), await makePdf(label, pages));
}

// A non-PDF file to verify rejection.
await writeFile(join(dir, "not-a-pdf.txt"), "i am plainly not a pdf");

// Small solid-color PNGs for the Images → PDF test (1×1 is a valid image).
// PNG_RED: 1×1 RGBA (color type 6) — required for createImageBitmap in Chrome.
const PNG_RED = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const PNG_BLUE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
await writeFile(join(dir, "img-red.png"), Buffer.from(PNG_RED, "base64"));
await writeFile(join(dir, "img-blue.png"), Buffer.from(PNG_BLUE, "base64"));

console.log("Fixtures written to", dir);
console.log("Expected total pages when all merged:", specs.reduce((s, [, , p]) => s + p, 0));
