/* ============================================================
   teacher.js - Panel Guru V9
   ------------------------------------------------------------
   01 Class Management : mulai/ubah/akhiri sesi, siswa online, konfirmasi
                         checkpoint (gate) Eksperimen & Makerspace.
   02 Group Management : akun siswa & kelompok (js/teacher-accounts.js).
   03 Group Monitoring : progres & semua jawaban tiap siswa + ekspor.
   04 Quiz             : kuis manual (pop-up) atau tes sumatif
                         (js/teacher-sumatif.js).
   Pemakaian AI kini ada di Panel Admin (admin.html).
   Guru masuk dengan akun (nama pengguna + kata sandi) yang dibuat admin.
   Token guru hanya disimpan di sessionStorage (hilang saat tab ditutup).
   ============================================================ */
const SESSION_KEY_TEACHER_TOKEN = "emergent.teacherToken";
const ROSTER_POLL_MS = 8000;
let rosterTimer = null;
let overviewCache = null;

let quizBank = [];
let quizBankDirty = false;
let quizEditingIndex = null;
let quizSelectedIds = new Set();
let quizLastActive = null;

function getTeacherToken() { try { return (sessionStorage.getItem(SESSION_KEY_TEACHER_TOKEN) || "").trim(); } catch (e) { return ""; } }
function setTeacherToken(v) { try { if (v) sessionStorage.setItem(SESSION_KEY_TEACHER_TOKEN, v); else sessionStorage.removeItem(SESSION_KEY_TEACHER_TOKEN); } catch (e) { /* abaikan */ } }
async function callBackend(mode, body) {
  let data;
  try { data = await apiCall(mode, Object.assign({ teacherToken: getTeacherToken() }, body || {})); }
  catch (e) { return { error: e.message }; }
  // Token guru kedaluwarsa / dinonaktifkan admin: kembali ke layar masuk.
  if (data && data.code === "TEACHER_AUTH" && mode !== "teacher_login") showTeacherLogin(data.error);
  return data;
}
function escapeHtml(str) { return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function escapeAttrT(str) { return escapeHtml(str); }
function stripTags(html) { const d = document.createElement("div"); d.innerHTML = html || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); }
// Hanya topik yang ditampilkan ke siswa (js/config.js, VISIBLE_TOPIC_IDS) yang boleh dipilih guru.
function topicVisibleT(tp) { return typeof VISIBLE_TOPIC_IDS === "undefined" || !VISIBLE_TOPIC_IDS.length || VISIBLE_TOPIC_IDS.includes(tp.id); }
function topicNo(tp) { return tp.syllabusno || tp.number; }
function readyTopics() { return TOPICS.filter(tp => tp.status === "ready" && topicVisibleT(tp)).sort((a, b) => a.number - b.number); }
function allTopicsSorted() { return TOPICS.filter(topicVisibleT).sort((a, b) => a.number - b.number); }
function topicTitle(id) { const tp = TOPICS.find(x => x.id === id); return tp ? `${topicNo(tp)}. ${trContent(tp.title)}` : (id || "-"); }
function tabLabelsT() { return [t("tab.materi"), t("tab.eksperimen"), t("tab.latihan"), t("tab.lab")]; }
function fmtTime(ms, withDate) {
  if (!ms) return "-";
  const d = new Date(ms), loc = getLang() === "en" ? "en-GB" : "id-ID";
  return withDate === false ? d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }) : d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function relativeTime(ms) {
  if (!ms) return "-";
  const s = Math.round(Math.max(0, Date.now() - ms) / 1000);
  if (s < 5) return t("time.justnow");
  if (s < 60) return t("time.secondsago", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("time.minutesago", { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t("time.hoursago", { n: h });
  return fmtTime(ms);
}
function statusClass(ms) {
  if (!ms) return "stale";
  const diff = Date.now() - ms;
  return diff < 40000 ? "online" : diff < 120000 ? "away" : "stale";
}
function typeset(el) { if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([el]).catch(() => {}); }

/* ---------------- Login & tab ---------------- */
function showTeacherLogin(msg) {
  stopRosterPolling();
  setTeacherToken("");
  document.getElementById("teacher-login-card").hidden = false;
  document.getElementById("teacher-panel").hidden = true;
  document.getElementById("teacher-logout-btn").hidden = true;
  if (msg) document.getElementById("teacher-login-status").textContent = msg;
}
async function enterPanel() {
  const data = await callBackend("teacher_roster");
  if (data.error) return data;
  document.getElementById("teacher-login-status").textContent = "";
  document.getElementById("teacher-login-card").hidden = true;
  document.getElementById("teacher-panel").hidden = false;
  document.getElementById("teacher-logout-btn").hidden = false;
  if (data.teacher) document.getElementById("teacher-whoami").textContent = `${data.teacher.name} (${data.teacher.username})`;
  populateTopicSelects();
  applyRoster(data);
  populateQuizTopicSelect();
  loadQuizBank();
  loadQuizHistory();
  startRosterPolling();
  return data;
}
async function doLogin(username, password) {
  const statusEl = document.getElementById("teacher-login-status");
  statusEl.textContent = t("teacher.login.checking");
  const r = await callBackend("teacher_login", { username, password });
  if (r.error) { statusEl.textContent = r.error; return false; }
  setTeacherToken(r.token);
  document.getElementById("teacher-password-input").value = "";
  const data = await enterPanel();
  if (data.error) { statusEl.textContent = data.error; setTeacherToken(""); return false; }
  return true;
}
document.getElementById("teacher-login-btn").addEventListener("click", () => {
  const u = document.getElementById("teacher-username-input").value.trim();
  const p = document.getElementById("teacher-password-input").value;
  if (!u || !p) { document.getElementById("teacher-login-status").textContent = t("tl.login.need"); return; }
  doLogin(u, p);
});
["teacher-username-input", "teacher-password-input"].forEach(id => document.getElementById(id).addEventListener("keydown", e => { if (e.key === "Enter") document.getElementById("teacher-login-btn").click(); }));
document.getElementById("teacher-logout-btn").addEventListener("click", () => { setTeacherToken(""); location.reload(); });
// Masih ada token di tab ini (mis. setelah memuat ulang halaman): langsung masuk.
if (getTeacherToken()) enterPanel().then(d => { if (d && d.error) showTeacherLogin(""); });

// Ganti kata sandi guru
document.getElementById("teacher-changepw-btn").addEventListener("click", () => {
  ["pw-current", "pw-next"].forEach(id => { document.getElementById(id).value = ""; });
  document.getElementById("pw-status").textContent = "";
  document.getElementById("pw-modal").hidden = false;
});
document.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", () => { document.getElementById(b.dataset.closeModal).hidden = true; }));
document.getElementById("pw-save-btn").addEventListener("click", async () => {
  const st = document.getElementById("pw-status");
  st.textContent = t("tl.pw.saving");
  const r = await callBackend("teacher_change_password", { current: document.getElementById("pw-current").value, next: document.getElementById("pw-next").value });
  if (r.error) { st.textContent = r.error; return; }
  setTeacherToken(r.token);
  st.textContent = t("tl.pw.saved");
  setTimeout(() => { document.getElementById("pw-modal").hidden = true; }, 900);
});

document.querySelectorAll(".t-tab").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".t-tab").forEach(b => b.classList.toggle("active", b === btn));
  document.querySelectorAll(".t-pane").forEach(p => p.classList.toggle("active", p.id === "pane-" + btn.dataset.pane));
  if (btn.dataset.pane === "records") loadOverview();
  if (btn.dataset.pane === "accounts" && typeof loadAccounts === "function") loadAccounts();
  if (btn.dataset.pane === "quiz") { loadQuizHistory(); if (typeof TeacherSumatif !== "undefined") TeacherSumatif.onShow(); }
}));

