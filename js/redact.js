import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

  // ======================== REDACT MODE ========================
  const redactDrop = $("redactDrop");
  const redactInput = $("redactInput");
  const redactCanvas = $("redactCanvas");
  const redactOverlay = $("redactOverlay");
  let red = null;           // { file, name, pages, page (1-based), marks: Map<pageIdx, [{x,y,w,h}]> }
  let redBusy = false;
  let redUrl = null;
  let redToken = 0;
  let redRenderGen = 0;     // bumped on every page render to cancel a superseded one
  let redPdfDoc = null;     // live pdf.js doc for preview navigation

  function resetRedactResult() {
    $("redactResult").classList.add("hidden");
    if (redUrl) { URL.revokeObjectURL(redUrl); redUrl = null; }
  }

  async function addRedactFile(file) {
    if (!file || redBusy) return;
    if (!(file.type === "application/pdf" || /\.pdf$/i.test(file.name))) { notice("That's not a PDF.", "warn"); return; }
    if (!pdfjsReady) { notice("Library didn't load — reload the page.", "error"); return; }
    redactClear();
    const token = ++redToken;
    try {
      const buf = await file.arrayBuffer();
      if (token !== redToken) return;
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), stopAtErrors: true, isEvalSupported: false }).promise;
      if (token !== redToken) { doc.destroy(); return; }
      redPdfDoc = doc;
      red = { file, name: file.name, pages: doc.numPages, page: 1, marks: new Map() };
      $("redactPanel").classList.remove("hidden");
      $("redactActions").classList.remove("hidden");
      $("redactHint").classList.remove("hidden");
      $("redactStage").classList.remove("hidden");
      await showRedactPage(1, token);
      updateRedactUI();
    } catch (err) {
      redactClear();
      notice(/password|encrypt/i.test(String(err && err.message)) ? "That PDF is password-protected." : "Couldn't read that PDF.", "error");
    }
  }

  async function showRedactPage(n, token) {
    if (!redPdfDoc) return;
    const gen = ++redRenderGen;                      // supersede any in-flight render
    const page = await redPdfDoc.getPage(n);
    if (token !== redToken || gen !== redRenderGen) { page.cleanup(); return; }
    const containerW = Math.min($("redactStage").clientWidth || 640, 760);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(containerW / base.width, 2);
    const vp = page.getViewport({ scale });
    redactCanvas.width = Math.ceil(vp.width); redactCanvas.height = Math.ceil(vp.height);
    const ctx = redactCanvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, redactCanvas.width, redactCanvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    page.cleanup();
    if (token !== redToken || gen !== redRenderGen) return;
    drawMarks();
  }

  function drawMarks() {
    redactOverlay.innerHTML = "";
    if (!red) return;
    const marks = red.marks.get(red.page - 1) || [];
    marks.forEach((m, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "redact-mark";
      el.style.left = (m.x * 100) + "%";
      el.style.top = (m.y * 100) + "%";
      el.style.width = (m.w * 100) + "%";
      el.style.height = (m.h * 100) + "%";
      el.title = "Remove this redaction mark";
      el.setAttribute("aria-label", "Remove redaction mark " + (i + 1) + " on page " + red.page);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); removeMark(i); });
      redactOverlay.appendChild(el);
    });
  }

  function removeMark(i) {
    if (redBusy || !red) return;
    const marks = red.marks.get(red.page - 1) || [];
    marks.splice(i, 1);
    if (!marks.length) red.marks.delete(red.page - 1); else red.marks.set(red.page - 1, marks);
    resetRedactResult(); drawMarks(); updateRedactUI();
  }

  function totalMarks() {
    let t = 0;
    if (red) red.marks.forEach((arr) => { t += arr.length; });
    return t;
  }

  function updateRedactUI() {
    if (!red) return;
    $("redactPageNum").textContent = red.page + " / " + red.pages;
    $("redactMarkCount").textContent = totalMarks();
    $("redactPrev").disabled = redBusy || red.page <= 1;
    $("redactNext").disabled = redBusy || red.page >= red.pages;
    const t = totalMarks();
    $("redactBtn").disabled = redBusy || t < 1;
    $("redactLabel").textContent = redBusy ? "Applying…" : t < 1 ? "Mark an area to redact" : "Apply & download (" + t + " mark" + (t > 1 ? "s" : "") + ")";
  }

  async function gotoPage(n) {
    if (redBusy || !red) return;
    n = Math.max(1, Math.min(red.pages, n));
    if (n === red.page) return;
    red.page = n;
    await showRedactPage(n, redToken);
    updateRedactUI();
  }

  // Drawing rectangles on the overlay
  let drawState = null;
  function overlayPoint(e) {
    const r = redactOverlay.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return { x: Math.min(1, Math.max(0, cx / r.width)), y: Math.min(1, Math.max(0, cy / r.height)) };
  }
  redactOverlay.addEventListener("pointerdown", (e) => {
    if (redBusy || !red) return;
    if (e.target.classList.contains("redact-mark")) return; // let mark click handle removal
    e.preventDefault();
    try { if (e.pointerId != null) redactOverlay.setPointerCapture(e.pointerId); } catch (_) { /* capture is best-effort */ }
    const p = overlayPoint(e);
    drawState = { x0: p.x, y0: p.y, el: document.createElement("div") };
    drawState.el.className = "redact-drawing";
    redactOverlay.appendChild(drawState.el);
  });
  redactOverlay.addEventListener("pointermove", (e) => {
    if (!drawState) return;
    const p = overlayPoint(e);
    const x = Math.min(p.x, drawState.x0), y = Math.min(p.y, drawState.y0);
    const w = Math.abs(p.x - drawState.x0), h = Math.abs(p.y - drawState.y0);
    Object.assign(drawState.el.style, { left: x * 100 + "%", top: y * 100 + "%", width: w * 100 + "%", height: h * 100 + "%" });
  });
  function endDraw(e) {
    if (!drawState) return;
    const p = overlayPoint(e);
    const x = Math.min(p.x, drawState.x0), y = Math.min(p.y, drawState.y0);
    const w = Math.abs(p.x - drawState.x0), h = Math.abs(p.y - drawState.y0);
    drawState.el.remove();
    drawState = null;
    if (w > 0.01 && h > 0.01) {
      const arr = red.marks.get(red.page - 1) || [];
      arr.push({ x, y, w, h });
      red.marks.set(red.page - 1, arr);
      resetRedactResult(); drawMarks(); updateRedactUI();
    }
  }
  redactOverlay.addEventListener("pointerup", endDraw);
  redactOverlay.addEventListener("pointercancel", () => { if (drawState) { drawState.el.remove(); drawState = null; } });

  function clearPageMarks() {
    if (redBusy || !red) return;
    red.marks.delete(red.page - 1);
    resetRedactResult(); drawMarks(); updateRedactUI();
  }
  function clearAllMarks() {
    if (redBusy || !red || totalMarks() === 0) return;
    const snapshot = new Map(Array.from(red.marks, ([k, v]) => [k, v.map((m) => ({ ...m }))]));
    red.marks = new Map();
    resetRedactResult(); drawMarks(); updateRedactUI();
    notice("Cleared all marks.", "warn", { label: "Undo", onClick() { if (red && !redBusy) { red.marks = snapshot; drawMarks(); updateRedactUI(); } } });
  }

  async function applyRedaction() {
    if (redBusy || !red || totalMarks() === 0) return;
    if (!pdfLibReady) { notice("Library didn't load — reload the page.", "error"); return; }
    redBusy = true; resetRedactResult(); updateRedactUI();
    setRedactControlsDisabled(true);
    const btn = $("redactBtn"), label = $("redactLabel");
    const spin = document.createElement("span"); spin.className = "spinner"; btn.insertBefore(spin, btn.firstChild);
    try {
      const bytes = await red.file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), stopAtErrors: true, isEvalSupported: false }).promise;
      const out = await PDFLib.PDFDocument.create();
      try {
        for (let i = 1; i <= doc.numPages; i++) {
          label.textContent = "Applying… (" + i + "/" + doc.numPages + ")";
          await nextFrame();
          const page = await doc.getPage(i);
          const baseVp = page.getViewport({ scale: 1 });
          let s = 150 / 72;
          const longest = Math.max(baseVp.width, baseVp.height) * s;
          if (longest > MAX_DIM) s *= MAX_DIM / longest;
          const vp = page.getViewport({ scale: s });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          page.cleanup();
          const marks = red.marks.get(i - 1) || [];
          ctx.fillStyle = "#000";
          marks.forEach((m) => ctx.fillRect(m.x * canvas.width, m.y * canvas.height, m.w * canvas.width, m.h * canvas.height));
          const jpg = await out.embedJpg(canvas.toDataURL("image/jpeg", 0.85));
          const np = out.addPage([baseVp.width, baseVp.height]);
          np.drawImage(jpg, { x: 0, y: 0, width: baseVp.width, height: baseVp.height });
        }
      } finally {
        doc.destroy();
      }
      const blob = new Blob([await out.save()], { type: "application/pdf" });
      redUrl = URL.createObjectURL(blob);
      $("redactDownloadLink").href = redUrl;
      $("redactDownloadLink").download = (red.name.replace(/\.pdf$/i, "") || "document").replace(/[\/\\]/g, "_") + "-redacted.pdf";
      $("redactResultMeta").textContent = totalMarks() + " mark" + (totalMarks() > 1 ? "s" : "") + " applied · " + red.pages + " pages · " + fmtSize(blob.size);
      $("redactResult").classList.remove("hidden");
      scrollToEl($("redactResult"));
      $("redactDownloadLink").focus();
    } catch (err) {
      notice("Redaction failed: " + (err && err.message ? err.message : "unknown error") + ".", "error");
    } finally {
      redBusy = false; spin.remove(); setRedactControlsDisabled(false); updateRedactUI();
    }
  }

  function setRedactControlsDisabled(state) {
    ["redactPrev", "redactNext", "redactClearPage", "redactClearMarks", "redactClearBtn"].forEach((id) => { $(id).disabled = state; });
  }

  function redactClear() {
    if (redBusy) return;
    redToken++;
    if (redPdfDoc) { redPdfDoc.destroy(); redPdfDoc = null; }
    red = null; drawState = null;
    redactOverlay.innerHTML = "";
    const ctx = redactCanvas.getContext("2d");
    ctx && ctx.clearRect(0, 0, redactCanvas.width, redactCanvas.height);
    ["redactPanel", "redactActions", "redactHint", "redactStage"].forEach((id) => $(id).classList.add("hidden"));
    resetRedactResult();
    redactInput.value = "";
  }

  redactDrop.addEventListener("click", () => redactInput.click());
  redactDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); redactInput.click(); } });
  redactInput.addEventListener("change", (e) => { if (e.target.files && e.target.files[0]) addRedactFile(e.target.files[0]); redactInput.value = ""; });
  attachDropHighlight(redactDrop);
  redactDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) addRedactFile(e.dataTransfer.files[0]); });
  $("redactPrev").addEventListener("click", () => gotoPage(red ? red.page - 1 : 1));
  $("redactNext").addEventListener("click", () => gotoPage(red ? red.page + 1 : 1));
  $("redactClearPage").addEventListener("click", clearPageMarks);
  $("redactClearMarks").addEventListener("click", clearAllMarks);
  $("redactBtn").addEventListener("click", applyRedaction);
  $("redactClearBtn").addEventListener("click", redactClear);
  // Re-render the current page on resize so overlay marks stay aligned (marks are fractional).
  let redResizeTimer = null;
  window.addEventListener("resize", () => {
    if (!red || redBusy) return;
    clearTimeout(redResizeTimer);
    redResizeTimer = setTimeout(() => { if (red && !redBusy) showRedactPage(red.page, redToken); }, 200);
  });


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "redact", zone: redactDrop, add: (f) => addRedactFile(f[0]) };
