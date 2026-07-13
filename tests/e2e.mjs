// End-to-end test: drives the real UI in headless Chrome and verifies the merge.
import { chromium } from "playwright";
import { PDFDocument } from "pdf-lib";
import { createServer } from "node:http";
import { readFile, stat, mkdtemp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(root, "tests", "fixtures");
const PORT = 8799;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf", ".webmanifest": "application/manifest+json", ".json": "application/json", ".png": "image/png" };

// --- tiny static server (loopback only) ---
const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel === "/" || rel.endsWith("/")) rel += "index.html";
    const p = join(root, rel);
    const data = await readFile(p);
    res.writeHead(200, { "Content-Type": MIME[extname(p)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

try {
  await page.goto(`http://127.0.0.1:${PORT}/index.html`);

  console.log("\nEmpty state:");
  check("summary hidden", await page.locator("#summary").isHidden());
  check("actions hidden", await page.locator("#actions").isHidden());

  console.log("\nPWA wiring:");
  check("manifest linked", (await page.locator('link[rel="manifest"]').count()) === 1);
  const manRes = await page.request.get(`http://127.0.0.1:${PORT}/manifest.webmanifest`);
  const man = await manRes.json();
  check("manifest has name + icons", man.name === "Utilities" && Array.isArray(man.icons) && man.icons.length >= 2, JSON.stringify(man.name));
  check("manifest display standalone", man.display === "standalone");
  check("icons reachable (192)", (await page.request.get(`http://127.0.0.1:${PORT}/icons/icon-192.png`)).ok());
  const swReady = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const timeout = new Promise((r) => setTimeout(() => r(null), 8000));
    const reg = await Promise.race([navigator.serviceWorker.ready, timeout]).catch(() => null);
    return !!(reg && (reg.active || reg.installing || reg.waiting));
  });
  check("service worker registered + active", swReady === true);

  console.log("\nAdd files (3 PDFs + 1 non-PDF):");
  await page.setInputFiles("#fileInput", [
    join(fixtures, "doc-A.pdf"),
    join(fixtures, "doc-B.pdf"),
    join(fixtures, "doc-C.pdf"),
    join(fixtures, "not-a-pdf.txt"),
  ]);
  // Wait until all 3 rows are "ready" (thumbnail rendered).
  await page.waitForFunction(() => document.querySelectorAll("li.file .thumb img").length === 3, { timeout: 15000 });

  check("3 file rows shown", (await page.locator("li.file").count()) === 3);
  check("non-PDF rejected (only 3 rows)", (await page.locator("li.file").count()) === 3);
  check("thumbnails rendered", (await page.locator("li.file .thumb img").count()) === 3);
  check("page total = 6", (await page.locator("#statPages").textContent()).trim() === "6", `got "${await page.locator("#statPages").textContent()}"`);
  const sizeText = (await page.locator("#statSize").textContent()).trim();
  check("size estimate shown (~est.)", /MB|KB|B/.test(sizeText) && /est\./.test(sizeText), `got "${sizeText}"`);
  check("merge button enabled", await page.locator("#mergeBtn").isEnabled());

  console.log("\nReorder via ▲▼ (move last row up to first):");
  const firstNameBefore = (await page.locator("li.file .fname").first().textContent()).trim();
  await page.locator('li.file:last-child button[aria-label="Move up"]').click();
  await page.locator('li.file:nth-child(2) button[aria-label="Move up"]').click();
  const firstNameAfter = (await page.locator("li.file .fname").first().textContent()).trim();
  check("order changed after moves", firstNameBefore !== firstNameAfter, `before="${firstNameBefore}" after="${firstNameAfter}"`);
  check("order badge #1 present", (await page.locator("li.file .order-badge").first().textContent()).trim() === "1");

  console.log("\nRemove a file:");
  await page.locator("li.file:first-child button[aria-label^='Remove']").click();
  await page.waitForFunction(() => document.querySelectorAll("li.file").length === 2);
  check("2 rows after remove", (await page.locator("li.file").count()) === 2);

  console.log("\nMerge + download:");
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#mergeBtn").click();
  await page.waitForSelector("#result:not(.hidden)", { timeout: 15000 });
  check("result card shown", await page.locator("#result").isVisible());
  const resultMeta = (await page.locator("#resultMeta").textContent()).trim();
  check("result meta reports pages/size/files", /pages.*·.*·.*files/.test(resultMeta), `got "${resultMeta}"`);

  await page.locator("#downloadLink").click();
  const download = await downloadPromise;
  const outPath = join(root, "tests", "fixtures", "merged-output.pdf");
  await download.saveAs(outPath);

  // Verify the actual merged PDF. We merged 2 of the 3 docs (one removed).
  const merged = await PDFDocument.load(await readFile(outPath));
  const remainingRows = await page.locator("li.file .fname").allTextContents();
  console.log("    merged from rows:", remainingRows.map((s) => s.trim()).join(", "));
  // Two remaining docs: their page counts depend on which was removed (we removed the first row after reorder).
  check("merged PDF is valid and non-empty", merged.getPageCount() > 0, `pages=${merged.getPageCount()}`);
  const outStat = await stat(outPath);
  check("merged file has real size", outStat.size > 500, `bytes=${outStat.size}`);

  console.log("\nClear all + Undo:");
  await page.locator("#clearBtn").click();
  await page.waitForFunction(() => document.querySelectorAll("li.file").length === 0);
  check("list cleared", (await page.locator("li.file").count()) === 0);
  check("undo toast shown", await page.locator(".notice .n-action", { hasText: "Undo" }).isVisible());
  await page.locator(".notice .n-action", { hasText: "Undo" }).click();
  await page.waitForFunction(() => document.querySelectorAll("li.file").length === 2);
  check("undo restored 2 rows", (await page.locator("li.file").count()) === 2);

  // ===================== SPLIT MODE =====================
  console.log("\nSplit — switch tab:");
  await page.locator('.tab[data-tab="split"]').click();
  check("split view visible", await page.locator("#splitView").isVisible());
  check("merge view hidden", await page.locator("#mergeView").isHidden());
  check("tab aria-pressed set", (await page.locator('.tab[data-tab="split"]').getAttribute("aria-pressed")) === "true");

  console.log("\nSplit — load a 3-page PDF:");
  await page.setInputFiles("#splitInput", join(fixtures, "doc-A.pdf"));
  await page.waitForFunction(() => document.querySelectorAll("#pageGrid .page-cell .pthumb img").length === 3, { timeout: 15000 });
  check("3 page cells rendered", (await page.locator("#pageGrid .page-cell").count()) === 3);
  check("2 cut slots between pages", (await page.locator("#pageGrid .cut-slot").count()) === 2);
  check("pages stat = 3", (await page.locator("#splitPages").textContent()).trim() === "3");
  check("parts stat = 1 (no cuts)", (await page.locator("#splitParts").textContent()).trim() === "1");
  check("split disabled with no cuts", await page.locator("#splitBtn").isDisabled());

  console.log("\nSplit — add a cut:");
  await page.locator('#pageGrid .cut-slot[data-after="0"]').click();
  check("parts = 2 after one cut", (await page.locator("#splitParts").textContent()).trim() === "2");
  check("cut slot pressed", (await page.locator('#pageGrid .cut-slot[data-after="0"]').getAttribute("aria-pressed")) === "true");
  check("split enabled", await page.locator("#splitBtn").isEnabled());
  check("part labels shown", (await page.locator("#pageGrid .ppart").first().textContent()).trim() === "Part 1");

  console.log("\nSplit — presets:");
  await page.locator("#presetBurst").click();
  check("burst → 3 parts", (await page.locator("#splitParts").textContent()).trim() === "3");
  await page.fill("#everyN", "2");
  await page.locator("#presetEvery").click();
  check("every 2 → 2 parts (p1-2, p3)", (await page.locator("#splitParts").textContent()).trim() === "2");

  console.log("\nSplit — clear cuts + undo:");
  await page.locator("#clearCuts").click();
  check("parts = 1 after clear", (await page.locator("#splitParts").textContent()).trim() === "1");
  check("undo toast shown", await page.locator(".notice .n-action", { hasText: "Undo" }).isVisible());
  await page.locator(".notice .n-action", { hasText: "Undo" }).click();
  check("undo restored parts = 2", (await page.locator("#splitParts").textContent()).trim() === "2");

  console.log("\nSplit — run split + verify zip:");
  const splitDownloadPromise = page.waitForEvent("download");
  await page.locator("#splitBtn").click();
  await page.waitForSelector("#splitResult:not(.hidden)", { timeout: 15000 });
  check("split result shown", await page.locator("#splitResult").isVisible());
  await page.locator("#splitDownloadLink").click();
  const zipDownload = await splitDownloadPromise;
  const tmp = await mkdtemp(join(tmpdir(), "pdfsplit-"));
  const zipPath = join(tmp, "parts.zip");
  await zipDownload.saveAs(zipPath);
  check("downloaded name ends -parts.zip", /-parts\.zip$/.test(zipDownload.suggestedFilename()), zipDownload.suggestedFilename());

  // Extract and validate each part PDF.
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", tmp]);
  const parts = readdirSync(tmp).filter((f) => f.toLowerCase().endsWith(".pdf")).sort();
  check("zip contains 2 part PDFs", parts.length === 2, "got " + JSON.stringify(parts));
  let pagesSum = 0;
  for (const p of parts) {
    const d = await PDFDocument.load(await readFile(join(tmp, p)));
    pagesSum += d.getPageCount();
  }
  // Last state was "every 2": part1 = pages 1-2 (2pp), part2 = page 3 (1pp) → total 3.
  check("part page counts sum to 3", pagesSum === 3, "sum=" + pagesSum);

  console.log("\nSplit — remove PDF resets view:");
  await page.locator("#splitClearBtn").click();
  await page.waitForFunction(() => document.querySelectorAll("#pageGrid .page-cell").length === 0);
  check("grid cleared", (await page.locator("#pageGrid .page-cell").count()) === 0);
  check("toolbar hidden", await page.locator("#splitToolbar").isHidden());

  // ===================== COMPRESS MODE =====================
  console.log("\nCompress — load + compress:");
  await page.locator('.tab[data-tab="compress"]').click();
  check("compress view visible", await page.locator("#compressView").isVisible());
  await page.setInputFiles("#compressInput", join(fixtures, "doc-A.pdf"));
  await page.waitForSelector("#compressActions:not(.hidden)", { timeout: 10000 });
  check("compress pages = 3", (await page.locator("#compressPages").textContent()).trim() === "3");
  check("original size shown", /B|KB|MB/.test((await page.locator("#compressOrig").textContent()).trim()));
  await page.selectOption("#compressLevel", "low");
  const compDownloadPromise = page.waitForEvent("download");
  await page.locator("#compressBtn").click();
  await page.waitForSelector("#compressResult:not(.hidden)", { timeout: 20000 });
  check("compress result shown", await page.locator("#compressResult").isVisible());
  await page.locator("#compressDownloadLink").click();
  const compDownload = await compDownloadPromise;
  const compPath = join(root, "tests", "fixtures", "compressed-out.pdf");
  await compDownload.saveAs(compPath);
  const compDoc = await PDFDocument.load(await readFile(compPath));
  check("compressed PDF valid, 3 pages", compDoc.getPageCount() === 3, "pages=" + compDoc.getPageCount());

  // ===================== IMAGES → PDF MODE =====================
  console.log("\nImages → PDF:");
  await page.locator('.tab[data-tab="images"]').click();
  check("images view visible", await page.locator("#imagesView").isVisible());
  await page.setInputFiles("#imagesInput", [join(fixtures, "img-red.png"), join(fixtures, "img-blue.png")]);
  await page.waitForFunction(() => document.querySelectorAll("#imagesList li.file").length === 2, { timeout: 10000 });
  check("2 image rows", (await page.locator("#imagesList li.file").count()) === 2);
  check("images button enabled", await page.locator("#imagesBtn").isEnabled());
  const imgDownloadPromise = page.waitForEvent("download");
  await page.locator("#imagesBtn").click();
  await page.waitForSelector("#imagesResult:not(.hidden)", { timeout: 15000 });
  check("images result shown", await page.locator("#imagesResult").isVisible());
  await page.locator("#imagesDownloadLink").click();
  const imgDownload = await imgDownloadPromise;
  const imgPath = join(root, "tests", "fixtures", "images-out.pdf");
  await imgDownload.saveAs(imgPath);
  const imgDoc = await PDFDocument.load(await readFile(imgPath));
  check("images PDF has 2 pages", imgDoc.getPageCount() === 2, "pages=" + imgDoc.getPageCount());

  console.log("\nImages — clear + undo:");
  await page.locator("#imagesClearBtn").click();
  await page.waitForFunction(() => document.querySelectorAll("#imagesList li.file").length === 0);
  check("images cleared", (await page.locator("#imagesList li.file").count()) === 0);
  check("undo toast shown", await page.locator(".notice .n-action", { hasText: "Undo" }).isVisible());

  // ===================== REDACT MODE =====================
  console.log("\nRedact — load + draw + apply:");
  await page.locator('.tab[data-tab="redact"]').click();
  check("redact view visible", await page.locator("#redactView").isVisible());
  await page.setInputFiles("#redactInput", join(fixtures, "doc-A.pdf"));
  await page.waitForSelector("#redactStage:not(.hidden)", { timeout: 10000 });
  await page.waitForFunction(() => { const c = document.getElementById("redactCanvas"); return c && c.width > 0; }, { timeout: 10000 });
  check("page indicator 1 / 3", (await page.locator("#redactPageNum").textContent()).trim() === "1 / 3");
  check("redact button disabled (no marks)", await page.locator("#redactBtn").isDisabled());

  // Draw a rectangle on the overlay via mouse drag.
  await page.locator("#redactOverlay").scrollIntoViewIfNeeded();
  const ov = await page.locator("#redactOverlay").boundingBox();
  await page.mouse.move(ov.x + ov.width * 0.2, ov.y + ov.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(ov.x + ov.width * 0.6, ov.y + ov.height * 0.4, { steps: 8 });
  await page.mouse.up();
  check("1 mark after drawing", (await page.locator("#redactMarkCount").textContent()).trim() === "1");
  check("mark rendered on overlay", (await page.locator("#redactOverlay .redact-mark").count()) === 1);
  check("redact button enabled", await page.locator("#redactBtn").isEnabled());

  const redDownloadPromise = page.waitForEvent("download");
  await page.locator("#redactBtn").click();
  await page.waitForSelector("#redactResult:not(.hidden)", { timeout: 20000 });
  check("redact result shown", await page.locator("#redactResult").isVisible());
  await page.locator("#redactDownloadLink").click();
  const redDownload = await redDownloadPromise;
  const redPath = join(root, "tests", "fixtures", "redacted-out.pdf");
  await redDownload.saveAs(redPath);
  const redDoc = await PDFDocument.load(await readFile(redPath));
  check("redacted PDF valid, 3 pages", redDoc.getPageCount() === 3, "pages=" + redDoc.getPageCount());
  check("download name ends -redacted.pdf", /-redacted\.pdf$/.test(redDownload.suggestedFilename()), redDownload.suggestedFilename());

  // ---- Base64 section ----
  console.log("\nBase64 encode/decode:");
  await page.evaluate(() => document.getElementById("notices").replaceChildren()); // clear stale toasts overlapping the tab bar
  await page.locator('.side-item[data-section="base64"]').click();
  check("base64 view visible", await page.locator("#base64View").isVisible());
  check("redact view hidden", await page.locator("#redactView").isHidden());
  check("encode sub-tab active by default", await page.locator("#b64EncPanel").isVisible());

  // Encode UTF-8 text (Turkish chars) and verify round-trip against Node's Buffer.
  const sample = "Merhaba dünya — zeka & çgöş";
  await page.locator("#b64Text").fill(sample);
  const encOut = (await page.locator("#b64EncOut").inputValue()).trim();
  const expected = Buffer.from(sample, "utf8").toString("base64");
  check("UTF-8 text encodes correctly", encOut === expected, `got ${encOut}`);

  // Decode it back.
  await page.locator('.tab[data-tab="b64dec"]').click();
  check("decode panel visible", await page.locator("#b64DecPanel").isVisible());
  await page.locator("#b64DecIn").fill(encOut);
  await page.locator("#b64DecBtn2").click();
  check("decoded text matches original", (await page.locator("#b64DecOut").inputValue()) === sample);

  // Decode a PNG data URL → image preview shown, text hidden.
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC";
  await page.locator("#b64DecIn").fill(pngDataUrl);
  await page.locator("#b64DecBtn2").click();
  check("image preview shown for PNG", await page.locator("#b64DecImg").isVisible());
  check("text output hidden for image", await page.locator("#b64DecText").isHidden());

  // Encoding a file while on the Decode sub-tab must surface the Encode panel (review fix).
  await page.setInputFiles("#b64FileInput", join(fixtures, "img-red.png"));
  check("encode panel surfaced on file input", await page.locator("#b64EncPanel").isVisible());
  await page.waitForFunction(() => document.getElementById("b64EncOut").value.startsWith("data:"), { timeout: 5000 });
  check("encode output is a data URL", (await page.locator("#b64EncOut").inputValue()).startsWith("data:image/png;base64,"));
  check("encode sub-tab re-activated", (await page.locator('.tab[data-tab="b64enc"]').getAttribute("aria-pressed")) === "true");

  console.log("\nData → CSV↔JSON:");
  await page.click('.side-item[data-section="data"]');
  await page.click('.tab[data-tab="csvjson"]');
  await page.fill("#cjInput", 'name,note\nAda,"hi, there"\nBob,plain');
  await page.click("#cjToJson");
  const cjJson = JSON.parse(await page.inputValue("#cjOutput"));
  check("csv→json parses quoted comma", cjJson.length === 2 && cjJson[0].note === "hi, there");
  await page.fill("#cjInput", await page.inputValue("#cjOutput"));
  await page.click("#cjToCsv");
  const cjCsv = await page.inputValue("#cjOutput");
  check("json→csv round-trips quoting", cjCsv.includes('"hi, there"') && cjCsv.includes("name,note"));

  console.log("\nData → Text Diff:");
  await page.click('.side-item[data-section="data"]');
  await page.click('.tab[data-tab="diff"]');
  await page.fill("#diffA", "one\ntwo\nthree");
  await page.fill("#diffB", "one\n2\nthree");
  await page.click("#diffRun");
  const removed = await page.locator("#diffOut .d-del").allInnerTexts();
  const added = await page.locator("#diffOut .d-add").allInnerTexts();
  check("diff flags changed line", removed.some((t) => t.includes("two")) && added.some((t) => t.includes("2")));
  check("diff keeps unchanged lines", (await page.locator("#diffOut .d-eq").count()) === 2);

  console.log("\nImage → Strip EXIF:");
  await page.click('.side-item[data-section="image"]');
  await page.click('.tab[data-tab="exif"]');
  await page.setInputFiles("#exifInput", join(fixtures, "img-red.png"));
  await page.waitForSelector("#exifResult:not(.hidden)", { timeout: 10000 });
  const exifDownloadPromise = page.waitForEvent("download");
  await page.click("#exifDownload");
  const exifDl = await exifDownloadPromise;
  const exifPath = join(await mkdtemp(join(tmpdir(), "exif-")), "out.png");
  await exifDl.saveAs(exifPath);
  const exifBytes = await readFile(exifPath);
  check("strip-exif output is a PNG", exifBytes[0] === 0x89 && exifBytes[1] === 0x50);
  check("strip-exif output has no APP1/Exif marker", !exifBytes.includes(Buffer.from("Exif")));

  console.log("\nImage → Background Remover:");
  await page.click('.side-item[data-section="image"]');
  await page.click('.tab[data-tab="bg"]');
  await page.setInputFiles("#bgInput", join(fixtures, "img-blue.png"));
  await page.waitForSelector("#bgResult:not(.hidden)");
  const bgDl = await Promise.all([
    page.waitForEvent("download"),
    page.click("#bgDownload"),
  ]).then(([d]) => d);
  const bgPath = join(await mkdtemp(join(tmpdir(), "bg-")), "out.png");
  await bgDl.saveAs(bgPath);
  // Decode the PNG corner alpha via the page's own canvas.
  const cornerAlpha = await page.evaluate(async (dataUrl) => {
    const img = new Image(); img.src = dataUrl; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, 1, 1).data[3];
  }, "data:image/png;base64," + (await readFile(bgPath)).toString("base64"));
  check("bg-remove makes a solid background transparent", cornerAlpha === 0);

  console.log("\nPDF → Sign/Stamp:");
  await page.click('.side-item[data-section="pdf"]');
  await page.click('.tab[data-tab="sign"]');
  await page.setInputFiles("#signInput", join(fixtures, "doc-A.pdf"));
  await page.waitForSelector("#signCanvas");
  await page.setInputFiles("#signImgInput", join(fixtures, "img-red.png"));
  await page.waitForSelector("#signStamp:not(.hidden)");
  const signDl = await Promise.all([
    page.waitForEvent("download"),
    page.click("#signApply"),
  ]).then(([d]) => d);
  const signPath = join(await mkdtemp(join(tmpdir(), "sign-")), "out.pdf");
  await signDl.saveAs(signPath);
  const signBytes = await readFile(signPath);
  const signDoc = await PDFDocument.load(signBytes);
  const srcDoc = await PDFDocument.load(await readFile(join(fixtures, "doc-A.pdf")));
  check("signed PDF keeps page count", signDoc.getPageCount() === srcDoc.getPageCount());
  check("signed PDF embeds the stamp (larger)", signBytes.length > (await stat(join(fixtures, "doc-A.pdf"))).size);

  console.log("\nRuntime errors:");
  // Ignore the benign pdf.js worker fallback warning if present.
  const realErrors = pageErrors.filter((e) => !/worker/i.test(e));
  check("no uncaught page errors", realErrors.length === 0, realErrors.join(" | "));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
