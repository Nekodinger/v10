/* ============================================================
   sumatif-student.js - Tes Sumatif untuk siswa (V10)
   ------------------------------------------------------------
   Saat guru mempublikasikan tes sumatif ke sesi kelas, muncul tombol
   "Tes Sumatif". Siswa membuka lembar tes layar penuh (seperti kertas
   PDF) dan menjawab langsung:
     - pilihan ganda: klik opsi,
     - uraian: KETIK (boleh LaTeX di antara $...$, pratinjau langsung),
       TULIS TANGAN di kanvas (pena/penghapus/urungkan), dan
       + PERSAMAAN lewat editor rumus MathLive (vendor/mathlive).
   Jawaban tersimpan otomatis (draft) dan dikumpulkan dengan tombol
   Kumpulkan atau otomatis saat waktu habis.
   Memakai global dari app.js: apiCall, t, getJoinedSessionCode,
   isInClassSession, showToast; dan js/sumatif-render.js.
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const R = window.SumatifRender;
  const SAVE_DEBOUNCE_MS = 2500, SAVE_EVERY_MS = 30000, INK_LIMIT = 440000;
  let summary = null;          // ringkasan tes aktif dari session_sync
  let data = null;             // { test, quizId, publishedAt, durationMin, answers, status }
  let offset = 0;              // serverNow - Date.now()
  let dirty = false, saving = false, saveTimer = null, periodic = null, tick = null;
  let readOnly = false, autoSubmitted = false;
  let pads = {};               // key -> InkPad
  let eqTarget = null;         // textarea tujuan sisipan persamaan
  let mathliveState = "none";  // none | loading | ready | failed

  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const typeset = el => { if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([el]).catch(() => {}); };
  const code = () => (typeof getJoinedSessionCode === "function" ? getJoinedSessionCode() : null);
  const serverNow = () => Date.now() + offset;
  function deadline() { return data && data.publishedAt ? Number(data.publishedAt) + (Number(data.durationMin) || 60) * 60000 : null; }

  /* ---------------- tombol mengambang ---------------- */
  function update(ts) {
    const btn = $("ts-toggle-btn");
    if (!btn) return;
    const inSession = typeof isInClassSession !== "function" || isInClassSession();
    const prev = summary;
    summary = ts && ts.id && ts.active && inSession ? ts : null;
    if (!summary) {
      btn.hidden = true;
      if (prev && data && !$("ts-overlay").hidden && !readOnly) endedByTeacher();
      return;
    }
    if (data && data.quizId !== summary.id) { data = null; pads = {}; }
    btn.hidden = false;
    const done = summary.status === "submitted" || (data && data.status === "submitted");
    btn.classList.toggle("done", !!done);
    $("ts-toggle-label").textContent = done ? t("ts.stu.btn.done") : t("ts.stu.btn");
  }
  function endedByTeacher() {
    setReadOnly(true);
    setSaveState(t("ts.stu.ended"), "bad");
    if (typeof showToast === "function") showToast(t("ts.stu.ended"));
  }

  /* ---------------- buka / tutup ---------------- */
  async function open() {
    const ov = $("ts-overlay");
    ov.hidden = false;
    document.body.classList.add("ts-open");
    if (data && summary && data.quizId === summary.id) { startClock(); return; }
    $("ts-sheet").innerHTML = `<p class="teacher-note">${esc(t("ts.loading"))}</p>`;
    const r = await apiCall("student_test_get", { code: code() });
    if (r.error || !r.test) { $("ts-sheet").innerHTML = `<p class="teacher-note">${esc(r.error || t("ts.stu.none"))}</p>`; return; }
    data = r;
    offset = (Number(r.serverNow) || Date.now()) - Date.now();
    autoSubmitted = false;
    render();
    startClock();
  }
  function close() {
    if (dirty) save(false);
    $("ts-overlay").hidden = true;
    document.body.classList.remove("ts-open");
  }

  /* ---------------- render lembar ---------------- */
  function render() {
    const sheet = $("ts-sheet");
    pads = {};
    $("ts-bar-title").textContent = data.test.title || t("qz.mode.test");
    sheet.innerHTML = R.paper(data.test, { mode: "student", answers: data.answers || {} });
    sheet.querySelectorAll(".ts-answer[data-answer-key]").forEach(box => buildAnswer(box, (data.answers || {})[box.dataset.answerKey]));
    typeset(sheet);
    setReadOnly(data.status === "submitted");
    setSaveState(data.status === "submitted" ? t("ts.stu.submitted") : (data.savedAt ? t("ts.stu.savedat", { time: hhmm(data.savedAt) }) : t("ts.stu.autosave")), data.status === "submitted" ? "ok" : "");
    progress();
  }
  function hhmm(ms) { return new Date(Number(ms) - offset).toLocaleTimeString(getLang() === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" }); }

  function buildAnswer(box, val) {
    const key = box.dataset.answerKey;
    const v = val && typeof val === "object" ? val : {};
    box.innerHTML = `<div class="ts-ans-tools no-print">
        <button type="button" class="ts-tool" data-tool="ink" aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/></svg>${esc(t("ts.stu.tool.ink"))}</button>
        <button type="button" class="ts-tool" data-tool="eq"><span class="ts-tool-fx">fx</span>${esc(t("ts.stu.tool.eq"))}</button>
        <span class="ts-ans-hint">${esc(t("ts.stu.hint"))}</span>
      </div>
      <textarea class="ts-ans-text" rows="3" maxlength="8000" placeholder="${esc(t("ts.stu.placeholder"))}">${esc(v.text || "")}</textarea>
      <div class="ts-ans-preview" hidden></div>
      <div class="ts-ink" hidden></div>`;
    const ta = box.querySelector(".ts-ans-text");
    autoGrow(ta);
    if (v.text && v.text.indexOf("$") >= 0) preview(box);
    if (v.ink) { openInk(box, v.ink); }
  }
  function autoGrow(ta) { ta.style.height = "auto"; ta.style.height = Math.min(600, Math.max(76, ta.scrollHeight + 2)) + "px"; }
  const previewTimers = new WeakMap();
  function preview(box) {
    const ta = box.querySelector(".ts-ans-text"), pv = box.querySelector(".ts-ans-preview");
    const txt = ta.value;
    if (txt.indexOf("$") < 0) { pv.hidden = true; pv.innerHTML = ""; return; }
    pv.hidden = false;
    pv.innerHTML = `<span class="ts-ans-preview-label">${esc(t("ts.stu.preview"))}</span><div>${R.txt(txt)}</div>`;
    typeset(pv);
  }
  function openInk(box, initial) {
    const key = box.dataset.answerKey;
    const holder = box.querySelector(".ts-ink");
    const btn = box.querySelector('[data-tool="ink"]');
    holder.hidden = false;
    btn.setAttribute("aria-pressed", "true");
    btn.classList.add("active");
    if (!pads[key]) pads[key] = new InkPad(holder, initial || null, () => markDirty());
  }

  /* ---------------- kanvas tulisan tangan ---------------- */
  function InkPad(holder, initialUrl, onChange) {
    this.holder = holder; this.onChange = onChange;
    this.strokes = []; this.tool = "pen"; this.height = 240; this.bg = null; this.bgH = 0;
    holder.innerHTML = `<div class="ts-ink-bar no-print">
        <button type="button" class="ts-ink-btn active" data-ink="pen">${esc(t("ts.stu.ink.pen"))}</button>
        <button type="button" class="ts-ink-btn" data-ink="eraser">${esc(t("ts.stu.ink.eraser"))}</button>
        <button type="button" class="ts-ink-btn" data-ink="undo">${esc(t("ts.stu.ink.undo"))}</button>
        <button type="button" class="ts-ink-btn" data-ink="clear">${esc(t("ts.stu.ink.clear"))}</button>
        <button type="button" class="ts-ink-btn" data-ink="grow">${esc(t("ts.stu.ink.grow"))}</button>
      </div><div class="ts-ink-surface"><canvas></canvas></div>`;
    this.canvas = holder.querySelector("canvas");
    this.ctx = this.canvas.getContext("2d");
    const self = this;
    holder.querySelector(".ts-ink-bar").addEventListener("click", e => {
      const b = e.target.closest("[data-ink]");
      if (!b || readOnly) return;
      const a = b.dataset.ink;
      if (a === "pen" || a === "eraser") {
        self.tool = a;
        holder.querySelectorAll('[data-ink="pen"],[data-ink="eraser"]').forEach(x => x.classList.toggle("active", x === b));
      } else if (a === "undo") { if (self.strokes.length) { self.strokes.pop(); self.redraw(); self.onChange(); } }
      else if (a === "clear") { if (confirm(t("ts.stu.ink.clear.confirm"))) { self.strokes = []; self.bg = null; self.redraw(); self.onChange(); } }
      else if (a === "grow") { self.height = Math.min(900, self.height + 160); self.resize(); }
    });
    let cur = null;
    const pos = e => { const r = self.canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top, e.pressure || 0.5]; };
    this.canvas.addEventListener("pointerdown", e => {
      if (readOnly) return;
      e.preventDefault();
      self.canvas.setPointerCapture(e.pointerId);
      cur = { tool: self.tool, pts: [pos(e)] };
      self.strokes.push(cur);
      self.drawStroke(cur, true);
    });
    this.canvas.addEventListener("pointermove", e => {
      if (!cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      evs.forEach(ev => cur.pts.push(pos(ev)));
      self.drawStroke(cur, false);
    });
    const end = () => { if (cur) { cur = null; self.onChange(); } };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    if (initialUrl) {
      const img = new Image();
      img.onload = () => { self.bg = img; self.bgH = img.naturalHeight; self.height = Math.max(self.height, Math.min(900, img.naturalHeight)); self.resize(); };
      img.src = initialUrl;
    }
    this.resize();
    this._ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => self.resize()) : null;
    if (this._ro) this._ro.observe(holder);
  }
  InkPad.prototype.resize = function () {
    const w = Math.max(200, Math.floor(this.holder.clientWidth || 600));
    if (this.w === w && this.h === this.height) return;
    this.w = w; this.h = this.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = w + "px"; this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  };
  InkPad.prototype.redraw = function () {
    const c = this.ctx;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, this.canvas.width, this.canvas.height); c.restore();
    if (this.bg) c.drawImage(this.bg, 0, 0, this.bg.naturalWidth, this.bg.naturalHeight);
    this.strokes.forEach(s => this.drawStroke(s, true, true));
  };
  InkPad.prototype.drawStroke = function (s, whole, noReset) {
    const c = this.ctx, pts = s.pts;
    c.save();
    c.lineCap = "round"; c.lineJoin = "round";
    if (s.tool === "eraser") { c.globalCompositeOperation = "destination-out"; c.lineWidth = 22; }
    else { c.globalCompositeOperation = "source-over"; c.strokeStyle = "#1B2160"; }
    const from = whole ? 1 : Math.max(1, pts.length - 4);
    if (pts.length === 1) {
      c.beginPath(); c.fillStyle = "#1B2160";
      if (s.tool !== "eraser") { c.arc(pts[0][0], pts[0][1], 1.4, 0, Math.PI * 2); c.fill(); }
    }
    for (let i = from; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (s.tool !== "eraser") c.lineWidth = 1.4 + b[2] * 2.2;
      c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    }
    c.restore();
  };
  InkPad.prototype.isEmpty = function () { return !this.bg && !this.strokes.some(s => s.tool === "pen"); };
  InkPad.prototype.toDataURL = function () {
    if (this.isEmpty()) return "";
    // Ekspor 1x (ukuran CSS) dengan latar putih supaya berkas kecil.
    const out = document.createElement("canvas");
    out.width = this.w; out.height = this.h;
    const o = out.getContext("2d");
    o.fillStyle = "#fff"; o.fillRect(0, 0, out.width, out.height);
    o.drawImage(this.canvas, 0, 0, out.width, out.height);
    let url = out.toDataURL("image/png");
    if (url.length > INK_LIMIT) url = out.toDataURL("image/webp", 0.8);
    if (url.length > INK_LIMIT) url = out.toDataURL("image/jpeg", 0.7);
    return url.length > INK_LIMIT ? "" : url;
  };

  /* ---------------- persamaan (MathLive) ---------------- */
  function loadMathLive() {
    if (mathliveState === "ready" || mathliveState === "failed") return Promise.resolve(mathliveState === "ready");
    if (mathliveState === "loading") return loadMathLive._p;
    mathliveState = "loading";
    loadMathLive._p = new Promise(res => {
      const s = document.createElement("script");
      s.src = "vendor/mathlive/mathlive.min.js";
      s.onload = () => {
        try {
          const MF = window.MathfieldElement || (window.MathLive && window.MathLive.MathfieldElement);
          if (MF) { MF.fontsDirectory = new URL("vendor/mathlive/fonts/", location.href).href; MF.soundsDirectory = null; }
          mathliveState = MF ? "ready" : "failed";
        } catch (e) { mathliveState = "failed"; }
        res(mathliveState === "ready");
      };
      s.onerror = () => { mathliveState = "failed"; res(false); };
      document.head.appendChild(s);
    });
    return loadMathLive._p;
  }
  async function openEq(ta) {
    eqTarget = ta;
    const modal = $("ts-eq-modal"), host = $("ts-eq-host");
    modal.hidden = false;
    $("ts-eq-status").textContent = "";
    host.innerHTML = `<p class="muted small">${esc(t("ts.loading"))}</p>`;
    const ok = await loadMathLive();
    if (ok) {
      host.innerHTML = `<math-field id="ts-eq-field" class="ts-eq-field" math-virtual-keyboard-policy="auto"></math-field>`;
      const mf = $("ts-eq-field");
      try { mf.smartFence = true; } catch (e) { /* abaikan */ }
      setTimeout(() => { try { mf.focus(); } catch (e) { /* abaikan */ } }, 60);
    } else {
      host.innerHTML = `<textarea id="ts-eq-latex" rows="2" placeholder="\\frac{F}{IL}"></textarea><div class="ts-ans-preview" id="ts-eq-preview"></div>`;
      $("ts-eq-status").textContent = t("ts.stu.eq.fallback");
      $("ts-eq-latex").addEventListener("input", () => { const pv = $("ts-eq-preview"); pv.textContent = "$" + $("ts-eq-latex").value + "$"; typeset(pv); });
      $("ts-eq-latex").focus();
    }
  }
  function eqLatex() {
    const mf = $("ts-eq-field");
    if (mf) { try { return mf.getValue ? mf.getValue("latex") : mf.value; } catch (e) { return mf.value || ""; } }
    const ta = $("ts-eq-latex");
    return ta ? ta.value : "";
  }
  function insertEq() {
    const latex = String(eqLatex() || "").trim();
    if (!latex) { $("ts-eq-status").textContent = t("ts.stu.eq.empty"); return; }
    const ta = eqTarget;
    if (ta) {
      const ins = "$" + latex + "$";
      const s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? s : ta.selectionEnd;
      const before = ta.value.slice(0, s), after = ta.value.slice(e);
      const pad = before && !/\s$/.test(before) ? " " : "";
      ta.value = before + pad + ins + after;
      const caret = (before + pad + ins).length;
      ta.focus(); ta.setSelectionRange(caret, caret);
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    }
    closeEq();
  }
  function closeEq() {
    $("ts-eq-modal").hidden = true;
    const mf = $("ts-eq-field");
    try { if (window.mathVirtualKeyboard) window.mathVirtualKeyboard.hide(); } catch (e) { /* abaikan */ }
    if (mf) mf.remove();
  }

  /* ---------------- interaksi lembar ---------------- */
  function markDirty() {
    if (readOnly) return;
    dirty = true;
    setSaveState(t("ts.stu.unsaved"), "warn");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save(false), SAVE_DEBOUNCE_MS);
    progress();
  }
  function bindSheet() {
    const sheet = $("ts-sheet");
    sheet.addEventListener("change", e => { if (e.target.matches("[data-mcq]")) markDirty(); });
    sheet.addEventListener("input", e => {
      if (!e.target.matches(".ts-ans-text")) return;
      autoGrow(e.target);
      const box = e.target.closest(".ts-answer");
      clearTimeout(previewTimers.get(box));
      previewTimers.set(box, setTimeout(() => preview(box), 350));
      markDirty();
    });
    sheet.addEventListener("click", e => {
      const b = e.target.closest("[data-tool]");
      if (!b || readOnly) return;
      const box = b.closest(".ts-answer");
      if (b.dataset.tool === "ink") {
        const holder = box.querySelector(".ts-ink");
        if (holder.hidden) openInk(box, null);
        else {
          const pad = pads[box.dataset.answerKey];
          if (pad && !pad.isEmpty() && !confirm(t("ts.stu.ink.hide.confirm"))) return;
          holder.hidden = true; b.setAttribute("aria-pressed", "false"); b.classList.remove("active");
          if (pad) { pad.strokes = []; pad.bg = null; delete pads[box.dataset.answerKey]; holder.innerHTML = ""; markDirty(); }
        }
      } else if (b.dataset.tool === "eq") openEq(box.querySelector(".ts-ans-text"));
    });
  }
  function collect() {
    const out = {};
    const sheet = $("ts-sheet");
    sheet.querySelectorAll("[data-mcq]:checked").forEach(r => { out[r.dataset.mcq] = parseInt(r.value, 10); });
    sheet.querySelectorAll(".ts-answer[data-answer-key]").forEach(box => {
      const key = box.dataset.answerKey;
      const text = box.querySelector(".ts-ans-text").value;
      const pad = pads[key];
      const ink = pad ? pad.toDataURL() : "";
      if (text.trim() || ink) out[key] = Object.assign({}, text.trim() ? { text } : {}, ink ? { ink } : {});
    });
    return out;
  }
  function counts() {
    if (!data) return { done: 0, all: 0 };
    let all = 0, done = 0;
    const sheet = $("ts-sheet");
    (data.test.sections || []).forEach(S => S.items.forEach(it => {
      if (it.type === "mcq") { all++; if (sheet.querySelector(`[data-mcq="${CSS.escape(it.id)}"]:checked`)) done++; }
      else {
        const keys = it.type === "structured" ? (it.parts || []).map(p => it.id + "." + p.id) : [it.id];
        keys.forEach(k => {
          all++;
          const box = sheet.querySelector(`.ts-answer[data-answer-key="${CSS.escape(k)}"]`);
          if (box && (box.querySelector(".ts-ans-text").value.trim() || (pads[k] && !pads[k].isEmpty()))) done++;
        });
      }
    }));
    return { done, all };
  }
  function progress() { const c = counts(); $("ts-progress").textContent = t("ts.stu.progress", { done: c.done, all: c.all }); }
  function setSaveState(msg, kind) { const el = $("ts-save-state"); el.textContent = msg || ""; el.className = "ts-save-state" + (kind ? " " + kind : ""); }

  async function save(submit) {
    if (!data || (readOnly && !submit)) return { ok: false };
    if (saving && !submit) { dirty = true; return { ok: false }; }
    clearTimeout(saveTimer);
    saving = true;
    const answers = collect();
    dirty = false;
    if (!submit) setSaveState(t("ts.stu.saving"), "");
    let r;
    try { r = await apiCall(submit ? "student_test_submit" : "student_test_save", { code: code(), quizId: data.quizId, answers }); }
    catch (e) { r = { error: e.message }; }
    saving = false;
    if (r.error) {
      dirty = true;
      if (r.code === "TEST_ENDED") { endedByTeacher(); }
      else if (r.code === "TEST_SUBMITTED") { data.status = "submitted"; setReadOnly(true); setSaveState(t("ts.stu.submitted"), "ok"); }
      else setSaveState(r.error, "bad");
      return r;
    }
    data.answers = answers;
    data.savedAt = r.savedAt;
    if (submit) { data.status = "submitted"; if (summary) summary.status = "submitted"; setReadOnly(true); setSaveState(t("ts.stu.submitted"), "ok"); update(summary); }
    else setSaveState(t("ts.stu.savedat", { time: hhmm(r.savedAt) }), "ok");
    return r;
  }
  async function submit(auto) {
    if (!data || readOnly) return;
    if (!auto) {
      const c = counts();
      const msg = c.done < c.all ? t("ts.stu.submit.confirm.partial", { n: c.all - c.done }) : t("ts.stu.submit.confirm");
      if (!confirm(msg)) return;
    }
    $("ts-submit-btn").disabled = true;
    setSaveState(t("ts.stu.submitting"), "");
    const r = await save(true);
    $("ts-submit-btn").disabled = readOnly;
    if (r && r.ok && typeof showToast === "function") showToast(auto ? t("ts.stu.autosubmitted") : t("ts.stu.submitted"));
  }
  function setReadOnly(on) {
    readOnly = !!on;
    const sheet = $("ts-sheet");
    sheet.classList.toggle("ts-readonly", readOnly);
    sheet.querySelectorAll("input, textarea").forEach(el => { el.disabled = readOnly; });
    sheet.querySelectorAll(".ts-ans-tools, .ts-ink-bar").forEach(el => { el.hidden = readOnly; });
    $("ts-submit-btn").hidden = readOnly;
    $("ts-save-now").hidden = readOnly;
    $("ts-readonly-note").hidden = !readOnly;
    $("ts-readonly-note").textContent = data && data.status === "submitted" ? t("ts.stu.readonly") : t("ts.stu.ended");
  }

  /* ---------------- waktu ---------------- */
  function startClock() {
    clearInterval(tick); clearInterval(periodic);
    tick = setInterval(clock, 1000); clock();
    periodic = setInterval(() => { if (dirty && !readOnly) save(false); }, SAVE_EVERY_MS);
  }
  function clock() {
    const el = $("ts-timer"), dl = deadline();
    if (!dl) { el.textContent = ""; return; }
    const left = Math.max(0, dl - serverNow());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    el.classList.toggle("warn", left < 5 * 60000 && left > 60000);
    el.classList.toggle("bad", left <= 60000);
    if (left <= 0 && !readOnly && !autoSubmitted && data && data.status !== "submitted") { autoSubmitted = true; submit(true); }
  }

  /* ---------------- init ---------------- */
  function init() {
    if (!$("ts-overlay")) return;
    $("ts-toggle-btn").addEventListener("click", open);
    $("ts-close-btn").addEventListener("click", close);
    $("ts-save-now").addEventListener("click", () => save(false));
    $("ts-submit-btn").addEventListener("click", () => submit(false));
    $("ts-eq-insert").addEventListener("click", insertEq);
    $("ts-eq-cancel").addEventListener("click", closeEq);
    $("ts-eq-close-x").addEventListener("click", closeEq);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("ts-eq-modal").hidden) closeEq(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && dirty) save(false); });
    window.addEventListener("beforeunload", e => { if (dirty && !readOnly) { save(false); e.preventDefault(); e.returnValue = ""; } });
    bindSheet();
  }
  init();
  window.SumatifStudent = { update, open, close, _state: () => ({ data, readOnly, dirty }) };
})();
