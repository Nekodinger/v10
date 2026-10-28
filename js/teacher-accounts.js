/* ============================================================
   teacher-accounts.js - Panel Guru: Siswa & Kelompok
   ------------------------------------------------------------
   Guru mendaftarkan siswa (nama + kelas + kelompok), sistem membuat PIN
   6 angka. Di sini guru juga mengganti ketua, memindah kelompok, reset
   PIN, menonaktifkan akun, melepas kunci perangkat, mencetak kartu login,
   dan mengekspor daftar akun ke Excel.
   Memakai fungsi global dari teacher.js (callBackend, escapeHtml, t, ...).
   ============================================================ */
let accCache = null;
const accSelected = new Set();

function accParseLines(text) {
  return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\t|;/).map(x => x.trim());
    return { name: parts[0] || "", group: parts[1] || "" };
  }).filter(x => x.name);
}

async function loadAccounts() {
  const statusEl = document.getElementById("acc-status");
  statusEl.textContent = t("teacher.records.loading");
  const data = await callBackend("teacher_accounts");
  if (data.error) { statusEl.textContent = data.error; return; }
  accCache = data;
  const classes = [...new Set(data.accounts.map(a => a.className).concat(data.groups.map(g => g.className)))].sort();
  const sel = document.getElementById("acc-class-filter");
  const prev = sel.value;
  sel.innerHTML = `<option value="">${t("teacher.records.allclasses")}</option>` + classes.map(c => `<option value="${escapeAttrT(c)}">${escapeHtml(c)}</option>`).join("");
  if (classes.includes(prev)) sel.value = prev;
  statusEl.textContent = t("acc.loaded", { n: data.accounts.length, g: data.groups.length });
  renderAccounts();
}

function accFiltered() {
  if (!accCache) return { accounts: [], groups: [] };
  const cls = document.getElementById("acc-class-filter").value;
  return {
    accounts: accCache.accounts.filter(a => !cls || a.className === cls),
    groups: accCache.groups.filter(g => !cls || g.className === cls)
  };
}

function accPinCell(a) {
  const show = document.getElementById("acc-show-pin").checked;
  return `<span class="acc-pin">${show ? escapeHtml(a.pin || "-") : "••••••"}</span>`;
}

function accMemberRow(a, groupsInClass, leaderId) {
  return `<tr class="${a.active ? "" : "acc-inactive"}${accSelected.has(a.studentId) ? " acc-selected" : ""}">
    <td class="acc-cb"><input type="checkbox" data-acc-sel="${escapeAttrT(a.studentId)}"${accSelected.has(a.studentId) ? " checked" : ""} aria-label="${escapeAttrT(a.name)}"></td>
    <td><button type="button" class="student-link" data-sid="${escapeAttrT(a.studentId)}">${escapeHtml(a.name)}</button>${a.studentId === leaderId ? ` <span class="pill solid">${t("teacher.rec.leader")}</span>` : ""}${a.active ? "" : ` <span class="pill bad">${t("acc.inactive")}</span>`}</td>
    <td class="num">${accPinCell(a)}</td>
    <td class="num">${a.lastLogin ? relativeTime(a.lastLogin) : `<span class="muted">${t("acc.neverlogin")}</span>`}</td>
    <td><div class="acc-actions">
      <button type="button" class="btn btn-ghost btn-small" data-acc-reset="${escapeAttrT(a.studentId)}">${t("acc.resetpin")}</button>
      <button type="button" class="btn btn-ghost btn-small" data-acc-active="${escapeAttrT(a.studentId)}" data-val="${a.active ? "0" : "1"}">${a.active ? t("acc.deactivate") : t("acc.activate")}</button>
    </div></td>
  </tr>`;
}

