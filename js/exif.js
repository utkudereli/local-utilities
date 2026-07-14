import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "exif", zone: exifDrop, add: (f) => addExifFiles(f) };
