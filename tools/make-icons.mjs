// Generates PWA icons (PNG) from an inline SVG using headless Chrome.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "icons");
await mkdir(outDir, { recursive: true });

// Wrench/toolbox glyph — matches the in-app "Utilities" logo.
const GLYPH = `
  <g fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2-2 2.6-2.6z"/>
  </g>`;

function svg({ size, rx, maskable }) {
  const bg = maskable
    ? `<rect width="24" height="24" fill="#0d9488"/>`
    : `<rect width="24" height="24" rx="${rx}" fill="#0d9488"/>`;
  const glyph = maskable ? `<g transform="translate(4.8 4.8) scale(0.6)">${GLYPH}</g>` : GLYPH;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}">${bg}${glyph}</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, rx: 4.4, maskable: false },
  { file: "icon-512.png", size: 512, rx: 4.4, maskable: false },
  { file: "icon-512-maskable.png", size: 512, rx: 0, maskable: true },
  { file: "apple-touch-icon.png", size: 180, rx: 0, maskable: true },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0}</style>${svg(t)}`,
    { waitUntil: "load" }
  );
  const buf = await page.screenshot({ omitBackground: !t.maskable, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  await writeFile(join(outDir, t.file), buf);
  console.log("wrote icons/" + t.file + " (" + t.size + "px)");
}
await browser.close();