function renderAccounts() {
  const box = document.getElementById("acc-groups");
  const { accounts, groups } = accFiltered();
  if (!accounts.length && !groups.length) { box.innerHTML = `<p class="muted small">${t("acc.empty")}</p>`; accUpdateBulk(); return; }
  const locks = (accCache.locks || []);
  const classes = [...new Set(accounts.map(a => a.className).concat(groups.map(g => g.className)))].sort();
  const head = `<thead><tr><th class="acc-cb"></th><th>${t("teacher.rec.student")}</th><th>PIN</th><th>${t("acc.lastlogin")}</th><th>${t("teacher.gate.th.action")}</th></tr></thead>`;
  box.innerHTML = classes.map(cls => {
    const gs = groups.filter(g => g.className === cls);
    const inCls = accounts.filter(a => a.className === cls);
    const cards = gs.map(g => {
      const mem = inCls.filter(a => a.groupId === g.groupId);
      const lk = locks.filter(l => l.groupId === g.groupId);
      const lockTxt = lk.length
        ? lk.map(l => `${l.section === "lab" ? t("tab.lab") : t("tab.eksperimen")}: ${escapeHtml((accounts.find(a => a.studentId === l.studentId) || {}).name || l.studentId)} · ${fmtTime(l.since, false)}`).join(" · ")
        : t("acc.nolock");
      const leaderOpts = [`<option value="">${t("acc.noleader")}</option>`].concat(mem.filter(m => m.active).map(m => `<option value="${escapeAttrT(m.studentId)}"${m.studentId === g.leaderId ? " selected" : ""}>${escapeHtml(m.name)}</option>`)).join("");
      return `<div class="acc-group">
        <div class="acc-group-head">
          <h4><label class="acc-check"><input type="checkbox" data-acc-selgroup="${escapeAttrT(g.groupId)}"${mem.length && mem.every(m => accSelected.has(m.studentId)) ? " checked" : ""}${mem.length ? "" : " disabled"} aria-label="${escapeAttrT(t("acc.bulk.selgroup") + " " + g.name)}"> ${escapeHtml(g.name)}</label> <span class="muted small">· ${mem.length} ${t("acc.members")}</span></h4>
          <label class="acc-leader"><span>${t("acc.leader")}</span><select data-group-leader="${escapeAttrT(g.groupId)}">${leaderOpts}</select></label>
        </div>
        <p class="small acc-lock ${lk.length ? "on" : ""}"><span class="status-dot ${lk.length ? "online" : ""}"></span>${t("acc.lockstatus")}: ${lockTxt}
          ${lk.length ? `<button type="button" class="btn btn-secondary btn-small" data-group-unlock="${escapeAttrT(g.groupId)}">${t("acc.unlock")}</button>` : ""}
          <button type="button" class="link-btn small" data-group-delete="${escapeAttrT(g.groupId)}">${t("acc.deletegroup")}</button></p>
        <div class="t-table-wrap"><table class="t-table">${head}<tbody>${mem.map(a => accMemberRow(a, gs, g.leaderId)).join("") || `<tr><td colspan="5" class="muted small">${t("acc.groupempty")}</td></tr>`}</tbody></table></div>
      </div>`;
    }).join("");
    const lone = inCls.filter(a => !a.groupId || !gs.find(g => g.groupId === a.groupId));
    const loneCard = lone.length ? `<div class="acc-group acc-lone"><div class="acc-group-head"><h4><label class="acc-check"><input type="checkbox" data-acc-sellone="${escapeAttrT(cls)}"${lone.every(m => accSelected.has(m.studentId)) ? " checked" : ""}> ${t("acc.nogroup")}</label></h4></div>
      <p class="muted small">${t("acc.nogroup.desc")}</p>
      <div class="t-table-wrap"><table class="t-table">${head}<tbody>${lone.map(a => accMemberRow(a, gs, null)).join("")}</tbody></table></div></div>` : "";
    return `<section class="acc-class"><h3 class="acc-class-title">${t("field.class")} ${escapeHtml(cls)}</h3>${cards}${loneCard}</section>`;
  }).join("");
  accUpdateBulk();
}

