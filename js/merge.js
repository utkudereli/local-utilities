import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

  // ---- DOM ----------------------------------------------------------------
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

  // ---- State --------------------------------------------------------------
  let items = [];           // { id, file, name, size, pages, status, thumb, error }
  let seq = 0;
  let lastObjectUrl = null;
  let busy = false;

  // ---- Helpers ------------------------------------------------------------
  const readyItems = () => items.filter((i) => i.status === "ready");

  // ---- Rendering ----------------------------------------------------------
  function render() {
    // Never rebuild the list mid-drag — it would corrupt SortableJS's state.
    // A fresh render runs in onEnd once the drag settles.
    if (state.dragging) return;
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

  mergeBtn.addEventListener("click", merge);
  clearBtn.addEventListener("click", clearAll);

  // Drag-and-drop reordering
  if (sortableReady) {
    Sortable.create(fileList, {
      handle: ".drag-handle",
      animation: 160,
      ghostClass: "sortable-ghost",
      chosenClass: "sortable-chosen",
      onStart() { state.dragging = true; },
      onEnd() {
        state.dragging = false;
        const ids = Array.from(fileList.children).map((li) => Number(li.dataset.id));
        items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        clearResult();
        render();
      },
    });
  }

  if (!pdfLibReady) notice("The merge library didn't load. Reload the page to fix this.", "error");
  else if (!sortableReady) notice("Drag-to-reorder didn't load — use the ▲ ▼ buttons instead.", "warn");

  render(); // initial paint of the (empty) merge view

  // Drop-routing descriptor consumed by nav.js.
  export const dropTarget = { key: "merge", zone: dropzone, add: (f) => addFiles(f) };

