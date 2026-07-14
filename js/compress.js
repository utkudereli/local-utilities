import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

  // ======================== COMPRESS MODE ========================
  const LEVELS = {
    high: { dpi: 150, q: 0.82 },
    medium: { dpi: 110, q: 0.68 },
    low: { dpi: 80, q: 0.55 },
  };

  const compressDrop = $("compressDrop");
  const compressInput = $("compressInput");
  let comp = null;          // { file, name, pages, origSize } | null
  let compBusy = false;
  let compUrl = null;
  let compToken = 0;

  function resetCompressResult() {
    $("compressResult").classList.add("hidden");
    if (compUrl) { URL.revokeObjectURL(compUrl); compUrl = null; }
  }

  async function addCompressFile(file) {
    if (!file || compBusy) return;
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) { notice("That's not a PDF.", "warn"); return; }
    if (!pdfjsReady) { notice("Library didn't load — reload the page.", "error"); return; }
    resetCompressResult();
    const token = ++compToken;
    let doc = null;
    try {
      const buf = await file.arrayBuffer();
      if (token !== compToken) return;
      doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), stopAtErrors: true, isEvalSupported: false }).promise;
      if (token !== compToken) return;
      comp = { file, name: file.name, pages: doc.numPages, origSize: file.size };
      $("compressPages").textContent = comp.pages;
      $("compressOrig").textContent = fmtSize(comp.origSize);
      $("compressPanel").classList.remove("hidden");
      $("compressActions").classList.remove("hidden");
      $("compressHint").classList.remove("hidden");
      $("compressLabel").textContent = "Compress PDF";
      $("compressBtn").disabled = false;
    } catch (err) {
      compressClear();
      notice(/password|encrypt/i.test(String(err && err.message)) ? "That PDF is password-protected." : "Couldn't read that PDF.", "error");
    } finally {
      if (doc) doc.destroy();
    }
  }

  async function rasterizePdf(file, level, onProgress) {
    const cfg = LEVELS[level] || LEVELS.medium;
    const scale = cfg.dpi / 72;
    const bytes = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, isEvalSupported: false }).promise;
    try {
      const out = await PDFLib.PDFDocument.create();
      for (let i = 1; i <= doc.numPages; i++) {
        if (onProgress) onProgress(i, doc.numPages);
        await nextFrame();
        const page = await doc.getPage(i);
        const baseVp = page.getViewport({ scale: 1 });
        let s = scale;
        const longest = Math.max(baseVp.width, baseVp.height) * s;
        if (longest > MAX_DIM) s *= MAX_DIM / longest;
        const vp = page.getViewport({ scale: s });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        const dataUrl = canvas.toDataURL("image/jpeg", cfg.q);
        const jpg = await out.embedJpg(dataUrl);
        const newPage = out.addPage([baseVp.width, baseVp.height]);
        newPage.drawImage(jpg, { x: 0, y: 0, width: baseVp.width, height: baseVp.height });
      }
      return await out.save();
    } finally {
      doc.destroy();
    }
  }

  async function doCompress() {
    if (compBusy || !comp) return;
    if (!pdfLibReady) { notice("Library didn't load — reload the page.", "error"); return; }
    compBusy = true;
    resetCompressResult();
    const btn = $("compressBtn"), label = $("compressLabel");
    btn.disabled = true; $("compressClearBtn").disabled = true; $("compressLevel").disabled = true;
    const spin = document.createElement("span"); spin.className = "spinner"; btn.insertBefore(spin, btn.firstChild);
    try {
      const level = $("compressLevel").value;
      const outBytes = await rasterizePdf(comp.file, level, (i, n) => { label.textContent = "Compressing… (" + i + "/" + n + ")"; });
      const blob = new Blob([outBytes], { type: "application/pdf" });
      compUrl = URL.createObjectURL(blob);
      const link = $("compressDownloadLink");
      link.href = compUrl;
      link.download = (comp.name.replace(/\.pdf$/i, "") || "document").replace(/[\/\\]/g, "_") + "-compressed.pdf";
      const delta = comp.origSize - blob.size;
      const pct = comp.origSize ? Math.round((delta / comp.origSize) * 100) : 0;
      const rtitle = $("compressResult").querySelector(".rtitle");
      if (delta > 0) {
        rtitle.textContent = "Compressed PDF ready";
        $("compressResultMeta").textContent = fmtSize(comp.origSize) + " → " + fmtSize(blob.size) + "  (saved " + pct + "%)";
      } else {
        rtitle.textContent = "No size reduction";
        const tip = level === "low" ? "Your original is already well-optimized — keep it." : "Already small — try the Low setting, or just keep your original.";
        $("compressResultMeta").textContent = fmtSize(comp.origSize) + " → " + fmtSize(blob.size) + ". " + tip;
      }
      $("compressResult").classList.remove("hidden");
      scrollToEl($("compressResult"));
      link.focus();
    } catch (err) {
      notice("Compression failed: " + (err && err.message ? err.message : "unknown error") + ".", "error");
    } finally {
      compBusy = false;
      spin.remove();
      btn.disabled = false; $("compressClearBtn").disabled = false; $("compressLevel").disabled = false;
      label.textContent = "Compress PDF";
    }
  }

  function compressClear() {
    if (compBusy) return;
    compToken++;
    comp = null;
    $("compressPanel").classList.add("hidden");
    $("compressActions").classList.add("hidden");
    $("compressHint").classList.add("hidden");
    resetCompressResult();
    compressInput.value = "";
  }

  compressDrop.addEventListener("click", () => compressInput.click());
  compressDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); compressInput.click(); } });
  compressInput.addEventListener("change", (e) => { if (e.target.files && e.target.files[0]) addCompressFile(e.target.files[0]); compressInput.value = ""; });
  attachDropHighlight(compressDrop);
  compressDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) addCompressFile(e.dataTransfer.files[0]); });
  $("compressBtn").addEventListener("click", doCompress);
  $("compressClearBtn").addEventListener("click", compressClear);
  $("compressLevel").addEventListener("change", resetCompressResult);


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "compress", zone: compressDrop, add: (f) => addCompressFile(f[0]) };
