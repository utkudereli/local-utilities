(function () {
  "use strict";

  // ---- Library readiness -------------------------------------------------
  const pdfjsReady = typeof pdfjsLib !== "undefined";
  if (pdfjsReady) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
  }
  const pdfLibReady = typeof PDFLib !== "undefined";
  const sortableReady = typeof Sortable !== "undefined";

  // ---- DOM ----------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const dropzone = $("dropzone");
  const fileInput = $("fileInput");
  const fileList = $("fileList");
  const summary = $("summary");
  const actions = $("actions");
  const reorderHint = $("reorderHint");
  const mergeBtn = $("mergeBtn");
  const mergeLabel = $("mergeLabel");
  const clearBtn = $("clearBtn");
  const addMore = $("addMore");
  const resultEl = $("result");
  const resultMeta = $("resultMeta");
  const downloadLink = $("downloadLink");
  const noticesEl = $("notices");

  // ---- State --------------------------------------------------------------
  let items = [];           // { id, file, name, size, pages, status, thumb, error }
  let seq = 0;
  let lastObjectUrl = null;
  let busy = false;
  let dragging = false;

  // ---- Helpers ------------------------------------------------------------
  function fmtSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
    return bytes + " B";
  }

  function notice(msg, type, action) {
    const isErr = type === "error";
    const el = document.createElement("div");
    el.className = "notice " + (type || "warn");
    el.setAttribute("role", isErr ? "alert" : "status");

    const icon = isErr
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    const iconSpan = document.createElement("span");
    iconSpan.className = "n-icon";
    iconSpan.innerHTML = icon;               // icon markup is a fixed literal
    const text = document.createElement("span");
    text.className = "n-text";
    text.textContent = msg;                  // user/library text — never parsed as HTML
    el.appendChild(iconSpan);
    el.appendChild(text);

    // Optional action (e.g. Undo)
    if (action) {
      const act = document.createElement("button");
      act.type = "button";
      act.className = "n-action";
      act.textContent = action.label;
      act.addEventListener("click", () => { action.onClick(); dismiss(); });
      el.appendChild(act);
    }

    // Manual close
    const close = document.createElement("button");
    close.type = "button";
    close.className = "n-close";
    close.setAttribute("aria-label", "Dismiss");
    close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    close.addEventListener("click", () => dismiss());
    el.appendChild(close);

    noticesEl.appendChild(el);

    let timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      el.style.transition = "opacity .3s ease";
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }
    // Errors/actions persist until dismissed; plain notices auto-clear.
    if (!isErr && !action) timer = setTimeout(dismiss, 4800);
    // Pause auto-dismiss on hover.
    el.addEventListener("mouseenter", () => { if (timer) { clearTimeout(timer); timer = null; } });
  }

  const readyItems = () => items.filter((i) => i.status === "ready");

  // ---- Rendering ----------------------------------------------------------
  function render() {
    // Never rebuild the list mid-drag — it would corrupt SortableJS's state.
    // A fresh render runs in onEnd once the drag settles.
    if (dragging) return;
    const has = items.length > 0;
    summary.classList.toggle("hidden", !has);
    actions.classList.toggle("hidden", !has);
    reorderHint.classList.toggle("hidden", items.length < 2);

    // Sync list (rebuild rows that don't exist; preserve order from `items`)
    fileList.innerHTML = "";
    items.forEach((it, idx) => fileList.appendChild(buildRow(it, idx)));

    // Summary stats
    const ready = readyItems();
    const totalPages = ready.reduce((s, i) => s + (i.pages || 0), 0);
    const totalBytes = ready.reduce((s, i) => s + i.size, 0);
    $("statFiles").textContent = ready.length + (items.length > ready.length ? " / " + items.length : "");
    $("statPages").textContent = totalPages;
    $("statSize").textContent = fmtSize(totalBytes) + " ~est.";

    const anyLoading = items.some((i) => i.status === "loading");
    mergeBtn.disabled = busy || anyLoading || ready.length < 2;
    if (busy) mergeLabel.textContent = "Merging…";
    else if (anyLoading) mergeLabel.textContent = "Waiting for files…";
    else if (ready.length < 2) mergeLabel.textContent = "Add 2+ PDFs to merge";
    else mergeLabel.textContent = "Merge " + ready.length + " PDFs";
  }

  function buildRow(it, idx) {
    const li = document.createElement("li");
    li.className = "file" + (it.status === "error" ? " error-row" : "");
    li.dataset.id = it.id;

    // drag handle
    const handle = document.createElement("div");
    handle.className = "drag-handle";
    handle.title = "Drag to reorder";
    handle.setAttribute("aria-hidden", "true");
    handle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    li.appendChild(handle);

    // order badge
    const badge = document.createElement("div");
    badge.className = "order-badge";
    badge.textContent = idx + 1;
    li.appendChild(badge);

    // thumbnail
    const thumb = document.createElement("div");
    thumb.className = "thumb" + (it.status === "loading" ? " skeleton" : "");
    if (it.thumb) {
      const img = document.createElement("img");
      img.src = it.thumb;
      img.alt = "First page of " + it.name;
      thumb.appendChild(img);
    } else if (it.status === "error") {
      thumb.innerHTML = '<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else if (it.status === "ready") {
      thumb.innerHTML = '<svg class="ph" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>';
    }
    li.appendChild(thumb);

    // info
    const info = document.createElement("div");
    info.className = "finfo";
    const name = document.createElement("div");
    name.className = "fname";
    name.textContent = it.name;
    name.title = it.name;
    const meta = document.createElement("div");
    meta.className = "fmeta";
    if (it.status === "loading") meta.textContent = "Reading… " + fmtSize(it.size);
    else if (it.status === "error") {
      const err = document.createElement("span");
      err.className = "err";
      err.textContent = it.error || "Could not read this PDF";
      meta.appendChild(err);
    } else meta.textContent = it.pages + (it.pages === 1 ? " page" : " pages") + " · " + fmtSize(it.size);
    info.appendChild(name);
    info.appendChild(meta);
    li.appendChild(info);

    // actions: up / down / remove
    const acts = document.createElement("div");
    acts.className = "row-actions";

    const up = iconBtn("Move up", '<polyline points="18 15 12 9 6 15"/>', () => move(it.id, -1));
    up.disabled = busy || idx === 0;
    const down = iconBtn("Move down", '<polyline points="6 9 12 15 18 9"/>', () => move(it.id, 1));
    down.disabled = busy || idx === items.length - 1;
    const del = iconBtn("Remove " + it.name, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', () => remove(it.id), true);
    del.disabled = busy;

    acts.appendChild(up);
    acts.appendChild(down);
    acts.appendChild(del);
    li.appendChild(acts);

    return li;
  }

  function iconBtn(label, pathSvg, onClick, danger) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn" + (danger ? " danger" : "");
    b.setAttribute("aria-label", label);
    b.title = label;
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pathSvg + "</svg>";
    b.addEventListener("click", onClick);
    return b;
  }

  // ---- Mutations ----------------------------------------------------------
  function move(id, dir) {
    if (busy) return;
    const i = items.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    clearResult();
    render();
    // Keep keyboard focus on the moved row's action so reorders can be chained.
    restoreFocus(id, dir < 0 ? "Move up" : "Move down");
  }

  function remove(id) {
    if (busy) return;
    const idx = items.findIndex((x) => x.id === id);
    const li = fileList.querySelector('li[data-id="' + id + '"]');
    const finalize = () => {
      items = items.filter((x) => x.id !== id);
      clearResult();
      render();
      // Move focus to the next row's remove button, or back to the dropzone.
      const next = items[idx] || items[idx - 1];
      if (next) restoreFocus(next.id, "Remove");
      else dropzone.focus();
    };
    if (li) { li.classList.add("removing"); setTimeout(finalize, 200); }
    else finalize();
  }

  function restoreFocus(id, labelPrefix) {
    const li = fileList.querySelector('li[data-id="' + id + '"]');
    if (!li) return;
    let btn = li.querySelector('.row-actions button[aria-label^="' + labelPrefix + '"]');
    if (btn && btn.disabled) btn = li.querySelector(".row-actions button:not([disabled])");
    if (btn) btn.focus();
  }

  function clearAll() {
    if (busy || !items.length) return;
    const snapshot = items.slice();
    items = [];
    clearResult();
    render();
    fileInput.value = "";
    notice("Cleared " + snapshot.length + " file" + (snapshot.length > 1 ? "s" : "") + ".", "warn", {
      label: "Undo",
      onClick() { items = snapshot.slice(); render(); },
    });
  }

  function clearResult() {
    resultEl.classList.add("hidden");
    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
  }

  // ---- Adding files -------------------------------------------------------
  function addFiles(fileListLike) {
    const incoming = Array.from(fileListLike);
    const pdfs = incoming.filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    const rejected = incoming.length - pdfs.length;
    if (rejected > 0) notice(rejected + " non-PDF file" + (rejected > 1 ? "s were" : " was") + " skipped.", "warn");
    if (!pdfs.length) return;

    clearResult();
    pdfs.forEach((file) => {
      const it = { id: ++seq, file, name: file.name, size: file.size, pages: 0, status: "loading", thumb: null, error: null };
      items.push(it);
      processFile(it);
    });
    render();
  }

  async function processFile(it) {
    let doc = null;
    try {
      const buf = await it.file.arrayBuffer();
      if (!items.includes(it)) return;            // removed/cleared while reading
      if (!pdfjsReady) {
        // Fallback: accept file, no page count / thumbnail
        it.status = "ready";
        it.pages = 0;
        render();
        return;
      }
      doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf), stopAtErrors: true, isEvalSupported: false }).promise;
      if (!items.includes(it)) return;            // removed/cleared while parsing
      it.pages = doc.numPages;
      it.thumb = await renderThumb(doc);
      it.status = "ready";
    } catch (err) {
      it.status = "error";
      it.error = /password|encrypt/i.test(String(err && err.message))
        ? "Password-protected — can't merge"
        : "Not a readable PDF";
    } finally {
      if (doc) doc.destroy();                      // always release pdf.js resources
    }
    if (items.includes(it)) render();
  }

  async function renderThumb(doc) {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(96 / base.width, 124 / base.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.7);
  }

  // ---- Merge --------------------------------------------------------------
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scrollToEl = (el) => {
    const v = el.closest("[data-view]");
    if (v && v.classList.contains("hidden")) return; // don't scroll a background tab
    el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "nearest" });
  };

  // Adds the drag-over highlight to a dropzone (drop handling is attached separately).
  function attachDropHighlight(zone) {
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && zone.contains(e.relatedTarget)) return; zone.classList.remove("dragover"); }));
  }

  async function merge() {
    const ready = readyItems();
    if (ready.length < 2 || busy) return;
    if (!pdfLibReady) { notice("Merge library failed to load. Reload the page to try again.", "error"); return; }

    busy = true;
    clearResult();
    render();                                       // disables row actions while merging
    const spin = document.createElement("span");
    spin.className = "spinner";
    mergeBtn.insertBefore(spin, mergeBtn.firstChild);

    let restricted = 0;
    try {
      const out = await PDFLib.PDFDocument.create();
      let pageCount = 0;
      for (let n = 0; n < ready.length; n++) {
        const it = ready[n];
        mergeLabel.textContent = "Merging… (" + (n + 1) + "/" + ready.length + ")";
        await nextFrame();                          // let the label/spinner paint
        const bytes = await it.file.arrayBuffer();
        const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
        if (src.isEncrypted) restricted++;
        const copied = await out.copyPages(src, src.getPageIndices());
        copied.forEach((p) => out.addPage(p));
        pageCount += copied.length;
      }
      const merged = await out.save();
      const blob = new Blob([merged], { type: "application/pdf" });
      lastObjectUrl = URL.createObjectURL(blob);
      downloadLink.href = lastObjectUrl;
      downloadLink.download = "merged-" + ready.length + "-files.pdf";
      resultMeta.textContent = pageCount + " pages · " + fmtSize(blob.size) + " · from " + ready.length + " files";
      resultEl.classList.remove("hidden");
      scrollToEl(resultEl);
      downloadLink.focus();
      if (restricted > 0) {
        notice(restricted + " restricted PDF" + (restricted > 1 ? "s" : "") + " merged — some pages may appear blank.", "warn");
      }
    } catch (err) {
      notice("Merge failed: " + (err && err.message ? err.message : "unknown error") + ".", "error");
    } finally {
      busy = false;
      spin.remove();
      render();
    }
  }

  // ---- Events -------------------------------------------------------------
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  addMore.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => { addFiles(e.target.files); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && dropzone.contains(e.relatedTarget)) return; dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  // Allow dropping anywhere on the page — routed to the active tab's handler.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) routeDrop(files, e.target);
  });

  mergeBtn.addEventListener("click", merge);
  clearBtn.addEventListener("click", clearAll);

  // Drag-and-drop reordering
  if (sortableReady) {
    Sortable.create(fileList, {
      handle: ".drag-handle",
      animation: 160,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      onStart() { dragging = true; },
      onEnd() {
        dragging = false;
        const ids = Array.from(fileList.children).map((li) => Number(li.dataset.id));
        items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        clearResult();
        render();
      },
    });
  }

  if (!pdfLibReady) notice("The merge library didn't load. Reload the page to fix this.", "error");
  else if (!sortableReady) notice("Drag-to-reorder didn't load — use the ▲ ▼ buttons instead.", "warn");

  // ======================== SPLIT MODE ========================
  const jszipReady = typeof JSZip !== "undefined";
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

  // ======================== COMPRESS MODE ========================
  const LEVELS = {
    high: { dpi: 150, q: 0.82 },
    medium: { dpi: 110, q: 0.68 },
    low: { dpi: 80, q: 0.55 },
  };
  const MAX_DIM = 2200; // px cap per side to bound memory

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

  // ======================== IMAGES → PDF MODE ========================
  const imagesDrop = $("imagesDrop");
  const imagesInput = $("imagesInput");
  const imagesList = $("imagesList");
  let imgs = [];            // { id, file, name, size, url, w, h }
  let imgSeq = 0;
  let imgBusy = false;
  let imagesUrl = null;

  function resetImagesResult() {
    $("imagesResult").classList.add("hidden");
    if (imagesUrl) { URL.revokeObjectURL(imagesUrl); imagesUrl = null; }
  }

  function addImageFiles(fileList) {
    if (imgBusy) return;
    const incoming = Array.from(fileList);
    const pics = incoming.filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name));
    const rejected = incoming.length - pics.length;
    if (rejected > 0) notice(rejected + " non-image file" + (rejected > 1 ? "s" : "") + " skipped.", "warn");
    if (!pics.length) return;
    resetImagesResult();
    pics.forEach((file) => {
      const it = { id: ++imgSeq, file, name: file.name, size: file.size, url: URL.createObjectURL(file), w: 0, h: 0 };
      imgs.push(it);
      const probe = new Image();
      probe.onload = () => { it.w = probe.naturalWidth; it.h = probe.naturalHeight; renderImages(); };
      probe.onerror = () => { it.w = 0; it.h = 0; };
      probe.src = it.url;
    });
    renderImages();
  }

  function renderImages() {
    const has = imgs.length > 0;
    $("imagesPanel").classList.toggle("hidden", !has);
    $("imagesActions").classList.toggle("hidden", !has);
    $("imagesHint").classList.toggle("hidden", imgs.length < 2);
    imagesList.innerHTML = "";
    imgs.forEach((it, idx) => imagesList.appendChild(buildImageRow(it, idx)));
    $("imagesCount").textContent = imgs.length;
    $("imagesBtn").disabled = imgBusy || imgs.length < 1;
    $("imagesLabel").textContent = imgBusy ? "Creating…" : imgs.length < 1 ? "Add images to start" : "Create PDF (" + imgs.length + (imgs.length === 1 ? " page)" : " pages)");
  }

  function buildImageRow(it, idx) {
    const li = document.createElement("li");
    li.className = "file";
    li.dataset.id = it.id;
    const handle = document.createElement("div");
    handle.className = "drag-handle"; handle.setAttribute("aria-hidden", "true"); handle.title = "Drag to reorder";
    handle.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    li.appendChild(handle);
    const badge = document.createElement("div"); badge.className = "order-badge"; badge.textContent = idx + 1; li.appendChild(badge);
    const thumb = document.createElement("div"); thumb.className = "thumb";
    const img = document.createElement("img"); img.src = it.url; img.alt = it.name; thumb.appendChild(img); li.appendChild(thumb);
    const info = document.createElement("div"); info.className = "finfo";
    const name = document.createElement("div"); name.className = "fname"; name.textContent = it.name; name.title = it.name;
    const meta = document.createElement("div"); meta.className = "fmeta";
    meta.textContent = (it.w && it.h ? it.w + "×" + it.h + " · " : "") + fmtSize(it.size);
    info.appendChild(name); info.appendChild(meta); li.appendChild(info);
    const acts = document.createElement("div"); acts.className = "row-actions";
    const up = iconBtn("Move up", '<polyline points="18 15 12 9 6 15"/>', () => moveImage(it.id, -1)); up.disabled = imgBusy || idx === 0;
    const down = iconBtn("Move down", '<polyline points="6 9 12 15 18 9"/>', () => moveImage(it.id, 1)); down.disabled = imgBusy || idx === imgs.length - 1;
    const del = iconBtn("Remove " + it.name, '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', () => removeImage(it.id), true); del.disabled = imgBusy;
    acts.appendChild(up); acts.appendChild(down); acts.appendChild(del); li.appendChild(acts);
    return li;
  }

  function moveImage(id, dir) {
    if (imgBusy) return;
    const i = imgs.findIndex((x) => x.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= imgs.length) return;
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
    resetImagesResult(); renderImages();
  }
  function removeImage(id) {
    if (imgBusy) return;
    const it = imgs.find((x) => x.id === id);
    if (it) URL.revokeObjectURL(it.url);
    imgs = imgs.filter((x) => x.id !== id);
    resetImagesResult(); renderImages();
  }
  function imagesClear() {
    if (imgBusy) return;
    const snapshot = imgs.slice();
    imgs.forEach((it) => URL.revokeObjectURL(it.url));
    imgs = [];
    resetImagesResult(); renderImages(); imagesInput.value = "";
    if (snapshot.length) notice("Cleared " + snapshot.length + " image" + (snapshot.length > 1 ? "s" : "") + ".", "warn", {
      label: "Undo",
      onClick() { snapshot.forEach((it) => { it.url = URL.createObjectURL(it.file); }); imgs = snapshot.slice(); renderImages(); },
    });
  }

  async function imageToEmbeddable(out, it) {
    const buf = await it.file.arrayBuffer();
    if (/jpe?g$/i.test(it.name) || it.file.type === "image/jpeg") {
      return { img: await out.embedJpg(buf), w: it.w, h: it.h };
    }
    if (/\.png$/i.test(it.name) || it.file.type === "image/png") {
      try { return { img: await out.embedPng(buf), w: it.w, h: it.h }; } catch (e) { /* fall through to canvas */ }
    }
    // WebP/GIF/BMP or odd PNG: re-encode through a canvas to PNG (size-capped).
    const bmp = await createImageBitmap(it.file);
    const s = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * s));
    canvas.height = Math.max(1, Math.round(bmp.height * s));
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close && bmp.close();
    const dataUrl = canvas.toDataURL("image/png");
    return { img: await out.embedPng(dataUrl), w: canvas.width, h: canvas.height };
  }

  async function createImagesPdf() {
    if (imgBusy || !imgs.length) return;
    if (!pdfLibReady) { notice("Library didn't load — reload the page.", "error"); return; }
    imgBusy = true; resetImagesResult();
    const sizeMode = $("imgPageSize").value;
    const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };
    const btn = $("imagesBtn"), label = $("imagesLabel");
    setImagesControlsDisabled(true);
    const spin = document.createElement("span"); spin.className = "spinner"; btn.insertBefore(spin, btn.firstChild);
    try {
      const out = await PDFLib.PDFDocument.create();
      const failed = [];
      for (let k = 0; k < imgs.length; k++) {
        label.textContent = "Creating… (" + (k + 1) + "/" + imgs.length + ")";
        await nextFrame();
        let emb;
        try { emb = await imageToEmbeddable(out, imgs[k]); }
        catch (e) { failed.push(imgs[k].name); continue; }
        const { img, w, h } = emb;
        const iw = w || img.width, ih = h || img.height;
        if (sizeMode === "fit") {
          const page = out.addPage([iw, ih]);
          page.drawImage(img, { x: 0, y: 0, width: iw, height: ih });
        } else {
          const [pw, ph0] = PAGE[sizeMode];
          const landscape = iw > ih;
          const pwF = landscape ? Math.max(pw, ph0) : Math.min(pw, ph0);
          const phF = landscape ? Math.min(pw, ph0) : Math.max(pw, ph0);
          const page = out.addPage([pwF, phF]);
          const margin = 24;
          const scale = Math.min((pwF - margin * 2) / iw, (phF - margin * 2) / ih);
          const dw = iw * scale, dh = ih * scale;
          page.drawImage(img, { x: (pwF - dw) / 2, y: (phF - dh) / 2, width: dw, height: dh });
        }
      }
      if (out.getPageCount() === 0) { notice("None of those images could be read.", "error"); return; }
      if (failed.length) notice(failed.length + " image" + (failed.length > 1 ? "s" : "") + " couldn't be read and " + (failed.length > 1 ? "were" : "was") + " skipped.", "warn");
      const pageCount = out.getPageCount();
      const blob = new Blob([await out.save()], { type: "application/pdf" });
      imagesUrl = URL.createObjectURL(blob);
      $("imagesDownloadLink").href = imagesUrl;
      $("imagesResultMeta").textContent = pageCount + (pageCount === 1 ? " page · " : " pages · ") + fmtSize(blob.size);
      $("imagesResult").classList.remove("hidden");
      scrollToEl($("imagesResult"));
      $("imagesDownloadLink").focus();
    } catch (err) {
      notice("Couldn't create the PDF: " + (err && err.message ? err.message : "unknown error") + ".", "error");
    } finally {
      imgBusy = false; spin.remove(); setImagesControlsDisabled(false); renderImages();
    }
  }

  function setImagesControlsDisabled(state) {
    ["imagesClearBtn", "imagesAddMore", "imgPageSize"].forEach((id) => { $(id).disabled = state; });
  }

  imagesDrop.addEventListener("click", () => imagesInput.click());
  imagesDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); imagesInput.click(); } });
  imagesInput.addEventListener("change", (e) => { addImageFiles(e.target.files); imagesInput.value = ""; });
  attachDropHighlight(imagesDrop);
  imagesDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addImageFiles(e.dataTransfer.files); });
  $("imagesAddMore").addEventListener("click", () => imagesInput.click());
  $("imagesBtn").addEventListener("click", createImagesPdf);
  $("imagesClearBtn").addEventListener("click", imagesClear);
  $("imgPageSize").addEventListener("change", resetImagesResult);
  if (sortableReady) {
    Sortable.create(imagesList, {
      handle: ".drag-handle", animation: 160, ghostClass: "sortable-ghost", chosenClass: "sortable-chosen",
      onStart() { dragging = true; },
      onEnd() {
        dragging = false;
        const ids = Array.from(imagesList.children).map((li) => Number(li.dataset.id));
        imgs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        resetImagesResult(); renderImages();
      },
    });
  }

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

  // ======================== BASE64 ========================
  const b64Text = $("b64Text");
  const b64Drop = $("b64Drop");
  const b64FileInput = $("b64FileInput");
  const b64EncPanel = $("b64EncPanel");
  const b64DecPanel = $("b64DecPanel");
  const b64EncResult = $("b64EncResult");
  const b64EncOut = $("b64EncOut");
  const b64EncMeta = $("b64EncMeta");
  const b64EncCopy = $("b64EncCopy");
  const b64EncClear = $("b64EncClear");
  const b64DecIn = $("b64DecIn");
  const b64DecRun = $("b64DecBtn2");
  const b64DecClear = $("b64DecClear");
  const b64DecResult = $("b64DecResult");
  const b64DecTextWrap = $("b64DecText");
  const b64DecOut = $("b64DecOut");
  const b64DecMeta = $("b64DecMeta");
  const b64DecImg = $("b64DecImg");
  const b64DecImgEl = $("b64DecImgEl");
  const b64DecCopy = $("b64DecCopy");
  const b64DecDownload = $("b64DecDownload");

  const B64_EXT = { "image/png":"png", "image/jpeg":"jpg", "image/gif":"gif", "image/webp":"webp",
    "image/svg+xml":"svg", "application/pdf":"pdf", "text/csv":"csv", "text/plain":"txt" };
  let b64DecUrl = null; // single object URL reused for preview + download

  // btoa/atob are latin1-only — go through bytes so UTF-8 (e.g. Turkish chars) survives.
  function bytesToB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  function sniffMime(b) {
    if (b.length >= 4 && b[0]===0x89 && b[1]===0x50 && b[2]===0x4E && b[3]===0x47) return "image/png";
    if (b.length >= 3 && b[0]===0xFF && b[1]===0xD8 && b[2]===0xFF) return "image/jpeg";
    if (b.length >= 3 && b[0]===0x47 && b[1]===0x49 && b[2]===0x46) return "image/gif";
    if (b.length >= 12 && b[0]===0x52 && b[1]===0x49 && b[2]===0x46 && b[3]===0x46 && b[8]===0x57 && b[9]===0x45 && b[10]===0x42 && b[11]===0x50) return "image/webp";
    if (b.length >= 4 && b[0]===0x25 && b[1]===0x50 && b[2]===0x44 && b[3]===0x46) return "application/pdf";
    return null;
  }

  function flashCopied(btn) {
    const prev = btn.dataset.label || btn.textContent.trim();
    btn.dataset.label = prev;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = btn.dataset.label; }, 1400);
  }
  async function copyText(str, btn) {
    try { await navigator.clipboard.writeText(str); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = str; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      ta.remove();
    }
    flashCopied(btn);
  }

  // ---- Encode ----
  function b64EncodeText() {
    const txt = b64Text.value;
    if (!txt) { b64EncResult.classList.add("hidden"); b64EncOut.value = ""; return; }
    const bytes = new TextEncoder().encode(txt);
    b64EncOut.value = bytesToB64(bytes);
    b64EncMeta.textContent = "· raw text · " + fmtSize(bytes.length);
    b64EncResult.classList.remove("hidden");
  }
  function b64EncodeFile(file) {
    if (!file) return;
    if (currentTab === "base64") selectLeaf("b64enc"); // a dropped file means "encode" — surface that panel
    b64Text.value = ""; // a file replaces typed text — avoid ambiguity
    const r = new FileReader();
    r.onload = () => {
      b64EncOut.value = String(r.result); // full data: URL — directly usable in <img src> / CSS
      b64EncMeta.textContent = "· " + (file.name || "file") + " · " + fmtSize(file.size) + (file.type ? " · " + file.type : "");
      b64EncResult.classList.remove("hidden");
    };
    r.onerror = () => notice("Couldn't read that file.", "error");
    r.readAsDataURL(file);
  }

  b64Text.addEventListener("input", b64EncodeText);
  b64Drop.addEventListener("click", () => b64FileInput.click());
  b64Drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); b64FileInput.click(); } });
  b64FileInput.addEventListener("change", (e) => { if (e.target.files && e.target.files[0]) b64EncodeFile(e.target.files[0]); b64FileInput.value = ""; });
  attachDropHighlight(b64Drop);
  b64Drop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) b64EncodeFile(e.dataTransfer.files[0]); });
  b64EncCopy.addEventListener("click", () => { if (b64EncOut.value) copyText(b64EncOut.value, b64EncCopy); });
  b64EncClear.addEventListener("click", () => { b64Text.value = ""; b64EncOut.value = ""; b64EncResult.classList.add("hidden"); b64Text.focus(); });

  // Paste an image straight into the Encode panel.
  document.addEventListener("paste", (e) => {
    if (currentTab !== "base64" || b64EncPanel.classList.contains("hidden")) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
      if (it.type && it.type.indexOf("image/") === 0) {
        const f = it.getAsFile();
        if (f) { e.preventDefault(); b64EncodeFile(f); return; }
      }
    }
  });

  // ---- Decode ----
  function b64Decode() {
    let raw = b64DecIn.value.trim();
    if (!raw) { notice("Paste some Base64 first.", "warn"); return; }
    let mime = null, bytes, txt = null;
    const m = raw.match(/^data:([^;,]*)(;base64)?,/i);
    if (m) {
      mime = m[1] || null;
      raw = raw.slice(m[0].length);
      if (!m[2]) { // data: URL without ;base64 → percent-encoded text
        try { txt = decodeURIComponent(raw); bytes = new TextEncoder().encode(txt); }
        catch (_) { notice("That data: URL couldn't be decoded.", "error"); return; }
      }
    }
    if (!bytes) {
      try { bytes = b64ToBytes(raw); }
      catch (_) { notice("That doesn't look like valid Base64.", "error"); return; }
    }
    if (!mime) mime = sniffMime(bytes);

    if (b64DecUrl) { URL.revokeObjectURL(b64DecUrl); b64DecUrl = null; }
    b64DecUrl = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
    b64DecDownload.href = b64DecUrl;
    b64DecDownload.download = "decoded." + (B64_EXT[mime] || "bin");
    b64DecDownload.classList.remove("hidden");

    const isImage = mime && mime.indexOf("image/") === 0;
    b64DecImg.classList.toggle("hidden", !isImage);
    if (isImage) b64DecImgEl.src = b64DecUrl;

    // Show text when it's not a binary type (images/pdf are unreadable as text).
    const showText = !isImage && mime !== "application/pdf";
    b64DecTextWrap.classList.toggle("hidden", !showText);
    b64DecCopy.classList.toggle("hidden", !showText);
    if (showText) {
      b64DecOut.value = txt !== null ? txt : new TextDecoder().decode(bytes);
      b64DecMeta.textContent = "· " + (mime || "text/plain") + " · " + fmtSize(bytes.length);
    }
    b64DecResult.classList.remove("hidden");
  }
  b64DecRun.addEventListener("click", b64Decode);
  b64DecCopy.addEventListener("click", () => { if (b64DecOut.value) copyText(b64DecOut.value, b64DecCopy); });
  b64DecClear.addEventListener("click", () => {
    b64DecIn.value = ""; b64DecOut.value = ""; b64DecResult.classList.add("hidden");
    if (b64DecUrl) { URL.revokeObjectURL(b64DecUrl); b64DecUrl = null; }
    b64DecIn.focus();
  });

  function b64ShowEncode(on) {
    b64EncPanel.classList.toggle("hidden", !on);
    b64DecPanel.classList.toggle("hidden", on);
  }

  // ---- CSV ↔ JSON ----
  function parseCSV(text) {
    const s = text.replace(/\r\n?/g, "\n");
    const rows = []; let row = [], field = "", inQ = false, i = 0;
    while (i < s.length) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function csvToJSON(text) {
    const rows = parseCSV(text).filter((r) => !(r.length === 1 && r[0] === ""));
    if (!rows.length) return [];
    const header = rows[0];
    return rows.slice(1).map((r) => {
      const o = {}; header.forEach((h, idx) => { o[h] = r[idx] ?? ""; }); return o;
    });
  }
  function csvCell(v) {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function jsonToCSV(text) {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) throw new Error("Expected a JSON array of objects");
    const keys = [];
    data.forEach((o) => Object.keys(o || {}).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    const lines = [keys.map(csvCell).join(",")];
    data.forEach((o) => lines.push(keys.map((k) => csvCell(o ? o[k] : "")).join(",")));
    return lines.join("\n");
  }
  const cjErr = $("cjErr");
  function cjRun(fn) {
    cjErr.textContent = "";
    try { $("cjOutput").value = fn($("cjInput").value); }
    catch (e) { $("cjOutput").value = ""; cjErr.textContent = "⚠ " + e.message; }
  }
  $("cjToJson").addEventListener("click", () => cjRun((t) => JSON.stringify(csvToJSON(t), null, 2)));
  $("cjToCsv").addEventListener("click", () => cjRun(jsonToCSV));
  $("cjCopy").addEventListener("click", () => navigator.clipboard.writeText($("cjOutput").value));
  $("cjClear").addEventListener("click", () => { $("cjInput").value = ""; $("cjOutput").value = ""; cjErr.textContent = ""; });
  $("cjFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { $("cjInput").value = String(r.result || ""); cjErr.textContent = ""; };
    r.onerror = () => { cjErr.textContent = "⚠ Couldn't read that file."; };
    r.readAsText(f);
    e.target.value = ""; // allow re-selecting the same file
  });

  // ---- Text diff (line-level LCS) ----
  // ponytail: O(n*m) DP — fine for pasted text; cap guards pathological inputs.
  function diffLines(a, b) {
    const A = a.split("\n"), B = b.split("\n");
    const n = A.length, m = B.length;
    if (n * m > 4_000_000) throw new Error("Inputs too large to diff");
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = []; let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ t: "=", v: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", v: A[i] }); i++; }
      else { out.push({ t: "+", v: B[j] }); j++; }
    }
    while (i < n) out.push({ t: "-", v: A[i++] });
    while (j < m) out.push({ t: "+", v: B[j++] });
    return out;
  }
  function escHtml(s) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
  $("diffRun").addEventListener("click", () => {
    try {
      const parts = diffLines($("diffA").value, $("diffB").value);
      const cls = { "=": "d-eq", "-": "d-del", "+": "d-add" }, sign = { "=": "  ", "-": "- ", "+": "+ " };
      $("diffOut").innerHTML = parts.map((p) => `<span class="${cls[p.t]}">${sign[p.t]}${escHtml(p.v)}</span>`).join("");
    } catch (e) { $("diffOut").textContent = "⚠ " + e.message; }
  });
  $("diffClear").addEventListener("click", () => { $("diffA").value = ""; $("diffB").value = ""; $("diffOut").innerHTML = ""; });

  // ---- Strip EXIF ----
  // createImageBitmap(...,{imageOrientation:'from-image'}) bakes orientation; canvas
  // re-encode drops all metadata (GPS/camera/timestamps). No byte-parsing needed.
  async function stripExif(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    bmp.close();
    const type = file.type === "image/png" ? "image/png" : file.type === "image/webp" ? "image/webp" : "image/jpeg";
    const quality = type === "image/jpeg" ? 0.92 : undefined;
    const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
    const blob = await new Promise((res) => c.toBlob(res, type, quality));
    return { blob, ext };
  }
  let exifUrl = null;
  function resetExif() {
    if (exifUrl) { URL.revokeObjectURL(exifUrl); exifUrl = null; }
    $("exifResult").classList.add("hidden");
  }
  async function addExifFiles(files) {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    resetExif();
    if (list.length === 1) {
      const { blob, ext } = await stripExif(list[0]);
      exifUrl = URL.createObjectURL(blob);
      const a = $("exifDownload"); a.href = exifUrl; a.download = "cleaned." + ext;
      $("exifMeta").textContent = `1 image cleaned — ${(blob.size / 1024).toFixed(0)} KB`;
    } else {
      const zip = new JSZip();
      for (let i = 0; i < list.length; i++) {
        const { blob, ext } = await stripExif(list[i]);
        zip.file(`cleaned-${i + 1}.${ext}`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      exifUrl = URL.createObjectURL(zipBlob);
      const a = $("exifDownload"); a.href = exifUrl; a.download = "cleaned-images.zip";
      $("exifMeta").textContent = `${list.length} images cleaned`;
    }
    $("exifResult").classList.remove("hidden");
  }
  const exifDrop = $("exifDrop"), exifInput = $("exifInput");
  exifDrop.addEventListener("click", () => exifInput.click());
  exifDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); exifInput.click(); } });
  exifInput.addEventListener("change", (e) => { if (e.target.files.length) addExifFiles(e.target.files).catch(console.error); exifInput.value = ""; });
  attachDropHighlight(exifDrop);
  exifDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) addExifFiles(e.dataTransfer.files); });
  $("exifClear").addEventListener("click", resetExif);

  // ---- Background remover (solid color, edge flood-fill) ----
  // Removes only background CONNECTED to the image border; won't punch holes in the subject.
  // ponytail: the tolerance slider is the calibration knob real photos need.
  function removeBg(imageData, tolerance) {
    const { data, width: w, height: h } = imageData;
    const visited = new Uint8Array(w * h), stack = [];
    const corners = [0, w - 1, (h - 1) * w, h * w - 1];
    let r0 = 0, g0 = 0, b0 = 0;
    corners.forEach((p) => { r0 += data[p * 4]; g0 += data[p * 4 + 1]; b0 += data[p * 4 + 2]; });
    r0 /= 4; g0 /= 4; b0 /= 4;
    const tol2 = tolerance * tolerance;
    const seed = (x, y) => { const p = y * w + x; if (!visited[p]) { visited[p] = 1; stack.push(p); } };
    for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
    for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
    while (stack.length) {
      const p = stack.pop(), i = p * 4;
      const dr = data[i] - r0, dg = data[i + 1] - g0, db = data[i + 2] - b0;
      if (dr * dr + dg * dg + db * db > tol2) continue; // subject edge — stop spreading
      data[i + 3] = 0;
      const x = p % w, y = (p - x) / w;
      if (x > 0) seed(x - 1, y);
      if (x < w - 1) seed(x + 1, y);
      if (y > 0) seed(x, y - 1);
      if (y < h - 1) seed(x, y + 1);
    }
    return imageData;
  }
  let bgSrc = null, bgUrl = null; // bgSrc: ImageBitmap of the original
  function bgRender() {
    if (!bgSrc) return;
    const c = $("bgCanvas"), ctx = c.getContext("2d");
    c.width = bgSrc.width; c.height = bgSrc.height;
    ctx.drawImage(bgSrc, 0, 0);
    const id = ctx.getImageData(0, 0, c.width, c.height);
    ctx.putImageData(removeBg(id, Number($("bgTol").value)), 0, 0);
    c.toBlob((blob) => {
      if (bgUrl) URL.revokeObjectURL(bgUrl);
      bgUrl = URL.createObjectURL(blob);
      $("bgDownload").href = bgUrl;
    }, "image/png");
  }
  function resetBg() {
    if (bgUrl) { URL.revokeObjectURL(bgUrl); bgUrl = null; }
    if (bgSrc) { bgSrc.close(); bgSrc = null; }
    $("bgResult").classList.add("hidden");
  }
  async function addBgFile(file) {
    if (!file || !file.type.startsWith("image/")) return;
    resetBg();
    bgSrc = await createImageBitmap(file, { imageOrientation: "from-image" });
    $("bgResult").classList.remove("hidden");
    bgRender();
  }
  const bgDrop = $("bgDrop"), bgInput = $("bgInput");
  bgDrop.addEventListener("click", () => bgInput.click());
  bgDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); bgInput.click(); } });
  bgInput.addEventListener("change", (e) => { if (e.target.files[0]) addBgFile(e.target.files[0]); bgInput.value = ""; });
  attachDropHighlight(bgDrop);
  bgDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) addBgFile(e.dataTransfer.files[0]); });
  $("bgTol").addEventListener("input", () => { $("bgTolVal").textContent = $("bgTol").value; bgRender(); });
  $("bgClear").addEventListener("click", resetBg);

  // ---- Sign / Stamp ----
  let signPdfBytes = null;   // ArrayBuffer of the loaded PDF
  let signPageNum = 1, signPageCount = 1;
  let signImgUrl = null;     // object URL of the signature image (preview only)
  let signImgFile = null;    // the signature File (read directly — no fetch, CSP-safe)
  let signPlace = { fx: 0.1, fy: 0.1, fw: 0.3 }; // fractions of the page

  async function renderSignPage() {
    const task = pdfjsLib.getDocument({ data: signPdfBytes.slice(0) });
    const doc = await task.promise;
    signPageCount = doc.numPages;
    const pdfPage = await doc.getPage(signPageNum);
    const vp = pdfPage.getViewport({ scale: 1.5 });
    const c = $("signCanvas"); c.width = vp.width; c.height = vp.height;
    await pdfPage.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    $("signPageLabel").textContent = `${signPageNum} / ${signPageCount}`;
    positionStamp();
  }
  function positionStamp() {
    const img = $("signStamp"), c = $("signCanvas");
    if (img.classList.contains("hidden")) return;
    const rect = c.getBoundingClientRect(); // displayed (CSS) size
    img.style.left = signPlace.fx * rect.width + "px";
    img.style.top = signPlace.fy * rect.height + "px";
    img.style.width = signPlace.fw * rect.width + "px";
    img.style.height = "auto";
  }
  function loadSignImage(file) {
    signImgFile = file;
    if (signImgUrl) URL.revokeObjectURL(signImgUrl);
    signImgUrl = URL.createObjectURL(file);
    const img = $("signStamp");
    img.onload = () => {
      img.classList.remove("hidden");
      positionStamp();
    };
    img.src = signImgUrl;
  }
  // Drag to move (pointer events on the stamp).
  (function enableStampDrag() {
    const img = $("signStamp"); let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    img.addEventListener("pointerdown", (e) => {
      dragging = true; img.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY; ox = parseFloat(img.style.left) || 0; oy = parseFloat(img.style.top) || 0;
    });
    img.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = $("signCanvas").getBoundingClientRect();
      const nx = Math.max(0, Math.min(rect.width - img.offsetWidth, ox + e.clientX - sx));
      const ny = Math.max(0, Math.min(rect.height - img.offsetHeight, oy + e.clientY - sy));
      img.style.left = nx + "px"; img.style.top = ny + "px";
      signPlace.fx = nx / rect.width; signPlace.fy = ny / rect.height;
    });
    img.addEventListener("pointerup", () => { dragging = false; });
  })();

  async function addSignFile(file) {
    if (!file || file.type !== "application/pdf") return;
    signPdfBytes = await file.arrayBuffer();
    signPageNum = 1;
    $("signDrop").classList.add("hidden");
    $("signWork").classList.remove("hidden");
    await renderSignPage();
  }
  async function signApply() {
    if (!signPdfBytes) return;
    if ($("signStamp").classList.contains("hidden") || !signImgFile) { alert("Upload a signature image first."); return; }
    const pdfDoc = await PDFLib.PDFDocument.load(signPdfBytes);
    const imgBytes = new Uint8Array(await signImgFile.arrayBuffer()); // read the File directly — no fetch
    const png = await pdfDoc.embedPng(imgBytes).catch(() => null);
    const stamp = png || await pdfDoc.embedJpg(imgBytes);
    const page = pdfDoc.getPages()[signPageNum - 1];
    const { width: W, height: H } = page.getSize();
    const w = signPlace.fw * W;
    const h = w * (stamp.height / stamp.width);
    const x = signPlace.fx * W;
    const y = H - signPlace.fy * H - h; // convert top-left fraction to PDF bottom-left origin
    page.drawImage(stamp, { x, y, width: w, height: h });
    const out = await pdfDoc.save();
    const url = URL.createObjectURL(new Blob([out], { type: "application/pdf" }));
    const a = document.createElement("a"); a.href = url; a.download = "signed.pdf"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function signClear() {
    signPdfBytes = null; signImgFile = null;
    if (signImgUrl) { URL.revokeObjectURL(signImgUrl); signImgUrl = null; }
    $("signStamp").classList.add("hidden");
    $("signWork").classList.add("hidden");
    $("signDrop").classList.remove("hidden");
  }
  const signDrop = $("signDrop"), signInput = $("signInput");
  signDrop.addEventListener("click", () => signInput.click());
  signDrop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); signInput.click(); } });
  signInput.addEventListener("change", (e) => { if (e.target.files[0]) addSignFile(e.target.files[0]); signInput.value = ""; });
  attachDropHighlight(signDrop);
  signDrop.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files[0]) addSignFile(e.dataTransfer.files[0]); });
  $("signImgInput").addEventListener("change", (e) => { if (e.target.files[0]) loadSignImage(e.target.files[0]); e.target.value = ""; });
  $("signPrev").addEventListener("click", () => { if (signPageNum > 1) { signPageNum--; renderSignPage(); } });
  $("signNext").addEventListener("click", () => { if (signPageNum < signPageCount) { signPageNum++; renderSignPage(); } });
  $("signApply").addEventListener("click", signApply);
  $("signClear").addEventListener("click", signClear);
  window.addEventListener("resize", positionStamp);

  // ======================== NAV (sections + sub-tabs) ========================
  // Each leaf sub-tab maps to a drop-routing key (used by routeDrop/dropTargets).
  const SECTIONS = [
    { key: "pdf", label: "PDF", icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
      subs: [
        { key: "merge", label: "Merge" },
        { key: "split", label: "Split" },
        { key: "compress", label: "Compress" },
        { key: "images", label: "Images → PDF" },
        { key: "redact", label: "Redact" },
        { key: "sign", label: "Sign" },
      ] },
    { key: "image", label: "Image", icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
      subs: [
        { key: "exif", label: "Strip EXIF" },
        { key: "bg", label: "Bg Remover" },
      ] },
    { key: "data", label: "Data", icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
      subs: [
        { key: "csvjson", label: "CSV ↔ JSON" },
        { key: "diff", label: "Text Diff" },
      ] },
    { key: "base64", label: "Base64", icon:
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
      subs: [
        { key: "b64enc", label: "Encode → Base64" },
        { key: "b64dec", label: "Base64 → Decode" },
      ] },
  ];
  // sub key -> the [data-view] element it shows; base64 subs share base64View.
  const LEAF_VIEW = { merge:"merge", split:"split", compress:"compress", images:"images", redact:"redact", sign:"sign", exif:"exif", bg:"bg", b64enc:"base64", b64dec:"base64", csvjson:"csvjson", diff:"diff" };
  // sub key -> drop-routing key
  const LEAF_DROP = { merge:"merge", split:"split", compress:"compress", images:"images", redact:"redact", sign:"sign", exif:"exif", bg:"bg", b64enc:"base64", b64dec:"base64" };

  const sideNav = document.querySelector(".side-nav");
  const subTabs = $("subtabs");
  const dropTargets = {
    merge: { zone: dropzone, add: (f) => addFiles(f) },
    split: { zone: splitDrop, add: (f) => addSplitFile(f[0]) },
    compress: { zone: compressDrop, add: (f) => addCompressFile(f[0]) },
    images: { zone: imagesDrop, add: (f) => addImageFiles(f) },
    redact: { zone: redactDrop, add: (f) => addRedactFile(f[0]) },
    sign: { zone: signDrop, add: (f) => addSignFile(f[0]) },
    exif: { zone: exifDrop, add: (f) => addExifFiles(f) },
    bg: { zone: bgDrop, add: (f) => addBgFile(f[0]) },
    base64: { zone: b64Drop, add: (f) => b64EncodeFile(f[0]) },
  };
  let activeSection = "pdf";
  let currentTab = "merge"; // active drop-routing key

  function routeDrop(files, target) {
    const t = dropTargets[currentTab];
    if (t && !t.zone.contains(target)) t.add(files);
  }

  // Build the sidebar once.
  SECTIONS.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "side-item"; b.dataset.section = s.key;
    b.innerHTML = s.icon + "<span>" + s.label + "</span>";
    b.addEventListener("click", () => selectSection(s.key));
    sideNav.appendChild(b);
  });

  function selectLeaf(subKey) {
    const viewKey = LEAF_VIEW[subKey];
    document.querySelectorAll("[data-view]").forEach((el) => el.classList.toggle("hidden", el.dataset.view !== viewKey));
    if (subKey === "b64enc" || subKey === "b64dec") b64ShowEncode(subKey === "b64enc");
    currentTab = LEAF_DROP[subKey];
    Array.from(subTabs.children).forEach((btn) => {
      const on = btn.dataset.tab === subKey;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function selectSection(sectionKey) {
    activeSection = sectionKey;
    const section = SECTIONS.find((s) => s.key === sectionKey);
    Array.from(sideNav.children).forEach((b) => {
      const on = b.dataset.section === sectionKey;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    // Re-render sub-tabs for this section.
    subTabs.innerHTML = "";
    section.subs.forEach((sub) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "tab"; btn.dataset.tab = sub.key;
      btn.textContent = sub.label;
      btn.addEventListener("click", () => selectLeaf(sub.key));
      subTabs.appendChild(btn);
    });
    selectLeaf(section.subs[0].key);
  }

  selectSection("pdf");
  render();
})();