/* ---------------- 01 Sesi kelas ---------------- */
function populateTopicSelects() {
  const opts = readyTopics().map(tp => `<option value="${tp.id}">${topicNo(tp)}. ${escapeHtml(trContent(tp.title))}</option>`).join("");
  document.getElementById("teacher-topic-select").innerHTML = opts;
  document.getElementById("teacher-topic-select-2").innerHTML = opts;
}
function renderSessionUI(state) {
  const statusEl = document.getElementById("teacher-session-status");
  const active = state && state.active;
  document.getElementById("teacher-no-session").hidden = !!active;
  document.getElementById("teacher-has-session").hidden = !active;
  if (active) {
    document.getElementById("teacher-code-display").textContent = state.code || "------";
    if (state.topicId) document.getElementById("teacher-topic-select-2").value = state.topicId;
    if (typeof state.tabIndex === "number") document.getElementById("teacher-tab-select-2").value = String(state.tabIndex);
    statusEl.textContent = t("teacher.session.active", { topic: topicTitle(state.topicId), tab: tabLabelsT()[state.tabIndex] || "" });
  } else {
    statusEl.textContent = t("teacher.session.none");
  }
}
function renderRoster(roster) {
  const body = document.getElementById("roster-body");
  const countEl = document.getElementById("roster-count");
  const ids = Object.keys(roster || {});
  if (!ids.length) { body.innerHTML = `<tr><td colspan="4" class="muted small">${t("teacher.roster.empty2")}</td></tr>`; countEl.textContent = ""; return; }
  ids.sort((a, b) => (roster[b].lastSeen || 0) - (roster[a].lastSeen || 0));
  body.innerHTML = ids.map(id => {
    const r = roster[id];
    const activity = r.topicId ? `${topicTitle(r.topicId)} · ${tabLabelsT()[r.tabIndex] || "-"}` : "-";
    return `<tr><td><button type="button" class="student-link" data-sid="${escapeAttrT(id)}">${escapeHtml(id)}</button></td><td>${escapeHtml(activity)}</td><td><span class="pill ${r.inSession ? "solid" : ""}">${r.inSession ? t("teacher.mode.class") : t("teacher.mode.self")}</span></td><td class="num"><span class="status-dot ${statusClass(r.lastSeen)}"></span>${relativeTime(r.lastSeen)}</td></tr>`;
  }).join("");
  const online = ids.filter(id => statusClass(roster[id].lastSeen) === "online").length;
  countEl.textContent = t("teacher.roster.count", { total: ids.length, online });
}
function stageLabel(stage) { return stage === "eksperimen" ? t("teacher.gate.stage.eksperimen") : t("teacher.gate.stage.lab"); }
let gateList = [];
function renderGatePending(list) {
  gateList = list || [];
  const body = document.getElementById("gate-pending-body");
  if (!gateList.length) { body.innerHTML = `<tr><td colspan="5" class="muted small">${t("teacher.gate.empty")}</td></tr>`; return; }
  body.innerHTML = gateList.map((req, i) => `<tr>
      <td>${/^grp:/.test(req.studentId)
        ? `<strong>${escapeHtml(req.label || req.studentId)}</strong> <span class="pill solid">${t("teacher.gate.groupwork")}</span>`
        : `<button type="button" class="student-link" data-sid="${escapeAttrT(req.studentId)}">${escapeHtml(req.label || req.studentId)}</button>`}<br><span class="muted small">${escapeHtml(topicTitle(req.topicId))}</span></td>
      <td>${escapeHtml(stageLabel(req.stage))}</td>
      <td class="small" style="max-width:300px;white-space:pre-wrap">${escapeHtml(req.summary)}</td>
      <td class="num">${relativeTime(req.submittedAt)}</td>
      <td><div class="lab-actions" style="margin:0"><button type="button" class="btn btn-primary btn-small" data-gate="${i}" data-decision="approved">${t("teacher.gate.approve.btn")}</button><button type="button" class="btn btn-secondary btn-small" data-gate="${i}" data-decision="rejected">${t("teacher.gate.reject.btn")}</button></div></td>
    </tr>`).join("");
}
document.getElementById("gate-pending-body").addEventListener("click", async e => {
  const btn = e.target.closest("[data-gate]");
  if (!btn) return;
  const req = gateList[parseInt(btn.dataset.gate, 10)];
  if (!req) return;
  let note = "";
  if (btn.dataset.decision === "rejected") {
    const v = window.prompt(t("teacher.gate.reject.prompt"), "");
    if (v === null) return;
    note = v;
  }
  const statusEl = document.getElementById("gate-decide-status");
  statusEl.textContent = t("teacher.gate.deciding");
  btn.disabled = true;
  const data = await callBackend("teacher_gate_decide", { topicId: req.topicId, studentId: req.studentId, stage: req.stage, decision: btn.dataset.decision, note });
  statusEl.textContent = data.error || "";
  pollRoster();
});
function applyRoster(data) {
  renderSessionUI(data.state);
  renderRoster(data.roster);
  renderGatePending(data.gatePending);
  renderQuizActiveCard(data.activeQuiz);
  if (typeof TeacherSumatif !== "undefined") TeacherSumatif.onRoster(data);
}
async function pollRoster() {
  const data = await callBackend("teacher_roster");
  if (data.error) { document.getElementById("teacher-session-status").textContent = data.error; return; }
  applyRoster(data);
}
function startRosterPolling() { stopRosterPolling(); rosterTimer = setInterval(() => { if (!document.hidden) pollRoster(); }, ROSTER_POLL_MS); }
function stopRosterPolling() { if (rosterTimer) clearInterval(rosterTimer); rosterTimer = null; }

async function sessionAction(action, topicSel, tabSel, busyKey) {
  const statusEl = document.getElementById("teacher-session-status");
  statusEl.textContent = t(busyKey);
  const body = { action };
  if (topicSel) { body.topicId = document.getElementById(topicSel).value; body.tabIndex = parseInt(document.getElementById(tabSel).value, 10); }
  const data = await callBackend("teacher_session", body);
  if (data.error) { statusEl.textContent = data.error; return; }
  renderSessionUI(data.state);
  pollRoster();
}
document.getElementById("teacher-start-btn").addEventListener("click", () => sessionAction("start", "teacher-topic-select", "teacher-tab-select", "teacher.session.starting"));
document.getElementById("teacher-update-btn").addEventListener("click", () => sessionAction("update", "teacher-topic-select-2", "teacher-tab-select-2", "teacher.session.applying"));
document.getElementById("teacher-end-btn").addEventListener("click", () => { if (confirm(t("teacher.session.end.confirm"))) sessionAction("end", null, null, "teacher.session.ending"); });

