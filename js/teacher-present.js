/* ============================================================
   js/teacher-present.js - 05 Presentation di Panel Guru
   ------------------------------------------------------------
   Guru mengajar langsung dari Panel Guru memakai slide Materi yang sama
   dengan siswa (js/materi-slides.js + js/slides.js), ditambah alat kelas:
   - catatan mengajar terbuka secara bawaan,
   - pena untuk mencoret slide (hilang saat pindah slide),
   - kode kelas besar di atas slide (dari sesi yang sedang aktif),
   - stopwatch pelajaran.
   Semua alat ada di dalam penampil, jadi tetap terlihat di layar penuh.
   ============================================================ */
window.TeacherPresent = (function () {
  "use strict";
  const $ = (s, r) => (r || document).querySelector(s);
  const en = () => (typeof getLang === "function" && getLang() === "en");
  const TX = {
    pen: ["Pena", "Pen"], penOn: ["Pena: aktif", "Pen: on"], clear: ["Hapus coretan", "Clear ink"],
    code: ["Kode kelas", "Class code"], noSession: ["Belum ada sesi kelas aktif. Mulai sesi di 01 Class Management.", "No active class session. Start one in 01 Class Management."],
    codeHint: ["Masukkan kode ini di Emergent: Saya siswa → Belajar di kelas", "Enter this code in Emergent: I am a student → Learn in class"],
    timerTitle: ["Stopwatch pelajaran (klik untuk mulai/jeda, klik dua kali untuk reset)", "Lesson stopwatch (click to start/pause, double-click to reset)"],
    noDeck: ["Topik ini belum punya slide.", "This topic has no slides yet."],
    colors: ["Warna pena", "Pen colour"]
  };
  const L = (k) => TX[k][en() ? 1 : 0];
  let mounted = null, topicId = null, timer = { t0: 0, acc: 0, run: false, iv: 0 };

  function decks() { return window.MATERI_DECKS || {}; }
  function topicOptions() {
    const sel = $("#present-topic-select");
    if (!sel || sel.options.length) return;
    const ids = Object.keys(decks());
    const list = (typeof readyTopics === "function" ? readyTopics() : []).filter(tp => ids.includes(tp.id));
    sel.innerHTML = (list.length ? list : ids.map(id => ({ id, title: { id: decks()[id].title, en: decks()[id].title } })))
      .map(tp => `<option value="${tp.id}">${typeof topicNo === "function" && topicNo(tp) ? topicNo(tp) + ". " : ""}${escapeHtmlP(typeof trContent === "function" ? trContent(tp.title) : tp.title.id)}</option>`).join("");
    sel.addEventListener("change", () => mount(sel.value));
  }
  function escapeHtmlP(s) { return String(s || "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function currentCode() {
    const has = $("#teacher-has-session");
    const code = ($("#teacher-code-display") || {}).textContent || "";
    return has && !has.hidden && /\w{4,}/.test(code) ? code.trim() : "";
  }

  function mount(id) {
    const box = $("#present-deck");
    const deck = decks()[id];
    if (!box) return;
    if (!deck || !window.SlideViewer) { box.innerHTML = `<p class="muted">${L("noDeck")}</p>`; return; }
    topicId = id;
    // catatan mengajar terbuka secara bawaan untuk guru (state terpisah dari siswa)
    const key = "physicsSandbox.slides.teacher-" + id;
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ index: 0, seen: [], allBuilds: false, notes: true })); } catch (e) { /* abaikan */ }
    mounted = SlideViewer.mount(box, deck, { topicId: "teacher-" + id });
    addTools(box);
  }

  function addTools(box) {
    const toolbar = $(".deck-toolbar", box), wrap = $(".deck-stage-wrap", box), counter = $(".deck-counter", box);
    if (!toolbar || !wrap) return;
    const tools = document.createElement("div");
    tools.className = "present-tools";
    tools.innerHTML =
      `<button type="button" class="btn btn-ghost btn-small" data-pr="pen" aria-pressed="false">${L("pen")}</button>` +
      `<span class="present-colors" hidden title="${L("colors")}">` +
      ["#F26B65", "#FFD23F", "#2FBF71", "#FFFFFF"].map((c, i) => `<button type="button" class="present-swatch${i ? "" : " on"}" data-color="${c}" style="background:${c}" aria-label="${c}"></button>`).join("") +
      `</span>` +
      `<button type="button" class="btn btn-ghost btn-small" data-pr="clear" hidden>${L("clear")}</button>` +
      `<button type="button" class="btn btn-ghost btn-small" data-pr="code">${L("code")}</button>` +
      `<button type="button" class="present-timer" data-pr="timer" title="${L("timerTitle")}">00:00</button>`;
    toolbar.insertBefore(tools, toolbar.querySelector(".spacer"));

    // pena
    const cv = document.createElement("canvas");
    cv.className = "present-ink";
    wrap.appendChild(cv);
    const ctx = cv.getContext("2d");
    let pen = false, drawing = false, color = "#F26B65", last = null;
    function size() {
      const r = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      const img = cv.width ? ctx.getImageData(0, 0, cv.width, cv.height) : null;
      cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
      cv.style.width = r.width + "px"; cv.style.height = r.height + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (img) { try { ctx.putImageData(img, 0, 0); } catch (e) { /* ukuran berubah */ } }
    }
    const clear = () => ctx.clearRect(0, 0, cv.width, cv.height);
    if (typeof ResizeObserver === "function") new ResizeObserver(() => { size(); clear(); }).observe(wrap);
    size();
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", e => { if (!pen) return; drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); e.preventDefault(); });
    cv.addEventListener("pointermove", e => {
      if (!drawing) return;
      const p = pos(e);
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, wrap.clientWidth / 320); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(ev => cv.addEventListener(ev, () => { drawing = false; }));
    const penBtn = $('[data-pr="pen"]', tools), clearBtn = $('[data-pr="clear"]', tools), colors = $(".present-colors", tools);
    function setPen(on) {
      pen = on;
      wrap.classList.toggle("pen-on", on);
      penBtn.textContent = on ? L("penOn") : L("pen");
      penBtn.setAttribute("aria-pressed", String(on));
      penBtn.classList.toggle("is-on", on);
      clearBtn.hidden = colors.hidden = !on;
    }
    penBtn.addEventListener("click", () => setPen(!pen));
    clearBtn.addEventListener("click", clear);
    colors.addEventListener("click", e => {
      const b = e.target.closest("[data-color]"); if (!b) return;
      color = b.dataset.color;
      colors.querySelectorAll(".present-swatch").forEach(x => x.classList.toggle("on", x === b));
    });
    // coretan dihapus setiap pindah slide
    if (counter) new MutationObserver(clear).observe(counter, { childList: true, characterData: true, subtree: true });

    // kode kelas besar di atas slide
    const ov = document.createElement("div");
    ov.className = "present-code"; ov.hidden = true;
    wrap.appendChild(ov);
    function showCode(on) {
      if (on) {
        const code = currentCode();
        ov.innerHTML = code
          ? `<div class="present-code-card"><span>${L("code")}</span><b>${escapeHtmlP(code)}</b><small>${L("codeHint")}</small></div>`
          : `<div class="present-code-card is-empty"><small>${L("noSession")}</small></div>`;
      }
      ov.hidden = !on;
      $('[data-pr="code"]', tools).classList.toggle("is-on", on);
    }
    $('[data-pr="code"]', tools).addEventListener("click", () => showCode(ov.hidden));
    ov.addEventListener("click", () => showCode(false));

    // stopwatch
    const tb = $('[data-pr="timer"]', tools);
    const fmt = (ms) => { const s = Math.floor(ms / 1000); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
    const paint = () => { tb.textContent = fmt(timer.acc + (timer.run ? Date.now() - timer.t0 : 0)); tb.classList.toggle("is-on", timer.run); };
    clearInterval(timer.iv);
    timer.iv = setInterval(paint, 500);
    paint();
    tb.addEventListener("click", () => {
      if (timer.run) { timer.acc += Date.now() - timer.t0; timer.run = false; } else { timer.t0 = Date.now(); timer.run = true; }
      paint();
    });
    tb.addEventListener("dblclick", () => { timer.run = false; timer.acc = 0; paint(); });

    // Esc menutup kode kelas / mematikan pena sebelum keluar layar penuh
    document.addEventListener("keydown", e => {
      if (!document.body.contains(wrap)) return;
      if (e.key === "Escape") { if (!ov.hidden) showCode(false); else if (pen) setPen(false); }
      if ((e.key === "p" || e.key === "P") && document.activeElement && document.activeElement.closest && document.activeElement.closest(".deck-viewer")) setPen(!pen);
    });
  }

  function onShow() {
    topicOptions();
    const sel = $("#present-topic-select");
    const id = (sel && sel.value) || Object.keys(decks())[0];
    if (!mounted || id !== topicId || !document.body.contains($(".deck-viewer", $("#present-deck")))) mount(id);
    else if (mounted && mounted.go) setTimeout(() => window.dispatchEvent(new Event("resize")), 30);
  }

  return { onShow, get viewer() { return mounted; } };
})();
