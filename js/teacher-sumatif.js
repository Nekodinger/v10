/* ============================================================
   teacher-sumatif.js - Tab "Quiz" mode Tes Sumatif (V10)
   ------------------------------------------------------------
   - Pratinjau lembar tes (default = dokumen Tes Sumatif Magnetic Fields).
   - Mode Edit: editor formulir (judul, durasi, petunjuk, bagian, soal PG,
     uraian bertingkat dengan tabel data, soal terbuka) lalu Simpan.
   - Publikasikan ke sesi kelas aktif / akhiri tes.
   - Daftar jawaban siswa + modal penilaian (PG otomatis, uraian manual).
   Memakai fungsi global dari teacher.js (callBackend, t, escapeHtml,
   topicTitle, fmtTime, typeset) dan js/sumatif-render.js.
   ============================================================ */
(function () {
  const $ = id => document.getElementById(id);
  const R = window.SumatifRender;
  let mode = "quiz";          // "quiz" | "test"
  let doc = null;             // tes tersimpan (atau default)
  let isDefault = true;
  let draft = null;           // salinan yang sedang diedit
  let editing = false;
  let showKeys = false;
  let loadedTopic = null;
  let lastActive = null;
  let grading = null;         // { quizId, studentId, test, answers, manual }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function topicId() { return $("quiz-topic-select").value; }
  function status(msg, bad) { const el = $("ts-status"); el.textContent = msg || ""; el.classList.toggle("unsaved", !!bad); }

  /* ---------- mode switch ---------- */
  function setMode(m) {
    mode = m === "test" ? "test" : "quiz";
    document.querySelectorAll(".qz-seg-btn").forEach(b => { const on = b.dataset.qmode === mode; b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false"); });
    $("qz-pane-quiz").hidden = mode !== "quiz";
    $("qz-pane-test").hidden = mode !== "test";
    if (mode === "test") { if (loadedTopic !== topicId()) loadTest(); loadResultsList(); }
  }
  document.querySelectorAll(".qz-seg-btn").forEach(b => b.addEventListener("click", () => setMode(b.dataset.qmode)));
  $("quiz-topic-select").addEventListener("change", () => { if (mode === "test") { if (editing && !confirm(t("ts.discard.confirm"))) return; editing = false; loadTest(); } else loadedTopic = null; });

  /* ---------- load & preview ---------- */
  async function loadTest() {
    const tid = topicId();
    loadedTopic = tid;
    $("ts-paper").innerHTML = `<p class="teacher-note">${escapeHtml(t("ts.loading"))}</p>`;
    const data = await callBackend("test_get", { topicId: tid });
    if (data.error) { $("ts-paper").innerHTML = `<p class="teacher-note">${escapeHtml(data.error)}</p>`; return; }
    doc = data.test; isDefault = !!data.isDefault;
    $("ts-duration").value = doc.durationMin || 60;
    editing = false;
    render();
  }
  function render() {
    $("ts-source-note").textContent = isDefault ? t("ts.source.default") : t("ts.source.custom");
    $("ts-edit-btn").hidden = editing;
    $("ts-save-btn").hidden = !editing;
    $("ts-cancel-btn").hidden = !editing;
    $("ts-reset-btn").hidden = editing || isDefault;
    $("ts-paper-heading").textContent = editing ? t("ts.editor.heading") : t("ts.preview");
    const box = $("ts-paper");
    if (editing) { box.innerHTML = editorHtml(); return; }
    const total = R.totalMarks(doc);
    box.innerHTML = `<div class="ts-preview-bar"><label class="acc-check small"><input type="checkbox" id="ts-showkeys" ${showKeys ? "checked" : ""}> <span>${escapeHtml(t("ts.showkeys"))}</span></label><span class="spacer"></span><span class="pill">${escapeHtml(t("ts.maxscore", { n: total }))}</span></div>` +
      R.paper(Object.assign({}, doc, { durationMin: parseInt($("ts-duration").value, 10) || doc.durationMin }), { mode: "preview", showKeys });
    typeset(box);
  }
  $("ts-paper").addEventListener("change", e => {
    if (e.target.id === "ts-showkeys") { showKeys = e.target.checked; render(); }
  });
  $("ts-duration").addEventListener("change", () => { if (!editing && doc) render(); });

  /* ---------- editor ---------- */
  function fld(label, path, value, opts) {
    const o = opts || {};
    const attrs = `data-ed="${escapeHtml(path)}"${o.num ? ` data-num="1"` : ""}`;
    const input = o.area
      ? `<textarea rows="${o.rows || 2}" ${attrs}>${escapeHtml(value)}</textarea>`
      : `<input type="${o.num ? "number" : "text"}" ${o.num ? `min="0" max="20" step="0.5"` : ""} value="${escapeHtml(value)}" ${attrs}>`;
    return `<label class="ts-ed-field ${o.cls || ""}"><span>${escapeHtml(label)}</span>${input}</label>`;
  }
  function itemTools(si, ii, n) {
    return `<span class="ts-ed-tools">
      <button type="button" class="icon-mini" data-act="item-up" data-s="${si}" data-i="${ii}" ${ii === 0 ? "disabled" : ""} title="${escapeHtml(t("qz.up"))}">▲</button>
      <button type="button" class="icon-mini" data-act="item-down" data-s="${si}" data-i="${ii}" ${ii === n - 1 ? "disabled" : ""} title="${escapeHtml(t("qz.down"))}">▼</button>
      <button type="button" class="icon-mini danger" data-act="item-del" data-s="${si}" data-i="${ii}" title="${escapeHtml(t("ts.ed.delitem"))}">✕</button></span>`;
  }
  function typeName(type) { return type === "mcq" ? t("ts.type.mcq") : type === "structured" ? t("ts.type.structured") : t("ts.type.open"); }
  function itemEditor(it, si, ii, n) {
    const p = `s.${si}.i.${ii}`;
    let html = `<div class="ts-ed-item"><div class="ts-ed-item-head"><strong>${escapeHtml(it.id)}</strong> <span class="pill">${escapeHtml(typeName(it.type))}</span> <span class="muted small">${escapeHtml(t("ts.ed.marks", { n: R.marksOf(it) }))}</span>${itemTools(si, ii, n)}</div>`;
    html += fld(t("ts.ed.stem"), p + ".stem", it.stem, { area: true, rows: 3 });
    if (it.type === "mcq") {
      html += `<div class="ts-ed-opts">` + it.options.map((op, oi) => `<div class="ts-ed-opt">
          <label class="ts-ed-correct" title="${escapeHtml(t("ts.ed.correct"))}"><input type="radio" name="ed-c-${si}-${ii}" data-ed="${p}.correct" value="${oi}" ${it.correct === oi ? "checked" : ""}> ${String.fromCharCode(65 + oi)}</label>
          <input type="text" value="${escapeHtml(op)}" data-ed="${p}.options.${oi}">
          <button type="button" class="icon-mini danger" data-act="opt-del" data-s="${si}" data-i="${ii}" data-o="${oi}" ${it.options.length <= 2 ? "disabled" : ""}>✕</button></div>`).join("") +
        `<button type="button" class="btn btn-ghost btn-small" data-act="opt-add" data-s="${si}" data-i="${ii}" ${it.options.length >= 6 ? "disabled" : ""}>${escapeHtml(t("ts.ed.addopt"))}</button></div>`;
      html += `<div class="ts-ed-row">${fld(t("ts.ed.marksfield"), p + ".marks", it.marks, { num: true, cls: "narrow" })}${fld(t("ts.ed.expl"), p + ".explanation", it.explanation, { area: true, cls: "grow" })}</div>`;
    } else if (it.type === "structured") {
      const tbl = (it.table || []).map(r => r.join(" | ")).join("\n");
      html += `<label class="ts-ed-field"><span>${escapeHtml(t("ts.ed.table"))}</span><textarea rows="3" data-ed="${p}.table" placeholder="${escapeHtml(t("ts.ed.table.ph"))}">${escapeHtml(tbl)}</textarea></label>`;
      html += it.parts.map((pt, pi) => `<div class="ts-ed-part"><div class="ts-ed-item-head"><strong>${escapeHtml(pt.id)}.</strong><span class="ts-ed-tools"><button type="button" class="icon-mini danger" data-act="part-del" data-s="${si}" data-i="${ii}" data-p="${pi}" ${it.parts.length <= 1 ? "disabled" : ""}>✕</button></span></div>
          ${fld(t("ts.ed.parttext"), `${p}.parts.${pi}.text`, pt.text, { area: true })}
          <div class="ts-ed-row">${fld(t("ts.ed.marksfield"), `${p}.parts.${pi}.marks`, pt.marks, { num: true, cls: "narrow" })}${fld(t("ts.ed.key"), `${p}.parts.${pi}.key`, pt.key, { area: true, cls: "grow" })}</div></div>`).join("");
      html += `<button type="button" class="btn btn-ghost btn-small" data-act="part-add" data-s="${si}" data-i="${ii}" ${it.parts.length >= 10 ? "disabled" : ""}>${escapeHtml(t("ts.ed.addpart"))}</button>`;
    } else {
      html += `<div class="ts-ed-row">${fld(t("ts.ed.marksfield"), p + ".marks", it.marks, { num: true, cls: "narrow" })}${fld(t("ts.ed.key"), p + ".key", it.key, { area: true, rows: 3, cls: "grow" })}</div>`;
    }
    return html + `</div>`;
  }
  function editorHtml() {
    const d = draft;
    let html = `<div class="ts-editor"><p class="muted small">${escapeHtml(t("ts.ed.tip"))}</p>`;
    html += fld(t("ts.ed.title"), "title", d.title);
    html += fld(t("ts.ed.instructions"), "instructions", d.instructions, { area: true, rows: 3 });
    d.sections.forEach((S, si) => {
      html += `<fieldset class="ts-ed-section"><legend>${escapeHtml(t("ts.ed.section", { id: S.id }))}
          <span class="ts-ed-tools"><button type="button" class="icon-mini danger" data-act="sec-del" data-s="${si}" title="${escapeHtml(t("ts.ed.delsec"))}" ${d.sections.length <= 1 ? "disabled" : ""}>✕</button></span></legend>
        <div class="ts-ed-row">${fld(t("ts.ed.sectitle"), `s.${si}.title`, S.title, { cls: "grow" })}</div>
        ${fld(t("ts.ed.secnote"), `s.${si}.note`, S.note, { area: true })}
        ${S.items.map((it, ii) => itemEditor(it, si, ii, S.items.length)).join("")}
        <div class="qz-add-row"><span class="muted small">${escapeHtml(t("ts.ed.additem"))}</span>
          <button type="button" class="btn btn-ghost btn-small" data-act="item-add" data-type="mcq" data-s="${si}">+ ${escapeHtml(t("ts.type.mcq"))}</button>
          <button type="button" class="btn btn-ghost btn-small" data-act="item-add" data-type="structured" data-s="${si}">+ ${escapeHtml(t("ts.type.structured"))}</button>
          <button type="button" class="btn btn-ghost btn-small" data-act="item-add" data-type="open" data-s="${si}">+ ${escapeHtml(t("ts.type.open"))}</button></div>
      </fieldset>`;
    });
    html += `<button type="button" class="btn btn-secondary btn-small" data-act="sec-add" ${d.sections.length >= 8 ? "disabled" : ""}>${escapeHtml(t("ts.ed.addsec"))}</button>`;
    html += `<p class="small ts-ed-total">${escapeHtml(t("ts.maxscore", { n: R.totalMarks(d) }))}</p></div>`;
    return html;
  }
  function targetOf(path) {
    // "title" | "s.0.title" | "s.0.i.2.options.1" | "s.0.i.2.parts.0.key"
    const seg = path.split(".");
    if (seg[0] !== "s") return { obj: draft, key: seg[0] };
    let obj = draft.sections[+seg[1]];
    if (seg.length === 3) return { obj, key: seg[2] };
    obj = obj.items[+seg[3]];
    if (seg.length === 5) return { obj, key: seg[4] };
    if (seg[4] === "options") return { obj: obj.options, key: +seg[5] };
    return { obj: obj.parts[+seg[5]], key: seg[6] };
  }
  function onEdit(e) {
    const el = e.target.closest("[data-ed]");
    if (!el || !editing) return;
    const { obj, key } = targetOf(el.dataset.ed);
    if (key === "table") {
      const rows = el.value.split("\n").map(l => l.trim()).filter(Boolean).map(l => l.split("|").map(c => c.trim()));
      obj.table = rows.length ? rows : undefined;
    } else if (key === "correct") obj.correct = parseInt(el.value, 10) || 0;
    else if (el.dataset.num) obj[key] = Math.max(0, Math.min(20, Number(el.value) || 0));
    else obj[key] = el.value;
    if (el.dataset.num) { const tot = document.querySelector(".ts-ed-total"); if (tot) tot.textContent = t("ts.maxscore", { n: R.totalMarks(draft) }); }
    status(t("ts.unsaved"), true);
  }
  $("ts-paper").addEventListener("input", onEdit);
  $("ts-paper").addEventListener("change", e => { if (e.target.type === "radio" || e.target.dataset.num) onEdit(e); });

  function renumber() {
    // ID soal mengikuti bagian: A1, A2, B1 ... (ID bagian A, B, C ...).
    draft.sections.forEach((S, si) => {
      S.id = String.fromCharCode(65 + si);
      S.items.forEach((it, ii) => {
        it.id = S.id + (ii + 1);
        if (it.parts) it.parts.forEach((p, pi) => { p.id = String.fromCharCode(97 + pi); });
      });
    });
  }
  function newItem(type) {
    if (type === "mcq") return { type, stem: "", options: ["", "", "", ""], correct: 0, marks: 1, explanation: "" };
    if (type === "structured") return { type, stem: "", parts: [{ text: "", marks: 2, key: "" }, { text: "", marks: 2, key: "" }] };
    return { type: "open", stem: "", marks: 4, key: "" };
  }
  $("ts-paper").addEventListener("click", e => {
    const b = e.target.closest("[data-act]");
    if (!b || !editing) return;
    const si = +b.dataset.s, ii = +b.dataset.i;
    const S = draft.sections[si], items = S ? S.items : null;
    switch (b.dataset.act) {
      case "item-add": items.push(newItem(b.dataset.type)); break;
      case "item-del": if (!confirm(t("ts.ed.delitem.confirm", { id: items[ii].id }))) return; items.splice(ii, 1); break;
      case "item-up": if (ii > 0) items.splice(ii - 1, 0, items.splice(ii, 1)[0]); break;
      case "item-down": if (ii < items.length - 1) items.splice(ii + 1, 0, items.splice(ii, 1)[0]); break;
      case "opt-add": { const it = items[ii]; if (it.options.length < 6) it.options.push(""); break; }
      case "opt-del": { const it = items[ii], oi = +b.dataset.o; it.options.splice(oi, 1); if (it.correct >= it.options.length) it.correct = 0; else if (it.correct > oi) it.correct -= 1; break; }
      case "part-add": items[ii].parts.push({ text: "", marks: 2, key: "" }); break;
      case "part-del": items[ii].parts.splice(+b.dataset.p, 1); break;
      case "sec-add": draft.sections.push({ title: t("ts.ed.newsec", { id: String.fromCharCode(65 + draft.sections.length) }), note: "", items: [] }); break;
      case "sec-del": if (!confirm(t("ts.ed.delsec.confirm", { id: S.id }))) return; draft.sections.splice(si, 1); break;
      default: return;
    }
    renumber();
    status(t("ts.unsaved"), true);
    const y = window.scrollY;
    $("ts-paper").innerHTML = editorHtml();
    window.scrollTo(0, y);
  });

  $("ts-edit-btn").addEventListener("click", () => {
    if (!doc) return;
    draft = clone(doc); editing = true; status(""); render();
  });
  $("ts-cancel-btn").addEventListener("click", () => {
    if (!confirm(t("ts.discard.confirm"))) return;
    editing = false; draft = null; status(""); render();
  });
  $("ts-save-btn").addEventListener("click", async () => {
    const empty = [];
    draft.sections.forEach(S => S.items.forEach(it => { if (!String(it.stem || "").trim() && !(it.parts || []).some(p => p.text.trim())) empty.push(it.id); }));
    if (empty.length) { status(t("ts.ed.emptystem", { ids: empty.join(", ") }), true); return; }
    draft.durationMin = parseInt($("ts-duration").value, 10) || draft.durationMin || 60;
    status(t("ts.saving"));
    const data = await callBackend("test_save", { topicId: topicId(), test: draft });
    if (data.error) { status(data.error, true); return; }
    doc = data.test; isDefault = !!data.isDefault; editing = false; draft = null;
    status(t("ts.saved")); render();
  });
  $("ts-reset-btn").addEventListener("click", async () => {
    if (!confirm(t("ts.reset.confirm"))) return;
    status(t("ts.saving"));
    const data = await callBackend("test_save", { topicId: topicId(), reset: true });
    if (data.error) { status(data.error, true); return; }
    doc = data.test; isDefault = !!data.isDefault; $("ts-duration").value = doc.durationMin || 60;
    status(t("ts.reset.done")); render();
  });

  /* ---------- publish / end ---------- */
  $("ts-publish-btn").addEventListener("click", async () => {
    if (editing) { status(t("ts.publish.saveFirst"), true); return; }
    if (lastActive && lastActive.active && !confirm(t("ts.publish.replace"))) return;
    status(t("ts.publishing"));
    const data = await callBackend("test_publish", { topicId: topicId(), durationMin: parseInt($("ts-duration").value, 10) || 60 });
    if (data.error) { status(data.error, true); return; }
    status(t("ts.published"));
    renderActive(data.test);
    loadResultsList(data.test.id);
  });
  $("ts-end-btn").addEventListener("click", async () => {
    if (!confirm(t("ts.end.confirm"))) return;
    const data = await callBackend("test_end");
    if (data.error) { status(data.error, true); return; }
    if (lastActive) { lastActive.active = false; renderActive(lastActive); }
    status(t("ts.ended"));
    loadResultsList();
  });
  function renderActive(ts) {
    lastActive = ts || null;
    const card = $("ts-active-card");
    if (!ts || !ts.id) { card.hidden = true; $("ts-end-btn").hidden = true; return; }
    card.hidden = false;
    card.classList.toggle("ended", !ts.active);
    card.textContent = ts.active
      ? t("ts.active.status", { title: ts.title || "", min: ts.durationMin || 60, time: fmtTime(ts.publishedAt, false) })
      : t("ts.ended.status", { title: ts.title || "", time: fmtTime(ts.endedAt || ts.publishedAt) });
    $("ts-end-btn").hidden = !ts.active;
  }

  /* ---------- results & grading ---------- */
  async function loadResultsList(selectId) {
    const sel = $("ts-results-select");
    const data = await callBackend("quiz_list");
    if (data.error) { $("ts-results-body").innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(data.error)}</td></tr>`; return; }
    const list = (data.quizzes || []).filter(z => z.kind === "sumatif");
    const keep = selectId || sel.value;
    sel.innerHTML = list.length
      ? list.map(z => `<option value="${escapeHtml(z.id)}">${escapeHtml(fmtTime(z.publishedAt))}${z.active ? " · " + escapeHtml(t("quiz.history.live")) : ""} · ${escapeHtml(t("ts.results.count", { n: z.answers }))}</option>`).join("")
      : `<option value="">${escapeHtml(t("ts.results.none"))}</option>`;
    if (keep && list.some(z => z.id === keep)) sel.value = keep;
    loadResults();
  }
  function statusPill(r) {
    if (!r.status) return `<span class="pill">${escapeHtml(t("ts.st.none"))}</span>`;
    if (r.status === "submitted") return r.gradedAll ? `<span class="pill ok">${escapeHtml(t("ts.st.graded"))}</span>` : `<span class="pill warn">${escapeHtml(t("ts.st.submitted"))}</span>`;
    return `<span class="pill">${escapeHtml(t("ts.st.draft"))}</span>`;
  }
  async function loadResults() {
    const body = $("ts-results-body"), qid = $("ts-results-select").value;
    if (!qid) { body.innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(t("ts.results.none"))}</td></tr>`; return; }
    body.innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(t("ts.loading"))}</td></tr>`;
    const data = await callBackend("test_results", { quizId: qid });
    if (data.error) { body.innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(data.error)}</td></tr>`; return; }
    const rows = data.rows || [], max = data.test ? data.test.max : 0;
    if (!rows.length) { body.innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(t("ts.results.nostudents"))}</td></tr>`; return; }
    body.innerHTML = rows.map(r => `<tr><td>${escapeHtml(r.name)}<div class="muted small">${escapeHtml(r.className || "")}</div></td><td>${statusPill(r)}</td>
      <td class="num">${r.autoScore == null ? "-" : r.autoScore}</td><td class="num">${r.total == null ? "-" : `${r.total} / ${max}`}</td>
      <td>${r.status ? `<button type="button" class="btn btn-ghost btn-small" data-grade="${escapeHtml(r.studentId)}" data-name="${escapeHtml(r.name)}">${escapeHtml(t("ts.grade.btn"))}</button>` : ""}</td></tr>`).join("");
  }
  $("ts-results-select").addEventListener("change", loadResults);
  $("ts-results-refresh").addEventListener("click", () => loadResultsList());
  $("ts-results-body").addEventListener("click", e => { const b = e.target.closest("[data-grade]"); if (b) openGrade(b.dataset.grade, b.dataset.name); });

  function gradeTotal() {
    if (!grading) return;
    let manualSum = 0;
    document.querySelectorAll("#ts-grade-body [data-score-key]").forEach(inp => { const v = Number(inp.value); if (inp.value !== "" && isFinite(v)) manualSum += Math.max(0, Math.min(Number(inp.max) || 0, v)); });
    const max = R.totalMarks(grading.test);
    $("ts-grade-total").textContent = t("ts.grade.total", { auto: grading.scores.auto, manual: manualSum, total: grading.scores.auto + manualSum, max });
  }
  async function openGrade(sid, name) {
    const qid = $("ts-results-select").value;
    $("ts-grade-title").textContent = name || sid;
    $("ts-grade-body").innerHTML = `<p class="teacher-note">${escapeHtml(t("ts.loading"))}</p>`;
    $("ts-grade-total").textContent = "";
    $("ts-grade-modal").hidden = false;
    const data = await callBackend("test_answer_detail", { quizId: qid, studentId: sid });
    if (data.error) { $("ts-grade-body").innerHTML = `<p class="teacher-note">${escapeHtml(data.error)}</p>`; return; }
    grading = { quizId: qid, studentId: sid, test: data.test, answers: data.answers, manual: data.manual, scores: data.scores };
    const meta = data.status === "submitted" ? t("ts.grade.submittedAt", { time: fmtTime(data.submittedAt) }) : t("ts.grade.notsubmitted");
    $("ts-grade-body").innerHTML = `<p class="muted small">${escapeHtml(meta)}</p>` + R.paper(data.test, { mode: "review", answers: data.answers, manual: data.manual });
    typeset($("ts-grade-body"));
    gradeTotal();
  }
  $("ts-grade-body").addEventListener("input", e => { if (e.target.matches("[data-score-key]")) gradeTotal(); });
  $("ts-grade-save-btn").addEventListener("click", async () => {
    if (!grading) return;
    const manual = {};
    document.querySelectorAll("#ts-grade-body [data-score-key]").forEach(inp => { if (inp.value !== "") manual[inp.dataset.scoreKey] = Number(inp.value); });
    $("ts-grade-total").textContent = t("ts.saving");
    const data = await callBackend("test_grade", { quizId: grading.quizId, studentId: grading.studentId, manual });
    if (data.error) { $("ts-grade-total").textContent = data.error; return; }
    grading.scores = data.scores;
    $("ts-grade-total").textContent = t("ts.grade.saved", { total: data.scores.total, max: data.scores.max });
    loadResults();
  });
  function closeGrade() { $("ts-grade-modal").hidden = true; grading = null; }
  $("ts-grade-close-btn").addEventListener("click", closeGrade);
  $("ts-grade-close-x").addEventListener("click", closeGrade);

  window.addEventListener("beforeunload", e => { if (editing) { e.preventDefault(); e.returnValue = ""; } });

  window.TeacherSumatif = {
    onShow() { if (mode === "test") { if (loadedTopic !== topicId()) loadTest(); loadResultsList(); } },
    onRoster(data) { if (data && "activeTest" in data) renderActive(data.activeTest); },
    setMode
  };
})();
