/* ============================================================
   math-input.js - kolom isian berpersamaan untuk Panel Guru
   ------------------------------------------------------------
   Menyamakan cara guru menulis soal dengan cara siswa menjawab di Tes
   Sumatif (js/sumatif-student.js):
     - tombol "fx Persamaan" membuka editor rumus MathLive
       (vendor/mathlive) lalu menyisipkan $...$ di posisi kursor,
     - LaTeX boleh diketik langsung di antara $...$,
     - pratinjau rumus muncul di bawah kolom (MathJax) saat ada $.
   Pemakaian:
     MathInput.wrap(fieldHtml)          -> kolom + alat + pratinjau
     MathInput.wrap(fieldHtml, true)    -> versi ringkas (kolom satu baris)
     MathInput.refresh(root)            -> tampilkan pratinjau isi awal
   Kolom (textarea / input teks) harus berada di dalam .mi-wrap. Setelah
   sisip persamaan, event "input" dikirim agar penyimpan draf ikut jalan.
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const tr = (k, fb) => { if (typeof t === "function") { const v = t(k); if (v && v !== k) return v; } return fb; };
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const txt = s => (window.SumatifRender && window.SumatifRender.txt) ? window.SumatifRender.txt(s) : esc(s).replace(/\n/g, "<br>");
  const typeset = el => { if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([el]).catch(() => {}); };
  let target = null;
  let state = "none"; // none | loading | ready | failed
  let loading = null;

  function toolsHtml(compact) {
    const label = esc(tr("ts.stu.tool.eq", "Persamaan"));
    // Versi ringkas (kolom opsi satu baris) hanya menampilkan "fx" agar kolom tetap lebar.
    const btn = `<button type="button" class="ts-tool mi-eq-btn" data-mi-eq title="${esc(tr("ts.stu.eq.title", "Tambah persamaan"))}" aria-label="${label}"><span class="ts-tool-fx">fx</span>${compact ? "" : label}</button>`;
    return compact ? btn : `<div class="ts-ans-tools mi-tools">${btn}<span class="ts-ans-hint">${esc(tr("mi.hint", "Tulis rumus di antara $...$ atau klik Persamaan."))}</span></div>`;
  }
  function wrap(fieldHtml, compact) {
    const pv = `<div class="ts-ans-preview mi-preview" hidden></div>`;
    return compact
      ? `<div class="mi-wrap mi-compact"><div class="mi-row">${fieldHtml}${toolsHtml(true)}</div>${pv}</div>`
      : `<div class="mi-wrap">${toolsHtml(false)}${fieldHtml}${pv}</div>`;
  }
  function fieldOf(w) { return w.querySelector("textarea, input[type=text]"); }
  function preview(w) {
    const f = fieldOf(w), pv = w.querySelector(".mi-preview");
    if (!f || !pv) return;
    const v = f.value || "";
    if (v.indexOf("$") < 0) { pv.hidden = true; pv.innerHTML = ""; return; }
    pv.hidden = false;
    pv.innerHTML = `<span class="ts-ans-preview-label">${esc(tr("ts.stu.preview", "Pratinjau rumus"))}</span><div>${txt(v)}</div>`;
    typeset(pv);
  }
  function refresh(root) { (root || document).querySelectorAll(".mi-wrap").forEach(preview); }

  const timers = new WeakMap();
  document.addEventListener("input", e => {
    const w = e.target && e.target.closest && e.target.closest(".mi-wrap");
    if (!w || e.target !== fieldOf(w)) return;
    clearTimeout(timers.get(w));
    timers.set(w, setTimeout(() => preview(w), 300));
  });
  document.addEventListener("click", e => {
    const b = e.target && e.target.closest && e.target.closest("[data-mi-eq]");
    if (!b) return;
    const w = b.closest(".mi-wrap");
    if (w) openEq(fieldOf(w));
  });

  /* ---------- editor persamaan (sama dengan siswa) ---------- */
  function modal() {
    let m = $("mi-eq-modal");
    if (m) return m;
    m = document.createElement("div");
    m.id = "mi-eq-modal"; m.className = "modal ts-eq-modal"; m.hidden = true;
    m.innerHTML = `<div class="modal-box">
      <div class="modal-head"><h3>${esc(tr("ts.stu.eq.title", "Tambah persamaan"))}</h3>
        <button type="button" class="icon-btn" id="mi-eq-close-x" aria-label="${esc(tr("chatbot.close.aria", "Tutup"))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <p class="muted small">${esc(tr("ts.stu.eq.desc", "Ketik rumus seperti di kalkulator: / untuk pecahan, ^ untuk pangkat, _ untuk indeks."))}</p>
      <div id="mi-eq-host"></div>
      <p class="onboarding-status" id="mi-eq-status"></p>
      <div class="modal-actions"><button type="button" class="btn btn-secondary" id="mi-eq-cancel">${esc(tr("ts.cancel", "Batal"))}</button><button type="button" class="btn btn-primary" id="mi-eq-insert">${esc(tr("ts.stu.eq.insert", "Sisipkan"))}</button></div>
    </div>`;
    document.body.appendChild(m);
    $("mi-eq-close-x").addEventListener("click", close);
    $("mi-eq-cancel").addEventListener("click", close);
    $("mi-eq-insert").addEventListener("click", insert);
    m.addEventListener("click", e => { if (e.target === m) close(); });
    m.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    return m;
  }
  function loadMathLive() {
    if (state === "ready") return Promise.resolve(true);
    if (state === "failed") return Promise.resolve(false);
    if (window.MathfieldElement || (window.customElements && customElements.get("math-field"))) { state = "ready"; return Promise.resolve(true); }
    if (loading) return loading;
    state = "loading";
    loading = new Promise(res => {
      const s = document.createElement("script");
      s.src = "vendor/mathlive/mathlive.min.js";
      s.onload = () => {
        try {
          const MF = window.MathfieldElement || (window.MathLive && window.MathLive.MathfieldElement);
          if (MF) { MF.fontsDirectory = new URL("vendor/mathlive/fonts/", location.href).href; MF.soundsDirectory = null; }
          state = MF ? "ready" : "failed";
        } catch (e) { state = "failed"; }
        res(state === "ready");
      };
      s.onerror = () => { state = "failed"; res(false); };
      document.head.appendChild(s);
    });
    return loading;
  }
  async function openEq(field) {
    if (!field) return;
    target = field;
    const m = modal(), host = $("mi-eq-host");
    m.hidden = false;
    $("mi-eq-status").textContent = "";
    host.innerHTML = `<p class="muted small">${esc(tr("ts.loading", "Memuat..."))}</p>`;
    const ok = await loadMathLive();
    if (ok) {
      host.innerHTML = `<math-field id="mi-eq-field" class="ts-eq-field" math-virtual-keyboard-policy="auto"></math-field>`;
      const mf = $("mi-eq-field");
      try { mf.smartFence = true; } catch (e) { /* abaikan */ }
      setTimeout(() => { try { mf.focus(); } catch (e) { /* abaikan */ } }, 60);
    } else {
      host.innerHTML = `<textarea id="mi-eq-latex" rows="2" placeholder="\\frac{F}{IL}"></textarea><div class="ts-ans-preview" id="mi-eq-preview"></div>`;
      $("mi-eq-status").textContent = tr("ts.stu.eq.fallback", "Editor rumus tidak termuat. Ketik rumus dalam LaTeX.");
      $("mi-eq-latex").addEventListener("input", () => { const pv = $("mi-eq-preview"); pv.textContent = "$" + $("mi-eq-latex").value + "$"; typeset(pv); });
      $("mi-eq-latex").focus();
    }
  }
  function latex() {
    const mf = $("mi-eq-field");
    if (mf) { try { return mf.getValue ? mf.getValue("latex") : mf.value; } catch (e) { return mf.value || ""; } }
    const ta = $("mi-eq-latex");
    return ta ? ta.value : "";
  }
  function insert() {
    const L = String(latex() || "").trim();
    if (!L) { $("mi-eq-status").textContent = tr("ts.stu.eq.empty", "Persamaan masih kosong."); return; }
    const f = target;
    if (f) {
      const ins = "$" + L + "$";
      const s = f.selectionStart == null ? f.value.length : f.selectionStart, e = f.selectionEnd == null ? s : f.selectionEnd;
      const before = f.value.slice(0, s), after = f.value.slice(e);
      const pad = before && !/\s$/.test(before) ? " " : "";
      f.value = before + pad + ins + after;
      const caret = (before + pad + ins).length;
      f.focus(); try { f.setSelectionRange(caret, caret); } catch (er) { /* abaikan */ }
      f.dispatchEvent(new Event("input", { bubbles: true }));
    }
    close();
  }
  function close() {
    const m = $("mi-eq-modal");
    if (m) m.hidden = true;
    try { if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide(); } catch (e) { /* abaikan */ }
    const mf = $("mi-eq-field");
    if (mf) mf.remove();
  }

  window.MathInput = { wrap, refresh, open: openEq };
})();
