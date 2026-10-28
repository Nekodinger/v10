/* ============================================================
   admin.js - Panel Admin (V10)
   ------------------------------------------------------------
   Satu akun admin. Tugasnya:
     01 Akun Guru       : buat, ubah, nonaktifkan, reset kata sandi,
                          hapus (data dipindahkan), serahkan data lama.
     02 Pemakaian Token : total, per fitur, per guru, per akun, per hari.
     03 Pengaturan      : ganti kata sandi admin.
   Token admin disimpan di sessionStorage (hilang saat tab ditutup).
   ============================================================ */
(function () {
  const KEY = "emergent.adminToken";
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let teachers = [];
  let usage = null;
  let editId = null, deleteId = null;

  function getToken() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return ""; } }
  function setToken(v) { try { if (v) sessionStorage.setItem(KEY, v); else sessionStorage.removeItem(KEY); } catch (e) { /* abaikan */ } }
  async function call(mode, body) {
    let data;
    try { data = await apiCall(mode, Object.assign({ adminToken: getToken() }, body || {})); }
    catch (e) { return { error: e.message }; }
    if (data && data.code === "ADMIN_AUTH" && mode !== "admin_login") showLogin(data.error);
    return data;
  }
  const loc = () => (getLang() === "en" ? "en-GB" : "id-ID");
  const fmtN = n => Number(n || 0).toLocaleString(loc());
  function fmtTok(n) {
    n = Number(n || 0);
    if (n >= 1e6) return (n / 1e6).toLocaleString(loc(), { maximumFractionDigits: 2 }) + (getLang() === "en" ? "M" : " jt");
    if (n >= 1e4) return (n / 1e3).toLocaleString(loc(), { maximumFractionDigits: 1 }) + (getLang() === "en" ? "k" : "rb");
    return fmtN(n);
  }
  function fmtTime(ms) { return ms ? new Date(Number(ms)).toLocaleString(loc(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "-"; }

  /* ---------------- login ---------------- */
  function showLogin(msg) {
    setToken("");
    $("admin-login-card").hidden = false;
    $("admin-panel").hidden = true;
    $("admin-logout-btn").hidden = true;
    if (msg) $("admin-login-status").textContent = msg;
  }
  async function enter(mustChange) {
    const me = await call("admin_me");
    if (me.error) return me;
    $("admin-login-card").hidden = true;
    $("admin-panel").hidden = false;
    $("admin-logout-btn").hidden = false;
    $("admin-mustchange").hidden = !mustChange;
    loadTeachers();
    return me;
  }
  async function login() {
    const st = $("admin-login-status");
    const u = $("admin-username-input").value.trim(), p = $("admin-password-input").value;
    if (!u || !p) { st.textContent = t("tl.login.need"); return; }
    st.textContent = t("teacher.login.checking");
    const r = await call("admin_login", { username: u, password: p });
    if (r.error) { st.textContent = r.error; return; }
    setToken(r.token);
    $("admin-password-input").value = "";
    try { sessionStorage.setItem(KEY + ".mc", r.mustChange ? "1" : ""); } catch (e) { /* abaikan */ }
    const me = await enter(r.mustChange);
    if (me.error) st.textContent = me.error; else st.textContent = "";
  }
  $("admin-login-btn").addEventListener("click", login);
  ["admin-username-input", "admin-password-input"].forEach(id => $(id).addEventListener("keydown", e => { if (e.key === "Enter") login(); }));
  $("admin-logout-btn").addEventListener("click", () => { setToken(""); location.reload(); });

  document.querySelectorAll(".t-tab").forEach(btn => btn.addEventListener("click", () => {
    document.querySelectorAll(".t-tab").forEach(b => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".t-pane").forEach(p => p.classList.toggle("active", p.id === "pane-" + btn.dataset.pane));
    if (btn.dataset.pane === "usage") loadUsage();
    if (btn.dataset.pane === "teachers") loadTeachers();
  }));
  document.querySelectorAll("[data-close-modal]").forEach(b => b.addEventListener("click", () => { $(b.dataset.closeModal).hidden = true; }));

  /* ---------------- 01 akun guru ---------------- */
  function secretBox(title, username, password) {
    const box = $("adm-secret");
    box.hidden = false;
    box.innerHTML = `<p><strong>${esc(title)}</strong></p>
      <p class="small">${esc(t("tl.username"))}: <code>${esc(username)}</code><br>${esc(t("tl.password"))}: <code id="adm-secret-pw">${esc(password)}</code></p>
      <p class="muted small">${esc(t("admin.secret.note"))}</p>
      <button type="button" class="btn btn-ghost btn-small" id="adm-secret-copy">${esc(t("admin.secret.copy"))}</button>`;
    $("adm-secret-copy").addEventListener("click", () => {
      const text = `${t("tl.username")}: ${username}\n${t("tl.password")}: ${password}\n${location.origin}${location.pathname.replace(/admin\.html$/, "")}teacher.html`;
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => { $("adm-secret-copy").textContent = t("admin.secret.copied"); }).catch(() => {});
    });
  }
  async function loadTeachers() {
    const body = $("adm-teachers-body");
    const data = await call("admin_teachers");
    if (data.error) { body.innerHTML = `<tr><td colspan="5" class="muted small">${esc(data.error)}</td></tr>`; return; }
    teachers = data.teachers || [];
    body.innerHTML = teachers.length ? teachers.map(tc => `<tr>
        <td><strong>${esc(tc.name)}</strong><div class="muted small">${esc(tc.username)}</div></td>
        <td>${tc.active ? `<span class="pill ok">${esc(t("admin.st.active"))}</span>` : `<span class="pill bad">${esc(t("admin.st.inactive"))}</span>`}${tc.sessionActive ? ` <span class="pill solid">${esc(t("admin.st.session"))}</span>` : ""}</td>
        <td class="num">${fmtN(tc.students)}<div class="muted small">${esc(t("admin.counts", { classes: tc.classes, groups: tc.groups }))}</div></td>
        <td class="num">${fmtTime(tc.lastLogin)}</td>
        <td class="admin-actions">
          <button type="button" class="btn btn-ghost btn-small" data-tact="edit" data-id="${esc(tc.teacherId)}">${esc(t("admin.act.edit"))}</button>
          <button type="button" class="btn btn-ghost btn-small" data-tact="reset" data-id="${esc(tc.teacherId)}">${esc(t("admin.act.reset"))}</button>
          <button type="button" class="btn btn-ghost btn-small" data-tact="toggle" data-id="${esc(tc.teacherId)}">${esc(tc.active ? t("admin.act.deactivate") : t("admin.act.activate"))}</button>
          <button type="button" class="btn btn-ghost btn-small danger" data-tact="delete" data-id="${esc(tc.teacherId)}">${esc(t("admin.act.delete"))}</button>
        </td></tr>`).join("") : `<tr><td colspan="5" class="muted small">${esc(t("admin.list.empty"))}</td></tr>`;
    const lg = data.legacy || {};
    const hasLegacy = (lg.accounts || 0) + (lg.groups || 0) + (lg.quizzes || 0) > 0;
    $("adm-legacy-card").hidden = !hasLegacy || !teachers.length;
    if (hasLegacy) {
      $("adm-legacy-desc").textContent = t("admin.legacy.desc", { accounts: lg.accounts || 0, groups: lg.groups || 0, quizzes: lg.quizzes || 0 });
      $("adm-legacy-select").innerHTML = teachers.map(tc => `<option value="${esc(tc.teacherId)}">${esc(tc.name)} (${esc(tc.username)})</option>`).join("");
    }
  }
  $("adm-teachers-refresh").addEventListener("click", loadTeachers);
  $("adm-create-btn").addEventListener("click", async () => {
    const st = $("adm-create-status");
    const name = $("adm-new-name").value.trim(), username = $("adm-new-username").value.trim().toLowerCase(), password = $("adm-new-password").value;
    $("adm-secret").hidden = true;
    if (!name || !username) { st.textContent = t("admin.create.need"); return; }
    st.textContent = t("admin.saving");
    const r = await call("admin_teacher_create", { name, username, password: password || undefined });
    if (r.error) { st.textContent = r.error; return; }
    st.textContent = t("admin.create.done", { name: r.teacher.name });
    ["adm-new-name", "adm-new-username", "adm-new-password"].forEach(id => { $(id).value = ""; });
    secretBox(t("admin.secret.title"), r.teacher.username, r.password || password);
    loadTeachers();
  });
  $("adm-teachers-body").addEventListener("click", async e => {
    const b = e.target.closest("[data-tact]");
    if (!b) return;
    const tc = teachers.find(x => x.teacherId === b.dataset.id);
    if (!tc) return;
    const st = $("adm-list-status");
    if (b.dataset.tact === "edit") {
      editId = tc.teacherId;
      $("adm-edit-name").value = tc.name; $("adm-edit-username").value = tc.username; $("adm-edit-status").textContent = "";
      $("adm-edit-modal").hidden = false;
    } else if (b.dataset.tact === "reset") {
      if (!confirm(t("admin.reset.confirm", { name: tc.name }))) return;
      st.textContent = t("admin.saving");
      const r = await call("admin_teacher_update", { teacherId: tc.teacherId, resetPassword: true });
      if (r.error) { st.textContent = r.error; return; }
      st.textContent = "";
      secretBox(t("admin.secret.reset", { name: tc.name }), r.teacher.username, r.password);
      $("adm-secret").scrollIntoView({ behavior: "smooth", block: "center" });
    } else if (b.dataset.tact === "toggle") {
      if (tc.active && !confirm(t("admin.deactivate.confirm", { name: tc.name }))) return;
      st.textContent = t("admin.saving");
      const r = await call("admin_teacher_update", { teacherId: tc.teacherId, active: !tc.active });
      st.textContent = r.error || "";
      loadTeachers();
    } else if (b.dataset.tact === "delete") {
      deleteId = tc.teacherId;
      $("adm-delete-desc").textContent = t("admin.delete.desc", { name: tc.name, n: tc.students });
      $("adm-delete-target").innerHTML = `<option value="">${esc(t("admin.delete.none"))}</option>` + teachers.filter(x => x.teacherId !== tc.teacherId).map(x => `<option value="${esc(x.teacherId)}">${esc(x.name)} (${esc(x.username)})</option>`).join("");
      $("adm-delete-status").textContent = "";
      $("adm-delete-modal").hidden = false;
    }
  });
  $("adm-edit-save").addEventListener("click", async () => {
    const st = $("adm-edit-status");
    st.textContent = t("admin.saving");
    const r = await call("admin_teacher_update", { teacherId: editId, name: $("adm-edit-name").value.trim(), username: $("adm-edit-username").value.trim().toLowerCase() });
    if (r.error) { st.textContent = r.error; return; }
    $("adm-edit-modal").hidden = true;
    loadTeachers();
  });
  $("adm-delete-confirm").addEventListener("click", async () => {
    const st = $("adm-delete-status");
    st.textContent = t("admin.saving");
    const r = await call("admin_teacher_delete", { teacherId: deleteId, targetTeacherId: $("adm-delete-target").value || undefined });
    if (r.error) { st.textContent = r.error; return; }
    $("adm-delete-modal").hidden = true;
    loadTeachers();
  });
  $("adm-legacy-btn").addEventListener("click", async () => {
    const tid = $("adm-legacy-select").value, st = $("adm-legacy-status");
    const tc = teachers.find(x => x.teacherId === tid);
    if (!tc || !confirm(t("admin.legacy.confirm", { name: tc.name }))) return;
    st.textContent = t("admin.saving");
    const r = await call("admin_assign_legacy", { teacherId: tid });
    if (r.error) { st.textContent = r.error; return; }
    st.textContent = t("admin.legacy.done", { accounts: r.accounts, groups: r.groups, quizzes: r.quizzes });
    loadTeachers();
  });

  /* ---------------- 02 pemakaian token ---------------- */
  function kindLabel(k) {
    const map = { chat: "teacher.usage.k.chat", simulate: "teacher.usage.k.simulate", edit: "teacher.usage.k.edit", continue: "admin.k.continue", datacheck: "teacher.usage.k.datacheck" };
    return map[k] ? t(map[k]) : k;
  }
  function teacherName(id) {
    if (!id) return t("admin.noteacher");
    const tc = usage && usage.teachers[id];
    return tc ? tc.name : id;
  }
  function accountLabel(a) {
    if (a.accountKind === "teacher") return { name: teacherName(a.accountId), sub: t("admin.kind.teacher") };
    if (a.accountKind === "guest") return { name: t("admin.kind.guest"), sub: a.accountId };
    const acc = usage.accounts[a.accountId];
    return acc ? { name: acc.name, sub: acc.className || "" } : { name: a.accountId, sub: t("admin.kind.deleted") };
  }
  async function loadUsage() {
    $("adm-stats").innerHTML = `<p class="teacher-note">${esc(t("ts.loading"))}</p>`;
    const data = await call("admin_usage", { period: $("adm-period").value });
    if (data.error) { $("adm-stats").innerHTML = `<p class="teacher-note">${esc(data.error)}</p>`; return; }
    usage = data;
    renderUsage();
  }
  function renderUsage() {
    const d = usage, T = d.total;
    $("adm-ai-status").innerHTML = d.ai ? `<span class="pill ok">${esc(t("teacher.usage.aiok"))}</span>` : `<span class="pill bad">${esc(t("teacher.usage.aino"))}</span>`;
    const students = d.byAccount.filter(a => a.accountKind === "student").length;
    const stats = [
      [t("admin.stat.tokens"), fmtTok(T.input + T.output), t("admin.stat.tokens.sub", { inp: fmtTok(T.input), out: fmtTok(T.output) })],
      [t("admin.stat.requests"), fmtN(T.requests), t("admin.stat.requests.sub", { n: fmtN(students) })],
      [t("admin.stat.cache"), fmtTok(T.cacheRead), t("admin.stat.cache.sub", { n: fmtTok(T.cacheWrite) })],
      [t("admin.stat.avg"), T.requests ? fmtTok(Math.round((T.input + T.output) / T.requests)) : "-", t("admin.stat.avg.sub")]
    ];
    $("adm-stats").innerHTML = stats.map(s => `<div class="admin-stat"><span class="admin-stat-label">${esc(s[0])}</span><strong>${esc(s[1])}</strong><span class="muted small">${esc(s[2])}</span></div>`).join("");

    const tot = r => r.input + r.output;
    const bt = d.byTeacher.slice().sort((a, b) => tot(b) - tot(a));
    $("adm-byteacher").innerHTML = bt.length ? bt.map(r => `<tr><td>${esc(teacherName(r.teacherId))}</td><td class="num">${fmtN(r.requests)}</td><td class="num">${fmtTok(r.input)}</td><td class="num">${fmtTok(r.output)}</td><td class="num"><strong>${fmtTok(tot(r))}</strong></td></tr>`).join("") : `<tr><td colspan="5" class="muted small">${esc(t("admin.usage.empty"))}</td></tr>`;

    const kinds = new Set(["chat", "simulate", "edit", "datacheck"]);
    d.byKind.forEach(r => kinds.add(r.kind));
    $("adm-bykind").innerHTML = [...kinds].map(k => {
      const r = d.byKind.find(x => x.kind === k) || { requests: 0, input: 0, output: 0 };
      const lim = d.limits[k], today = d.today[k] || 0;
      return `<tr><td>${esc(kindLabel(k))}</td><td class="num">${fmtN(r.requests)}</td><td class="num">${fmtTok(tot(r))}</td><td class="num">${lim ? `${fmtN(today)} / ${fmtN(lim.global)}<div class="muted small">${esc(t("admin.perstudent", { n: lim.perStudent }))}</div>` : fmtN(today)}</td></tr>`;
    }).join("");
    $("adm-models").textContent = d.models ? t("admin.models", { chat: d.models.chat, sim: d.models.sim }) : "";

    const days = d.byDay;
    const max = Math.max(1, ...days.map(tot));
    $("adm-byday").innerHTML = days.length ? days.map(r => `<div class="admin-bar-row"><span class="admin-bar-day">${esc(r.day.slice(5))}</span><span class="admin-bar"><span style="width:${Math.max(2, Math.round(tot(r) / max * 100))}%"></span></span><span class="admin-bar-val">${fmtTok(tot(r))}</span></div>`).join("") : `<p class="muted small">${esc(t("admin.usage.empty"))}</p>`;

    const sel = $("adm-acc-teacher"), keep = sel.value;
    const ids = Object.keys(d.teachers);
    sel.innerHTML = `<option value="">${esc(t("admin.allteachers"))}</option>` + ids.map(id => `<option value="${esc(id)}">${esc(d.teachers[id].name)}</option>`).join("") + `<option value="-">${esc(t("admin.noteacher"))}</option>`;
    if (keep) sel.value = keep;
    renderAccounts();
  }
  function filteredAccounts() {
    if (!usage) return [];
    const tf = $("adm-acc-teacher").value, qs = $("adm-acc-search").value.trim().toLowerCase();
    return usage.byAccount.filter(a => {
      if (tf === "-" && a.teacherId) return false;
      if (tf && tf !== "-" && a.teacherId !== tf) return false;
      if (qs) { const L = accountLabel(a); if (!(L.name + " " + L.sub).toLowerCase().includes(qs)) return false; }
      return true;
    });
  }
  function renderAccounts() {
    const list = filteredAccounts();
    $("adm-byaccount").innerHTML = list.length ? list.slice(0, 400).map(a => {
      const L = accountLabel(a);
      return `<tr><td><strong>${esc(L.name)}</strong><div class="muted small">${esc(L.sub)}</div></td><td>${esc(teacherName(a.teacherId))}</td><td class="num">${fmtN(a.requests)}</td><td class="num">${fmtTok(a.chatTokens)}</td><td class="num">${fmtTok(a.simTokens)}</td><td class="num">${fmtTok(a.checkTokens)}</td><td class="num"><strong>${fmtTok(a.input + a.output)}</strong></td><td class="num">${fmtTime(a.lastAt)}</td></tr>`;
    }).join("") : `<tr><td colspan="8" class="muted small">${esc(t("admin.usage.empty"))}</td></tr>`;
  }
  $("adm-period").addEventListener("change", loadUsage);
  $("adm-usage-refresh").addEventListener("click", loadUsage);
  $("adm-acc-teacher").addEventListener("change", renderAccounts);
  $("adm-acc-search").addEventListener("input", renderAccounts);
  $("adm-usage-csv").addEventListener("click", () => {
    if (!usage) return;
    const q = v => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const rows = [["account", "class_or_kind", "teacher", "requests", "input_tokens", "output_tokens", "cache_read_tokens", "chat_tokens", "simulation_tokens", "datacheck_tokens", "last_used"]];
    filteredAccounts().forEach(a => { const L = accountLabel(a); rows.push([L.name, L.sub, teacherName(a.teacherId), a.requests, a.input, a.output, a.cacheRead, a.chatTokens, a.simTokens, a.checkTokens, a.lastAt ? new Date(Number(a.lastAt)).toISOString() : ""]); });
    const blob = new Blob(["﻿" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `emergent-token-${usage.period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });

  /* ---------------- 03 pengaturan ---------------- */
  $("adm-pw-save").addEventListener("click", async () => {
    const st = $("adm-pw-status");
    const cur = $("adm-pw-current").value, next = $("adm-pw-next").value, rep = $("adm-pw-repeat").value;
    if (next !== rep) { st.textContent = t("admin.pw.mismatch"); return; }
    st.textContent = t("admin.saving");
    const r = await call("admin_change_password", { current: cur, next });
    if (r.error) { st.textContent = r.error; return; }
    setToken(r.token);
    ["adm-pw-current", "adm-pw-next", "adm-pw-repeat"].forEach(id => { $(id).value = ""; });
    try { sessionStorage.removeItem(KEY + ".mc"); } catch (e) { /* abaikan */ }
    $("admin-mustchange").hidden = true;
    st.textContent = t("tl.pw.saved");
  });

  /* ---------------- init ---------------- */
  applyStaticI18n();
  initLangSwitch();
  if (getToken()) {
    let mc = false;
    try { mc = sessionStorage.getItem(KEY + ".mc") === "1"; } catch (e) { /* abaikan */ }
    enter(mc).then(d => { if (d && d.error) showLogin(""); });
  }
  (function () {
    const h = $("site-header");
    if (!h) return;
    const sync = () => { h.classList.toggle("scrolled", window.scrollY > 8); document.documentElement.style.setProperty("--header-h", h.offsetHeight + "px"); };
    window.addEventListener("scroll", sync, { passive: true });
    window.addEventListener("resize", sync);
    sync();
  })();
})();
