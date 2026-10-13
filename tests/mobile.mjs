// Mobile check: phone viewport + touch emulation. Taps through every section and
// sub-tool, asserts no horizontal page scroll and ≥44px nav targets, taps every
// drop zone and expects a file chooser, and loads files through it for merge + images.
// Screenshots go to tests/screenshots-mobile/ (gitignored).
import { chromium, webkit, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(root, "tests", "fixtures");
const shots = join(root, "tests", "screenshots-mobile");
await mkdir(shots, { recursive: true });
const PORT = 8798;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png" };

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(req.url.split("?")[0]);
    if (rel.endsWith("/")) rel += "index.html";
    const data = await readFile(join(root, rel));
    res.writeHead(200, { "Content-Type": MIME[extname(rel)] || "application/octet-stream" });
    res.end(data);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const iphone = devices["iPhone 13"];
const runs = [
  ["chrome 375x812", chromium, { channel: "chrome" }, { ...iphone, viewport: { width: 375, height: 812 } }, true],
  ["chrome iPhone 13", chromium, { channel: "chrome" }, iphone, false],
  ["webkit iPhone 13", webkit, {}, iphone, false],
];

try {
  for (const [label, type, launchOpts, ctxOpts, screenshot] of runs) {
    let browser;
    try { browser = await type.launch(launchOpts); }
    catch { console.log(`\n${label}: SKIPPED (browser not installed — npx playwright install webkit)`); continue; }
    console.log(`\n${label}:`);
    const width = ctxOpts.viewport.width;
    const page = await (await browser.newContext(ctxOpts)).newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForSelector(".side-item");
    if (screenshot) await page.screenshot({ path: join(shots, "main.png") });

    const sections = await page.locator(".side-item").evaluateAll((els) => els.map((e) => e.dataset.section));
    check("4 sections in the mobile nav", sections.length === 4, String(sections));
    const navSmall = await page.locator(".side-item").evaluateAll((els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.height < 44 || r.width < 44 || r.right > innerWidth; }).length);
    check("section buttons ≥44px and on-screen", navSmall === 0);

    let leaves = 0, wide = [], noPickBtn = [], unreached = [], zonesNoChooser = [], zones = 0;
    for (const sec of sections) {
      await page.locator(`.side-item[data-section="${sec}"]`).tap();
      const subs = await page.locator(".tab").evaluateAll((els) => els.map((e) => e.dataset.tab));
      for (const sub of subs) {
        await page.locator(`.tab[data-tab="${sub}"]`).tap();
        leaves++;
        const ok = await page.locator(`.tab[data-tab="${sub}"]`).getAttribute("aria-pressed") === "true"
          && (await page.locator("[data-view]:not(.hidden)").count()) === 1;
        if (!ok) unreached.push(sub);
        const sw = await page.evaluate(() => document.documentElement.scrollWidth);
        if (sw > width) wide.push(`${sub}=${sw}`);
        if (screenshot) { await page.waitForTimeout(250); await page.screenshot({ path: join(shots, `${sub}.png`) }); }
        for (const zone of await page.locator("[data-view]:not(.hidden) .dropzone:visible").all()) {
          zones++;
          if (await zone.evaluate((z) => getComputedStyle(z, "::after").content) !== '"Choose file"') noPickBtn.push(sub);
          const chooser = page.waitForEvent("filechooser", { timeout: 3000 }).catch(() => null);
          await zone.tap();
          if (!(await chooser)) zonesNoChooser.push(sub);
        }
      }
    }
    check(`all ${leaves} sub-tools reachable by tapping the nav`, leaves === 12 && unreached.length === 0, unreached.join(","));
    check(`no horizontal scroll (scrollWidth ≤ ${width})`, wide.length === 0, wide.join(","));
    check("every drop zone shows a visible 'Choose file' button", noPickBtn.length === 0, noPickBtn.join(","));
    check(`every drop zone opens a file chooser on tap (${zones})`, zones >= 9 && zonesNoChooser.length === 0, zonesNoChooser.join(","));

    // Load files through the tap-opened chooser.
    await page.locator('.side-item[data-section="pdf"]').tap();
    await page.locator('.tab[data-tab="merge"]').tap();
    let [fc] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#dropzone").tap()]);
    await fc.setFiles([join(fixtures, "doc-A.pdf"), join(fixtures, "doc-B.pdf")]);
    await page.waitForFunction(() => document.querySelectorAll("#fileList li").length === 2, null, { timeout: 5000 }).catch(() => {});
    check("merge: 2 PDFs added via tap → chooser", (await page.locator("#fileList li").count()) === 2);

    await page.locator('.tab[data-tab="images"]').tap();
    [fc] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#imagesDrop").tap()]);
    await fc.setFiles([join(fixtures, "img-red.png"), join(fixtures, "img-blue.png")]);
    await page.waitForFunction(() => document.querySelectorAll("#imagesList li").length === 2, null, { timeout: 5000 }).catch(() => {});
    check("images: 2 images added via tap → chooser", (await page.locator("#imagesList li").count()) === 2);
    const loadedWide = await page.evaluate(() => [...document.querySelectorAll("body *")]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5 && (!e.parentElement || e.parentElement.getBoundingClientRect().right <= innerWidth + 0.5))
      .map((e) => `${e.tagName}#${e.id}.${e.className} r=${Math.round(e.getBoundingClientRect().right)}`).concat("sw=" + document.documentElement.scrollWidth).slice(0, 6));
    check("no horizontal scroll with files loaded", (await page.evaluate(() => document.documentElement.scrollWidth)) <= width, loadedWide.join(" "));
    if (screenshot) { await page.evaluate(() => document.getElementById("imagesDrop").scrollIntoView()); await page.waitForTimeout(250); await page.screenshot({ path: join(shots, "images-loaded.png") }); }

    const real = errors.filter((e) => !/worker/i.test(e));
    check("no uncaught page errors", real.length === 0, real.join(" | "));
    await browser.close();
  }
} finally {
  server.close();
}

console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
