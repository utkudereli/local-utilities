import { $, state } from "./lib.js";
import { dropTarget as mergeDT } from "./merge.js";
import { dropTarget as splitDT } from "./split.js";
import { dropTarget as compressDT } from "./compress.js";
import { dropTarget as imagesDT } from "./images.js";
import { dropTarget as redactDT } from "./redact.js";
import { dropTarget as signDT } from "./sign.js";
import { dropTarget as exifDT } from "./exif.js";
import { dropTarget as bgDT } from "./bgremove.js";
import { dropTarget as base64DT, b64ShowEncode } from "./base64.js";

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
    merge: mergeDT, split: splitDT, compress: compressDT, images: imagesDT,
    redact: redactDT, sign: signDT, exif: exifDT, bg: bgDT, base64: base64DT,
  };
  let activeSection = "pdf";

  function routeDrop(files, target) {
    const t = dropTargets[state.currentTab];
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
    state.currentTab = LEAF_DROP[subKey];
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

  state.selectLeaf = selectLeaf; // let base64 surface the encode panel on file input
  selectSection("pdf");

  // Allow dropping anywhere on the page — routed to the active tab's handler.
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length) routeDrop(files, e.target);
  });
