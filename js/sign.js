import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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
    img.addEventListener("dragstart", (e) => e.preventDefault()); // stop native image drag
    img.addEventListener("pointerdown", (e) => {
      e.preventDefault();                                          // else the browser starts a native image drag on the first move
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


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "sign", zone: signDrop, add: (f) => addSignFile(f[0]) };
