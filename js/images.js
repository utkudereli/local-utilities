import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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
      onStart() { state.dragging = true; },
      onEnd() {
        state.dragging = false;
        const ids = Array.from(imagesList.children).map((li) => Number(li.dataset.id));
        imgs.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
        resetImagesResult(); renderImages();
      },
    });
  }


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "images", zone: imagesDrop, add: (f) => addImageFiles(f) };