/* ---------- Pilih banyak siswa: hapus / pindah kelompok / pindah kelas ---------- */
function accVisibleIds() { return accFiltered().accounts.map(a => a.studentId); }
function accUpdateBulk() {
  if (!accCache) return;
  const known = new Set(accCache.accounts.map(a => a.studentId));
  [...accSelected].forEach(id => { if (!known.has(id)) accSelected.delete(id); });
  const vis = accVisibleIds();
  const all = document.getElementById("acc-select-all");
  const nSel = vis.filter(id => accSelected.has(id)).length;
  all.checked = vis.length > 0 && nSel === vis.length;
  all.indeterminate = nSel > 0 && nSel < vis.length;
  document.getElementById("acc-bulk-count").textContent = t("acc.bulk.count", { n: accSelected.size });
  const act = document.getElementById("acc-bulk-action").value;
  document.getElementById("acc-bulk-class").hidden = act !== "class";
  document.getElementById("acc-bulk-group").hidden = act !== "group" && act !== "class";
  document.getElementById("acc-bulk-apply").disabled = !accSelected.size || !act;
  document.getElementById("acc-bulk-apply").classList.toggle("btn-danger", act === "delete");
  // saran isian: kelas yang ada, kelompok di kelas tujuan
  const classes = [...new Set(accCache.accounts.map(a => a.className).concat(accCache.groups.map(g => g.className)))].sort();
  document.getElementById("acc-bulk-class-list").innerHTML = classes.map(c => `<option value="${escapeAttrT(c)}">`).join("");
  const selCls = [...new Set(accCache.accounts.filter(a => accSelected.has(a.studentId)).map(a => a.className))];
  const target = act === "class" ? document.getElementById("acc-bulk-class").value.trim() : (selCls.length === 1 ? selCls[0] : "");
  document.getElementById("acc-bulk-group-list").innerHTML = accCache.groups.filter(g => !target || g.className === target).map(g => `<option value="${escapeAttrT(g.name)}">`).join("");
}
function accSetSel(ids, on) { ids.forEach(id => on ? accSelected.add(id) : accSelected.delete(id)); renderAccounts(); }
document.getElementById("acc-select-all").addEventListener("change", e => accSetSel(accVisibleIds(), e.target.checked));
document.getElementById("acc-bulk-action").addEventListener("change", accUpdateBulk);
document.getElementById("acc-bulk-class").addEventListener("input", accUpdateBulk);
document.getElementById("acc-bulk-apply").addEventListener("click", async () => {
  const act = document.getElementById("acc-bulk-action").value;
  const ids = [...accSelected];
  if (!ids.length || !act) return;
  const names = accCache.accounts.filter(a => accSelected.has(a.studentId)).map(a => a.name);
  const list = names.slice(0, 8).join(", ") + (names.length > 8 ? ` +${names.length - 8}` : "");
  const body = { studentIds: ids };
  let msg;
  if (act === "delete") {
    body.action = "delete";
    if (!confirm(t("acc.bulk.delete.confirm", { n: ids.length, list }))) return;
    msg = "acc.bulk.deleted";
  } else {
    body.action = "move";
    const grp = document.getElementById("acc-bulk-group").value.trim();
    if (act === "class") {
      const cls = document.getElementById("acc-bulk-class").value.trim();
      if (!cls) { document.getElementById("acc-status").textContent = t("acc.bulk.needclass"); return; }
      body.className = cls; body.groupName = grp;
      if (!confirm(t("acc.bulk.class.confirm", { n: ids.length, cls, list }))) return;
    } else {
      body.groupName = grp;
      if (!confirm(t(grp ? "acc.bulk.group.confirm" : "acc.bulk.nogroup.confirm", { n: ids.length, grp, list }))) return;
    }
    msg = "acc.bulk.moved";
  }
  const d = await accAction("teacher_accounts_bulk", body);
  if (d && !d.error) {
    accSelected.clear();
    document.getElementById("acc-bulk-action").value = "";
    document.getElementById("acc-bulk-class").value = "";
    document.getElementById("acc-bulk-group").value = "";
    renderAccounts();
    document.getElementById("acc-status").textContent = t(msg, { n: d.done.length }) + (d.skipped && d.skipped.length ? " " + t("acc.add.skipped", { list: d.skipped.map(x => x.reason).join("; ") }) : "");
  }
});

