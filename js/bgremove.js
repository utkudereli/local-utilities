import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "bg", zone: bgDrop, add: (f) => addBgFile(f[0]) };
