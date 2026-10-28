/* ============================================================
   slides.js - penampil slide materi (tab Materi)
   ------------------------------------------------------------
   Menampilkan deck format slide (kanvas 1920x1080, style inline)
   langsung di halaman:
   - kanvas diskalakan mengikuti lebar kontainer (tajam, bukan gambar),
   - <x-embed> (animasi canvas) dijalankan sebagai iframe sandbox,
   - data-build-in="fade order N" muncul bertahap setiap klik Next,
   - catatan slide (<aside>) bisa dibuka di bawah kanvas,
   - progres slide yang sudah dilihat disimpan & dilaporkan ke Panel Guru.
   Navigasi: tombol, klik sisi kiri/kanan kanvas, panah keyboard, PageUp/
   PageDown, spasi, F (layar penuh).
   ============================================================ */
window.SlideViewer = (function () {
  const W = 1920, H = 1080;
  const STORE = "physicsSandbox.slides.";
  let active = null; // instance yang sedang terpasang

  function T(key, fallback) { return (typeof t === "function" && t(key) !== key) ? t(key) : fallback; }
  function L(obj) { return typeof trContent === "function" ? trContent(obj) : (obj.id || obj.en || ""); }

  function loadState(topicId) {
    try { return JSON.parse(localStorage.getItem(STORE + topicId) || "null") || { index: 0, seen: [], allBuilds: false, notes: false }; }
    catch (e) { return { index: 0, seen: [], allBuilds: false, notes: false }; }
  }
  function saveState(topicId, s) {
    try { localStorage.setItem(STORE + topicId, JSON.stringify(s)); } catch (e) { /* abaikan */ }
  }

  // Ubah HTML satu slide menjadi elemen .deck-slide. withEmbeds=false untuk
  // thumbnail (iframe diganti kotak statis supaya 31 animasi tidak berjalan).
  function buildSlideEl(slide, withEmbeds) {
    const tpl = document.createElement("template");
    tpl.innerHTML = slide.html;
    const section = tpl.content.querySelector("section");
    const el = document.createElement("div");
    el.className = "deck-slide";
    el.setAttribute("style", section.getAttribute("style") || "");
    el.dataset.slideId = slide.id;
    while (section.firstChild) el.appendChild(section.firstChild);
    el.querySelectorAll("x-embed").forEach(emb => {
      if (withEmbeds) {
        const frame = document.createElement("iframe");
        frame.className = "deck-embed";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.setAttribute("title", T("materi.embed.title", "Animasi konsep"));
        frame.setAttribute("style", (emb.getAttribute("style") || "") + ";border:0");
        frame.setAttribute("loading", "lazy");
        frame.srcdoc = "<!DOCTYPE html><html><head><meta charset='utf-8'></head><body>" + emb.innerHTML + "</body></html>";
        if (emb.hasAttribute("data-build-in")) frame.setAttribute("data-build-in", emb.getAttribute("data-build-in"));
        emb.replaceWith(frame);
      } else {
        const box = document.createElement("div");
        box.setAttribute("style", (emb.getAttribute("style") || "") + ";background:#ECEDFF;border:2px dashed #C9CDEB");
        emb.replaceWith(box);
      }
    });
    el.querySelectorAll("a[href]").forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    return el;
  }

  function buildOrder(el) {
    return Array.from(el.querySelectorAll("[data-build-in]")).map((node, i) => {
      const m = /order\s+(\d+)/.exec(node.getAttribute("data-build-in") || "");
      if (/\brise\b/.test(node.getAttribute("data-build-in") || "")) node.classList.add("build-rise");
      return { node, order: m ? parseInt(m[1], 10) : 0, i };
    }).sort((a, b) => a.order - b.order || a.i - b.i);
  }

  function mount(container, deck, opts) {
    if (active) active.destroy();
    const topicId = opts.topicId;
    const state = loadState(topicId);
    if (state.index >= deck.slides.length) state.index = 0;
    const n = deck.slides.length;

    container.innerHTML = `
      <div class="deck-viewer" tabindex="0" aria-roledescription="${T("materi.deck.role", "penampil slide")}">
        <div class="deck-toolbar">
          <div class="deck-sections">${deck.sections.map(s => `<button type="button" class="deck-sec-btn" data-start="${s.start}" title="${escapeAttrSafe(s.description)}">${L(s.label)}</button>`).join("")}</div>
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost btn-small" data-act="builds" title="${T("materi.deck.builds.title", "Tampilkan semua langkah sekaligus")}"></button>
          <button type="button" class="btn btn-ghost btn-small" data-act="notes"></button>
          <button type="button" class="btn btn-ghost btn-small" data-act="grid">${T("materi.deck.grid", "Semua slide")}</button>
          <button type="button" class="btn btn-ghost btn-small" data-act="full" title="F">${T("materi.deck.full", "Layar penuh")}</button>
          <span class="deck-counter" aria-live="polite"></span>
          <button type="button" class="btn btn-secondary btn-small" data-act="prev" aria-label="${T("materi.deck.prev", "Sebelumnya")}">&larr;</button>
          <button type="button" class="btn btn-primary btn-small" data-act="next">${T("materi.deck.next", "Berikutnya")} &rarr;</button>
        </div>
        <div class="deck-stage-wrap">
          <div class="deck-stage"></div>
          <button type="button" class="deck-click-zone prev" aria-label="${T("materi.deck.prev", "Sebelumnya")}"></button>
          <button type="button" class="deck-click-zone next" aria-label="${T("materi.deck.next", "Berikutnya")}"></button>
        </div>
        <div class="deck-progressbar"><span></span></div>
        <div class="deck-notes" hidden><p class="eyebrow">${T("materi.deck.notes.label", "Catatan slide")}</p><p class="deck-notes-text"></p></div>
        <div class="deck-thumbs" hidden></div>
      </div>
      <p class="materi-help"><span>${T("materi.deck.help.keys", "Navigasi: <kbd>&larr;</kbd> <kbd>&rarr;</kbd> atau klik sisi kanvas")}</span><span>${T("materi.deck.help.builds", "Isi slide muncul bertahap seperti di kelas")}</span></p>`;

    const viewer = container.querySelector(".deck-viewer");
    const wrap = container.querySelector(".deck-stage-wrap");
    const stage = container.querySelector(".deck-stage");
    const counter = container.querySelector(".deck-counter");
    const bar = container.querySelector(".deck-progressbar span");
    const notesBox = container.querySelector(".deck-notes");
    const notesText = container.querySelector(".deck-notes-text");
    const thumbs = container.querySelector(".deck-thumbs");
    const btnBuilds = container.querySelector('[data-act="builds"]');
    const btnNotes = container.querySelector('[data-act="notes"]');
    let builds = [], revealed = 0, current = null, reportTimer = null;

    function scale() {
      const s = wrap.clientWidth / W;
      stage.style.transform = `scale(${s})`;
      thumbs.querySelectorAll(".thumb-box").forEach(box => {
        const sl = box.firstElementChild;
        if (sl) sl.style.transform = `scale(${box.clientWidth / W})`;
      });
    }
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(scale) : null;
    if (ro) ro.observe(wrap); else window.addEventListener("resize", scale);

    function applyBuilds() {
      builds.forEach((b, i) => b.node.classList.toggle("build-hidden", !state.allBuilds && i >= revealed));
    }
    function markSeen(i) {
      if (!state.seen.includes(i)) {
        state.seen.push(i);
        clearTimeout(reportTimer);
        reportTimer = setTimeout(() => opts.onProgress && opts.onProgress({ seen: state.seen.length, total: n, last: i + 1 }), 2500);
      }
    }
    function render(i, revealAll) {
      state.index = Math.max(0, Math.min(n - 1, i));
      const slide = deck.slides[state.index];
      if (current) current.remove();
      current = buildSlideEl(slide, true);
      stage.appendChild(current);
      builds = buildOrder(current);
      revealed = revealAll ? builds.length : 0;
      applyBuilds();
      counter.textContent = String(state.index + 1).padStart(2, "0") + " / " + n;
      bar.style.width = ((state.index + 1) / n * 100).toFixed(1) + "%";
      notesText.textContent = slide.notes || T("materi.deck.notes.none", "Tidak ada catatan untuk slide ini.");
      let secKey = null;
      deck.sections.forEach(s => { if (deck.slides.findIndex(x => x.id === s.start) <= state.index) secKey = s.start; });
      container.querySelectorAll(".deck-sec-btn").forEach(b => b.classList.toggle("active", b.dataset.start === secKey));
      thumbs.querySelectorAll(".deck-thumb").forEach((tEl, k) => { tEl.classList.toggle("active", k === state.index); tEl.classList.toggle("seen", state.seen.includes(k)); });
      markSeen(state.index);
      saveState(topicId, state);
      scale();
    }
    function next() {
      if (!state.allBuilds && revealed < builds.length) { revealed++; applyBuilds(); return; }
      if (state.index < n - 1) render(state.index + 1, false);
      else if (opts.onEnd) opts.onEnd();
    }
    function prev() {
      if (state.index > 0) render(state.index - 1, true);
    }
    function refreshToggles() {
      btnBuilds.textContent = state.allBuilds ? T("materi.deck.builds.on", "Bertahap: mati") : T("materi.deck.builds.off", "Bertahap: aktif");
      btnNotes.textContent = state.notes ? T("materi.deck.notes.hide", "Tutup catatan") : T("materi.deck.notes.show", "Catatan");
      notesBox.hidden = !state.notes;
    }
    function buildThumbs() {
      if (thumbs.childElementCount) return;
      deck.slides.forEach((slide, k) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "deck-thumb";
        b.innerHTML = `<div class="thumb-box"></div><div class="thumb-label"><b>${String(k + 1).padStart(2, "0")}</b><span></span></div>`;
        b.querySelector(".thumb-label span").textContent = slide.title;
        const el = buildSlideEl(slide, false);
        b.querySelector(".thumb-box").appendChild(el);
        b.addEventListener("click", () => { render(k, true); thumbs.hidden = true; viewer.focus(); });
        thumbs.appendChild(b);
      });
    }

    container.querySelector('[data-act="next"]').addEventListener("click", next);
    container.querySelector('[data-act="prev"]').addEventListener("click", prev);
    container.querySelector(".deck-click-zone.next").addEventListener("click", next);
    container.querySelector(".deck-click-zone.prev").addEventListener("click", prev);
    btnBuilds.addEventListener("click", () => { state.allBuilds = !state.allBuilds; applyBuilds(); refreshToggles(); saveState(topicId, state); });
    btnNotes.addEventListener("click", () => { state.notes = !state.notes; refreshToggles(); saveState(topicId, state); });
    container.querySelector('[data-act="grid"]').addEventListener("click", () => {
      buildThumbs();
      thumbs.hidden = !thumbs.hidden;
      render(state.index, true);
      setTimeout(scale, 0);
    });
    container.querySelector('[data-act="full"]').addEventListener("click", toggleFull);
    container.querySelectorAll(".deck-sec-btn").forEach(b => b.addEventListener("click", () => {
      render(deck.slides.findIndex(s => s.id === b.dataset.start), false);
    }));
    function toggleFull() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (viewer.requestFullscreen) viewer.requestFullscreen().then(() => setTimeout(scale, 60)).catch(() => {});
    }
    document.addEventListener("fullscreenchange", scale);

    function onKey(e) {
      if (!document.body.contains(viewer)) return;
      const panel = viewer.closest(".tab-panel");
      if (panel && !panel.classList.contains("active")) return;
      const tag = (document.activeElement && document.activeElement.tagName) || "";
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
      if (document.querySelector(".modal:not([hidden])")) return;
      if (e.key === "ArrowRight" || e.key === "PageDown" || (e.key === " " && document.activeElement === viewer)) { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
      else if ((e.key === "f" || e.key === "F") && document.activeElement === viewer) { toggleFull(); }
    }
    document.addEventListener("keydown", onKey);

    refreshToggles();
    render(state.index, state.seen.includes(state.index));

    active = {
      destroy() {
        document.removeEventListener("keydown", onKey);
        document.removeEventListener("fullscreenchange", scale);
        if (ro) ro.disconnect();
        clearTimeout(reportTimer);
        active = null;
      },
      go: (i) => render(i, true),
      next, prev,
      progress: () => ({ seen: state.seen.length, total: n, index: state.index })
    };
    return active;
  }

  function escapeAttrSafe(s) { return String(s || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

  return { mount, current: () => active };
})();