async function accAction(mode, body, okMsg) {
  const statusEl = document.getElementById("acc-status");
  statusEl.textContent = t("teacher.gate.deciding");
  const data = await callBackend(mode, body);
  if (data.error) { statusEl.textContent = data.error; return data; }
  await loadAccounts();
  if (okMsg) statusEl.textContent = okMsg;
  return data;
}

document.getElementById("acc-add-btn").addEventListener("click", async () => {
  const cls = document.getElementById("acc-add-class").value.trim();
  const lines = accParseLines(document.getElementById("acc-add-lines").value);
  const statusEl = document.getElementById("acc-add-status");
  if (!cls) { statusEl.textContent = t("acc.add.needclass"); return; }
  if (!lines.length) { statusEl.textContent = t("acc.add.needlines"); return; }
  statusEl.textContent = t("acc.add.saving");
  const btn = document.getElementById("acc-add-btn");
  btn.disabled = true;
  const data = await callBackend("teacher_accounts_add", { lines: lines.map(l => ({ name: l.name, className: cls, group: l.group })) });
  btn.disabled = false;
  if (data.error) { statusEl.textContent = data.error; return; }
  statusEl.className = "onboarding-status ok";
  statusEl.textContent = t("acc.add.done", { n: data.created.length }) + (data.skipped.length ? " " + t("acc.add.skipped", { list: data.skipped.map(x => x.reason).join("; ") }) : "");
  document.getElementById("acc-add-lines").value = "";
  document.getElementById("acc-class-filter").value = cls;
  await loadAccounts();
  document.getElementById("acc-class-filter").value = cls;
  renderAccounts();
});

document.getElementById("acc-groups").addEventListener("click", async e => {
  const reset = e.target.closest("[data-acc-reset]");
  if (reset) {
    if (!confirm(t("acc.resetpin.confirm"))) return;
    const d = await accAction("teacher_account_update", { studentId: reset.dataset.accReset, resetPin: true });
    if (d && d.pin) document.getElementById("acc-status").textContent = t("acc.resetpin.done", { pin: d.pin });
    return;
  }
  const act = e.target.closest("[data-acc-active]");
  if (act) { await accAction("teacher_account_update", { studentId: act.dataset.accActive, active: act.dataset.val === "1" }); return; }
  const unlock = e.target.closest("[data-group-unlock]");
  if (unlock) { await accAction("teacher_group_update", { groupId: unlock.dataset.groupUnlock, unlock: true }, t("acc.unlock.done")); return; }
  const gdel = e.target.closest("[data-group-delete]");
  if (gdel) {
    if (!confirm(t("acc.deletegroup.confirm"))) return;
    await accAction("teacher_group_update", { groupId: gdel.dataset.groupDelete, delete: true });
  }
});
document.getElementById("acc-groups").addEventListener("change", async e => {
  const leader = e.target.closest("[data-group-leader]");
  if (leader) { await accAction("teacher_group_update", { groupId: leader.dataset.groupLeader, leaderId: leader.value }, t("acc.leader.done")); return; }
  const sel = e.target.closest("[data-acc-sel]");
  if (sel) { accSetSel([sel.dataset.accSel], sel.checked); return; }
  const sg = e.target.closest("[data-acc-selgroup]");
  if (sg) { accSetSel(accFiltered().accounts.filter(a => a.groupId === sg.dataset.accSelgroup).map(a => a.studentId), sg.checked); return; }
  const sl = e.target.closest("[data-acc-sellone]");
  if (sl) {
    const gids = new Set(accCache.groups.filter(g => g.className === sl.dataset.accSellone).map(g => g.groupId));
    accSetSel(accFiltered().accounts.filter(a => a.className === sl.dataset.accSellone && (!a.groupId || !gids.has(a.groupId))).map(a => a.studentId), sl.checked);
  }
});
document.getElementById("acc-class-filter").addEventListener("change", renderAccounts);
document.getElementById("acc-show-pin").addEventListener("change", renderAccounts);
document.getElementById("acc-refresh-btn").addEventListener("click", loadAccounts);

