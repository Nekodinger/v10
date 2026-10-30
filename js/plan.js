/* ============================================================
   plan.js - Lembar Rencana Proyek Kelompok di halaman siswa (V12)
   ------------------------------------------------------------
   - Tombol "Rencana Proyek" muncul di pojok kanan bawah (seperti
     Tes Sumatif) setelah siswa mencapai tab Eksperimen pada topik.
   - Semua anggota kelompok mengisi SATU lembar yang sama. Setiap
     kolom disimpan sendiri dengan nomor versi; perubahan anggota
     lain muncul otomatis (sinkron setiap beberapa detik), dan nama
     anggota yang sedang mengisi sebuah kolom ditampilkan.
   - Di Makerspace, tombol "Isi dari Rencana Proyek" memindahkan
     draf prompt ke Generator dan Prompt Final.
   ============================================================ */
(function () {
  const D = window.PlanDef;
  if (!D) return;
  const L = D.L;
  const B = (id, en) => ({ id, en });
  const SAVE_DEBOUNCE_MS = 700;
  const POLL_MS = 3000;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TX = {
    btn: B("Rencana Proyek", "Project Plan"),
    btnTitle: B("Lembar Rencana Proyek Kelompok", "Group Project Plan"),
    eyebrow: B("Sintaks PjBL 2-3 · Mendesain produk dan menyusun jadwal", "PjBL steps 2-3 · Design the product and plan the schedule"),
    title: B("Lembar Rencana Proyek Kelompok", "Group Project Plan"),
    close: B("Tutup lembar rencana", "Close the project plan"),
    shared: B("Satu lembar untuk seluruh anggota kelompok. Perubahan tersimpan otomatis dan langsung terlihat di perangkat anggota lain.", "One plan for the whole group. Changes save automatically and appear on the other members' devices."),
    solo: B("Kamu belum masuk kelompok, jadi lembar ini hanya milikmu. Perubahan tersimpan otomatis.", "You are not in a group yet, so this plan is yours alone. Changes save automatically."),
    guest: B("Mode eksplorasi: isian tidak disimpan ke server.", "Exploration mode: entries are not saved to the server."),
    saving: B("Menyimpan...", "Saving..."),
    saved: B("Tersimpan", "Saved"),
    unsaved: B("Belum tersimpan...", "Not saved yet..."),
    offline: B("Belum tersimpan online, dicoba lagi otomatis", "Not saved online yet, retrying automatically"),
    loading: B("Memuat rencana kelompok...", "Loading the group plan..."),
    members: B("Anggota", "Members"),
    you: B("kamu", "you"),
    typing: B("sedang mengisi", "is editing"),
    updatedBy: B("diperbarui oleh", "updated by"),
    lastBy: B("terakhir diisi", "last edited by"),
    checklist: B("Periksa sebelum Pertemuan 2", "Check before Meeting 2"),
    idea: B("Ide fitur", "Feature idea"),
    category: B("Kategori", "Category"),
    when: B("Waktu", "When"),
    target: B("Target", "Target"),
    who: B("Penanggung jawab", "Responsible"),
    done: B("Selesai", "Done"),
    fill: B("Isi dari Rencana Proyek", "Fill from Project Plan"),
    fillDone: B("Generator diisi dari Rencana Proyek kelompok. Periksa lalu tekan Susun Prompt atau langsung Generate.", "The Generator was filled from the group's Project Plan. Check it, then press Build Prompt or Generate."),
    fillEmpty: B("Rencana Proyek kelompok masih kosong. Isi dulu bagian Draf Prompt di tombol Rencana Proyek.", "The group's Project Plan is still empty. Fill in the Prompt Draft part first using the Project Plan button."),
    fillFail: B("Rencana Proyek belum bisa dimuat. Coba lagi.", "The Project Plan could not be loaded. Try again."),
    choose: B("pilih", "choose")
  };

  const st = { topicId: null, fields: {}, dirty: {}, inflight: false, focusK: null, saveTimer: null, pollTimer: null, presence: [], guest: false, loaded: false, open: false, rendered: null, lastErr: false };
  const me = () => { try { const a = getAccount && getAccount(); return a ? a.studentId : ""; } catch (e) { return ""; } };
  const acct = () => { try { return (typeof getAccount === "function" && getAccount()) || null; } catch (e) { return null; } };

  /* ---------- DOM ---------- */
  function build() {
    if ($("plan-toggle-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button"; btn.id = "plan-toggle-btn"; btn.className = "quiz-toggle-btn plan-toggle-btn"; btn.hidden = true;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M8 6H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2"/><path d="M8.5 12l2 2 4-4"/><path d="M8.5 17.5h7"/></svg><span id="plan-toggle-label"></span>`;
    const shell = $("site-shell") || document.body;
    shell.appendChild(btn);
    const ov = document.createElement("div");
    ov.id = "plan-overlay"; ov.className = "ts-overlay plan-overlay"; ov.hidden = true;
    ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-labelledby", "plan-bar-title");
    ov.innerHTML = `<div class="ts-bar plan-bar">
        <div class="ts-bar-main"><p class="eyebrow" id="plan-eyebrow"></p><h3 id="plan-bar-title"></h3></div>
        <div class="ts-bar-info"><span class="plan-members" id="plan-members"></span><span class="ts-save-state" id="plan-save-state"></span></div>
        <div class="ts-bar-actions"><button type="button" class="icon-btn" id="plan-close-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      </div>
      <div class="ts-scroll" id="plan-scroll"><div class="plan-sheet" id="plan-sheet"></div></div>`;
    document.body.appendChild(ov);
    btn.addEventListener("click", open);
    $("plan-close-btn").addEventListener("click", close);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && st.open) close(); });
    const sheet = $("plan-sheet");
    sheet.addEventListener("input", onInput);
    sheet.addEventListener("change", onInput);
    sheet.addEventListener("focusin", e => { const el = e.target.closest("[data-k]"); if (el) { st.focusK = el.dataset.k; } });
    sheet.addEventListener("focusout", e => { const el = e.target.closest("[data-k]"); if (el && st.focusK === el.dataset.k) { st.focusK = null; scheduleSave(150); } });
    // Makerspace: isi Generator dari rencana
    const buildBtn = $("pf-build-btn");
    if (buildBtn && !$("pf-plan-btn")) {
      const fb = document.createElement("button");
      fb.type = "button"; fb.id = "pf-plan-btn"; fb.className = "btn btn-ghost";
      buildBtn.insertAdjacentElement("afterend", fb);
      fb.addEventListener("click", fillGenerator);
    }
  }
  function labels() {
    const lb = $("plan-toggle-label"); if (lb) lb.textContent = L(TX.btn);
    const b = $("plan-toggle-btn"); if (b) { b.title = L(TX.btnTitle); b.setAttribute("aria-label", L(TX.btnTitle)); }
    const c = $("plan-close-btn"); if (c) c.setAttribute("aria-label", L(TX.close));
    if ($("plan-eyebrow")) $("plan-eyebrow").textContent = L(TX.eyebrow);
    if ($("plan-bar-title")) $("plan-bar-title").textContent = L(TX.title);
    const fb = $("pf-plan-btn"); if (fb) fb.textContent = L(TX.fill);
  }

  function fieldLabel(k) {
    for (const s of D.SECTIONS) {
      for (const f of (s.fields || [])) if (f.k === k) return L(f.label).replace(/\$[^$]*\$/g, "").split(/[(:?]/)[0].trim().slice(0, 40);
      if (s.ideas && /^(idea|cat)_\d+$/.test(k)) return L(TX.idea) + " " + k.split("_")[1];
      if (s.schedule && /^sched_/.test(k)) return L(s.title).replace(/^\d+\.\s*/, "");
    }
    return k;
  }

  function renderSheet() {
    const lang = (typeof getLang === "function" && getLang()) || "id";
    const sig = (st.topicId || "") + "|" + lang;
    if (st.rendered === sig) return;
    st.rendered = sig;
    const a = acct();
    const intro = st.guest ? L(TX.guest) : (a && a.groupId ? L(TX.shared) : L(TX.solo));
    const meta = (typeof currentTopic !== "undefined" && currentTopic) ? (typeof trContent === "function" ? trContent(currentTopic.title) : currentTopic.title) : "";
    const pres = k => `<span class="plan-pres" data-pres-for="${k}"></span>`;
    const lastBy = k => `<span class="plan-by" data-by-for="${k}"></span>`;
    let h = `<div class="ts-paper plan-paper"><p class="eyebrow">${esc(meta)}${a && a.groupName ? " · " + esc(a.groupName) : ""}</p><p class="plan-intro">${esc(intro)}</p>`;
    D.SECTIONS.forEach(s => {
      h += `<section class="plan-sec" data-sec="${s.id}"><h4>${L(s.title)}</h4>` + (s.hint ? `<p class="plan-hint">${L(s.hint)}</p>` : "");
      (s.fields || []).forEach(f => {
        const id = "plan-f-" + f.k;
        h += `<div class="plan-field${f.type === "text" ? " plan-field-inline" : ""}"><label for="${id}">${L(f.label)}</label>` +
          (f.type === "text" ? `<input type="text" id="${id}" data-k="${f.k}" maxlength="120" autocomplete="off">` : `<textarea id="${id}" data-k="${f.k}" rows="${f.rows || 3}" maxlength="4000"></textarea>`) +
          `<div class="plan-meta">${pres(f.k)}${lastBy(f.k)}</div></div>`;
      });
      if (s.ideas) {
        h += `<table class="plan-ideas"><thead><tr><th class="c" style="width:7%">No.</th><th>${L(TX.idea)}</th><th style="width:30%">${L(TX.category)}</th></tr></thead><tbody>`;
        for (let i = 1; i <= s.ideas; i++) {
          h += `<tr><td class="c">${i}</td><td><input type="text" data-k="idea_${i}" maxlength="300" autocomplete="off" aria-label="${L(TX.idea)} ${i}"><div class="plan-meta">${pres("idea_" + i)}</div></td>
            <td><select data-k="cat_${i}" aria-label="${L(TX.category)} ${i}"><option value="">${L(TX.choose)}</option>${D.CATS.map(([c, lab]) => `<option value="${c}">(${c}) ${esc(L(lab))}</option>`).join("")}</select></td></tr>`;
        }
        h += `</tbody></table>`;
      }
      if (s.schedule) {
        h += `<table class="plan-sched"><thead><tr><th style="width:15%">${L(TX.when)}</th><th>${L(TX.target)}</th><th style="width:24%">${L(TX.who)}</th><th class="c" style="width:9%">${L(TX.done)}</th></tr></thead><tbody>`;
        s.schedule.forEach(r => {
          h += `<tr><td>${esc(L(r.when))}</td><td>${L(r.what)}</td><td><input type="text" data-k="sched_${r.k}_who" maxlength="120" autocomplete="off"><div class="plan-meta">${pres("sched_" + r.k + "_who")}</div></td>
            <td class="c"><input type="checkbox" data-k="sched_${r.k}_done" aria-label="${L(TX.done)}"></td></tr>`;
        });
        h += `</tbody></table>`;
      }
      h += `</section>`;
    });
    h += `<section class="plan-sec plan-check"><h4>${L(TX.checklist)}</h4><ul class="plan-checklist" id="plan-checklist"></ul></section></div>`;
    $("plan-sheet").innerHTML = h;
    Object.keys(st.fields).forEach(k => setEl(k, st.fields[k].v, false));
    Object.keys(st.dirty).forEach(k => setEl(k, st.dirty[k], false));
    if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([$("plan-sheet")]).catch(() => {});
    refreshMeta();
  }

  function elOf(k) { return document.querySelector(`#plan-sheet [data-k="${k}"]`); }
  function setEl(k, v, flash) {
    const el = elOf(k);
    if (!el) return;
    if (el.type === "checkbox") { el.checked = v === "1"; }
    else if (el.value !== v) {
      if (document.activeElement === el && typeof el.selectionStart === "number") {
        const s0 = el.selectionStart, e0 = el.selectionEnd;
        el.value = v;
        try { el.setSelectionRange(Math.min(s0, v.length), Math.min(e0, v.length)); } catch (e) { /* select */ }
      } else el.value = v;
    }
    if (flash) { el.classList.remove("plan-remote"); void el.offsetWidth; el.classList.add("plan-remote"); }
  }
  function readEl(el) { return el.type === "checkbox" ? (el.checked ? "1" : "") : el.value; }

  function refreshMeta() {
    if (!st.open) return;
    // daftar periksa
    const merged = Object.assign({}, st.fields);
    Object.keys(st.dirty).forEach(k => { merged[k] = { v: st.dirty[k] }; });
    const cl = $("plan-checklist");
    if (cl) {
      cl.innerHTML = D.checks(merged).map(c => `<li class="${c.ok ? "ok" : ""}"><span class="plan-tick" aria-hidden="true"></span>${L(c.label)}</li>`).join("");
      if (window.MathJax && MathJax.typesetPromise) MathJax.typesetPromise([cl]).catch(() => {});
    }
    // siapa sedang mengisi kolom apa
    document.querySelectorAll("#plan-sheet [data-pres-for]").forEach(x => { x.textContent = ""; });
    st.presence.forEach(p => {
      if (!p.field) return;
      const x = document.querySelector(`#plan-sheet [data-pres-for="${p.field}"]`);
      if (x) x.textContent = (x.textContent ? x.textContent + ", " : "") + p.name + " " + L(TX.typing);
    });
    document.querySelectorAll("#plan-sheet [data-by-for]").forEach(x => {
      const f = st.fields[x.dataset.byFor];
      x.textContent = f && f.by && f.byId !== me() ? L(TX.lastBy) + ": " + f.by : "";
    });
    // anggota (titik hijau = sedang membuka lembar)
    const a = acct();
    const mem = $("plan-members");
    if (mem) {
      if (a && a.groupId && a.members && a.members.length) {
        const on = new Set(st.presence.map(p => p.id));
        mem.innerHTML = `<span class="muted small">${L(TX.members)}:</span> ` + a.members.map(m => `<span class="plan-member${m.studentId === a.studentId || on.has(m.studentId) ? " on" : ""}" title="${esc(m.name)}">${esc(m.name.split(" ")[0])}${m.studentId === a.studentId ? " (" + L(TX.you) + ")" : ""}</span>`).join("");
      } else mem.innerHTML = "";
    }
  }
  function setSaveState(txt) { const x = $("plan-save-state"); if (x) x.textContent = txt; }

  /* ---------- sinkron ---------- */
  function onInput(e) {
    const el = e.target.closest("[data-k]");
    if (!el) return;
    const k = el.dataset.k, v = readEl(el);
    st.dirty[k] = v;
    setSaveState(L(TX.unsaved));
    refreshMeta();
    scheduleSave(el.type === "checkbox" || el.tagName === "SELECT" ? 100 : SAVE_DEBOUNCE_MS);
  }
  function scheduleSave(ms) {
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(save, ms);
  }
  async function save() {
    if (st.guest || !st.topicId) { if (Object.keys(st.dirty).length) { Object.keys(st.dirty).forEach(k => { st.fields[k] = { v: st.dirty[k], ver: (st.fields[k] ? st.fields[k].ver : 0) + 1, byId: me(), by: "" }; }); st.dirty = {}; setSaveState(""); refreshMeta(); } return; }
    if (st.inflight) { scheduleSave(400); return; }
    const sent = Object.assign({}, st.dirty);
    const patches = Object.keys(sent).map(k => ({ k, v: sent[k], base: st.fields[k] ? st.fields[k].ver : 0 }));
    st.inflight = true;
    if (patches.length) setSaveState(L(TX.saving));
    let data;
    try {
      data = await apiCall("plan_save", { topicId: st.topicId, patches, editing: st.open ? st.focusK : null });
    } catch (e) { data = { error: String(e && e.message || e) }; }
    st.inflight = false;
    if (data.error) { st.lastErr = true; if (patches.length) setSaveState(L(TX.offline)); scheduleSave(4000); return; }
    st.lastErr = false;
    if (data.guest) { st.guest = true; }
    const res = data.results || {};
    Object.keys(sent).forEach(k => {
      const r = res[k];
      const stillSame = st.dirty[k] === sent[k];
      if (r && r.ok) {
        st.fields[k] = { v: sent[k], ver: r.ver, byId: me(), by: "", at: Date.now() };
        if (stillSame) delete st.dirty[k];
      } else if (r && !r.ok) {
        // Kolom yang sama baru diubah anggota lain. Bila kolom ini sedang kamu ketik, isianmu
        // dikirim ulang di atas versi terbaru; bila tidak, versi anggota lain yang dipakai.
        const srv = data.fields && data.fields[k];
        if (srv) st.fields[k] = srv;
        if (st.focusK === k) { if (stillSame) st.dirty[k] = sent[k]; }
        else if (stillSame) { delete st.dirty[k]; if (srv) setEl(k, srv.v, true); }
      }
    });
    applyRemote(data.fields || {});
    st.presence = data.presence || [];
    st.loaded = true;
    if (!Object.keys(st.dirty).length) {
      const cur = ($("plan-save-state") || {}).textContent || "";
      if (patches.length || cur === L(TX.saving) || cur === L(TX.offline)) setSaveState(L(TX.saved));
      else if (cur === L(TX.loading)) setSaveState("");
    }
    else scheduleSave(SAVE_DEBOUNCE_MS);
    refreshMeta();
  }
  function applyRemote(fields) {
    Object.keys(fields).forEach(k => {
      const srv = fields[k], loc = st.fields[k];
      if (loc && loc.ver >= srv.ver) return;
      st.fields[k] = srv;
      if (st.dirty[k] !== undefined) return;
      setEl(k, srv.v, srv.byId && srv.byId !== me());
    });
  }
  async function poll() {
    if (!st.open) return;
    await save(); // simpan perubahan (bila ada) sekaligus memperbarui kehadiran & isi terbaru
  }
  async function loadOnce() {
    if (!st.topicId) return false;
    try {
      const data = await apiCall("plan_get", { topicId: st.topicId });
      if (data.error) return false;
      st.guest = !!data.guest;
      applyRemote(data.fields || {});
      st.presence = data.presence || [];
      st.loaded = true;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- buka / tutup ---------- */
  function topicNow() { return (typeof currentTopic !== "undefined" && currentTopic) ? currentTopic.id : null; }
  function switchTopic(tid) {
    if (st.topicId === tid) return;
    st.topicId = tid; st.fields = {}; st.dirty = {}; st.presence = []; st.loaded = false; st.rendered = null;
  }
  async function open() {
    const tid = topicNow();
    if (!tid) return;
    switchTopic(tid);
    st.guest = (typeof getUserRole === "function" && getUserRole() === "guest");
    st.open = true;
    $("plan-overlay").hidden = false;
    document.body.classList.add("plan-open");
    renderSheet();
    setSaveState(st.loaded ? "" : L(TX.loading));
    if (!st.guest) await save();
    else { st.loaded = true; setSaveState(L(TX.guest)); }
    refreshMeta();
    clearInterval(st.pollTimer);
    st.pollTimer = setInterval(poll, POLL_MS);
    setTimeout(() => { const f = $("plan-close-btn"); if (f) f.focus(); }, 50);
  }
  async function close() {
    if (!st.open) return;
    st.open = false;
    clearInterval(st.pollTimer);
    $("plan-overlay").hidden = true;
    document.body.classList.remove("plan-open");
    st.focusK = null;
    clearTimeout(st.saveTimer);
    if (!st.guest) save();
  }

  async function fillGenerator() {
    const status = $("pf-build-status");
    const tid = topicNow();
    if (!tid) return;
    switchTopic(tid);
    st.guest = (typeof getUserRole === "function" && getUserRole() === "guest");
    if (!st.loaded && !st.guest && !(await loadOnce())) { if (status) status.textContent = L(TX.fillFail); return; }
    const v = k => (st.dirty[k] !== undefined ? st.dirty[k] : D.val(st.fields, k)).trim();
    const setV = (id, val) => { const el = $(id); if (el && val) { el.value = val; el.dispatchEvent(new Event("input", { bubbles: true })); } };
    const any = ["p_vars", "p_goal", "p_extra", "full_prompt", "p_concept"].some(k => v(k));
    if (!any) { if (status) status.textContent = L(TX.fillEmpty); return; }
    setV("pf-variables", v("p_vars"));
    setV("pf-goal", v("p_goal"));
    setV("pf-extra", [v("p_concept") && (L(B("Konsep: ", "Concept: ")) + v("p_concept")), v("p_extra"), v("unique")].filter(Boolean).join("\n"));
    const vis = v("p_visual").toLowerCase(), sel = $("pf-vistype");
    if (sel && vis) {
      const pick = /grafik|graph/.test(vis) ? 1 : /alat|apparatus|peraga/.test(vis) ? 2 : /vektor|vector/.test(vis) ? 3 : /animasi|animation/.test(vis) ? 0 : -1;
      if (pick >= 0 && sel.options[pick]) { sel.selectedIndex = pick; sel.dispatchEvent(new Event("change", { bubbles: true })); }
    }
    if (v("full_prompt")) setV("final-prompt", v("full_prompt"));
    if (status) status.textContent = L(TX.fillDone);
  }

  /* ---------- tampil hanya setelah tab Eksperimen tercapai ---------- */
  function shouldShow() {
    try {
      const shell = $("site-shell");
      if (!shell || shell.hidden) return false;
      if (typeof currentTopic === "undefined" || !currentTopic || currentTopic.status !== "ready") return false;
      const tv = $("topic-view"); if (!tv || tv.hidden) return false;
      const role = typeof getUserRole === "function" ? getUserRole() : "student";
      if (role !== "student" && role !== "guest") return false;
      if (typeof isUnlockAll === "function" && isUnlockAll()) return true;
      return typeof getUnlockedTabIndex === "function" && getUnlockedTabIndex(currentTopic.id) >= 1;
    } catch (e) { return false; }
  }
  // Tombol mengambang ditumpuk dari bawah sesuai yang sedang tampil, supaya tidak saling menutupi.
  function layoutFabs() {
    const ids = ["chatbot-toggle-btn", "quiz-toggle-btn", "ts-toggle-btn", "plan-toggle-btn"];
    const phone = window.matchMedia && window.matchMedia("(max-width: 520px)").matches;
    const base = phone ? 16 : 22, step = phone ? 64 : 62;
    let n = 0;
    ids.forEach(id => {
      const el = $(id);
      if (!el) return;
      const vis = !el.hidden && getComputedStyle(el).display !== "none";
      if (!vis) return;
      el.style.bottom = (base + n * step) + "px";
      n++;
    });
  }
  function tick() {
    const btn = $("plan-toggle-btn");
    if (!btn) return;
    const show = shouldShow();
    if (btn.hidden === show) btn.hidden = !show;
    if (st.open) {
      const tid = topicNow();
      if (!show || tid !== st.topicId) close();
    }
    labels();
    if (st.open) renderSheet();
    layoutFabs();
  }
  function init() {
    build();
    labels();
    tick();
    setInterval(tick, 1000);
    window.addEventListener("resize", layoutFabs);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.ProjectPlan = { open, close, fillGenerator, _state: () => st };
})();
