import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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

