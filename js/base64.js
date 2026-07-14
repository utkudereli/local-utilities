import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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
    if (state.currentTab === "base64") state.selectLeaf("b64enc"); // a dropped file means "encode" — surface that panel
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
    if (state.currentTab !== "base64" || b64EncPanel.classList.contains("hidden")) return;
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


// Drop-routing descriptor consumed by nav.js.
export const dropTarget = { key: "base64", zone: b64Drop, add: (f) => b64EncodeFile(f[0]) };

export { b64ShowEncode };
