// Shared helpers, library-readiness flags, and the one piece of cross-tool
// mutable state (the drag flag). Every tool module imports from here.

// ---- Library readiness ----
export const pdfjsReady = typeof pdfjsLib !== "undefined";
if (pdfjsReady) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
}
export const pdfLibReady = typeof PDFLib !== "undefined";
export const sortableReady = typeof Sortable !== "undefined";
export const jszipReady = typeof JSZip !== "undefined";

// ---- DOM helper ----
export const $ = (id) => document.getElementById(id);
const noticesEl = $("notices");

// ---- Cross-tool mutable state ----
// Only the drag flag is shared (merge's render pauses while any sortable drags).
// An object so modules can mutate it (imported bindings are read-only).
export const state = { dragging: false, currentTab: "merge", selectLeaf: null };

// ---- Helpers ----
export function fmtSize(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(2) + " MB";
  if (bytes >= 1024) return (bytes / 1024).toFixed(0) + " KB";
  return bytes + " B";
}

export function notice(msg, type, action) {
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

  if (action) {
    const act = document.createElement("button");
    act.type = "button";
    act.className = "n-action";
    act.textContent = action.label;
    act.addEventListener("click", () => { action.onClick(); dismiss(); });
    el.appendChild(act);
  }

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
  if (!isErr && !action) timer = setTimeout(dismiss, 4800);
  el.addEventListener("mouseenter", () => { if (timer) { clearTimeout(timer); timer = null; } });
}

export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
export const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export const scrollToEl = (el) => {
  const v = el.closest("[data-view]");
  if (v && v.classList.contains("hidden")) return; // don't scroll a background tab
  el.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "nearest" });
};

// Shared max image dimension (px cap per side) used by compress / redact / images.
export const MAX_DIM = 2200;

// Small icon button used by merge and images row actions.
export function iconBtn(label, pathSvg, onClick, danger) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "icon-btn" + (danger ? " danger" : "");
  b.setAttribute("aria-label", label);
  b.title = label;
  b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + pathSvg + "</svg>";
  b.addEventListener("click", onClick);
  return b;
}

// Adds the drag-over highlight to a dropzone (drop handling is attached separately).
export function attachDropHighlight(zone) {
  ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("dragover"); }));
  ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "dragleave" && zone.contains(e.relatedTarget)) return; zone.classList.remove("dragover"); }));
}
