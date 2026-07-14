import { $, fmtSize, notice, nextFrame, prefersReduced, scrollToEl, attachDropHighlight, iconBtn, MAX_DIM, state, pdfjsReady, pdfLibReady, sortableReady, jszipReady } from "./lib.js";

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