function accRowsForExport() {
  const { accounts, groups } = accFiltered();
  return accounts.map(a => {
    const g = groups.find(x => x.groupId === a.groupId) || (accCache.groups || []).find(x => x.groupId === a.groupId);
    return { a, g, leader: !!(g && g.leaderId === a.studentId) };
  }).sort((x, y) => x.a.className.localeCompare(y.a.className) || (x.g ? x.g.name : "~").localeCompare(y.g ? y.g.name : "~") || (y.leader - x.leader) || x.a.name.localeCompare(y.a.name));
}

document.getElementById("acc-print-btn").addEventListener("click", () => {
  const rows = accRowsForExport().filter(r => r.a.active);
  if (!rows.length) { document.getElementById("acc-status").textContent = t("acc.empty"); return; }
  const origin = location.origin + location.pathname.replace(/teacher\.html$/, "");
  const esc = escapeHtml;
  const cards = rows.map(({ a, g, leader }) => `<div class="card">
      <div class="top"><img src="${origin}assets/logo-96.png" alt=""><div><b>Emergent</b><small>${esc(t("acc.card.sub"))}</small></div></div>
      <div class="k">${esc(t("field.fullname"))}</div><div class="v">${esc(a.name)}</div>
      <div class="row"><div><div class="k">${esc(t("field.class"))}</div><div class="v sm">${esc(a.className)}</div></div>
      <div><div class="k">${esc(t("settings.identity.group"))}</div><div class="v sm">${g ? esc(g.name) + (leader ? " · " + esc(t("teacher.rec.leader")) : "") : "-"}</div></div></div>
      <div class="k">PIN</div><div class="pin">${esc(a.pin || "------")}</div>
      <div class="url">${esc(origin.replace(/^https?:\/\//, "").replace(/\/$/, ""))}</div>
    </div>`).join("");
  const w = window.open("", "_blank");
  if (!w) { document.getElementById("acc-status").textContent = t("acc.print.blocked"); return; }
  w.document.write(`<!doctype html><html lang="${getLang()}"><head><meta charset="utf-8"><title>${esc(t("acc.print.title"))}</title>
    <style>
      @page { size: A4; margin: 10mm; }
      body { font-family: "Inter", "Segoe UI", Arial, sans-serif; color: #0B104A; margin: 0; }
      .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; }
      .card { border: 1.5px dashed #9AA0C8; border-radius: 10px; padding: 4mm 5mm; break-inside: avoid; }
      .top { display: flex; align-items: center; gap: 3mm; margin-bottom: 3mm; }
      .top img { width: 12mm; height: 12mm; border-radius: 50%; }
      .top b { display: block; font-size: 15pt; } .top small { color: #6B7080; font-size: 8pt; }
      .k { font-size: 7.5pt; color: #6B7080; text-transform: uppercase; letter-spacing: .04em; margin-top: 2mm; }
      .v { font-size: 12pt; font-weight: 700; } .v.sm { font-size: 10pt; }
      .row { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; }
      .pin { font-size: 22pt; font-weight: 700; letter-spacing: .25em; color: #525FE1; }
      .url { margin-top: 2mm; font-size: 8pt; color: #6B7080; }
    </style></head><body><div class="grid">${cards}</div>
    <script>window.onload = () => setTimeout(() => window.print(), 300);<\/script></body></html>`);
  w.document.close();
});

document.getElementById("acc-xlsx-btn").addEventListener("click", () => {
  if (!window.XLSX) return;
  const rows = accRowsForExport().map(({ a, g, leader }) => ({
    [t("field.class")]: a.className, [t("settings.identity.group")]: g ? g.name : "", [t("acc.leader")]: leader ? t("acc.yes") : "",
    [t("field.fullname")]: a.name, PIN: a.pin || "", Status: a.active ? t("acc.active") : t("acc.inactive"),
    [t("acc.lastlogin")]: a.lastLogin ? new Date(a.lastLogin).toLocaleString(getLang() === "en" ? "en-GB" : "id-ID") : ""
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [{ wch: 12 }, { wch: 14 }, { wch: 8 }, { wch: 28 }, { wch: 9 }, { wch: 10 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, ws, t("acc.xlsx.sheet"));
  XLSX.writeFile(wb, `akun-siswa-emergent-${new Date().toISOString().slice(0, 10)}.xlsx`);
});
