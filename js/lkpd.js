/* ============================================================
   lkpd.js - Lembar Kerja Peserta Didik interaktif (tab Eksperimen)
   ------------------------------------------------------------
   Satu LKPD per varian eksperimen (Virtual / Sederhana / Laboratorium),
   isi di js/lkpd-content.js. Fitur:
   - identitas (nama, kelas, kelompok, tanggal), kemajuan & skor,
   - ceklis alat/langkah, ukuran alat, tabel data, alat virtual,
   - grafik F-I + garis terbaik, soal pilihan ganda/hitungan dengan
     umpan balik yang TIDAK membocorkan nilai jawaban,
   - isian uraian dengan contoh jawaban yang baru bisa dibuka setelah
     siswa menulis jawabannya sendiri,
   - simpan otomatis ke perangkat + server (Panel Guru melihat semua isi),
   - tombol Kumpulkan dan Cetak / Simpan PDF.
   Bergantung pada fungsi global dari app.js: apiCall, getStudentId,
   getStudentName, getStudentClass, showToast, setEksperimenDataSavedFlag,
   getEksperimenDataSavedFlag, renderVlabApparatusSVG, animateBalanceReading.
   ============================================================ */
window.LKPD = (function () {
  const STORE = "physicsSandbox.lkpd9";
  const TRUEB_KEY = "physicsSandbox.virtualLabTrueB";
  let ctx = null; // { topic, mode, def, lk, st, root }
  let saveTimer = null;
  // Mode baca-saja: anggota kelompok melihat LKPD yang dikerjakan ketua.
  let readOnly = false;

  /* ---------- util ---------- */
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const num = s => { const n = parseFloat(String(s == null ? "" : s).replace(",", ".")); return isNaN(n) ? null : n; };
  function fmt(x, d) {
    if (x == null || !isFinite(x)) return "-";
    let s = Number(x.toPrecision(d || 3)).toString();
    if (/e/.test(s)) s = Number(x).toExponential((d || 3) - 1);
    return getLang() === "id" ? s.replace(".", ",") : s;
  }
  // Seperti fmt, tetapi mempertahankan nol di belakang (0,0100 bukan 0,01) agar angka penting tetap terlihat.
  function fmtSig(x, d) {
    if (x == null || !isFinite(x)) return "-";
    const p = d || 3;
    if (x === 0) return "0";
    const e = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(p)))));
    const s = (e < -4 || e >= 6) ? x.toExponential(p - 1) : x.toFixed(Math.max(0, p - 1 - e));
    return getLang() === "id" ? s.replace(".", ",") : s;
  }
  const stripNum = s => String(s || "").replace(/^\s*\d+\.\s*/, "");
  const typeset = el => { if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([el]).catch(() => {}); };
  const isExt = sec => !!sec.onlyFor;
  const checkable = sec => sec.type === "choice" || sec.type === "calc";

  /* ---------- penyimpanan lokal ---------- */
  function loadAll() { try { return JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { return {}; } }
  function keyOf(topicId, mode) { return getStudentId() + "|" + topicId + "|" + mode; }
  function emptyState() { return { v: 1, group: "", tick: {}, vars: {}, a: {}, ck: {}, first: {}, tries: {}, open: {}, revealed: {}, table: null, asm: 0, updatedAt: 0, tableSavedAt: 0 }; }
  function loadState(topicId, mode) {
    const s = loadAll()[keyOf(topicId, mode)];
    return Object.assign(emptyState(), s || {});
  }
  function persistLocal() {
    if (!ctx) return;
    try {
      const all = loadAll();
      all[keyOf(ctx.topic.id, ctx.mode)] = ctx.st;
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch (e) { /* penyimpanan penuh: tetap jalan */ }
  }
  function touch() {
    if (readOnly) return;
    ctx.st.updatedAt = Date.now();
    persistLocal();
    setSaveState("dirty");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => pushServer(false), 2500);
  }
  function payload(submit) {
    const s = stats();
    return {
      studentId: getStudentId(), topicId: ctx.topic.id, lkpdMode: ctx.mode,
      data: ctx.st, progress: s.pct, score: s.checkTotal ? Math.round(s.okCount / s.checkTotal * 1000) / 10 : null, submit: !!submit
    };
  }
  // Kirim cepat saat tab ditutup/disembunyikan (navigator.sendBeacon tetap
  // terkirim walau halaman sudah ditutup).
  function flushBeacon() {
    if (!ctx || !saveTimer || readOnly || getUserRole() !== "student") return;
    clearTimeout(saveTimer); saveTimer = null;
    try {
      const body = JSON.stringify(Object.assign({ mode: "lkpd_save", lang: getLang() }, authFields(), payload(false)));
      if (navigator.sendBeacon) navigator.sendBeacon(apiUrl("/api/backend"), new Blob([body], { type: "text/plain;charset=utf-8" }));
    } catch (e) { /* abaikan */ }
  }
  async function pushServer(submit) {
    if (!ctx) return null;
    saveTimer = null;
    if (readOnly) return { ok: true };
    if (getUserRole() !== "student") { setSaveState("local"); return { ok: true }; }
    const c = ctx;
    const s = stats();
    try {
      const data = await apiCall("lkpd_save", {
        studentId: getStudentId(), topicId: c.topic.id, lkpdMode: c.mode,
        data: c.st, progress: s.pct, score: s.checkTotal ? Math.round(s.okCount / s.checkTotal * 1000) / 10 : null, submit: !!submit
      });
      if (c === ctx) setSaveState(data.error ? "error" : "saved");
      return data;
    } catch (e) {
      if (c === ctx) setSaveState("error");
      return { error: e.message };
    }
  }
  function setSaveState(kind) {
    const el = ctx && ctx.root.querySelector(".lkpd-save-state");
    if (!el) return;
    el.classList.toggle("dirty", kind === "dirty" || kind === "error");
    el.textContent = kind === "local" ? t("lkpd.save.local") : kind === "dirty" ? t("lkpd.save.dirty") : kind === "error" ? t("lkpd.save.error") : t("lkpd.save.saved", { time: new Date().toLocaleTimeString(getLang() === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" }) });
  }

  /* ---------- data tabel & analisis ---------- */
  function tableRows() {
    const dt = ctx.def.dataTable;
    const rows = (ctx.st.table && Array.isArray(ctx.st.table.rows)) ? ctx.st.table.rows : null;
    if (dt.independentValues) {
      return dt.independentValues.map((I, i) => ({ I, values: (rows && rows[i] && rows[i].values) || Array(dt.replicateCount).fill("") }));
    }
    const n = dt.rowCount || 5;
    return Array.from({ length: n }, (_, i) => ({ I: rows && rows[i] ? rows[i].I : "", values: (rows && rows[i] && rows[i].values) || Array(dt.replicateCount).fill("") }));
  }
  function points() {
    const f = typeof ctx.def.dataTable.derivedFactor === "number" ? ctx.def.dataTable.derivedFactor : 9.81 / 1000;
    return tableRows().map(r => {
      const I = num(r.I);
      const vals = r.values.map(num).filter(v => v !== null);
      if (I === null || !vals.length) return null;
      return { x: I, y: vals.reduce((a, b) => a + b, 0) / vals.length * f };
    }).filter(Boolean);
  }
  function fit(pts) {
    const n = pts.length;
    if (n < 2) return null;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    pts.forEach(p => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
    const den = n * sxx - sx * sx;
    if (Math.abs(den) < 1e-12) return null;
    const m = (n * sxy - sx * sy) / den, c = (sy - m * sx) / n, yb = sy / n;
    let tot = 0, res = 0;
    pts.forEach(p => { tot += (p.y - yb) ** 2; res += (p.y - (m * p.x + c)) ** 2; });
    return { m, c, r2: tot > 0 ? 1 - res / tot : 1, n };
  }
  function varSI(key) {
    const sec = ctx.def.sections.find(s => s.type === "vars");
    const f = sec && sec.fields.find(x => x.key === key);
    if (!f) return null;
    const raw = f.fixed !== undefined ? f.fixed : num(ctx.st.vars[key]);
    return raw === null || raw <= 0 ? null : raw * (f.toSI || 1);
  }
  function analysis() {
    const pts = points(), ft = fit(pts);
    const L = varSI("L"), N = varSI("N") || 1;
    const B = ft && ft.m > 0 && L ? ft.m / (N * L) : null;
    return { pts, fit: ft, L, N, B };
  }

  /* ---------- kemajuan ---------- */
  function stats() {
    const st = ctx.st;
    let done = 0, total = 0, okCount = 0, checkTotal = 0;
    ctx.def.sections.forEach((sec, idx) => {
      if (isExt(sec)) return;
      if (sec.type === "materials" || sec.type === "steps") sec.items.forEach((_, i) => { total++; if (st.tick[idx + "-" + i]) done++; });
      else if (sec.type === "vars") sec.fields.filter(f => f.fixed === undefined).forEach(f => { total++; if (num(st.vars[f.key]) !== null) done++; });
      else if (sec.type === "table") { total++; if (points().length >= 3) done++; }
      else if (sec.type === "vlab") { total++; if (asmDone()) done++; }
      else if (checkable(sec)) { total++; checkTotal++; if (st.ck[sec.id]) done++; if (st.ck[sec.id] === 1) okCount++; }
      else if (sec.type === "open") { total++; if ((st.open[sec.id] || "").trim().length >= 15) done++; }
    });
    return { pct: total ? Math.round(done / total * 100) : 0, okCount, checkTotal, done, total };
  }
  function refreshProgress() {
    const s = stats();
    const r = ctx.root;
    r.querySelector(".lkpd-progress span").style.width = s.pct + "%";
    r.querySelector(".lkpd-score-big").innerHTML = `${s.okCount}<small>/${s.checkTotal}</small>`;
    r.querySelector(".lkpd-pct").textContent = t("lkpd.progress.pct", { pct: s.pct });
  }

  /* ---------- render ---------- */
  const KIND = { info: "lkpd.kind.info", materials: "lkpd.kind.materials", steps: "lkpd.kind.steps", safety: "lkpd.kind.safety", vars: "lkpd.kind.vars", table: "lkpd.kind.table", graph: "lkpd.kind.graph", choice: "lkpd.kind.choice", calc: "lkpd.kind.calc", open: "lkpd.kind.open", vlab: "lkpd.kind.vlab" };

  function hintHTML(sec) {
    return sec.hint ? `<details class="lkpd-hint"><summary>${t("lkpd.hint")}</summary><div>${trContent(sec.hint)}</div></details>` : "";
  }
  function tableHTML() {
    const dt = ctx.def.dataTable;
    const editI = !dt.independentValues;
    const ro = dt.readonly ? " readonly" : "";
    const head = `<tr><th>${esc(dt.independentLabel)}</th>${Array.from({ length: dt.replicateCount }, (_, i) => `<th>${esc(dt.replicateLabel)}<sub>${i + 1}</sub></th>`).join("")}<th>${esc(dt.replicateLabel)} ${t("eksdata.mean")}</th><th>${esc(dt.derivedLabel)}</th></tr>`;
    const body = tableRows().map((r, ri) => `<tr data-row="${ri}">` +
      (editI ? `<td><input type="text" inputmode="decimal" data-ti="${ri}" value="${esc(r.I)}" aria-label="I #${ri + 1}"></td>` : `<td class="eks-dt-i">${fmt(r.I, 3)}</td>`) +
      r.values.map((v, ci) => `<td><input type="text" inputmode="decimal" data-tv="${ri}-${ci}" value="${esc(v)}"${ro} aria-label="${esc(dt.replicateLabel)} ${ri + 1}.${ci + 1}"></td>`).join("") +
      `<td class="eks-dt-avg" data-avg="${ri}">-</td><td class="eks-dt-f" data-f="${ri}">-</td></tr>`).join("");
    return `<div class="eks-datatable-section"><div style="overflow-x:auto"><table class="eks-datatable"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <div class="lkpd-answer-row"><button type="button" class="btn btn-primary btn-small" data-act="save-table">${t("eksdata.savebtn")}</button>
      ${dt.readonly ? `<button type="button" class="btn btn-ghost btn-small" data-act="clear-table">${t("lkpd.table.clear")}</button>` : ""}
      <span class="eks-dt-status" data-table-status></span></div></div>`;
  }
  /* ---------- Merakit alat virtual (sebelum mengukur) ----------
     Siswa memasang alat satu per satu dengan urutan seperti di lab:
     neraca -> magnet -> tare -> kawat uji + klem -> amperemeter ->
     catu daya -> kabel penghubung. Bagian bisa diketuk atau diseret ke
     meja kerja. Urutan salah memberi petunjuk, bukan nilai. */
  const ASM_STEPS = ["balance", "magnets", "tare", "wire", "ammeter", "supply", "leads"];
  const ASM_TRAY = ["ammeter", "magnets", "leads", "balance", "supply", "wire"]; // sengaja diacak tetap
  const ASM_ICON = {
    balance: '<rect x="3" y="13" width="26" height="12" rx="3"/><ellipse cx="16" cy="12" rx="12" ry="2.5"/><rect x="11" y="17" width="10" height="5" rx="1" fill="#0d1f16"/>',
    magnets: '<rect x="5" y="6" width="8" height="15" rx="1.5" fill="#b23b3b" stroke="none"/><rect x="19" y="6" width="8" height="15" rx="1.5" fill="#3b6bb2" stroke="none"/><rect x="3" y="21" width="26" height="4" />',
    wire: '<line x1="3" y1="14" x2="29" y2="14" stroke="#cc3333" stroke-width="3"/><line x1="6" y1="14" x2="6" y2="27"/><line x1="26" y1="14" x2="26" y2="27"/>',
    ammeter: '<circle cx="16" cy="16" r="11"/><line x1="16" y1="16" x2="22" y2="9" stroke-width="2"/><text x="16" y="25" font-size="7" text-anchor="middle" stroke="none" fill="currentColor">A</text>',
    supply: '<rect x="3" y="8" width="26" height="17" rx="3"/><circle cx="9" cy="8" r="2"/><circle cx="23" cy="8" r="2"/><line x1="8" y1="21" x2="22" y2="13" stroke-width="1.6"/>',
    leads: '<path d="M4,24 C10,4 22,28 28,8" fill="none" stroke-width="2.2"/><circle cx="4" cy="24" r="2.2"/><circle cx="28" cy="8" r="2.2"/>'
  };
  let asmWin = null;
  const MAGNET_GRAMS = 41.37; // massa magnet + yoke yang terbaca sebelum tare
  function asmDone() { return (ctx.st.asm || 0) >= ASM_STEPS.length; }
  function asmHTML() {
    const n = Math.min(ctx.st.asm || 0, ASM_STEPS.length);
    return `<div class="vlab-asm" data-asm>
      <div class="vlab-asm-head"><strong>${t("vlab.asm.title")}</strong><span class="small muted" data-asm-count>${t("vlab.asm.count", { n, total: ASM_STEPS.length })}</span></div>
      <p class="small muted" style="margin:4px 0 10px">${t("vlab.asm.desc")}</p>
      <ol class="vlab-asm-steps">${ASM_STEPS.map((id, i) => `<li data-asm-step="${id}" class="${i < n ? "done" : i === n ? "current" : ""}">${t("vlab.asm.step." + id)}</li>`).join("")}</ol>
      <div class="vlab-asm-tray" role="list">${ASM_TRAY.map(id => `<button type="button" class="vlab-asm-item" role="listitem" data-asm-part="${id}"${ASM_STEPS.indexOf(id) < n ? " hidden" : ""}><svg viewBox="0 0 32 32" aria-hidden="true" fill="var(--panel-light, #f2f3fb)" stroke="currentColor" stroke-width="1.4">${ASM_ICON[id]}</svg><span>${t("vlab.asm.part." + id)}</span></button>`).join("")}
        <button type="button" class="btn btn-secondary btn-small vlab-asm-tare" data-asm-part="tare"${n === 2 ? "" : " hidden"}>${t("vlab.asm.tarebtn")}</button></div>
      <p class="vlab-asm-msg small" data-asm-msg aria-live="polite"></p>
    </div>`;
  }
  function vlabHTML() {
    const dt = ctx.def.dataTable, ap = ctx.def.apparatus;
    return `<div class="lkpd-vlab-wrap${asmDone() ? "" : " vlab-unassembled"}">${asmHTML()}<div class="vlab-apparatus" id="vlab-apparatus-box">
      <div class="vlab-diagram-wrap" data-asm-drop>${typeof renderVlabApparatusSVG === "function" ? renderVlabApparatusSVG() : ""}<span class="vlab-asm-dropnote">${t("vlab.asm.drophere")}</span></div>
      <div class="lkpd-answer-row vlab-controls" style="margin-top:0">
        <span class="mono small">L = ${fmt(ap.lengthM * 100, 2)} cm</span>
        <label style="margin:0;display:flex;align-items:center;gap:6px">${t("vlab.current.label")}<select data-vlab-i>${dt.independentValues.map(v => `<option value="${v}">${fmt(v, 3)} A</option>`).join("")}</select></label>
        <button type="button" class="btn btn-accent btn-small" data-act="vlab-read">${t("vlab.readbtn")}</button>
        <span class="small muted" data-vlab-status></span>
      </div></div></div>`;
  }
  // Tabel Alat & Bahan: No (dengan centang siap) | Nama alat | Jumlah | Gambar
  function photoCell(key) {
    if (key === "svg:vlab") return `<div class="lkpd-mat-svg">${typeof renderVlabApparatusSVG === "function" ? renderVlabApparatusSVG().replace(/ id="[^"]*"/g, "") : ""}</div>`;
    const ph = (typeof LKPD_PHOTOS !== "undefined" && LKPD_PHOTOS[key]) || null;
    if (!ph) return `<span class="muted small">-</span>`;
    const url = ph.url || (LKPD_PHOTO_BASE + ph.src);
    const page = "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(ph.file);
    return `<a href="${esc(page)}" target="_blank" rel="noopener noreferrer" class="lkpd-mat-photo"><img src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></a>`;
  }
  function materialsTableHTML(sec, idx) {
    const st = ctx.st;
    const rows = sec.items.map((it, i) => {
      const k = idx + "-" + i, on = !!st.tick[k];
      return `<tr class="${on ? "checked" : ""}">
        <td class="lkpd-mat-no"><label><input type="checkbox" data-tick="${k}"${on ? " checked" : ""} aria-label="${esc(t("lkpd.mat.ready"))} ${i + 1}"><span>${i + 1}</span></label></td>
        <td class="lkpd-mat-name">${trContent(it.n)}${it.note ? `<span class="note">${trContent(it.note)}</span>` : ""}</td>
        <td class="lkpd-mat-qty">${it.qty ? trContent(it.qty) : "-"}</td>
        <td class="lkpd-mat-img">${photoCell(it.photo)}</td></tr>`;
    }).join("");
    const used = [...new Set(sec.items.map(it => it.photo).filter(p => p && p !== "svg:vlab" && typeof LKPD_PHOTOS !== "undefined" && LKPD_PHOTOS[p]))];
    const credits = used.length ? `<p class="lkpd-mat-credit">${t("lkpd.mat.credit")} ${used.map(k => { const ph = LKPD_PHOTOS[k]; return `<a href="https://commons.wikimedia.org/wiki/File:${esc(encodeURIComponent(ph.file))}" target="_blank" rel="noopener noreferrer">${esc(ph.by)}</a> (${esc(ph.lic)})`; }).join(", ")}.</p>` : "";
    return `<p class="lkpd-desc small">${t("lkpd.mat.hint")}</p>
      <div class="lkpd-mat-wrap"><table class="lkpd-mat-table"><thead><tr><th>${t("lkpd.mat.no")}</th><th>${t("lkpd.mat.name")}</th><th>${t("lkpd.mat.qty")}</th><th>${t("lkpd.mat.img")}</th></tr></thead><tbody>${rows}</tbody></table></div>${credits}` +
      (sec.kits && sec.kits.length ? `<p class="eyebrow dim" style="margin-top:16px">${t("lkpd.kits.title")}</p><div class="lkpd-kits">${sec.kits.map(k => `<div class="lkpd-kit"><span class="code">${esc(k.code)}</span><strong>${trContent(k.name)}</strong><span>${trContent(k.note)}</span>${k.url ? `<br><a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${trContent(k.urlLabel || k.url)}</a>` : ""}</div>`).join("")}</div>` : "") +
      (sec.footnote ? `<p class="muted small" style="margin-top:12px">${trContent(sec.footnote)}</p>` : "");
  }
  function sectionHTML(sec, idx, no) {
    const st = ctx.st;
    const title = sec.title ? `<h4>${trContent(stripNum(trContent(sec.title)))}</h4>` : "";
    const ext = isExt(sec) ? `<span class="lkpd-badge-ext">${t("lkpd.enrich")}</span>` : "";
    let inner = "";
    switch (sec.type) {
      case "info": inner = title + `<div class="lkpd-desc">${trContent(sec.html)}</div>`; break;
      case "materials":
        if (sec.items.some(it => it.photo || it.qty)) { inner = title + materialsTableHTML(sec, idx); break; }
      // falls through
      case "steps":
        inner = title + `<ul class="lkpd-check-list">${sec.items.map((it, i) => {
          const k = idx + "-" + i, on = !!st.tick[k];
          return `<li class="${on ? "checked" : ""}"><label><input type="checkbox" data-tick="${k}"${on ? " checked" : ""}><span class="step-no">${String(i + 1).padStart(2, "0")}</span><span>${trContent(it.n || it.h)}${it.note ? `<span class="note">${trContent(it.note)}</span>` : ""}</span></label></li>`;
        }).join("")}</ul>` +
          (sec.kits && sec.kits.length ? `<p class="eyebrow dim" style="margin-top:16px">${t("lkpd.kits.title")}</p><div class="lkpd-kits">${sec.kits.map(k => `<div class="lkpd-kit"><span class="code">${esc(k.code)}</span><strong>${trContent(k.name)}</strong><span>${trContent(k.note)}</span>${k.url ? `<br><a href="${esc(k.url)}" target="_blank" rel="noopener noreferrer">${trContent(k.urlLabel || k.url)}</a>` : ""}</div>`).join("")}</div>` : "") +
          (sec.footnote ? `<p class="muted small" style="margin-top:12px">${trContent(sec.footnote)}</p>` : "");
        break;
      case "safety": inner = `<div class="lkpd-safety">${title}<ul>${sec.items.map(it => `<li>${trContent(it.h)}</li>`).join("")}</ul></div>`; break;
      case "vars":
        inner = title + `<p class="lkpd-desc">${trContent(sec.desc)}</p><div class="lkpd-vars">${sec.fields.map(f => `<label>${trContent(f.label)}<span class="lkpd-unit-input"><input type="text" inputmode="decimal" data-var="${f.key}" value="${esc(f.fixed !== undefined ? fmt(f.fixed, 3) : (st.vars[f.key] || ""))}"${f.fixed !== undefined ? " readonly" : ""} placeholder="${esc(trContent(f.hint))}"><span class="unit">${esc(trContent(f.unit))}</span></span></label>`).join("")}</div>`;
        break;
      case "table": inner = title + `<p class="lkpd-desc">${trContent(sec.desc)}</p>` + tableHTML(); break;
      case "vlab": inner = title + vlabHTML(); break;
      case "graph": inner = title + `<p class="lkpd-desc">${trContent(sec.desc)}</p><div class="lkpd-graph-box"><div data-graph></div><div class="lkpd-fit" data-fit></div></div>`; break;
      case "choice":
        inner = `<div class="lkpd-q">${ext}${trContent(sec.q)}</div><div class="lkpd-choice">${sec.options.map((o, oi) => `<label data-o="${oi}"><input type="radio" name="lk-${esc(sec.id)}" value="${oi}"${st.a[sec.id] === oi ? " checked" : ""}><span class="letter">${String.fromCharCode(65 + oi)}</span><span>${trContent(o)}</span></label>`).join("")}</div>` +
          hintHTML(sec) + `<div class="lkpd-answer-row"><button type="button" class="btn btn-secondary btn-small" data-check="${esc(sec.id)}">${t("lkpd.check")}</button></div><div class="lkpd-feedback" data-fb="${esc(sec.id)}" hidden></div>`;
        break;
      case "calc":
        inner = `<div class="lkpd-q">${ext}${trContent(sec.q)}</div><div class="lkpd-answer-row"><span class="lkpd-unit-input" style="max-width:260px"><input type="text" inputmode="decimal" data-calc="${esc(sec.id)}" value="${esc(st.a[sec.id] || "")}" placeholder="${esc(t("lkpd.calc.placeholder"))}"><span class="unit">${esc(sec.unit)}</span></span><button type="button" class="btn btn-secondary btn-small" data-check="${esc(sec.id)}">${t("lkpd.check")}</button></div>` +
          hintHTML(sec) + `<div class="lkpd-feedback" data-fb="${esc(sec.id)}" hidden></div>`;
        break;
      case "open":
        inner = `<div class="lkpd-q">${ext}${trContent(sec.q)}</div><div class="lkpd-open"><textarea rows="4" data-open="${esc(sec.id)}" placeholder="${esc(t("lkpd.open.placeholder"))}">${esc(st.open[sec.id] || "")}</textarea></div>` +
          hintHTML(sec) + `<div class="lkpd-answer-row"><button type="button" class="btn btn-ghost btn-small" data-reveal="${esc(sec.id)}">${t("lkpd.model.show")}</button></div><div class="lkpd-feedback info" data-model="${esc(sec.id)}" hidden><strong>${t("lkpd.model.title")}</strong> ${trContent(sec.model)}</div>`;
        break;
      default: return "";
    }
    return `<section class="lkpd-sec" data-sec="${idx}" data-type="${sec.type}"><div class="lkpd-sec-num">${String(no).padStart(2, "0")}<span class="sec-kind">${t(KIND[sec.type] || "lkpd.kind.info")}</span></div><div class="lkpd-sec-body">${inner}</div></section>`;
  }

  function render(container, topic, mode) {
    const lk = topic.eksperimen.lkpd;
    const def = lk.modes[mode];
    const st = loadState(topic.id, mode);
    ctx = { topic, mode, def, lk, st, root: null };
    const today = new Date().toLocaleDateString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "long", year: "numeric" });
    let no = 0;
    const body = def.sections.map((sec, idx) => sectionHTML(sec, idx, ++no)).join("");
    container.innerHTML = `
      <article class="lkpd" data-mode="${mode}">
        <header class="lkpd-head">
          <div class="lkpd-head-main">
            <p class="eyebrow">${esc(lk.code || "LKPD")} · ${esc(trContent(def.name))}</p>
            <h3>${trContent(lk.title)}</h3>
            <p>${trContent(def.tagline)}</p>
          </div>
          <div class="lkpd-head-side">
            <span class="mono">${t("lkpd.score.label")}</span>
            <span class="lkpd-score-big">0<small>/0</small></span>
            <span class="mono lkpd-pct"></span>
          </div>
        </header>
        <div class="lkpd-identity">
          <div><span class="k">${t("field.fullname")}</span><span class="v">${esc(getStudentName() || "-")}</span></div>
          <div><span class="k">${t("field.class")}</span><span class="v">${esc(getStudentClass() || "-")}</span></div>
          ${(() => { const acc = typeof getAccount === "function" ? getAccount() : null;
            return acc && acc.groupName
              ? `<div><span class="k">${t("lkpd.group")}</span><span class="v">${esc(acc.groupName)}${acc.leaderName ? ` · ${esc(t("group.leader.short"))} ${esc(acc.leaderName)}` : ""}</span></div>`
              : `<div><span class="k">${t("lkpd.group")}</span><input type="text" data-group value="${esc(st.group || "")}" placeholder="${esc(t("lkpd.group.placeholder"))}"></div>`; })()}
          <div><span class="k">${t("lkpd.date")}</span><span class="v">${esc(today)}</span></div>
        </div>
        <div class="lkpd-progress"><span style="width:0"></span></div>
        <div class="lkpd-body">${body}</div>
        <footer class="lkpd-foot">
          <span class="lkpd-save-state">${t("lkpd.save.local")}</span>
          <span class="lkpd-submitted" data-submitted hidden></span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary btn-small" data-act="print">${t("lkpd.print")}</button>
          <button type="button" class="btn btn-primary" data-act="submit">${t("lkpd.submit")}</button>
        </footer>
      </article>`;
    ctx.root = container.querySelector(".lkpd");
    // foto alat gagal dimuat (offline / diblokir) -> tampilkan keterangan, tanpa handler inline
    ctx.root.addEventListener("error", e => { const a = e.target.closest && e.target.closest(".lkpd-mat-photo"); if (a) a.classList.add("noimg"); }, true);
    wire();
    recalcTable();
    drawGraph();
    def.sections.forEach(sec => { if (checkable(sec) && st.ck[sec.id]) applyCheck(sec.id, false); });
    Object.keys(st.revealed || {}).forEach(id => { const m = ctx.root.querySelector(`[data-model="${CSS.escape(id)}"]`); if (m) m.hidden = false; });
    refreshProgress();
    markSubmitted(st.submittedAt);
    if (mode === "virtual") initVlab();
    if (readOnly) applyReadOnly();
    typeset(ctx.root);
    hydrateFromServer(topic.id, mode);
  }
  function applyReadOnly() {
    ctx.root.classList.add("lkpd-readonly");
    ctx.root.querySelectorAll("input, textarea, select, button").forEach(el => {
      if (el.dataset.act === "print") return;
      el.disabled = true;
    });
    const sub = ctx.root.querySelector('[data-act="submit"]');
    if (sub) sub.hidden = true;
    const ss = ctx.root.querySelector(".lkpd-save-state");
    if (ss) ss.textContent = t("group.readonly.lkpd");
  }

  async function hydrateFromServer(topicId, mode) {
    try {
      const data = await apiCall("lkpd_get", { studentId: getStudentId(), topicId });
      if (!ctx || ctx.topic.id !== topicId || ctx.mode !== mode) return;
      const srv = data && data.modes && data.modes[mode];
      if (srv && srv.submittedAt) { ctx.st.submittedAt = srv.submittedAt; markSubmitted(srv.submittedAt); }
      if (srv && srv.data && (srv.data.updatedAt || 0) > (ctx.st.updatedAt || 0) + (readOnly ? 0 : 1000)) {
        const container = ctx.root.parentElement;
        const all = loadAll();
        all[keyOf(topicId, mode)] = Object.assign(emptyState(), srv.data, { submittedAt: srv.submittedAt || srv.data.submittedAt });
        try { localStorage.setItem(STORE, JSON.stringify(all)); } catch (e) { /* abaikan */ }
        render(container, ctx.topic, mode);
        if (!readOnly) showToast(t("lkpd.restored"));
      }
    } catch (e) { /* offline: pakai salinan lokal */ }
  }

  function markSubmitted(ts) {
    const el = ctx.root.querySelector("[data-submitted]");
    if (!ts) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = t("lkpd.submitted.at", { time: new Date(ts).toLocaleString(getLang() === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) });
    ctx.root.querySelector('[data-act="submit"]').textContent = t("lkpd.resubmit");
  }

  /* ---------- tabel ---------- */
  function readTableFromDom() {
    const rows = [];
    ctx.root.querySelectorAll(".eks-datatable tbody tr").forEach((tr, ri) => {
      const iInput = tr.querySelector("[data-ti]");
      const I = iInput ? iInput.value.trim() : ctx.def.dataTable.independentValues[ri];
      rows.push({ I, values: Array.from(tr.querySelectorAll("[data-tv]")).map(i => i.value.trim()) });
    });
    return rows;
  }
  function recalcTable() {
    const f = typeof ctx.def.dataTable.derivedFactor === "number" ? ctx.def.dataTable.derivedFactor : 9.81 / 1000;
    ctx.root.querySelectorAll(".eks-datatable tbody tr").forEach(tr => {
      const vals = Array.from(tr.querySelectorAll("[data-tv]")).map(i => num(i.value)).filter(v => v !== null);
      const avg = tr.querySelector("[data-avg]"), F = tr.querySelector("[data-f]");
      if (vals.length) {
        const m = vals.reduce((a, b) => a + b, 0) / vals.length;
        avg.textContent = fmt(m, 3); F.textContent = fmtSig(m * f, 3);
      } else { avg.textContent = "-"; F.textContent = "-"; }
    });
  }
  async function saveTable() {
    const statusEl = ctx.root.querySelector("[data-table-status]");
    const btn = ctx.root.querySelector('[data-act="save-table"]');
    const rows = readTableFromDom();
    if (!rows.some(r => r.values.some(v => v !== ""))) { statusEl.className = "eks-dt-status eks-dt-status-warn"; statusEl.textContent = t("eksdata.empty"); return; }
    const an = analysis();
    btn.disabled = true;
    statusEl.className = "eks-dt-status"; statusEl.textContent = t("eksdata.saving");
    const dt = ctx.def.dataTable;
    const c = ctx;
    try {
      const data = await apiCall("eksperimen_data_save", {
        topicId: c.topic.id, studentId: getStudentId(), variant: c.mode, context: dt.context, lang: getLang(),
        rows: rows.map(r => ({ I: num(r.I), values: r.values.map(v => num(v)) })),
        meta: { independentLabel: dt.independentLabel, replicateLabel: dt.replicateLabel, derivedLabel: dt.derivedLabel, replicateCount: dt.replicateCount, derivedFactor: dt.derivedFactor },
        analysis: {
          gradient: an.fit ? an.fit.m : null, intercept: an.fit ? an.fit.c : null, r2: an.fit ? an.fit.r2 : null,
          L: an.L, N: an.N, B_fromFit: an.B,
          hypothesis: c.st.a.predict, B_student: c.st.a.calcB || null,
          conclusion: c.st.open.conclusion || ""
        }
      });
      if (c !== ctx) return;
      if (data.error) { statusEl.className = "eks-dt-status eks-dt-status-warn"; statusEl.textContent = data.error; }
      else {
        setEksperimenDataSavedFlag(c.topic.id, true);
        c.st.tableSavedAt = Date.now(); touch();
        statusEl.className = "eks-dt-status " + (data.flagged ? "eks-dt-status-warn" : "eks-dt-status-ok");
        statusEl.textContent = t("eksdata.saved") + " " + (data.feedback || "");
      }
    } catch (e) {
      statusEl.className = "eks-dt-status eks-dt-status-warn"; statusEl.textContent = t("eksdata.networkerror");
    }
    btn.disabled = false;
  }

  /* ---------- grafik ---------- */
  function niceStep(range, ticks) {
    const raw = range / ticks, mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }
  function drawGraph() {
    const box = ctx.root.querySelector("[data-graph]"), fitBox = ctx.root.querySelector("[data-fit]");
    if (!box) return;
    const an = analysis(), pts = an.pts, ft = an.fit;
    const W = 560, H = 340, ml = 70, mr = 18, mt = 16, mb = 48;
    const xmax = (Math.max(0, ...pts.map(p => p.x)) || 2.5) * 1.1;
    let ymax = Math.max(0, ...pts.map(p => p.y)); if (ft) ymax = Math.max(ymax, ft.m * xmax + ft.c); ymax = (ymax || 0.03) * 1.12;
    let ymin = Math.min(0, ...pts.map(p => p.y), ft ? ft.c : 0); if (ymin < 0) ymin *= 1.2;
    const X = v => ml + v / xmax * (W - ml - mr), Y = v => H - mb - (v - ymin) / (ymax - ymin) * (H - mt - mb);
    const sx = niceStep(xmax, 6), sy = niceStep(ymax - ymin, 5);
    let g = "";
    for (let v = 0; v <= xmax + 1e-12; v += sx) g += `<line x1="${X(v)}" y1="${mt}" x2="${X(v)}" y2="${H - mb}" stroke="#E3E5F1" stroke-width="1"/><text x="${X(v)}" y="${H - mb + 18}" font-size="12" font-family="IBM Plex Mono, monospace" fill="#6B7080" text-anchor="middle">${fmt(v, 2)}</text>`;
    for (let v = Math.ceil(ymin / sy) * sy; v <= ymax + 1e-12; v += sy) g += `<line x1="${ml}" y1="${Y(v)}" x2="${W - mr}" y2="${Y(v)}" stroke="#E3E5F1" stroke-width="1"/><text x="${ml - 8}" y="${Y(v) + 4}" font-size="12" font-family="IBM Plex Mono, monospace" fill="#6B7080" text-anchor="end">${fmt(v, 2)}</text>`;
    const line = ft ? `<line x1="${X(0)}" y1="${Y(ft.c)}" x2="${X(xmax)}" y2="${Y(ft.m * xmax + ft.c)}" stroke="#525FE1" stroke-width="2" stroke-dasharray="7 4"/>` : "";
    const dots = pts.map(p => `<g><line x1="${X(p.x) - 6}" y1="${Y(p.y) - 6}" x2="${X(p.x) + 6}" y2="${Y(p.y) + 6}" stroke="#F26B65" stroke-width="2"/><line x1="${X(p.x) - 6}" y1="${Y(p.y) + 6}" x2="${X(p.x) + 6}" y2="${Y(p.y) - 6}" stroke="#F26B65" stroke-width="2"/></g>`).join("");
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t("lkpd.graph.aria"))}">${g}
      <line x1="${ml}" y1="${mt}" x2="${ml}" y2="${H - mb}" stroke="#0B104A" stroke-width="1.5"/><line x1="${ml}" y1="${Y(0)}" x2="${W - mr}" y2="${Y(0)}" stroke="#0B104A" stroke-width="1.5"/>
      ${line}${dots}
      <text x="${(ml + W - mr) / 2}" y="${H - 8}" font-size="13" font-family="Public Sans, Arial" fill="#0B104A" text-anchor="middle">I / A</text>
      <text transform="translate(18 ${(mt + H - mb) / 2}) rotate(-90)" font-size="13" font-family="Public Sans, Arial" fill="#0B104A" text-anchor="middle">F / N</text></svg>`;
    if (!ft || pts.length < 2) {
      fitBox.innerHTML = `<p class="muted small" style="margin:0">${t("lkpd.graph.empty")}</p>`;
      return;
    }
    const lk = ctx.lk;
    fitBox.innerHTML = `<p class="eyebrow teal" style="margin-bottom:6px">${t("lkpd.fit.title")}</p>
      <div class="row"><span>${t("lkpd.fit.gradient")}</span><b>${fmtSig(ft.m, 3)} N A⁻¹</b></div>
      <div class="row"><span>${t("lkpd.fit.intercept")}</span><b>${fmt(ft.c, 2)} N</b></div>
      <div class="row"><span>R²</span><b>${fmtSig(ft.r2, 3)}</b></div>
      <div class="row"><span>${t("lkpd.fit.points")}</span><b>${ft.n}</b></div>
      ${an.B !== null && (an.B < lk.plausibleB[0] || an.B > lk.plausibleB[1]) ? `<p class="small warn" style="margin:8px 0 0">${t("lkpd.graph.implausible.nolimit")}</p>` : ""}
      ${ft.m <= 0 ? `<p class="small warn" style="margin:8px 0 0">${t("lkpd.graph.negslope")}</p>` : ""}`;
  }

  /* ---------- cek jawaban ---------- */
  function applyCheck(id, live) {
    const sec = ctx.def.sections.find(s => s.id === id);
    const fb = ctx.root.querySelector(`[data-fb="${CSS.escape(id)}"]`);
    if (!sec || !fb) return;
    const st = ctx.st;
    let ok = false, msg = "", answer = null;
    if (sec.type === "choice") {
      const picked = ctx.root.querySelector(`input[name="lk-${CSS.escape(id)}"]:checked`);
      if (!picked) { if (live) { fb.hidden = false; fb.className = "lkpd-feedback warn"; fb.textContent = t("lkpd.pick"); } return; }
      answer = parseInt(picked.value, 10);
      ok = answer === sec.correct;
      ctx.root.querySelectorAll(`[name="lk-${CSS.escape(id)}"]`).forEach(inp => {
        const lab = inp.closest("label");
        lab.classList.toggle("is-right", ok && parseInt(inp.value, 10) === sec.correct);
        lab.classList.toggle("is-wrong", !ok && parseInt(inp.value, 10) === answer);
      });
      msg = ok ? `<strong>${t("lkpd.correct")}</strong> ${trContent(sec.explain)}` : t("lkpd.wrong.tryagain");
      st.a[id] = answer;
    } else {
      const input = ctx.root.querySelector(`[data-calc="${CSS.escape(id)}"]`);
      const v = num(input.value);
      if (v === null) { if (live) { fb.hidden = false; fb.className = "lkpd-feedback warn"; fb.textContent = t("lkpd.calc.needvalue"); } return; }
      answer = input.value.trim();
      const an = analysis();
      const ref = sec.compute === "m" ? (an.fit ? an.fit.m : null) : an.B;
      if (ref === null || !(ref > 0)) { fb.hidden = false; fb.className = "lkpd-feedback warn"; fb.textContent = t("lkpd.needdata"); st.a[id] = answer; touch(); return; }
      const ratio = v / ref;
      ok = Math.abs(ratio - 1) * 100 <= (sec.tolPct || 15);
      if (ok) msg = `<strong>${t("lkpd.calc.right.noval")}</strong> ${trContent(sec.explain)}`;
      else {
        let hint = "";
        if (Math.abs(Math.log10(Math.abs(ratio)) - 2) < 0.3 || Math.abs(Math.log10(Math.abs(ratio)) + 2) < 0.3) hint = t("lkpd.calc.hint.units");
        else if (an.N > 1 && Math.abs(ratio / an.N - 1) < 0.2) hint = t("lkpd.calc.hint.turns");
        else if (Math.abs(ratio - 1000) / 1000 < 0.2 || Math.abs(ratio * 1000 - 1) < 0.2) hint = t("lkpd.calc.hint.grams");
        msg = t(ratio > 1 ? "lkpd.calc.toohigh" : "lkpd.calc.toolow") + (hint ? " " + hint : "");
      }
      st.a[id] = answer;
    }
    fb.hidden = false;
    fb.className = "lkpd-feedback " + (ok ? "ok" : "warn");
    fb.innerHTML = msg;
    if (live) {
      st.tries[id] = (st.tries[id] || 0) + 1;
      if (st.first[id] === undefined) st.first[id] = ok ? 1 : 0;
      st.ck[id] = ok ? 1 : 2;
      touch();
      refreshProgress();
      apiCall("record_event", { studentId: getStudentId(), topicId: ctx.topic.id, kind: "lkpd_check", item: ctx.mode + ":" + id, score: ok ? 100 : 0, payload: { answer, correct: ok, attempt: st.tries[id] } }).catch(() => {});
    }
    typeset(fb);
  }

  /* ---------- alat virtual ---------- */
  function trueB() {
    let map = {};
    try { map = JSON.parse(localStorage.getItem(TRUEB_KEY) || "{}"); } catch (e) { /* abaikan */ }
    if (typeof map[ctx.topic.id] === "number") return map[ctx.topic.id];
    const ap = ctx.def.apparatus;
    const b = ap.bTrueMin + Math.random() * (ap.bTrueMax - ap.bTrueMin);
    map[ctx.topic.id] = b;
    try { localStorage.setItem(TRUEB_KEY, JSON.stringify(map)); } catch (e) { /* abaikan */ }
    return b;
  }
  function needle(I) {
    const el = ctx.root.querySelector("#vlab-ammeter-needle");
    if (!el) return;
    const vals = ctx.def.dataTable.independentValues, lo = Math.min(...vals), hi = Math.max(...vals);
    el.style.transform = "rotate(" + (-60 + (hi > lo ? (I - lo) / (hi - lo) : .5) * 120).toFixed(1) + "deg)";
  }
  function asmApply(animatePart) {
    const r = ctx.root, n = Math.min(ctx.st.asm || 0, ASM_STEPS.length);
    const placed = new Set(ASM_STEPS.slice(0, n));
    r.querySelectorAll(".vlab-part").forEach(g => {
      const on = placed.has(g.dataset.part);
      g.classList.toggle("vlab-part-missing", !on);
      if (on && g.dataset.part === animatePart) { g.classList.remove("vlab-part-in"); void g.getBoundingClientRect(); g.classList.add("vlab-part-in"); }
    });
    r.querySelectorAll("[data-asm-step]").forEach((li, i) => { li.className = i < n ? "done" : i === n ? "current" : ""; });
    r.querySelectorAll(".vlab-asm-item").forEach(b => { b.hidden = placed.has(b.dataset.asmPart); });
    const tare = r.querySelector(".vlab-asm-tare"); if (tare) tare.hidden = n !== 2;
    const cnt = r.querySelector("[data-asm-count]"); if (cnt) cnt.textContent = t("vlab.asm.count", { n, total: ASM_STEPS.length });
    const disp = r.querySelector("#vlab-balance-display");
    if (disp && !asmDone()) disp.textContent = n === 2 ? fmtGrams(MAGNET_GRAMS) : fmtGrams(0);
    const wrap = r.querySelector(".lkpd-vlab-wrap");
    if (wrap) wrap.classList.toggle("vlab-unassembled", !asmDone());
    const box = r.querySelector("[data-asm]"); if (box) box.classList.toggle("complete", asmDone());
  }
  function fmtGrams(g) { const v = g.toFixed(2); return (getLang() === "id" ? v.replace(".", ",") : v) + " g"; }
  function asmTry(part) {
    if (readOnly || asmDone()) return;
    const n = ctx.st.asm || 0, expected = ASM_STEPS[n];
    const msg = ctx.root.querySelector("[data-asm-msg]");
    if (part === expected) {
      ctx.st.asm = n + 1;
      msg.className = "vlab-asm-msg small ok";
      msg.textContent = asmDone() ? t("vlab.asm.complete") : t("vlab.asm.ok." + part);
      asmApply(part);
      touch(); refreshProgress();
      if (asmDone()) { const sel = ctx.root.querySelector("[data-vlab-i]"); if (sel) needle(parseFloat(sel.value)); }
    } else {
      msg.className = "vlab-asm-msg small warn";
      msg.textContent = t("vlab.asm.wrong." + expected);
      const btn = ctx.root.querySelector(`[data-asm-part="${part}"]`);
      if (btn) { btn.classList.remove("shake"); void btn.offsetWidth; btn.classList.add("shake"); }
    }
  }
  // Seret (pointer) atau ketuk: keduanya didukung, termasuk di iPad.
  function wireAsm() {
    const r = ctx.root, tray = r.querySelector(".vlab-asm-tray"), drop = r.querySelector("[data-asm-drop]");
    if (!tray || !drop) return;
    let drag = null;
    if (asmWin) { window.removeEventListener("pointermove", asmWin.move); window.removeEventListener("pointerup", asmWin.end); window.removeEventListener("pointercancel", asmWin.end); }
    tray.addEventListener("pointerdown", e => {
      const b = e.target.closest(".vlab-asm-item");
      if (!b || readOnly || b.disabled) return;
      drag = { b, x: e.clientX, y: e.clientY, ghost: null, id: e.pointerId };
    });
    const move = e => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.ghost && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
        drag.ghost = drag.b.cloneNode(true);
        drag.ghost.classList.add("vlab-asm-ghost");
        document.body.appendChild(drag.ghost);
        drop.classList.add("vlab-drop-active");
      }
      if (drag.ghost) { drag.ghost.style.left = e.clientX + "px"; drag.ghost.style.top = e.clientY + "px"; e.preventDefault(); }
    };
    window.addEventListener("pointermove", move, { passive: false });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      drop.classList.remove("vlab-drop-active");
      if (!d.ghost) return; // ketukan biasa: ditangani oleh click
      d.ghost.remove();
      d.b.dataset.dragged = "1";
      const rc = drop.getBoundingClientRect();
      if (e.clientX >= rc.left && e.clientX <= rc.right && e.clientY >= rc.top && e.clientY <= rc.bottom) asmTry(d.b.dataset.asmPart);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    asmWin = { move, end };
  }
  function initVlab() {
    // Data lama (sebelum fitur rakit alat): sudah ada bacaan -> dianggap sudah terakit
    if (!asmDone() && points().length) ctx.st.asm = ASM_STEPS.length;
    asmApply(null);
    wireAsm();
    const sel = ctx.root.querySelector("[data-vlab-i]");
    if (!sel) return;
    needle(parseFloat(sel.value));
    sel.addEventListener("change", () => needle(parseFloat(sel.value)));
  }
  function vlabRead(btn) {
    const sel = ctx.root.querySelector("[data-vlab-i]");
    const statusEl = ctx.root.querySelector("[data-vlab-status]");
    const I = parseFloat(sel.value);
    const ri = ctx.def.dataTable.independentValues.findIndex(v => Math.abs(v - I) < 1e-9);
    const inputs = Array.from(ctx.root.querySelectorAll(`.eks-datatable tbody tr[data-row="${ri}"] [data-tv]`));
    const empty = inputs.find(i => i.value.trim() === "");
    if (!empty) { statusEl.textContent = t("vlab.rowfull"); return; }
    const ap = ctx.def.apparatus;
    const grams = (trueB() * I * ap.lengthM / 9.81) * 1000;
    const g = Math.max(0, grams * (1 + (Math.random() - .5) * 2 * ap.noiseFrac) + (Math.random() - .5) * 2 * ap.noiseAbsG);
    btn.disabled = true;
    const appBox = ctx.root.querySelector("#vlab-apparatus-box");
    appBox.classList.add("vlab-reading-active");
    const done = () => {
      empty.value = getLang() === "id" ? g.toFixed(2).replace(".", ",") : g.toFixed(2);
      statusEl.textContent = t("vlab.reading.result", { grams: fmt(Number(g.toFixed(2)), 3) });
      btn.disabled = false;
      appBox.classList.remove("vlab-reading-active");
      onTableInput();
    };
    if (typeof animateBalanceReading === "function") animateBalanceReading(g, done); else done();
  }

  function onTableInput() {
    ctx.st.table = { rows: readTableFromDom() };
    recalcTable();
    drawGraph();
    touch();
    refreshProgress();
  }

  /* ---------- interaksi ---------- */
  function wire() {
    const r = ctx.root;
    r.addEventListener("change", e => {
      const tk = e.target.closest("[data-tick]");
      if (tk) { ctx.st.tick[tk.dataset.tick] = tk.checked; tk.closest("li, tr").classList.toggle("checked", tk.checked); touch(); refreshProgress(); }
    });
    r.addEventListener("input", e => {
      const el = e.target;
      if (el.matches("[data-tv],[data-ti]")) return onTableInput();
      if (el.matches("[data-var]")) { ctx.st.vars[el.dataset.var] = el.value; drawGraph(); touch(); refreshProgress(); return; }
      if (el.matches("[data-open]")) { ctx.st.open[el.dataset.open] = el.value; touch(); refreshProgress(); return; }
      if (el.matches("[data-calc]")) { ctx.st.a[el.dataset.calc] = el.value; touch(); return; }
      if (el.matches("[data-group]")) { ctx.st.group = el.value.slice(0, 60); touch(); }
    });
    r.addEventListener("click", e => {
      const chk = e.target.closest("[data-check]");
      if (chk) return applyCheck(chk.dataset.check, true);
      const rev = e.target.closest("[data-reveal]");
      if (rev) {
        const id = rev.dataset.reveal;
        const box = r.querySelector(`[data-model="${CSS.escape(id)}"]`);
        if ((ctx.st.open[id] || "").trim().length < 15 && box.hidden) { showToast(t("lkpd.model.writefirst")); return; }
        box.hidden = !box.hidden;
        if (!box.hidden) { ctx.st.revealed[id] = Date.now(); touch(); typeset(box); }
        return;
      }
      const ap = e.target.closest("[data-asm-part]");
      if (ap) { if (ap.dataset.dragged) { delete ap.dataset.dragged; return; } asmTry(ap.dataset.asmPart); return; }
      const act = e.target.closest("[data-act]");
      if (!act) return;
      const a = act.dataset.act;
      if (a === "save-table") saveTable();
      else if (a === "clear-table") { if (confirm(t("lkpd.table.clear.confirm"))) { r.querySelectorAll("[data-tv]").forEach(i => { i.value = ""; }); onTableInput(); } }
      else if (a === "vlab-read") { if (asmDone()) vlabRead(act); }
      else if (a === "print") window.print();
      else if (a === "submit") submit(act);
    });
  }

  async function submit(btn) {
    const s = stats();
    if (!getEksperimenDataSavedFlag(ctx.topic.id) || !ctx.st.tableSavedAt) { showToast(t("lkpd.submit.needtable")); return; }
    if (s.pct < 60) { showToast(t("lkpd.submit.needmore", { pct: s.pct })); return; }
    btn.disabled = true;
    clearTimeout(saveTimer);
    ctx.st.submittedAt = Date.now();
    persistLocal();
    const data = await pushServer(true);
    btn.disabled = false;
    if (data && !data.error) { markSubmitted(ctx.st.submittedAt); showToast(t("lkpd.submit.ok")); }
    else showToast((data && data.error) || t("lkpd.save.error"));
  }

  function summaryText(topic) {
    if (!ctx || ctx.topic.id !== topic.id) return "";
    const s = stats();
    return t("lkpd.summary", { mode: trContent(ctx.def.name), ok: s.okCount, total: s.checkTotal, pct: s.pct });
  }

  return {
    has: topic => !!(topic && topic.eksperimen && topic.eksperimen.lkpd),
    render,
    summaryText,
    flush: () => { if (ctx && saveTimer) { clearTimeout(saveTimer); return pushServer(false); } },
    flushBeacon,
    setReadOnly: v => { readOnly = !!v; },
    isReadOnly: () => readOnly,
    refresh: () => { if (ctx) return hydrateFromServer(ctx.topic.id, ctx.mode); },
    _ctx: () => ctx
  };
})();
