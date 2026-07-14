import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

  // ======================== SPLIT MODE ========================
  const PART_COLORS = ["#0f766e", "#c2410c", "#4f46e5", "#be185d", "#0e7490", "#3f6212", "#7c3aed", "#92400e"];
  const SCISSOR_SVG = '<svg class="scissor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>';

  const splitDrop = $("splitDrop");
  const splitInput = $("splitInput");
  const pageGrid = $("pageGrid");
  const splitToolbar = $("splitToolbar");
  const splitActions = $("splitActions");
  const partsPreview = $("partsPreview");
  const splitBtn = $("splitBtn");
  const splitLabel = $("splitLabel");
  const splitResult = $("splitResult");
  const splitResultMeta = $("splitResultMeta");
  const splitDownloadLink = $("splitDownloadLink");

  let split = null;          // { file, name, pages } | null
  let cuts = new Set();      // "cut after page index" (0-based, 0..pages-2)
  let splitBusy = false;
  let splitObjectUrl = null;
  let splitToken = 0;        // invalidates in-flight thumbnail rendering when the file changes

  function resetSplitResult() {
    splitResult.classList.add("hidden");
    if (splitObjectUrl) { URL.revokeObjectURL(splitObjectUrl); splitObjectUrl = null; }
  }

  async function addSplitFile(file) {
    if (!file || splitBusy) return;
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) {
      notice("That's not a PDF. Pick a .pdf file to split.", "warn");
      return;
    }
    if (!pdfjsReady) { notice("Preview library didn't load — reload the page.", "error"); return; }

    const token = ++splitToken;
    resetSplitResult();
    cuts = new Set();
    split = { file, name: file.name, pages: 0 };
    splitToolbar.classList.remove("hidden");
    splitActions.classList.remove("hidden");
    pageGrid.innerHTML = "";
    $("splitPages").textContent = "…";
    $("splitParts").textContent = "…";
    splitLabel.textContent = "Reading…";
    splitBtn.disabled = true;

    let doc = null;
    try {
      const buf = await file.arrayBuffer();
      if (token !== splitToken) return;
      doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), stopAtErrors: true, isEvalSupported: false }).promise;
      if (token !== splitToken) return;
      split.pages = doc.numPages;
      buildGrid(split.pages);
      updateParts();
      await renderThumbs(doc, token);
    } catch (err) {
      if (token !== splitToken) return;
      splitClear();
      notice(/password|encrypt/i.test(String(err && err.message))
        ? "That PDF is password-protected — can't split it."
        : "Couldn't read that PDF.", "error");
    } finally {
      if (doc) doc.destroy();
    }
  }

  function buildGrid(n) {
    pageGrid.innerHTML = "";
    for (let i = 0; i < n; i++) {
      const cell = document.createElement("div");
      cell.className = "page-cell";
      cell.dataset.index = i;
      const thumb = document.createElement("div");
      thumb.className = "pthumb skeleton";
      const num = document.createElement("div");
      num.className = "pnum";
      num.textContent = "p" + (i + 1);
      const part = document.createElement("div");
      part.className = "ppart";
      cell.appendChild(thumb); cell.appendChild(num); cell.appendChild(part);
      pageGrid.appendChild(cell);

      if (i < n - 1) {
        const slot = document.createElement("button");
        slot.type = "button";
        slot.className = "cut-slot";
        slot.dataset.after = i;
        slot.setAttribute("aria-pressed", "false");
        slot.setAttribute("aria-label", "Cut after page " + (i + 1));
        slot.title = "Cut after page " + (i + 1);
        slot.innerHTML = SCISSOR_SVG;
        slot.addEventListener("click", () => toggleCut(i));
        pageGrid.appendChild(slot);
      }
    }
  }

  async function renderThumbs(doc, token) {
    const cells = pageGrid.querySelectorAll(".page-cell");
    const status = $("thumbStatus");
    const showProgress = doc.numPages > 12;
    for (let i = 0; i < doc.numPages; i++) {
      if (token !== splitToken) return;
      if (showProgress) {
        status.textContent = "Loading previews… " + (i + 1) + " / " + doc.numPages;
        status.classList.remove("hidden");
      }
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(148 / base.width, 192 / base.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      page.cleanup();
      if (token !== splitToken) return;
      const cell = cells[i];
      if (!cell) continue;
      const thumb = cell.querySelector(".pthumb");
      thumb.classList.remove("skeleton");
      thumb.innerHTML = "";
      const img = document.createElement("img");
      img.src = canvas.toDataURL("image/jpeg", 0.72);
      img.alt = "Page " + (i + 1);
      thumb.appendChild(img);
      await nextFrame();
    }
    if (token === splitToken) $("thumbStatus").classList.add("hidden");
  }

  function toggleCut(after) {
    if (splitBusy || !split) return;
    if (cuts.has(after)) cuts.delete(after); else cuts.add(after);
    resetSplitResult();
    updateParts();
  }

  function segments() {
    if (!split) return [];
    const sorted = Array.from(cuts).filter((c) => c >= 0 && c < split.pages - 1).sort((a, b) => a - b);
    const segs = [];
    let start = 0;
    for (const c of sorted) { segs.push([start, c]); start = c + 1; }
    segs.push([start, split.pages - 1]);
    return segs;
  }

  function updateParts() {
    if (!split) return;
    const segs = segments();
    pageGrid.querySelectorAll(".cut-slot").forEach((s) => {
      s.setAttribute("aria-pressed", cuts.has(Number(s.dataset.after)) ? "true" : "false");
    });
    const cells = pageGrid.querySelectorAll(".page-cell");
    segs.forEach((seg, k) => {
      const color = PART_COLORS[k % PART_COLORS.length];
      for (let i = seg[0]; i <= seg[1]; i++) {
        const cell = cells[i];
        if (!cell) continue;
        cell.style.background = color + "14";
        const part = cell.querySelector(".ppart");
        part.textContent = "Part " + (k + 1);
        part.style.background = color;
      }
    });
    $("splitPages").textContent = split.pages;
    $("splitParts").textContent = segs.length;
    const label = (s) => (s[0] === s[1] ? "p" + (s[0] + 1) : "p" + (s[0] + 1) + "–" + (s[1] + 1));
    if (segs.length > 12) {
      const avg = (split.pages / segs.length).toFixed(segs.length && split.pages % segs.length ? 1 : 0);
      partsPreview.textContent = segs.length + " parts · ~" + avg + " pages each";
    } else {
      partsPreview.textContent = segs.map((s, k) => "Part " + (k + 1) + ": " + label(s)).join("  ·  ");
    }
    partsPreview.classList.toggle("hidden", split.pages === 0);
    $("splitHint").classList.toggle("hidden", split.pages < 2);
    splitBtn.disabled = splitBusy || segs.length < 2;
    splitLabel.textContent = splitBusy
      ? "Splitting…"
      : segs.length < 2 ? "Add a cut to split" : "Split into " + segs.length + " files";
  }

  function applyBurst() {
    if (!split || splitBusy) return;
    cuts = new Set();
    for (let i = 0; i < split.pages - 1; i++) cuts.add(i);
    resetSplitResult(); updateParts();
  }
  function applyEvery(n) {
    if (!split || splitBusy) return;
    n = Math.max(1, Math.floor(n || 0));
    cuts = new Set();
    for (let i = 0; i < split.pages - 1; i++) if ((i + 1) % n === 0) cuts.add(i);
    resetSplitResult(); updateParts();
  }
  function clearCuts() {
    if (!split || splitBusy || cuts.size === 0) return;
    const snapshot = new Set(cuts);
    cuts = new Set();
    resetSplitResult(); updateParts();
    notice("Cleared " + snapshot.size + " cut" + (snapshot.size > 1 ? "s" : "") + ".", "warn", {
      label: "Undo",
      onClick() { if (split && !splitBusy) { cuts = new Set(snapshot); resetSplitResult(); updateParts(); } },
    });
  }

  function splitClear() {
    if (splitBusy) return;
    split = null; cuts = new Set(); splitToken++;
    pageGrid.innerHTML = "";
    splitToolbar.classList.add("hidden");
    splitActions.classList.add("hidden");
    partsPreview.classList.add("hidden");
    $("splitHint").classList.add("hidden");
    $("thumbStatus").classList.add("hidden");
    resetSplitResult();
    splitInput.value = "";
  }

  function setSplitControlsDisabled(state) {
    ["splitClearBtn", "presetBurst", "presetEvery", "clearCuts", "everyN"].forEach((id) => { $(id).disabled = state; });
    pageGrid.querySelectorAll(".cut-slot").forEach((s) => { s.disabled = state; });
  }

  async function doSplit() {
    if (splitBusy || !split) return;
    const segs = segments();
    if (segs.length < 2) return;
    if (!pdfLibReady || !jszipReady) { notice("A required library didn't load — reload the page.", "error"); return; }

    splitBusy = true;
    resetSplitResult();
    updateParts();
    setSplitControlsDisabled(true);
    const spin = document.createElement("span"); spin.className = "spinner";
    splitBtn.insertBefore(spin, splitBtn.firstChild);

    try {
      const bytes = await split.file.arrayBuffer();
      const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const baseName = (split.name.replace(/\.pdf$/i, "") || "document").replace(/[\/\\]/g, "_");
      const zip = new JSZip();
      const pad = String(segs.length).length;
      let restricted = src.isEncrypted ? 1 : 0;
      for (let k = 0; k < segs.length; k++) {
        splitLabel.textContent = "Splitting… (" + (k + 1) + "/" + segs.length + ")";
        await nextFrame();
        const [a, b] = segs[k];
        const out = await PDFLib.PDFDocument.create();
        const idx = [];
        for (let i = a; i <= b; i++) idx.push(i);
        const copied = await out.copyPages(src, idx);
        copied.forEach((p) => out.addPage(p));
        const partBytes = await out.save();
        const range = a === b ? "p" + (a + 1) : "p" + (a + 1) + "-" + (b + 1);
        zip.file(baseName + "-part" + String(k + 1).padStart(pad, "0") + "-" + range + ".pdf", partBytes);
      }
      const blob = await zip.generateAsync({ type: "blob" });
      splitObjectUrl = URL.createObjectURL(blob);
      splitDownloadLink.href = splitObjectUrl;
      splitDownloadLink.download = baseName + "-parts.zip";
      splitResultMeta.textContent = segs.length + " files · " + fmtSize(blob.size) + " · from " + split.pages + " pages";
      splitResult.classList.remove("hidden");
      scrollToEl(splitResult);
      splitDownloadLink.focus();
      if (restricted) notice("This PDF is restricted — some pages in the parts may appear blank.", "warn");
    } catch (err) {
      notice("Split failed: " + (err && err.message ? err.message : "unknown error") + ".", "error");
    } finally {
      splitBusy = false;
      spin.remove();
      setSplitControlsDisabled(false);
      updateParts();
    }
  }

  // Split events
  splitDrop.addEventListener("click", () => splitInput.click());
  splitDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); splitInput.click(); } });
  splitInput.addEventListener("change", (e) => { if (e.target.files && e.target.files[0]) addSplitFile(e.target.files[0]); splitInput.value = ""; });
  ["dragenter", "dragover"].forEach((ev) => splitDrop.addEventListener(ev, (e) => { e.preventDefault(); splitDrop.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => splitDrop.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && splitDrop.contains(e.relatedTarget)) return; splitDrop.classList.remove("dragover"); }));
  splitDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) addSplitFile(e.dataTransfer.files[0]); });
  $("presetBurst").addEventListener("click", applyBurst);
  $("presetEvery").addEventListener("click", () => applyEvery(Number($("everyN").value)));
  $("everyN").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); applyEvery(Number($("everyN").value)); } });
  $("clearCuts").addEventListener("click", clearCuts);
  splitBtn.addEventListener("click", doSplit);
  $("splitClearBtn").addEventListener("click", splitClear);


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "split", zone: splitDrop, add: (f) => addSplitFile(f[0]) };