/* ---------------- 02 Rekap siswa ---------------- */
function lkpdModes(topicId) {
  const tp = TOPICS.find(x => x.id === topicId);
  return (tp && tp.eksperimen && tp.eksperimen.lkpd) ? tp.eksperimen.lkpd.modes : {};
}
function modeName(topicId, mode) {
  const m = lkpdModes(topicId)[mode];
  return m ? trContent(m.name) : mode;
}
// Ringkasan per siswa dari teacher_overview (dipakai tabel & ekspor).
function buildSummaries(ov) {
  const byId = {};
  const groupsById = {};
  (ov.groups || []).forEach(g => { groupsById[g.groupId] = g; });
  const accById = {};
  (ov.accounts || []).forEach(a => { accById[a.studentId] = a; });
  ov.students.forEach(s => {
    byId[s.studentId] = { s, events: {}, lkpd: [], gates: [], quizzes: [], exps: [], latihan: { right: 0, total: 0 } };
  });
  const ensure = id => byId[id] || (byId[id] = { s: { studentId: id, name: id, className: "", progress: {} }, events: {}, lkpd: [], gates: [], quizzes: [], exps: [], latihan: { right: 0, total: 0 } });
  ov.events.forEach(e => { ensure(e.studentId).events[e.kind] = { n: e.n, best: e.best, last: e.last }; });
  (ov.lastScores || []).forEach(e => { const x = ensure(e.studentId).events[e.kind]; if (x) x.lastScore = e.score; });
  ov.lkpd.forEach(l => ensure(l.studentId).lkpd.push(l));
  ov.gates.forEach(g => ensure(g.studentId).gates.push(g));
  ov.quizAnswers.forEach(a => ensure(a.studentId).quizzes.push(a));
  ov.experiments.forEach(x => ensure(x.studentId).exps.push(x));
  (ov.latihanFirst || []).forEach(l => { const r = ensure(l.studentId).latihan; r.total++; if (l.firstScore >= 100) r.right++; });
  return Object.values(byId).map(x => {
    const prog = x.s.progress || {};
    const maxStage = Math.max(x.s.topicId || x.s.lastSeen ? 0 : -1, ...Object.values(prog).map(Number));
    const quizScores = x.quizzes.map(q => q.score).filter(v => v != null);
    const lkpdBest = x.lkpd.slice().sort((a, b) => (b.progress || 0) - (a.progress || 0))[0] || null;
    const gate = stage => { const g = x.gates.filter(g => g.stage === stage).sort((a, b) => (b.submittedAt || 0) - (a.submittedAt || 0))[0]; return g ? g.status : null; };
    return {
      studentId: x.s.studentId, name: x.s.name || x.s.studentId, className: x.s.className || "",
      groupName: accById[x.s.studentId] && groupsById[accById[x.s.studentId].groupId] ? groupsById[accById[x.s.studentId].groupId].name : "",
      isLeader: !!(accById[x.s.studentId] && groupsById[accById[x.s.studentId].groupId] && groupsById[accById[x.s.studentId].groupId].leaderId === x.s.studentId),
      lastSeen: x.s.lastSeen, stageIndex: maxStage,
      slidesPct: x.events.slides_progress ? x.events.slides_progress.best : null,
      materiBest: x.events.materi_check ? x.events.materi_check.best : null,
      materiTries: x.events.materi_check ? x.events.materi_check.n : 0,
      eksBest: x.events.eksperimen_check ? x.events.eksperimen_check.best : null,
      lkpd: lkpdBest, lkpdAll: x.lkpd,
      latihan: x.latihan,
      quizAvg: quizScores.length ? quizScores.reduce((a, b) => a + b, 0) / quizScores.length : null, quizCount: x.quizzes.length,
      simCount: x.events.lab_generate ? x.events.lab_generate.n : 0, editCount: x.events.lab_edit ? x.events.lab_edit.n : 0,
      gateEks: gate("eksperimen"), gateLab: gate("lab"),
      expCount: x.exps.length
    };
  }).filter(x => !/^grp:/.test(x.studentId)).sort((a, b) => (a.className || "").localeCompare(b.className || "") || a.name.localeCompare(b.name));
}
function gatePill(status) {
  if (!status) return `<span class="pill">-</span>`;
  const cls = status === "approved" ? "ok" : status === "pending" ? "warn" : "bad";
  return `<span class="pill ${cls}">${t("teacher.gatestatus." + status)}</span>`;
}
function stageSteps(idx) {
  return `<span class="mini-steps" title="${escapeAttrT(idx >= 0 ? tabLabelsT()[Math.min(idx, 3)] : "-")}">${[0, 1, 2, 3].map(i => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</span>`;
}
const pct = v => (v == null ? "-" : Math.round(v) + "%");
function filteredSummaries() {
  if (!overviewCache) return [];
  const qtext = document.getElementById("records-search").value.trim().toLowerCase();
  const cls = document.getElementById("records-class-filter").value;
  return overviewCache.summaries.filter(s => (!cls || s.className === cls) && (!qtext || s.name.toLowerCase().includes(qtext) || s.studentId.toLowerCase().includes(qtext)));
}
function renderRecords() {
  const rows = filteredSummaries();
  const body = document.getElementById("records-body");
  if (!rows.length) { body.innerHTML = `<tr><td colspan="12" class="muted small">${t("teacher.records.empty")}</td></tr>`; }
  else body.innerHTML = rows.map(s => `<tr>
      <td><button type="button" class="student-link" data-sid="${escapeAttrT(s.studentId)}">${escapeHtml(s.name)}</button></td>
      <td>${escapeHtml(s.className || "-")}</td>
      <td>${s.groupName ? escapeHtml(s.groupName) + (s.isLeader ? ` <span class="pill solid">${t("teacher.rec.leader")}</span>` : "") : "-"}</td>
      <td>${stageSteps(s.stageIndex)}</td>
      <td class="num">${s.slidesPct == null ? "-" : `<span class="meter"><span style="width:${Math.min(100, s.slidesPct)}%"></span></span>${pct(s.slidesPct)}`}</td>
      <td class="num">${s.materiBest == null ? "-" : pct(s.materiBest) + ` <span class="muted">(${s.materiTries}x)</span>`}</td>
      <td class="num">${s.lkpd ? `${escapeHtml(modeName("magnetic-fields", s.lkpd.mode))}<br>${pct(s.lkpd.progress)} · ${t("teacher.rec.score")} ${pct(s.lkpd.score)} ${s.lkpd.status === "submitted" ? `<span class="pill ok">${t("teacher.rec.submitted")}</span>` : ""}` : "-"}</td>
      <td class="num">${s.latihan.total ? `${s.latihan.right}/${s.latihan.total}` : "-"}</td>
      <td class="num">${s.quizCount ? pct(s.quizAvg) + ` <span class="muted">(${s.quizCount})</span>` : "-"}</td>
      <td class="num">${s.simCount ? `${s.simCount} · ${t("teacher.rec.edits", { n: s.editCount })}` : "-"}</td>
      <td>${gatePill(s.gateEks)} ${gatePill(s.gateLab)}</td>
      <td class="num">${relativeTime(s.lastSeen)}</td>
    </tr>`).join("");
  const all = overviewCache.summaries;
  const online = all.filter(s => s.lastSeen && Date.now() - s.lastSeen < 5 * 60000).length;
  const submitted = all.filter(s => s.lkpd && s.lkpd.status === "submitted").length;
  const avgMateri = all.filter(s => s.materiBest != null);
  document.getElementById("records-stats").innerHTML = [
    [t("teacher.stat.students"), all.length],
    [t("teacher.stat.online"), online],
    [t("teacher.stat.lkpd"), submitted],
    [t("teacher.stat.materi"), avgMateri.length ? Math.round(avgMateri.reduce((a, b) => a + b.materiBest, 0) / avgMateri.length) + "%" : "-"],
    [t("teacher.stat.pending"), gateList.length]
  ].map(([k, v]) => `<div class="t-stat"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`).join("");
}
async function loadOverview() {
  const statusEl = document.getElementById("records-status");
  statusEl.textContent = t("teacher.records.loading");
  const data = await callBackend("teacher_overview");
  if (data.error) { statusEl.textContent = data.error; return; }
  overviewCache = { raw: data, summaries: buildSummaries(data) };
  const classes = [...new Set(overviewCache.summaries.map(s => s.className).filter(Boolean))].sort();
  const sel = document.getElementById("records-class-filter");
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t("teacher.records.allclasses")}</option>` + classes.map(c => `<option value="${escapeAttrT(c)}">${escapeHtml(c)}</option>`).join("");
  if (classes.includes(prev)) sel.value = prev;
  statusEl.textContent = t("teacher.records.loaded", { n: overviewCache.summaries.length, time: fmtTime(Date.now(), false) });
  renderRecords();
}
document.getElementById("records-search").addEventListener("input", renderRecords);
document.getElementById("records-class-filter").addEventListener("change", renderRecords);
document.getElementById("records-refresh-btn").addEventListener("click", loadOverview);

/* ---------------- Detail siswa ---------------- */
let currentDetail = null;
document.addEventListener("click", e => {
  const link = e.target.closest(".student-link");
  if (link) openStudent(link.dataset.sid);
});
function qText(html) { return stripTags(trContent(html)); }
// Susun jawaban LKPD menjadi daftar baris yang mudah dibaca (dipakai modal & ekspor).
function lkpdAnswerRows(topicId, entry) {
  const def = lkpdModes(topicId)[entry.mode];
  const st = entry.data || {};
  const out = [];
  if (!def) return out;
  if (st.group) out.push({ item: t("lkpd.group"), question: "", answer: st.group });
  def.sections.forEach((sec, idx) => {
    // Label seperti yang dilihat siswa di LKPD, mis. "12 · Uraian" (bukan id internal).
    const label = String(idx + 1).padStart(2, "0") + " · " + t("lkpd.kind." + sec.type);
    if (sec.type === "materials" || sec.type === "steps") {
      const done = sec.items.filter((_, i) => st.tick && st.tick[idx + "-" + i]).length;
      out.push({ item: qText(sec.title), question: "", answer: `${done}/${sec.items.length} ${t("teacher.lkpd.ticked")}` });
    } else if (sec.type === "vars") {
      sec.fields.forEach(f => out.push({ item: stripTags(trContent(f.label)), question: "", answer: (f.fixed !== undefined ? f.fixed : ((st.vars || {})[f.key] || "-")) + " " + trContent(f.unit) }));
    } else if (sec.type === "choice") {
      const a = (st.a || {})[sec.id];
      out.push({ item: label, question: qText(sec.q), answer: a == null ? "-" : String.fromCharCode(65 + a) + ". " + qText(sec.options[a]), correct: st.ck && st.ck[sec.id] ? st.ck[sec.id] === 1 : null, first: st.first ? st.first[sec.id] : undefined, tries: st.tries ? st.tries[sec.id] : undefined, key: String.fromCharCode(65 + sec.correct) });
    } else if (sec.type === "calc") {
      const a = (st.a || {})[sec.id];
      out.push({ item: label, question: qText(sec.q), answer: a ? a + " " + sec.unit : "-", correct: st.ck && st.ck[sec.id] ? st.ck[sec.id] === 1 : null, first: st.first ? st.first[sec.id] : undefined, tries: st.tries ? st.tries[sec.id] : undefined });
    } else if (sec.type === "open") {
      out.push({ item: label, question: qText(sec.q), answer: (st.open || {})[sec.id] || "-", revealed: !!(st.revealed && st.revealed[sec.id]) });
    }
  });
  return out;
}
// Nilai B yang ditulis siswa: dari data eksperimen, atau dari jawaban "hitung B" di LKPD
// (siswa sering mengisinya setelah menekan "Simpan Data").
function studentB(x, lkpdList) {
  const an = x.analysis || {};
  if (an.B_student) return an.B_student;
  const l = (lkpdList || []).find(e => e.topicId === x.topicId && e.mode === x.variant);
  return (l && l.data && l.data.a && l.data.a.calcB) || "";
}
// "q4" -> "Soal 4" (id internal soal latihan)
function latihanLabel(item) {
  const m = /^q(\d+)$/.exec(item || "");
  return m ? t("lkpd.kind.choice") + " " + m[1] : (item || "");
}
function correctnessHTML(r) {
  if (r.correct == null) return "";
  let s = `<span class="pill ${r.correct ? "ok" : "bad"}">${r.correct ? t("quiz.results.correct") : t("quiz.results.incorrect")}</span>`;
  if (r.tries) s += ` <span class="muted small">${t("teacher.lkpd.tries", { n: r.tries, first: r.first === 1 ? t("teacher.lkpd.firstok") : t("teacher.lkpd.firstwrong") })}</span>`;
  return s;
}
function eventsOf(detail, kind) { return detail.events.filter(e => e.kind === kind); }
function renderDetail(d) {
  const s = d.student || { studentId: currentDetail.sid, name: currentDetail.sid, className: "" };
  document.getElementById("student-modal-eyebrow").textContent = (s.className || "-") + " · " + t("teacher.rec.last") + ": " + relativeTime(s.lastSeen);
  document.getElementById("student-modal-title").textContent = s.name || s.studentId;
  const sec = (title, html) => `<div class="detail-section"><h4>${escapeHtml(title)}</h4>${html || `<p class="muted small">${t("teacher.detail.none")}</p>`}</div>`;
  const list = items => items.length ? `<div class="answer-list">${items.map(([k, v]) => `<div class="answer-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("")}</div>` : "";
  let html = "";
  const prog = s.progress || {};
  html += sec(t("teacher.detail.progress"), list(Object.keys(prog).map(k => [escapeHtml(topicTitle(k)), stageSteps(prog[k]) + " " + escapeHtml(tabLabelsT()[Math.min(prog[k], 3)] || "-")])));
  const checks = kind => eventsOf(d, kind).map(e => [fmtTime(e.createdAt), `<b>${pct(e.score)}</b>` + ((e.payload && e.payload.answers) ? `<ol class="small" style="margin:6px 0 0">${e.payload.answers.map(a => `<li>${escapeHtml(a.q)}<br><span class="${a.correct ? "ok" : "warn"}">${escapeHtml(a.picked || "-")}</span></li>`).join("")}</ol>` : "")]);
  const slides = eventsOf(d, "slides_progress").slice(-1)[0];
  html += sec(t("teacher.detail.slides"), slides ? `<p>${t("teacher.detail.slidesseen", { seen: slides.payload.seen, total: slides.payload.total })} (${fmtTime(slides.createdAt)})</p>` : "");
  html += sec(t("teacher.detail.materi"), list(checks("materi_check")));
  html += sec(t("teacher.detail.eksperimen"), list(checks("eksperimen_check")));
  d.lkpd.forEach(l => {
    const rows = lkpdAnswerRows(l.topicId, l);
    html += sec(`LKPD · ${modeName(l.topicId, l.mode)} · ${pct(l.progress)} · ${t("teacher.rec.score")} ${pct(l.score)}` + (l.submittedAt ? ` · ${t("teacher.rec.submitted")} ${fmtTime(l.submittedAt)}` : ""),
      list(rows.map(r => [escapeHtml(r.item), (r.question ? `<span class="muted small">${escapeHtml(r.question)}</span><br>` : "") + escapeHtml(r.answer) + " " + correctnessHTML(r) + (r.key && r.correct === false ? ` <span class="muted small">(${t("teacher.lkpd.key")} ${r.key})</span>` : "") + (r.revealed ? ` <span class="muted small">${t("teacher.lkpd.revealed")}</span>` : "")])));
  });
  d.experiments.forEach(x => {
    const rows = (x.rows || []).map(r => `<tr><td>${r.I == null ? "-" : r.I}</td>${(r.values || []).map(v => `<td>${v == null ? "" : v}</td>`).join("")}</tr>`).join("");
    const an = x.analysis || {};
    html += sec(`${t("teacher.detail.expdata")} · ${modeName(x.topicId, x.variant)}`,
      `<table class="quiz-results-table"><thead><tr><th>I (A)</th><th>Δm₁ (g)</th><th>Δm₂ (g)</th><th>Δm₃ (g)</th></tr></thead><tbody>${rows}</tbody></table>` +
      `<p class="small" style="margin-top:8px">${t("teacher.detail.analysis", { grad: an.gradient != null ? Number(an.gradient).toPrecision(3) : "-", b: studentB(x, d.lkpd) || "-", bfit: an.B_fromFit != null ? Number(an.B_fromFit).toPrecision(3) : "-" })}</p>` +
      `<p class="small ${x.flagged ? "warn" : "ok"}">${t("teacher.detail.aifeedback")}: ${escapeHtml(x.feedback || "-")}</p>`);
  });
  const lat = eventsOf(d, "latihan");
  html += sec(t("teacher.detail.latihan"), list(lat.map(e => [escapeHtml(latihanLabel(e.item)) + " · " + fmtTime(e.createdAt), e.payload && e.payload.revealed ? t("teacher.detail.revealed") : `${escapeHtml(e.payload ? e.payload.picked : "-")} <span class="pill ${e.score >= 100 ? "ok" : "bad"}">${e.score >= 100 ? t("quiz.results.correct") : t("quiz.results.incorrect")}</span>`])));
  html += sec(t("teacher.detail.quiz"), d.quizzes.map(z => `<p class="small"><b>${escapeHtml(topicTitle(z.topicId))}</b> · ${fmtTime(z.submittedAt)} · ${t("teacher.rec.score")} ${pct(z.score)}</p>` +
    list((z.questions || []).map((q, i) => {
      const v = (z.answers || {})[q.id];
      let ans = v == null || v === "" ? "-" : (q.type === "mcq" ? String.fromCharCode(65 + v) + ". " + escapeHtml(q.options[v] || "") + ` <span class="pill ${v === q.correct ? "ok" : "bad"}">${v === q.correct ? t("quiz.results.correct") : t("quiz.results.incorrect")}</span>` : escapeHtml(v));
      return [t("quiz.modal.question.label", { n: i + 1 }), `<span class="muted small">${escapeHtml(q.question)}</span><br>${ans}`];
    }))).join(""));
  const sims = d.events.filter(e => e.kind === "lab_generate" || e.kind === "lab_edit");
  html += sec(t("teacher.detail.lab"), list(sims.map((e, i) => [fmtTime(e.createdAt) + "<br>" + (e.kind === "lab_edit" ? t("teacher.detail.edit") : t("teacher.detail.generate")),
    `<span class="small" style="white-space:pre-wrap">${escapeHtml(((e.payload && (e.payload.instruction || e.payload.prompt)) || "").slice(0, 1200))}</span>` +
    (e.payload && e.payload.html ? `<br><button type="button" class="btn btn-secondary btn-small" data-open-sim="${d.events.indexOf(e)}">${t("teacher.detail.opensim")}</button> <span class="muted small">${(e.payload.html.length / 1024).toFixed(1)} KB${e.payload.truncated ? " · " + t("teacher.detail.truncated") : ""}</span>` : "")])));
  html += sec(t("teacher.detail.gates"), list(d.gates.map(g => [escapeHtml(topicTitle(g.topicId)) + "<br>" + escapeHtml(stageLabel(g.stage)), gatePill(g.status) + ` <span class="muted small">${fmtTime(g.submittedAt)}</span><div style="white-space:pre-wrap;margin-top:4px">${escapeHtml(g.summary || "")}</div>` + (g.note ? `<div class="small muted">${t("gate.banner.notefromteacher")}: ${escapeHtml(g.note)}</div>` : "")])));
  const body = document.getElementById("student-modal-body");
  body.innerHTML = html;
  typeset(body);
}
async function openStudent(sid) {
  currentDetail = { sid, data: null };
  const modal = document.getElementById("student-modal");
  document.getElementById("student-modal-title").textContent = sid;
  document.getElementById("student-modal-eyebrow").textContent = "";
  document.getElementById("student-modal-body").innerHTML = `<p class="teacher-note">${t("teacher.records.loading")}</p>`;
  modal.hidden = false;
  const data = await callBackend("teacher_student_detail", { studentId: sid });
  if (data.error) { document.getElementById("student-modal-body").innerHTML = `<p class="teacher-note">${escapeHtml(data.error)}</p>`; return; }
  currentDetail.data = data;
  renderDetail(data);
}
document.getElementById("student-modal-body").addEventListener("click", e => {
  const b = e.target.closest("[data-open-sim]");
  if (!b || !currentDetail || !currentDetail.data) return;
  const ev = currentDetail.data.events[parseInt(b.dataset.openSim, 10)];
  if (!ev || !ev.payload || !ev.payload.html) return;
  const url = URL.createObjectURL(new Blob([ev.payload.html], { type: "text/html" }));
  const w = window.open("", "_blank");
  if (w) { w.document.write(`<!DOCTYPE html><title>Simulasi</title><style>html,body{margin:0;height:100%}</style><iframe sandbox="allow-scripts" src="${url}" style="border:0;width:100%;height:100%"></iframe>`); w.document.close(); }
});
function closeStudentModal() { document.getElementById("student-modal").hidden = true; }
document.getElementById("student-modal-close-x").addEventListener("click", closeStudentModal);
document.getElementById("student-modal-close-btn").addEventListener("click", closeStudentModal);
document.getElementById("student-delete-btn").addEventListener("click", async () => {
  if (!currentDetail) return;
  if (!confirm(t("teacher.student.delete.confirm", { name: currentDetail.sid }))) return;
  const data = await callBackend("teacher_delete_student", { studentId: currentDetail.sid });
  if (data.error) { alert(data.error); return; }
  closeStudentModal();
  loadOverview();
});

/* ---------------- Ekspor ---------------- */
async function fetchExport(ids) {
  const statusEl = document.getElementById("records-status");
  statusEl.textContent = t("teacher.export.preparing");
  const data = await callBackend("teacher_export", ids ? { studentIds: ids } : {});
  if (data.error) { statusEl.textContent = data.error; return null; }
  statusEl.textContent = "";
  return data;
}
document.getElementById("export-xlsx-btn").addEventListener("click", async () => {
  const rows = filteredSummaries();
  if (!rows.length) return;
  const data = await fetchExport(rows.map(r => r.studentId));
  if (data) TeacherExport.xlsx(data, rows, "rekap-emergent");
});
document.getElementById("export-pdf-btn").addEventListener("click", async () => {
  const rows = filteredSummaries();
  if (!rows.length) return;
  const data = await fetchExport(rows.map(r => r.studentId));
  if (data) TeacherExport.pdf(data, rows, "rekap-emergent");
});
document.getElementById("student-pdf-btn").addEventListener("click", async () => {
  if (!currentDetail || !currentDetail.data) return;
  const sum = overviewCache ? overviewCache.summaries.filter(s => s.studentId === currentDetail.sid) : [];
  TeacherExport.pdf({ exportedAt: Date.now(), students: [currentDetail.data], quizzes: [] }, sum, "siswa-" + currentDetail.sid);
});
document.getElementById("student-xlsx-btn").addEventListener("click", async () => {
  if (!currentDetail || !currentDetail.data) return;
  const sum = overviewCache ? overviewCache.summaries.filter(s => s.studentId === currentDetail.sid) : [];
  TeacherExport.xlsx({ exportedAt: Date.now(), students: [currentDetail.data], quizzes: [] }, sum, "siswa-" + currentDetail.sid);
});

/* ---------------- 04 Pemakaian AI ---------------- */
function populateQuizTopicSelect() {
  document.getElementById("quiz-topic-select").innerHTML = allTopicsSorted().map(tp => `<option value="${tp.id}">${topicNo(tp)}. ${escapeHtml(trContent(tp.title))}</option>`).join("");
  const ready = readyTopics()[0];
  const vis = (typeof VISIBLE_TOPIC_IDS !== "undefined" && VISIBLE_TOPIC_IDS.length) ? VISIBLE_TOPIC_IDS[0] : (ready ? ready.id : null);
  if (vis) document.getElementById("quiz-topic-select").value = vis;
}
async function loadQuizBank() {
  const topicId = document.getElementById("quiz-topic-select").value;
  if (!topicId) return;
  closeQuizEditor();
  quizSelectedIds = new Set();
  document.getElementById("quiz-bank-loading-note").hidden = false;
  document.getElementById("quiz-bank-empty-note").hidden = true;
  document.getElementById("quiz-question-list").innerHTML = "";
  const saveStatus = document.getElementById("quiz-save-status");
  saveStatus.textContent = ""; saveStatus.classList.remove("unsaved");
  const data = await callBackend("quiz_bank_get", { topicId });
  document.getElementById("quiz-bank-loading-note").hidden = true;
  if (data.error) { document.getElementById("quiz-generate-status").textContent = data.error; quizBank = []; }
  else { quizBank = data.questions || []; quizBankDirty = false; }
  renderQuizList();
}
document.getElementById("quiz-topic-select").addEventListener("change", loadQuizBank);
function updateQuizDirtyStatus() {
  const statusEl = document.getElementById("quiz-save-status");
  if (quizBankDirty) { statusEl.textContent = t("quiz.unsaved.note"); statusEl.classList.add("unsaved"); }
}
function renderQuizList() {
  const listEl = document.getElementById("quiz-question-list");
  const emptyNote = document.getElementById("quiz-bank-empty-note");
  if (!quizBank.length) { listEl.innerHTML = ""; emptyNote.hidden = false; return; }
  emptyNote.hidden = true;
  listEl.innerHTML = quizBank.map((q, i) => {
    const badgeClass = q.type === "short" ? "type-short" : (q.type === "essay" ? "type-essay" : "");
    const opts = q.type === "mcq" && Array.isArray(q.options) ? `<ul class="quiz-options-preview">${q.options.map((o, oi) => `<li class="${oi === q.correct ? "is-correct" : ""}">${String.fromCharCode(65 + oi)}. ${escapeHtml(o)}</li>`).join("")}</ul>` : "";
    return `<div class="quiz-question-item">
      <input type="checkbox" class="quiz-select-checkbox" data-index="${i}" ${quizSelectedIds.has(q.id) ? "checked" : ""} aria-label="${t("quiz.select.aria")}">
      <div><span class="quiz-type-badge ${badgeClass}">${t("quiz.type." + q.type)}</span><div class="quiz-question-text">${escapeHtml(q.question)}</div>${opts}</div>
      <div class="quiz-question-actions">
        <span class="qz-num">${i + 1}</span>
        <button type="button" class="btn btn-secondary btn-small quiz-edit-btn" data-index="${i}">${t("quiz.question.edit.btn")}</button>
        <button type="button" class="btn btn-ghost btn-small quiz-dup-btn" data-index="${i}" title="${escapeAttrT(t("qz.dup"))}">${t("qz.dup")}</button>
        <span class="qz-move"><button type="button" class="icon-btn qz-up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="${escapeAttrT(t("qz.up"))}">&uarr;</button><button type="button" class="icon-btn qz-down" data-index="${i}" ${i === quizBank.length - 1 ? "disabled" : ""} aria-label="${escapeAttrT(t("qz.down"))}">&darr;</button></span>
        <button type="button" class="btn btn-ghost btn-small quiz-delete-btn" data-index="${i}">${t("quiz.question.delete.btn")}</button>
      </div>
    </div>`;
  }).join("");
  typeset(listEl);
}
document.getElementById("quiz-question-list").addEventListener("click", e => {
  const edit = e.target.closest(".quiz-edit-btn");
  if (edit) return openQuizEditor(parseInt(edit.dataset.index, 10));
  const dup = e.target.closest(".quiz-dup-btn");
  if (dup) {
    const i = parseInt(dup.dataset.index, 10);
    const copy = JSON.parse(JSON.stringify(quizBank[i])); copy.id = newQuestionId();
    quizBank.splice(i + 1, 0, copy);
    return persistQuizBank();
  }
  const mv = e.target.closest(".qz-up, .qz-down");
  if (mv) {
    const i = parseInt(mv.dataset.index, 10), j = mv.classList.contains("qz-up") ? i - 1 : i + 1;
    if (j < 0 || j >= quizBank.length) return;
    [quizBank[i], quizBank[j]] = [quizBank[j], quizBank[i]];
    return persistQuizBank();
  }
  const del = e.target.closest(".quiz-delete-btn");
  if (del && confirm(t("quiz.confirmdelete"))) {
    const removed = quizBank.splice(parseInt(del.dataset.index, 10), 1)[0];
    if (removed) quizSelectedIds.delete(removed.id);
    persistQuizBank();
  }
});
document.getElementById("qz-select-all").addEventListener("change", e => {
  quizSelectedIds = e.target.checked ? new Set(quizBank.map(q => q.id)) : new Set();
  renderQuizList();
});
// Bank soal disimpan otomatis setiap ada perubahan (tambah, edit, hapus, urutan).
async function persistQuizBank() {
  quizBankDirty = true;
  renderQuizList();
  const statusEl = document.getElementById("quiz-save-status");
  statusEl.textContent = t("quiz.save.saving"); statusEl.classList.remove("unsaved");
  const data = await callBackend("quiz_bank_save", { topicId: document.getElementById("quiz-topic-select").value, questions: quizBank });
  if (data.error) { statusEl.textContent = data.error; statusEl.classList.add("unsaved"); return false; }
  quizBank = data.questions || quizBank; quizBankDirty = false;
  renderQuizList(); statusEl.textContent = t("qz.autosaved");
  return true;
}
document.getElementById("quiz-question-list").addEventListener("change", e => {
  if (!e.target.classList.contains("quiz-select-checkbox")) return;
  const q = quizBank[parseInt(e.target.dataset.index, 10)];
  if (!q) return;
  if (e.target.checked) quizSelectedIds.add(q.id); else quizSelectedIds.delete(q.id);
});
function latexToolbarHtml(targetId) {
  const syms = ["Δ", "θ", "ω", "μ", "π", "λ", "√", "±", "×", "→"];
  return `<div class="quiz-latex-toolbar">${syms.map(s => `<button type="button" class="quiz-latex-btn" data-target="${targetId}" data-kind="${escapeAttrT(s)}">${s}</button>`).join("")}${[["math", "$x$"], ["sup", "x²"], ["sub", "xₙ"], ["frac", "a/b"]].map(([k, l]) => `<button type="button" class="quiz-latex-btn" data-target="${targetId}" data-kind="${k}">${l}</button>`).join("")}</div>`;
}
function quizLatexInsert(targetId, kind) {
  const ta = document.getElementById(targetId);
  if (!ta) return;
  const start = ta.selectionStart, end = ta.selectionEnd, val = ta.value, sel = val.slice(start, end);
  let ins, s1, s2;
  if (kind === "math") { ins = "$" + (sel || "x") + "$"; s1 = start + 1; s2 = s1 + (sel || "x").length; }
  else if (kind === "sup") { ins = "^{" + (sel || "2") + "}"; s1 = start + 2; s2 = s1 + (sel || "2").length; }
  else if (kind === "sub") { ins = "_{" + (sel || "0") + "}"; s1 = start + 2; s2 = s1 + (sel || "0").length; }
  else if (kind === "frac") { ins = "\\frac{" + (sel || "a") + "}{b}"; s1 = start + 6; s2 = s1 + (sel || "a").length; }
  else { ins = kind; s1 = start + kind.length; s2 = s1; }
  ta.value = val.slice(0, start) + ins + val.slice(end);
  ta.focus(); ta.setSelectionRange(s1, s2);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}
document.addEventListener("click", e => {
  const b = e.target.closest(".quiz-latex-btn");
  if (b) quizLatexInsert(b.dataset.target, b.dataset.kind);
  if (e.target && e.target.id === "qz-ed-save") saveQuizEditor(false);
  if (e.target && e.target.id === "qz-ed-save-next") saveQuizEditor(true);
  if (e.target && e.target.id === "qz-ed-cancel") closeQuizEditor();
});
document.addEventListener("input", e => { if (e.target && e.target.id === "qz-ed-question") updateQuizPreview(); });
document.addEventListener("change", e => {
  if (e.target && e.target.id === "qz-ed-type") { const w = document.getElementById("qz-ed-options-wrap"); if (w) w.hidden = e.target.value !== "mcq"; }
});
let quizPreviewTimer = null;
function updateQuizPreview() {
  clearTimeout(quizPreviewTimer);
  quizPreviewTimer = setTimeout(() => {
    const ta = document.getElementById("qz-ed-question"), pv = document.getElementById("qz-ed-question-preview");
    if (!ta || !pv) return;
    pv.textContent = ta.value;
    typeset(pv);
  }, 250);
}
function openQuizEditor(index, presetType) {
  quizEditingIndex = typeof index === "number" ? index : null;
  const ex = quizEditingIndex !== null ? quizBank[quizEditingIndex] : null;
  const d = ex ? JSON.parse(JSON.stringify(ex)) : { type: presetType || "mcq", question: "", options: ["", "", "", ""], correct: 0, modelAnswer: "" };
  const c = document.getElementById("quiz-editor-container");
  c.innerHTML = `<div class="quiz-editor-box">
    <h4>${quizEditingIndex !== null ? t("quiz.editor.title.edit") : t("quiz.editor.title.add")}</h4>
    <label><span>${t("quiz.editor.type.label")}</span><select id="qz-ed-type">${["mcq", "short", "essay"].map(k => `<option value="${k}" ${d.type === k ? "selected" : ""}>${t("quiz.type." + k)}</option>`).join("")}</select></label>
    <label><span>${t("quiz.editor.question.label")}</span></label>${latexToolbarHtml("qz-ed-question")}<textarea id="qz-ed-question" rows="3">${escapeHtml(d.question)}</textarea>
    <p class="muted small" style="margin:8px 0 4px">${t("quiz.editor.preview.label")}</p><div class="quiz-editor-preview" id="qz-ed-question-preview"></div>
    <div id="qz-ed-options-wrap" ${d.type === "mcq" ? "" : "hidden"}><p class="muted small">${t("quiz.editor.correct.label")}</p>
      ${[0, 1, 2, 3].map(i => `<div class="quiz-option-row"><input type="radio" name="qz-ed-correct" value="${i}" ${d.correct === i ? "checked" : ""}><input type="text" class="qz-ed-option" value="${escapeAttrT((d.options || [])[i] || "")}" placeholder="${t("quiz.optionletter", { letter: String.fromCharCode(65 + i) })}"></div>`).join("")}</div>
    <label><span>${t("quiz.editor.modelanswer.label")}</span><textarea id="qz-ed-modelanswer" rows="2">${escapeHtml(d.modelAnswer || "")}</textarea></label>
    <div class="quiz-editor-actions"><button type="button" id="qz-ed-save" class="btn btn-primary btn-small">${t("quiz.editor.save.btn")}</button>${quizEditingIndex === null ? `<button type="button" id="qz-ed-save-next" class="btn btn-secondary btn-small">${t("qz.savenext")}</button>` : ""}<button type="button" id="qz-ed-cancel" class="btn btn-ghost btn-small">${t("quiz.editor.cancel.btn")}</button></div>
    <p class="muted small">${t("qz.editor.tip")}</p>
  </div>`;
  updateQuizPreview();
  c.scrollIntoView({ behavior: "smooth", block: "center" });
  const q = document.getElementById("qz-ed-question"); if (q) q.focus();
}
function newQuestionId() { return "q_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function closeQuizEditor() { const c = document.getElementById("quiz-editor-container"); if (c) c.innerHTML = ""; quizEditingIndex = null; }
// Ctrl+Enter di editor = simpan
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && e.target && e.target.closest && e.target.closest(".quiz-editor-box")) { e.preventDefault(); saveQuizEditor(quizEditingIndex === null); }
});
async function saveQuizEditor(addAnother) {
  const type = document.getElementById("qz-ed-type").value;
  const question = document.getElementById("qz-ed-question").value.trim();
  if (!question) { document.getElementById("quiz-generate-status").textContent = t("quiz.editor.needquestion"); return; }
  const entry = { id: quizEditingIndex !== null && quizBank[quizEditingIndex] ? quizBank[quizEditingIndex].id : newQuestionId(), type, question, modelAnswer: document.getElementById("qz-ed-modelanswer").value.trim() };
  if (type === "mcq") {
    entry.options = Array.from(document.querySelectorAll(".qz-ed-option")).map(i => i.value.trim());
    const r = document.querySelector('input[name="qz-ed-correct"]:checked');
    entry.correct = r ? parseInt(r.value, 10) : 0;
  }
  if (type === "mcq" && entry.options.filter(Boolean).length < 2) { document.getElementById("quiz-generate-status").textContent = t("qz.editor.needoptions"); return; }
  if (quizEditingIndex !== null) quizBank[quizEditingIndex] = entry; else quizBank.push(entry);
  document.getElementById("quiz-generate-status").textContent = "";
  closeQuizEditor();
  await persistQuizBank();
  if (addAnother) openQuizEditor(null, type);
}
document.querySelectorAll("[data-qadd]").forEach(b => b.addEventListener("click", () => openQuizEditor(null, b.dataset.qadd)));
document.getElementById("qz-import-toggle").addEventListener("click", () => { const box = document.getElementById("qz-import-box"); box.hidden = !box.hidden; });
// Tempel banyak soal sekaligus (format: nomor, opsi A-D, "Kunci: X", "Jawaban: ...").
function parseQuizText(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];
  blocks.forEach(block => {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
    const stem = [], opts = [];
    let key = null, answer = "";
    lines.forEach(l => {
      const om = /^([A-Da-d])[.)]\s*(.*)$/.exec(l);
      const km = /^(kunci|key|jawaban benar|answer key)\s*[:=]\s*([A-Da-d])\b/i.exec(l);
      const am = /^(jawaban|answer|pembahasan|model answer)\s*[:=]\s*(.*)$/i.exec(l);
      if (km) key = km[2].toUpperCase().charCodeAt(0) - 65;
      else if (am) answer = am[2];
      else if (om && stem.length) opts[om[1].toUpperCase().charCodeAt(0) - 65] = om[2];
      else if (!opts.length) stem.push(l.replace(/^\d+\s*[.)]\s*/, ""));
    });
    const question = stem.join(" ").trim();
    if (!question) return;
    const filled = opts.filter(o => o !== undefined);
    if (filled.length >= 2) {
      const options = [0, 1, 2, 3].map(i => opts[i] || "");
      out.push({ id: newQuestionId(), type: "mcq", question, options, correct: key != null && key >= 0 && key < 4 ? key : 0, modelAnswer: answer });
    } else {
      out.push({ id: newQuestionId(), type: question.length > 160 ? "essay" : "short", question, modelAnswer: answer });
    }
  });
  return out;
}
document.getElementById("qz-import-btn").addEventListener("click", async () => {
  const ta = document.getElementById("qz-import-text");
  const items = parseQuizText(ta.value);
  const st = document.getElementById("quiz-generate-status");
  if (!items.length) { st.textContent = t("qz.import.none"); return; }
  quizBank = quizBank.concat(items);
  if (await persistQuizBank()) { ta.value = ""; document.getElementById("qz-import-box").hidden = true; st.textContent = t("qz.import.done", { n: items.length }); }
});
document.getElementById("quiz-save-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("quiz-save-status");
  statusEl.textContent = t("quiz.save.saving"); statusEl.classList.remove("unsaved");
  const data = await callBackend("quiz_bank_save", { topicId: document.getElementById("quiz-topic-select").value, questions: quizBank });
  if (data.error) { statusEl.textContent = data.error; statusEl.classList.add("unsaved"); return; }
  quizBank = data.questions || quizBank; quizBankDirty = false;
  renderQuizList(); statusEl.textContent = t("quiz.save.saved");
});
document.getElementById("quiz-publish-btn").addEventListener("click", async () => {
  const statusEl = document.getElementById("quiz-save-status");
  const selected = quizBank.filter(q => quizSelectedIds.has(q.id));
  if (!selected.length) { statusEl.textContent = t("quiz.publish.needselection"); statusEl.classList.add("unsaved"); return; }
  statusEl.textContent = t("quiz.publish.publishing"); statusEl.classList.remove("unsaved");
  const data = await callBackend("quiz_publish", { topicId: document.getElementById("quiz-topic-select").value, questions: selected });
  if (data.error) { statusEl.textContent = data.error; statusEl.classList.add("unsaved"); return; }
  statusEl.textContent = "";
  renderQuizActiveCard(data.quiz);
  loadQuizHistory();
});
function renderQuizActiveCard(quiz) {
  quizLastActive = quiz || null;
  const card = document.getElementById("quiz-active-card"), endBtn = document.getElementById("quiz-end-btn");
  if (!quiz || !quiz.id) { card.hidden = true; endBtn.hidden = true; return; }
  card.hidden = false;
  card.classList.toggle("ended", !quiz.active);
  card.textContent = quiz.active
    ? t("quiz.active.status", { topic: topicTitle(quiz.topicId), count: (quiz.questions || []).length, time: fmtTime(quiz.publishedAt, false) })
    : t("quiz.ended.status", { topic: topicTitle(quiz.topicId), count: (quiz.questions || []).length });
  endBtn.hidden = !quiz.active;
}
document.getElementById("quiz-end-btn").addEventListener("click", async () => {
  const data = await callBackend("quiz_unpublish");
  if (data.error) { document.getElementById("quiz-save-status").textContent = data.error; return; }
  if (quizLastActive) { quizLastActive.active = false; renderQuizActiveCard(quizLastActive); }
  loadQuizHistory();
});
async function loadQuizHistory() {
  const body = document.getElementById("quiz-history-body");
  const data = await callBackend("quiz_list");
  if (data.error) { body.innerHTML = `<tr><td colspan="5" class="muted small">${escapeHtml(data.error)}</td></tr>`; return; }
  const list = (data.quizzes || []).filter(z => z.kind !== "sumatif");
  if (!list.length) { body.innerHTML = `<tr><td colspan="5" class="muted small">${t("quiz.history.empty")}</td></tr>`; return; }
  body.innerHTML = list.map(z => `<tr><td class="num">${fmtTime(z.publishedAt)}${z.active ? ` <span class="pill ok">${t("quiz.history.live")}</span>` : ""}</td><td>${escapeHtml(t("qz.mode.quiz"))} · ${escapeHtml(topicTitle(z.topicId))}</td><td class="num">${z.count == null ? "-" : z.count}</td><td class="num">${z.answers}</td><td><button type="button" class="btn btn-ghost btn-small" data-quiz-results="${escapeAttrT(z.id)}">${t("quiz.history.open")}</button></td></tr>`).join("");
}
document.getElementById("quiz-history-body").addEventListener("click", e => {
  const b = e.target.closest("[data-quiz-results]");
  if (b) openQuizResults(b.dataset.quizResults);
});
async function openQuizResults(quizId) {
  const body = document.getElementById("quiz-results-body");
  body.innerHTML = `<p class="teacher-note">${t("quiz.results.loading")}</p>`;
  document.getElementById("quiz-results-modal").hidden = false;
  const data = await callBackend("quiz_results", quizId ? { quizId } : {});
  if (data.error) { body.innerHTML = `<p class="teacher-note">${escapeHtml(data.error)}</p>`; return; }
  const quiz = data.quiz, answers = data.answers || [];
  if (!quiz || !quiz.id) { body.innerHTML = `<p class="teacher-note">${t("quiz.none.status")}</p>`; return; }
  if (!answers.length) { body.innerHTML = `<p class="teacher-note">${t("quiz.results.empty")}</p>`; return; }
  const qs = quiz.questions || [];
  let html = `<div style="overflow-x:auto"><table class="quiz-results-table"><thead><tr><th>${t("teacher.th.student")}</th><th>${t("teacher.rec.score")}</th>${qs.map((q, i) => `<th title="${escapeAttrT(q.question)}">${t("quiz.modal.question.label", { n: i + 1 })}</th>`).join("")}</tr></thead><tbody>`;
  answers.forEach(a => {
    html += `<tr><td>${escapeHtml(a.studentId)}</td><td>${a.score == null ? "-" : Math.round(a.score) + "%"}</td>`;
    qs.forEach(q => {
      const v = (a.answers || {})[q.id];
      let cell = "-";
      if (v !== undefined && v !== null && v !== "") {
        cell = q.type === "mcq" ? `<span class="${v === q.correct ? "quiz-answer-correct" : "quiz-answer-incorrect"}">${String.fromCharCode(65 + v)}</span>` : escapeHtml(String(v));
      }
      html += `<td>${cell}</td>`;
    });
    html += `</tr>`;
  });
  body.innerHTML = html + `</tbody></table></div>`;
  typeset(body);
}
document.getElementById("quiz-viewresults-btn").addEventListener("click", () => openQuizResults(null));
function closeQuizResults() { document.getElementById("quiz-results-modal").hidden = true; }
document.getElementById("quiz-results-close-btn").addEventListener("click", closeQuizResults);
document.getElementById("quiz-results-close-x").addEventListener("click", closeQuizResults);

/* ---------------- Init ---------------- */
applyStaticI18n();
initLangSwitch();

/* Header transparan (fixed): kaca buram tipis setelah digulir; tinggi header dipakai sebagai offset konten. */
(function () {
  const h = document.getElementById("site-header");
  if (!h) return;
  const sync = () => {
    h.classList.toggle("scrolled", window.scrollY > 8);
    document.documentElement.style.setProperty("--header-h", h.offsetHeight + "px");
  };
  window.addEventListener("scroll", sync, { passive: true });
  window.addEventListener("resize", sync);
  sync();
})();
