/* ============================================================
   tests/e2e.mjs - uji ujung-ke-ujung V9 di browser (Playwright)
   Menjalankan tests/dev-server.mjs (PGlite + mock Claude) lalu
   menelusuri alur siswa dan guru. Jalankan: node tests/e2e.mjs
   ============================================================ */
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4710, BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(ROOT, "tests", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const srv = spawn(process.execPath, ["tests/dev-server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "pipe", "pipe"] });
srv.stderr.on("data", d => process.stderr.write("[srv] " + d));
await new Promise((res, rej) => { const to = setTimeout(() => rej(new Error("server timeout")), 20000); srv.stdout.on("data", d => { if (String(d).includes("dev server")) { clearTimeout(to); res(); } }); });

const api = async (body) => (await fetch(BASE + "/api/backend", { method: "POST", body: JSON.stringify(body) })).json();
const browser = await chromium.launch();
let passed = 0;
const pageErrors = [];
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1360, height: 900 }, acceptDownloads: true });
  const pg = await ctx.newPage();
  // CDN tidak bisa diakses dari lingkungan tes: MathJax dilayani dari node_modules
  // (versi sama dengan yang dimuat index.html), font Google diblokir (fallback).
  await pg.route("**/*", r => {
    const u = r.request().url();
    if (/cdn\.jsdelivr\.net\/npm\/mathjax@3\.2\.2\/es5\/(.+)$/.test(u)) {
      const f = path.join(ROOT, "node_modules/mathjax/es5", u.match(/es5\/(.+)$/)[1]);
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: "text/javascript" }) : r.abort();
    }
    // FONT_DIR (opsional): folder berisi file woff2 Jost/DM Sans untuk screenshot yang akurat
    if (process.env.FONT_DIR && /fonts\.googleapis\.com\/css2/.test(u)) {
      const css = fs.readdirSync(process.env.FONT_DIR).filter(f => /\.woff2$/.test(f)).map(f => {
        const m = f.match(/^(jost|dm-sans)-latin-(\d00)-normal\.woff2$/); if (!m) return "";
        return `@font-face{font-family:"${m[1] === "jost" ? "Jost" : "DM Sans"}";font-weight:${m[2]};src:url(https://fonts.gstatic.com/local/${f}) format("woff2")}`;
      }).join("\n");
      return r.fulfill({ body: css, contentType: "text/css" });
    }
    if (process.env.FONT_DIR && /fonts\.gstatic\.com\/local\//.test(u)) return r.fulfill({ path: path.join(process.env.FONT_DIR, u.split("/local/")[1]), contentType: "font/woff2" });
    return /googleapis|gstatic|jsdelivr/.test(u) ? r.abort() : r.continue();
  });
  pg.on("pageerror", e => pageErrors.push(String(e)));
  pg.on("console", m => { if (/Content Security Policy|Refused to (load|execute|apply|frame|connect)/i.test(m.text())) pageErrors.push("CSP: " + m.text()); });
  return pg;
}
async function step(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) {
    console.error("  FAIL " + name + "\n", e);
    try {
      await pg.screenshot({ path: path.join(SHOTS, "FAIL.png") });
      console.error("state:", await pg.evaluate(() => ({ steps: [...document.querySelectorAll(".gate-step")].filter(x => !x.hidden).map(x => x.id), ls: { ...localStorage }, status: [...document.querySelectorAll(".onboarding-status")].map(x => x.textContent) })));
    } catch (err) { /* abaikan */ }
    await browser.close(); srv.kill(); process.exit(1);
  }
}
// V10: admin membuat akun guru; guru masuk dengan nama pengguna + kata sandi.
const ADM = (await api({ mode: "admin_login", username: "admin", password: "admin-uji" })).token;
assert.ok(ADM, "admin can sign in with ADMIN_PASSWORD");
const tcr = await api({ mode: "admin_teacher_create", adminToken: ADM, name: "Guru Uji", username: "guru.uji", password: "sandi-guru-uji" });
assert.ok(tcr.teacher, "teacher account created: " + JSON.stringify(tcr));
const TT = (await api({ mode: "teacher_login", username: "guru.uji", password: "sandi-guru-uji" })).token;
assert.ok(TT, "teacher can sign in");
async function teacherLoginUI(tp) {
  await tp.goto(BASE + "/teacher.html");
  await tp.fill("#teacher-username-input", "guru.uji");
  await tp.fill("#teacher-password-input", "sandi-guru-uji");
  await tp.click("#teacher-login-btn");
  await tp.waitForSelector("#teacher-panel:not([hidden])");
}
// Akun dibuat guru lebih dulu (Panel Guru -> Group Management)
const reg = await api({ mode: "teacher_accounts_add", teacherToken: TT, lines: [
  { name: "Rina Putri", className: "XII IPA 1", group: "Kelompok 1" },
  { name: "Budi Santoso", className: "XII IPA 1", group: "Kelompok 1" }
] });
const PIN = Object.fromEntries(reg.created.map(c => [c.name, c.pin]));
async function loginStudent(p, name, pin, mode) {
  await p.goto(BASE + "/");
  await p.click("#gate-role-student-btn");
  await p.fill("#gate-login-name-input", name);
  await p.fill("#gate-login-pin-input", pin);
  await p.click("#gate-login-btn");
  if (!mode) return;
  await p.click("#gate-mode-" + mode + "-btn");
}
async function joinClassAtGate(p, code) {
  await p.click("#gate-mode-class-btn");
  await p.fill("#gate-student-code-input", code);
  await p.click("#gate-student-code-btn");
}
let classCode = null;
async function passMateri(p) {
  // Dalam sesi kelas guru langsung membawa siswa ke topik (tanpa layar sambutan)
  await p.waitForFunction(() => { const w = document.getElementById("welcome-start-btn"); return (w && w.offsetParent) || document.querySelector(".deck-slide"); });
  if (await p.isVisible("#welcome-start-btn")) await p.click("#welcome-start-btn");
  await p.waitForSelector(".deck-slide");
  await p.click("#progress-next-btn");
  const corr = await p.evaluate(() => currentTopic.materiCheck.map(q => q.correct));
  for (let i = 0; i < corr.length; i++) await p.check(`#confirm-modal input[name="cq-${i}"][value="${corr[i]}"]`);
  await p.click("#confirm-modal-submit-btn");
}

const pg = await newPage();
await pg.addInitScript(() => { Math.random = () => 0.9999; }); // urutan soal deterministik di tes

await step("no API-key UI anywhere; brand & logo present", async () => {
  await pg.goto(BASE + "/");
  const text = await pg.evaluate(() => document.documentElement.outerHTML);
  assert.ok(!/gemini|aistudio|AIza|apikey|api key/i.test(text), "no API key wording in index.html");
  assert.ok(await pg.isVisible("#gate-step-role"));
  await pg.screenshot({ path: path.join(SHOTS, "01-gate.png") });
});
await step("account login (name + PIN), class code checked, self-study enters", async () => {
  assert.equal(await pg.getAttribute("#gate-role-teacher-link", "href"), "teacher.html");
  await loginStudent(pg, "Rina Putri", "000000");
  await pg.waitForFunction(() => /tidak cocok/i.test(document.getElementById("gate-login-status").textContent));
  await pg.fill("#gate-login-pin-input", PIN["Rina Putri"]);
  await pg.click("#gate-login-btn");
  await pg.waitForSelector("#gate-step-student-mode:not([hidden])");
  await pg.click("#gate-mode-class-btn");
  await pg.fill("#gate-student-code-input", "SALAH1");
  await pg.click("#gate-student-code-btn");
  await pg.waitForFunction(() => /tidak valid/i.test(document.getElementById("gate-student-code-status").textContent));
  await pg.click("#gate-student-code-back-btn");
  await pg.click("#gate-mode-self-btn");
  await pg.waitForSelector("#site-shell:not([hidden])");
  await pg.waitForFunction(() => document.getElementById("user-chip-mode").textContent.trim() !== "", null, { timeout: 10000 });
  assert.equal(await pg.textContent("#user-chip-mode"), "Mandiri");
  await pg.screenshot({ path: path.join(SHOTS, "02-home.png") });
});
await step("Materi: slide viewer renders 31 slides with embeds and builds", async () => {
  await pg.click("#welcome-start-btn");
  await pg.waitForSelector(".deck-slide");
  assert.equal(await pg.textContent(".deck-counter"), "01 / 31");
  await pg.evaluate(() => SlideViewer.current().go(7));
  assert.equal(await pg.locator(".deck-stage iframe.deck-embed").count(), 1, "x-embed becomes sandboxed iframe");
  await pg.evaluate(() => SlideViewer.current().go(12));
  await pg.click('[data-act="next"]');
  assert.equal(await pg.textContent(".deck-counter"), "14 / 31");
  assert.ok(await pg.locator(".deck-stage .build-hidden").count() >= 4, "builds hidden at start");
  await pg.click('[data-act="next"]');
  assert.ok(await pg.locator(".deck-stage .build-hidden").count() >= 3);
  await pg.keyboard.press("ArrowRight");
  await pg.waitForTimeout(3000); // laporan progres slide (debounce 2,5 s)
  await pg.screenshot({ path: path.join(SHOTS, "03-materi.png") });
});
await step("Materi gate: fail keeps modal open, pass unlocks Eksperimen", async () => {
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.click("#progress-next-btn");
  const n = await pg.locator("#confirm-modal .question-card").count();
  assert.equal(n, 5);
  const corr = await pg.evaluate(() => currentTopic.materiCheck.map(q => q.correct));
  for (let i = 0; i < n; i++) await pg.check(`#confirm-modal input[name="cq-${i}"][value="${(corr[i] + 1) % 4}"]`);
  await pg.click("#confirm-modal-submit-btn");
  assert.ok(await pg.isVisible("#confirm-modal"), "modal stays open on fail");
  for (let i = 0; i < n; i++) await pg.check(`#confirm-modal input[name="cq-${i}"][value="${corr[i]}"]`);
  await pg.click("#confirm-modal-submit-btn");
  await pg.waitForSelector("#panel-eksperimen.active .lkpd");
});
await step("LKPD virtual: readings, graph, save, checks without leaking values, submit", async () => {
  await pg.waitForSelector("#group-banner-eksperimen.gb-leader");
  assert.match(await pg.textContent("#group-banner-eksperimen"), /ketua Kelompok 1/);
  // Alat Sederhana & Lab: tabel No | Alat | Jumlah | Gambar
  await pg.click('.eks-variant-btn[data-variant="sederhana"]');
  await pg.waitForSelector(".lkpd-mat-table");
  assert.equal(await pg.locator(".lkpd-mat-table tbody tr").count(), 10);
  assert.ok((await pg.getAttribute(".lkpd-mat-table img", "src")).startsWith("https://thumb.wikimedia.org/"));
  assert.match(await pg.textContent(".lkpd-mat-credit"), /Wikimedia Commons/);
  await pg.locator(".lkpd-mat-table").scrollIntoViewIfNeeded();
  await pg.screenshot({ path: path.join(SHOTS, "18-materials-simple.png") });
  await pg.click('.eks-variant-btn[data-variant="laboratorium"]');
  await pg.waitForFunction(() => document.querySelectorAll(".lkpd-mat-table tbody tr").length === 7);
  assert.equal(await pg.locator(".lkpd-mat-svg svg").count(), 1, "current balance row shows the set-up illustration");
  await pg.click('.eks-variant-btn[data-variant="virtual"]');
  await pg.waitForSelector('.lkpd[data-mode="virtual"]');
  // Rakit alat dulu: kontrol pengukuran tersembunyi, urutan salah diberi petunjuk
  assert.ok(await pg.isHidden('[data-act="vlab-read"]'), "measuring locked until assembled");
  await pg.click('[data-asm-part="ammeter"]');
  assert.match(await pg.textContent("[data-asm-msg]"), /neraca elektronik harus diletakkan dulu/);
  await pg.click('[data-asm-part="balance"]');
  // seret magnet ke meja kerja (pointer drag)
  const mg = await pg.locator('[data-asm-part="magnets"]').boundingBox();
  const bench = await pg.locator("[data-asm-drop]").boundingBox();
  await pg.mouse.move(mg.x + mg.width / 2, mg.y + mg.height / 2);
  await pg.mouse.down();
  await pg.mouse.move(bench.x + bench.width / 2, bench.y + bench.height / 2, { steps: 8 });
  await pg.mouse.up();
  await pg.waitForFunction(() => LKPD._ctx().st.asm === 2);
  assert.match(await pg.textContent("#vlab-balance-display"), /41,37 g/, "balance shows magnet mass before tare");
  await pg.locator("[data-asm]").scrollIntoViewIfNeeded();
  await pg.screenshot({ path: path.join(SHOTS, "17-assemble.png") });
  for (const part of ["tare", "wire", "ammeter", "supply", "leads"]) await pg.click(`[data-asm-part="${part}"]`);
  assert.match(await pg.textContent("[data-asm-msg]"), /Rangkaian lengkap/);
  assert.match(await pg.textContent("#vlab-balance-display"), /0,00 g/);
  assert.ok(await pg.isVisible('[data-act="vlab-read"]'));
  const I = ["0.5", "1", "1.5", "2", "2.5"];
  for (let k = 0; k < 15; k++) {
    await pg.selectOption("[data-vlab-i]", I[Math.floor(k / 3)]);
    await pg.click('[data-act="vlab-read"]');
    await pg.waitForFunction(() => !document.querySelector('[data-act="vlab-read"]').disabled);
  }
  await pg.click('[data-act="save-table"]');
  await pg.waitForFunction(() => /tersimpan/i.test(document.querySelector("[data-table-status]").textContent));
  const gradient = await pg.evaluate(() => {
    const rows = LKPD._ctx().st.table.rows.map(r => ({ x: Number(r.I), y: r.values.map(v => parseFloat(String(v).replace(",", "."))).reduce((a, b) => a + b, 0) / 3 * 9.81 / 1000 }));
    const n = rows.length, sx = rows.reduce((a, r) => a + r.x, 0), sy = rows.reduce((a, r) => a + r.y, 0), sxx = rows.reduce((a, r) => a + r.x * r.x, 0), sxy = rows.reduce((a, r) => a + r.x * r.y, 0);
    return (n * sxy - sx * sy) / (n * sxx - sx * sx);
  });
  const B = gradient / 0.045;
  await pg.fill('[data-calc="calcB"]', (B * 3).toFixed(3));
  await pg.click('[data-check="calcB"]');
  const fbWrong = await pg.textContent('[data-fb="calcB"]');
  assert.match(fbWrong, /terlalu besar/);
  assert.ok(!fbWrong.includes(B.toFixed(2)) && !fbWrong.includes(B.toFixed(2).replace(".", ",")), "wrong feedback must not reveal B");
  await pg.fill('[data-calc="calcB"]', B.toFixed(3).replace(".", ","));
  await pg.click('[data-check="calcB"]');
  assert.match(await pg.textContent('[data-fb="calcB"]'), /Tepat/);
  for (const id of ["predict", "gradient", "reverse", "intercept"]) {
    const correct = await pg.evaluate(i => LKPD._ctx().def.sections.find(s => s.id === i).correct, id);
    await pg.check(`input[name="lk-${id}"][value="${correct}"]`);
    await pg.click(`[data-check="${id}"]`);
  }
  await pg.click('[data-reveal="conclusion"]');
  assert.ok(await pg.isHidden('[data-model="conclusion"]'), "sample answer locked until student writes");
  await pg.fill('[data-open="conclusion"]', "F sebanding dengan I karena grafik lurus melalui titik asal; B sekitar 0,2 T.");
  await pg.fill('[data-open="virtual-vs-real"]', "Pemanasan kawat dan kawat menyentuh magnet tidak muncul pada alat virtual.");
  assert.match(await pg.textContent(".lkpd-identity"), /Kelompok 1/);
  const steps = await pg.locator(".lkpd [data-tick]").count();
  for (let i = 0; i < steps; i++) await pg.locator(".lkpd [data-tick]").nth(i).check();
  assert.equal(await pg.textContent(".lkpd-score-big"), "5/5");
  await pg.click('[data-act="submit"]');
  await pg.waitForSelector("[data-submitted]:not([hidden])");
  await pg.locator(".lkpd-head").scrollIntoViewIfNeeded();
  await pg.screenshot({ path: path.join(SHOTS, "04-lkpd.png") });
});
await step("Eksperimen gate -> teacher approves -> Latihan & Makerspace unlock", async () => {
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.click("#progress-next-btn");
  const corr = await pg.evaluate(() => currentTopic.eksperimenCheck.map(q => q.correct));
  for (let i = 0; i < corr.length; i++) await pg.check(`#confirm-modal input[name="cq-${i}"][value="${corr[i]}"]`);
  await pg.click("#confirm-modal-submit-btn");
  await pg.waitForSelector("#eksperimen-gate-banner.gate-pending");
  const ro = await api({ mode: "teacher_roster", teacherToken: TT });
  const req = ro.gatePending.find(g => g.stage === "eksperimen" && g.label === "Kelompok 1 (XII IPA 1)");
  assert.ok(req && /5\/5/.test(req.summary), "gate summary includes LKPD score: " + (req && req.summary));
  await api({ mode: "teacher_gate_decide", teacherToken: TT, topicId: req.topicId, studentId: req.studentId, stage: "eksperimen", decision: "approved" });
  await pg.waitForSelector("#eksperimen-gate-banner.gate-approved", { timeout: 15000 });
  assert.ok(!(await pg.getAttribute('.tab-btn[data-tab="lab"]', "class")).includes("locked"));
});
await step("Latihan answers are recorded", async () => {
  await pg.click('.tab-btn[data-tab="latihan"]');
  await pg.locator("#panel-latihan input[type=radio]").first().check();
  await pg.locator("[data-latihan-check]").first().click();
  await pg.waitForSelector(".latihan-fb:not([hidden])");
});
await step("Self-study: no AI (Tutor & Makerspace hidden, server refuses)", async () => {
  await pg.click('.tab-btn[data-tab="lab"]');
  await pg.waitForSelector("#lab-class-only:not([hidden])");
  assert.ok(await pg.isHidden("#generate-btn"), "generator hidden in self-study");
  assert.ok(await pg.isHidden("#chatbot-toggle-btn"), "tutor hidden in self-study");
  const r = await pg.evaluate(() => fetch("/api/ai", { method: "POST", headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(Object.assign({ mode: "chat", message: "halo", topicId: "magnetic-fields" }, authFields())) }).then(async x => ({ s: x.status, d: await x.json() })));
  assert.equal(r.s, 403); assert.equal(r.d.code, "CLASS_ONLY");
  await pg.screenshot({ path: path.join(SHOTS, "16-self-no-ai.png") });
});
await step("Makerspace: streaming generate, edit, reflection to teacher", async () => {
  const s = await api({ mode: "teacher_session", teacherToken: TT, action: "start", topicId: "magnetic-fields", tabIndex: 0 });
  classCode = s.state.code;
  await pg.click("#lab-class-only-join-btn");
  await pg.fill("#class-session-code-input", classCode);
  await pg.click("#class-session-join-btn");
  await pg.waitForFunction(() => /Kelas/.test(document.getElementById("user-chip-mode").textContent));
  await pg.click("#settings-close-btn");
  await pg.click('.tab-btn[data-tab="lab"]');
  await pg.waitForSelector("#lab-class-only", { state: "hidden" });
  await pg.fill("#pf-goal", "mengamati hubungan arus dan gaya pada kawat");
  await pg.click("#pf-build-btn");
  await pg.click("#generate-btn");
  await pg.waitForFunction(() => /selesai/.test(document.getElementById("generate-status").textContent), null, { timeout: 15000 });
  const src = await pg.getAttribute("#preview-frame", "srcdoc");
  assert.ok(src.startsWith("<!DOCTYPE html>"));
  // Koneksi putus di tengah streaming -> dilanjutkan otomatis tanpa klik
  await pg.evaluate(() => fetch("/__dropnext"));
  await pg.click("#generate-btn");
  await pg.waitForFunction(() => /otomatis/.test(document.getElementById("generate-status").textContent), null, { timeout: 15000 });
  await pg.waitForFunction(() => /selesai|dilanjutkan/.test(document.getElementById("generate-status").textContent), null, { timeout: 20000 });
  const src2 = await pg.getAttribute("#preview-frame", "srcdoc");
  assert.ok(src2.startsWith("<!DOCTYPE html>") && /<\/html>\s*$/.test(src2), "auto-resumed HTML must be complete");
  assert.equal(await pg.isHidden("#continue-gen-btn"), true);
  await pg.fill("#edit-followup-input", "tambahkan label satuan");
  await pg.click("#edit-followup-btn");
  await pg.waitForFunction(() => /direvisi/.test(document.getElementById("edit-followup-status").textContent), null, { timeout: 15000 });
  await pg.fill("#lab-reflection-input", "Saat arus nol gaya juga nol, sesuai F = BIL; saat arus dua kali gaya dua kali.");
  await pg.click("#lab-reflection-submit-btn");
  await pg.waitForSelector("#lab-gate-banner.gate-pending");
  await pg.locator(".lab-grid").scrollIntoViewIfNeeded();
  await pg.screenshot({ path: path.join(SHOTS, "05-makerspace.png") });
});
await step("Group member: leader name + read-only LKPD & simulation on own device", async () => {
  const bp = await newPage();
  await bp.addInitScript(() => { Math.random = () => 0.9999; });
  await loginStudent(bp, "Budi", PIN["Budi Santoso"]);
  await bp.waitForSelector("#gate-step-student-mode:not([hidden])");
  await joinClassAtGate(bp, classCode);
  await bp.waitForSelector("#site-shell:not([hidden])");
  await passMateri(bp);
  await bp.waitForSelector("#group-banner-eksperimen.gb-member");
  assert.match(await bp.textContent("#group-banner-eksperimen"), /Rina Putri/);
  await bp.waitForFunction(() => document.querySelector(".lkpd-score-big") && document.querySelector(".lkpd-score-big").textContent === "5/5", null, { timeout: 20000 });
  assert.ok(await bp.locator(".lkpd.lkpd-readonly").count() === 1);
  assert.ok(await bp.locator('.lkpd [data-open="conclusion"]').isDisabled());
  assert.ok(await bp.isHidden('.lkpd [data-act="submit"]'));
  await bp.click('.eks-variant-btn[data-variant="laboratorium"]');
  assert.equal(await bp.getAttribute('.eks-variant-btn[data-variant="virtual"]', "class"), "eks-variant-btn active", "member cannot switch variant");
  await bp.screenshot({ path: path.join(SHOTS, "13-member-eksperimen.png") });
  // Eksperimen kelompok sudah disetujui guru -> Latihan & Makerspace anggota ikut terbuka
  await bp.waitForFunction(() => !document.querySelector('.tab-btn[data-tab="lab"]').classList.contains("locked"), null, { timeout: 20000 });
  await bp.click('.tab-btn[data-tab="lab"]');
  await bp.waitForSelector("#group-banner-lab.gb-member");
  assert.ok(await bp.isHidden("#generate-btn"), "member cannot generate");
  await bp.waitForFunction(() => (document.getElementById("preview-frame").getAttribute("srcdoc") || "").includes("</html>"), null, { timeout: 20000 });
  assert.match(await bp.textContent("#group-lab-note"), /tambahkan label satuan/);
  assert.ok(await bp.isHidden("#lab-reflection-section"));
  await bp.screenshot({ path: path.join(SHOTS, "14-member-lab.png") });
  await bp.close();
});
await step("Leader on a second device: read-only until moved, then takes over", async () => {
  const rp = await newPage();
  await loginStudent(rp, "Rina Putri", PIN["Rina Putri"]);
  await rp.waitForSelector("#gate-step-student-mode:not([hidden])");
  await joinClassAtGate(rp, classCode);
  await rp.waitForSelector("#site-shell:not([hidden])");
  await rp.waitForFunction(() => { const w = document.getElementById("welcome-start-btn"); return (w && w.offsetParent) || document.querySelector(".deck-slide"); });
  if (await rp.isVisible("#welcome-start-btn")) await rp.click("#welcome-start-btn");
  await rp.waitForFunction(() => !document.querySelector('.tab-btn[data-tab="lab"]').classList.contains("locked"), null, { timeout: 20000 });
  await rp.click('.tab-btn[data-tab="lab"]');
  await rp.waitForSelector("#group-banner-lab.gb-blocked");
  assert.ok(await rp.isHidden("#generate-btn"));
  await rp.click("[data-group-takeover]");
  await rp.waitForSelector("#group-banner-lab.gb-leader");
  assert.ok(await rp.isVisible("#generate-btn"));
  await rp.close();
  // perangkat pertama sekarang ditolak server saat menulis
  const r = await pg.evaluate(() => apiCall("lkpd_save", { topicId: "magnetic-fields", lkpdMode: "virtual", data: {}, progress: 0 }));
  assert.equal(r._status, 409);
});
await step("Tutor chat streams a reply", async () => {
  await pg.click("#chatbot-toggle-btn");
  await pg.fill("#chatbot-input", "Kenapa F = BIL?");
  await pg.press("#chatbot-input", "Enter");
  await pg.waitForFunction(() => /Pertanyaan bagus/.test(document.getElementById("chatbot-messages").textContent));
  await pg.screenshot({ path: path.join(SHOTS, "06-chat.png") });
  await pg.click("#chatbot-close-btn");
  // Sesi kelas berakhir -> kembali mandiri, AI mati lagi
  await api({ mode: "teacher_session", teacherToken: TT, action: "end" });
  await pg.evaluate(() => syncClassSession());
  await pg.waitForFunction(() => document.getElementById("user-chip-mode").textContent === "Mandiri");
  assert.ok(await pg.isHidden("#chatbot-toggle-btn"));
});
await step("Class session: join, quiz, session end keeps student inside (V7 bug fixed)", async () => {
  const s = await api({ mode: "teacher_session", teacherToken: TT, action: "start", topicId: "magnetic-fields", tabIndex: 0 });
  await api({ mode: "quiz_bank_save", teacherToken: TT, topicId: "magnetic-fields", questions: [{ type: "mcq", question: "Satuan B adalah", options: ["T", "N", "A", "Wb"], correct: 0 }, { type: "short", question: "Definisikan tesla." }] });
  const bank = await api({ mode: "quiz_bank_get", teacherToken: TT, topicId: "magnetic-fields" });
  await pg.click("#menu-btn");
  await pg.waitForSelector("#menu-drawer.open");
  await pg.click("#settings-btn");
  await pg.fill("#class-session-code-input", s.state.code);
  await pg.click("#class-session-join-btn");
  await pg.waitForFunction(() => /Kelas/.test(document.getElementById("user-chip-mode").textContent));
  await pg.click("#settings-close-btn");
  await api({ mode: "quiz_publish", teacherToken: TT, topicId: "magnetic-fields", questions: bank.questions });
  await pg.evaluate(() => syncClassSession());
  await pg.waitForSelector("#quiz-toggle-btn:not([hidden])");
  await pg.click("#quiz-toggle-btn");
  await pg.locator("#quiz-modal-body input[type=radio]").first().check();
  await pg.fill("#quiz-modal-body textarea", "1 T = 1 N A^-1 m^-1");
  await pg.click("#quiz-modal-submit-btn");
  await pg.waitForFunction(() => document.getElementById("quiz-modal-submit-btn").disabled && document.getElementById("quiz-modal-status").textContent.length > 3);
  await pg.click("#quiz-modal-close-btn");
  // Tes sumatif: lembar tes di web (pilih, ketik, persamaan, tulis tangan), simpan & kumpulkan
  const pub = await api({ mode: "test_publish", teacherToken: TT, topicId: "magnetic-fields", durationMin: 45 });
  assert.ok(pub.test && pub.test.active, "test published: " + JSON.stringify(pub));
  await pg.evaluate(() => syncClassSession());
  await pg.waitForSelector("#ts-toggle-btn:not([hidden])");
  await pg.click("#ts-toggle-btn");
  await pg.waitForSelector("#ts-sheet .ts-paper .ts-answer .ts-ans-text");
  assert.equal(await pg.locator("#ts-sheet .ts-key").count(), 0, "no keys for students");
  assert.ok(!(await pg.textContent("#ts-sheet")).includes("Kerapatan garis menunjukkan"), "explanations never reach students");
  assert.match(await pg.textContent("#ts-timer"), /^4[45]:\d\d$/);
  await pg.check('#ts-sheet input[data-mcq="A1"][value="2"]');
  await pg.check('#ts-sheet input[data-mcq="A2"][value="0"]');
  await pg.fill('#ts-sheet [data-answer-key="B1.a"] .ts-ans-text', "Gradien grafik $\\Delta m$ terhadap $I$ konstan, jadi $F \\propto I$.");
  await pg.waitForSelector('#ts-sheet [data-answer-key="B1.a"] .ts-ans-preview:not([hidden]) mjx-container', { timeout: 8000 });
  // persamaan lewat MathLive
  await pg.click('#ts-sheet [data-answer-key="C1"] [data-tool="eq"]');
  await pg.waitForSelector("#ts-eq-field", { timeout: 10000 });
  await pg.waitForTimeout(300);
  await pg.evaluate(() => document.getElementById("ts-eq-field").setValue("B=\\frac{F}{IL}"));
  await pg.click("#ts-eq-insert");
  assert.match(await pg.inputValue('#ts-sheet [data-answer-key="C1"] .ts-ans-text'), /\$B=\\frac\{F\}\{IL\}\$/);
  // tulis tangan
  await pg.click('#ts-sheet [data-answer-key="B2.a"] [data-tool="ink"]');
  const cv = pg.locator('#ts-sheet [data-answer-key="B2.a"] canvas');
  await cv.scrollIntoViewIfNeeded();
  const bb = await cv.boundingBox();
  await pg.mouse.move(bb.x + 30, bb.y + 40); await pg.mouse.down();
  for (let i = 1; i <= 12; i++) await pg.mouse.move(bb.x + 30 + i * 18, bb.y + 40 + (i % 2) * 30);
  await pg.mouse.up();
  await pg.screenshot({ path: path.join(SHOTS, "20-student-test.png") });
  await pg.click("#ts-save-now");
  await pg.waitForFunction(() => /Tersimpan/.test(document.getElementById("ts-save-state").textContent));
  pg.once("dialog", d => d.accept());
  await pg.click("#ts-submit-btn");
  await pg.waitForFunction(() => /dikumpulkan/.test(document.getElementById("ts-save-state").textContent));
  assert.ok(await pg.isDisabled('#ts-sheet [data-answer-key="B1.a"] .ts-ans-text'), "read-only after submit");
  await pg.click("#ts-close-btn");
  assert.match(await pg.textContent("#ts-toggle-label"), /terkumpul/);
  const tr = await api({ mode: "test_results", teacherToken: TT });
  const rr = tr.rows.find(r => r.name === "Rina Putri");
  assert.equal(rr.status, "submitted"); assert.equal(rr.autoScore, 2); assert.equal(tr.test.max, 48);
  const det = await api({ mode: "test_answer_detail", teacherToken: TT, quizId: tr.test.id, studentId: rr.studentId });
  assert.match(det.answers["B2.a"].ink, /^data:image\/png;base64,/);
  assert.match(det.answers.C1.text, /frac/);
  await api({ mode: "teacher_session", teacherToken: TT, action: "end" });
  await pg.evaluate(() => syncClassSession());
  await pg.waitForFunction(() => document.getElementById("user-chip-mode").textContent === "Mandiri");
  assert.ok(await pg.isVisible("#site-shell"), "student stays in the site");
  assert.ok(await pg.isHidden("#onboarding-gate"));
});
await step("Teacher panel: records, detail with LKPD answers, Excel & PDF export", async () => {
  const tp = await newPage({ width: 1400, height: 900 });
  await teacherLoginUI(tp);
  // Guru hanya bisa memilih topik yang terlihat oleh siswa (VISIBLE_TOPIC_IDS)
  const topicOpts = await tp.$$eval("#teacher-topic-select option, #quiz-topic-select option", os => os.map(o => o.value));
  assert.ok(topicOpts.length >= 2 && topicOpts.every(v => v === "magnetic-fields"), "teacher topic lists: " + topicOpts.join(","));
  await tp.screenshot({ path: path.join(SHOTS, "07-teacher-session.png") });
  await tp.click('.t-tab[data-pane="accounts"]');
  await tp.waitForSelector(".acc-group");
  assert.match(await tp.textContent("#acc-groups"), /Kelompok 1/);
  assert.equal(await tp.locator(".acc-pin").first().textContent(), "••••••", "PINs hidden by default");
  await tp.check("#acc-show-pin");
  assert.match(await tp.textContent("#acc-groups"), new RegExp(PIN["Budi Santoso"]));
  assert.equal(await tp.$eval('[data-group-leader]', el => el.selectedOptions[0].textContent), "Rina Putri");
  await tp.fill("#acc-add-class", "XII IPA 2");
  await tp.fill("#acc-add-lines", "Sari Dewi; Kelompok A\nDoni\tKelompok A");
  await tp.click("#acc-add-btn");
  await tp.waitForFunction(() => /2 siswa terdaftar/.test(document.getElementById("acc-add-status").textContent));
  await tp.waitForFunction(() => /Kelompok A/.test(document.getElementById("acc-groups").textContent));
  const [pop] = await Promise.all([tp.waitForEvent("popup"), tp.click("#acc-print-btn")]);
  await pop.waitForLoadState();
  assert.equal(await pop.locator(".card").count(), 2, "cards for the filtered class");
  assert.match(await pop.textContent("body"), /Sari Dewi/);
  await pop.close();
  const [dA] = await Promise.all([tp.waitForEvent("download"), tp.click("#acc-xlsx-btn")]);
  const aPath = path.join(SHOTS, "akun.xlsx"); await dA.saveAs(aPath);
  const accRows = require("xlsx").utils.sheet_to_json(require("xlsx").readFile(aPath).Sheets["Akun siswa"]);
  assert.equal(accRows.length, 2); assert.match(String(accRows[0].PIN), /^\d{6}$/);
  await tp.selectOption("#acc-class-filter", "");
  // Pilih banyak: centang satu kelompok -> pindah kelas; lalu hapus satu siswa
  tp.on("dialog", d => d.accept());
  const gA = await tp.evaluate(() => accCache.groups.find(g => g.name === "Kelompok A").groupId);
  await tp.check(`[data-acc-selgroup="${gA}"]`);
  await tp.waitForFunction(() => /2 dipilih/.test(document.getElementById("acc-bulk-count").textContent));
  await tp.selectOption("#acc-bulk-action", "class");
  await tp.fill("#acc-bulk-class", "XII IPA 3");
  await tp.fill("#acc-bulk-group", "Kelompok B");
  await tp.screenshot({ path: path.join(SHOTS, "19-bulk-select.png") });
  await tp.click("#acc-bulk-apply");
  await tp.waitForFunction(() => /2 siswa dipindahkan/.test(document.getElementById("acc-status").textContent));
  const moved = await tp.evaluate(() => accCache.accounts.filter(a => a.className === "XII IPA 3").map(a => a.studentId).sort());
  assert.deepEqual(moved, ["Doni (XII IPA 3)", "Sari Dewi (XII IPA 3)"]);
  await tp.check('[data-acc-sel="Doni (XII IPA 3)"]');
  await tp.selectOption("#acc-bulk-action", "delete");
  await tp.click("#acc-bulk-apply");
  await tp.waitForFunction(() => /1 siswa dihapus/.test(document.getElementById("acc-status").textContent));
  assert.ok(!(await tp.evaluate(() => accCache.accounts.some(a => a.name === "Doni"))));
  await tp.screenshot({ path: path.join(SHOTS, "15-teacher-accounts.png") });
  await tp.click('.t-tab[data-pane="records"]');
  await tp.waitForSelector("#records-body .student-link");
  const rowText = await tp.textContent("#records-body");
  assert.match(rowText, /Rina Putri/); assert.match(rowText, /terkumpul/);
  await tp.screenshot({ path: path.join(SHOTS, "08-teacher-records.png") });
  await tp.click('#records-body .student-link:has-text("Rina Putri")');
  await tp.waitForSelector("#student-modal-body .detail-section");
  const detail = await tp.textContent("#student-modal-body");
  assert.match(detail, /F sebanding dengan I/); assert.match(detail, /LKPD/); assert.match(detail, /Satuan B adalah/); assert.match(detail, /Saat arus nol/);
  await tp.screenshot({ path: path.join(SHOTS, "09-teacher-detail.png") });
  const [d1] = await Promise.all([tp.waitForEvent("download"), tp.click("#student-pdf-btn")]);
  const pdfPath = path.join(SHOTS, "student.pdf"); await d1.saveAs(pdfPath);
  assert.ok(fs.statSync(pdfPath).size > 3000 && fs.readFileSync(pdfPath).slice(0, 4).toString() === "%PDF");
  await tp.click("#student-modal-close-btn");
  const [d2] = await Promise.all([tp.waitForEvent("download"), tp.click("#export-xlsx-btn")]);
  const xPath = path.join(SHOTS, "rekap.xlsx"); await d2.saveAs(xPath);
  const XLSX = require("xlsx");
  const wb = XLSX.readFile(xPath);
  assert.deepEqual(wb.SheetNames, ["Rekap", "Konfirmasi", "LKPD", "Data Eksperimen", "Latihan", "Kuis", "Makerspace", "Checkpoint"]);
  const lk = XLSX.utils.sheet_to_json(wb.Sheets.LKPD);
  assert.ok(lk.find(r => /^\d\d · Uraian$/.test(r.Butir) && /sebanding/.test(r.Jawaban)), "LKPD conclusion exported");
  const exp = XLSX.utils.sheet_to_json(wb.Sheets["Data Eksperimen"]);
  assert.equal(exp.filter(r => r.Siswa === "Rina Putri").length, 5);
  const quiz = XLSX.utils.sheet_to_json(wb.Sheets.Kuis);
  assert.ok(quiz.find(r => r.Siswa === "Rina Putri" && r["Benar (1/0)"] === 1));
  const lat = XLSX.utils.sheet_to_json(wb.Sheets.Latihan);
  assert.ok(lat.find(r => r.Siswa === "Rina Putri"));
  const [d3] = await Promise.all([tp.waitForEvent("download"), tp.click("#export-pdf-btn")]);
  await d3.saveAs(path.join(SHOTS, "rekap.pdf"));
  // Tab baru: Class Management / Group Management / Group Monitoring / Quiz; tidak ada AI generate & usage
  assert.deepEqual(await tp.$$eval(".t-tab span:not(.tab-num)", xs => xs.map(x => x.textContent)), ["Class Management", "Group Management", "Group Monitoring", "Quiz"]);
  assert.equal(await tp.locator("#quiz-generate-btn, .t-tab[data-pane=usage]").count(), 0);
  await tp.click('.t-tab[data-pane="quiz"]');
  await tp.waitForSelector("#quiz-question-list .quiz-question-item");
  const nQ = await tp.locator("#quiz-question-list .quiz-question-item").count();
  await tp.click('[data-qadd="mcq"]');
  await tp.fill("#qz-ed-question", "Arah gaya pada kawat ditentukan dengan kaidah ....");
  const opts = tp.locator(".qz-ed-option");
  await opts.nth(0).fill("tangan kiri Fleming"); await opts.nth(1).fill("tangan kanan"); await opts.nth(2).fill("Lenz");
  await tp.click("#qz-ed-save");
  await tp.waitForFunction(n => document.querySelectorAll("#quiz-question-list .quiz-question-item").length === n + 1, nQ);
  await tp.waitForFunction(() => /otomatis/.test(document.getElementById("quiz-save-status").textContent));
  await tp.click("#qz-import-toggle");
  await tp.fill("#qz-import-text", "1. Satuan fluks magnet adalah ....\nA. tesla\nB. weber\nC. henry\nD. ampere\nKunci: B\n\n2. Tuliskan rumus gaya Lorentz pada kawat.\nJawaban: F = BIL sin θ");
  await tp.click("#qz-import-btn");
  await tp.waitForFunction(n => document.querySelectorAll("#quiz-question-list .quiz-question-item").length === n + 3, nQ);
  const bankNow = await api({ mode: "quiz_bank_get", teacherToken: TT, topicId: "magnetic-fields" });
  assert.equal(bankNow.questions.find(q => /fluks/.test(q.question)).correct, 1);
  await tp.screenshot({ path: path.join(SHOTS, "10-teacher-quiz.png") });
  // Tes sumatif: pratinjau default, edit, simpan, kembalikan default, nilai jawaban siswa
  await tp.click('.qz-seg-btn[data-qmode="test"]');
  await tp.waitForSelector("#ts-paper .ts-paper .ts-item");
  assert.equal(await tp.locator("#ts-paper .ts-item").count(), 17);
  assert.match(await tp.textContent("#ts-paper .ts-meta"), /48/);
  await tp.check("#ts-showkeys");
  await tp.waitForSelector("#ts-paper .ts-key");
  await tp.screenshot({ path: path.join(SHOTS, "21-teacher-test-preview.png") });
  await tp.click("#ts-edit-btn");
  await tp.fill('[data-ed="title"]', "Tes Sumatif Medan Magnet (versi kelas)");
  await tp.click('[data-act="item-add"][data-type="open"][data-s="2"]');
  await tp.fill('[data-ed="s.2.i.4.stem"]', "Rancang eksperimen sederhana untuk mengukur $B$ magnet ponsel.");
  await tp.screenshot({ path: path.join(SHOTS, "22-teacher-test-editor.png") });
  await tp.click("#ts-save-btn");
  await tp.waitForFunction(() => /editan/.test(document.getElementById("ts-source-note").textContent));
  assert.equal(await tp.locator("#ts-paper .ts-item").count(), 18);
  assert.match(await tp.textContent("#ts-paper .ts-title"), /versi kelas/);
  await tp.click("#ts-reset-btn");
  await tp.waitForFunction(() => /default/.test(document.getElementById("ts-source-note").textContent));
  assert.equal(await tp.locator("#ts-paper .ts-item").count(), 17);
  await tp.waitForSelector('#ts-results-body [data-grade]');
  await tp.click('#ts-results-body [data-grade][data-name="Rina Putri"]');
  await tp.waitForSelector("#ts-grade-body .ts-paper [data-score-key]");
  assert.equal(await tp.locator("#ts-grade-body .ts-ink-view").count(), 1, "handwriting visible to the teacher");
  await tp.fill('#ts-grade-body [data-score-key="B1.a"]', "2");
  await tp.fill('#ts-grade-body [data-score-key="C1"]', "3");
  await tp.click("#ts-grade-save-btn");
  await tp.waitForFunction(() => /7 \/ 48/.test(document.getElementById("ts-grade-total").textContent));
  await tp.screenshot({ path: path.join(SHOTS, "23-teacher-test-grade.png") });
  await tp.click("#ts-grade-close-btn");
  await tp.waitForFunction(() => /Sudah dinilai|Perlu dinilai/.test(document.getElementById("ts-results-body").textContent));
});
await step("Admin panel: teacher accounts and token usage per account & overall", async () => {
  const ap = await newPage({ width: 1400, height: 900 });
  await ap.goto(BASE + "/admin.html");
  await ap.fill("#admin-password-input", "salah-salah");
  await ap.click("#admin-login-btn");
  await ap.waitForFunction(() => document.getElementById("admin-login-status").textContent.length > 3);
  await ap.fill("#admin-password-input", "admin-uji");
  await ap.click("#admin-login-btn");
  await ap.waitForSelector("#admin-panel:not([hidden])");
  assert.ok(await ap.isVisible("#admin-mustchange"), "asks to change env password");
  await ap.waitForSelector('#adm-teachers-body [data-tact="edit"]');
  assert.match(await ap.textContent("#adm-teachers-body"), /Guru Uji/);
  await ap.fill("#adm-new-name", "Bu Sari");
  await ap.fill("#adm-new-username", "bu.sari");
  await ap.click("#adm-create-btn");
  await ap.waitForSelector("#adm-secret:not([hidden])");
  const pw = await ap.textContent("#adm-secret-pw");
  assert.ok(pw.length >= 8);
  assert.ok((await api({ mode: "teacher_login", username: "bu.sari", password: pw })).token, "generated password works");
  await ap.waitForFunction(() => /Bu Sari/.test(document.getElementById("adm-teachers-body").textContent));
  await ap.screenshot({ path: path.join(SHOTS, "11-admin-teachers.png") });
  await ap.click('.t-tab[data-pane="usage"]');
  await ap.waitForSelector("#adm-stats .admin-stat");
  await ap.selectOption("#adm-period", "all");
  await ap.waitForFunction(() => /Rina Putri/.test(document.getElementById("adm-byaccount").textContent));
  assert.match(await ap.textContent("#adm-byteacher"), /Guru Uji/);
  assert.ok(await ap.locator("#adm-byday .admin-bar-row").count() >= 1);
  await ap.screenshot({ path: path.join(SHOTS, "12-admin-usage.png"), fullPage: true });
  // satu-satunya admin: teacher token tidak bisa membuka data admin
  assert.equal((await api({ mode: "admin_usage", teacherToken: TT })).code, "ADMIN_AUTH");
  await ap.context().close();
});
await step("Security: student-supplied text is never executed in the Teacher Panel (XSS)", async () => {
  const X = n => `<img src=x onerror=window.__xss=${n}><script>window.__xss=${n}</script>`;
  const add = await api({ mode: "teacher_accounts_add", teacherToken: TT, lines: [{ name: "Eve " + X(1), className: "XSS " + X(2), group: "G " + X(3) }] });
  assert.equal(add.created.length, 1);
  const ev = add.created[0];
  const tok = (await api({ mode: "student_login", name: ev.name, pin: ev.pin })).token;
  assert.ok(tok, "payload-named student can log in");
  for (const kind of ["latihan", "lab_prompt", "lab_reflection", "materi_check"]) await api({ mode: "record_event", token: tok, topicId: "magnetic-fields", kind, item: X(4), payload: { answer: X(5), text: X(6), prompt: X(7) }, score: 0 });
  await api({ mode: "lkpd_save", token: tok, topicId: "magnetic-fields", lkpdMode: "virtual", data: { open: { conclusion: X(8) }, a: { calcB: X(9) }, group: X(10) }, progress: 50, submit: true });
  const tp = await newPage({ width: 1400, height: 900 });
  await teacherLoginUI(tp);
  await tp.click('.t-tab[data-pane="accounts"]'); await tp.waitForSelector(".acc-group");
  await tp.check("#acc-show-pin");
  await tp.click('.t-tab[data-pane="records"]'); await tp.waitForSelector("#records-body .student-link");
  await tp.click('#records-body .student-link:has-text("Eve")');
  await tp.waitForSelector("#student-modal-body .detail-section");
  await tp.waitForTimeout(500);
  const r = await tp.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('img[src="x"]').length, scripts: [...document.querySelectorAll("script")].filter(s => /__xss/.test(s.textContent)).length }));
  assert.deepEqual(r, { xss: undefined, imgs: 0, scripts: 0 }, "payload rendered as text only");
  assert.match(await tp.textContent("#student-modal-body"), /onerror=window.__xss=4/, "payload is visible as plain text");
  await tp.context().close();
  // tampilan siswa juga aman (nama & kelompok di menu)
  const sp = await newPage();
  await loginStudent(sp, ev.name, ev.pin, "self");
  await sp.waitForSelector("#site-shell:not([hidden])");
  await sp.waitForTimeout(400);
  assert.equal(await sp.evaluate(() => window.__xss), undefined);
  await sp.context().close();
});
await step("English UI and phone layout", async () => {
  const mp = await newPage({ width: 390, height: 844 });
  await mp.goto(BASE + "/");
  await Promise.all([mp.waitForEvent("load"), mp.click('.lang-switch-btn[data-lang="en"]')]);
  await mp.waitForSelector("#gate-step-role");
  assert.match(await mp.textContent("#gate-step-role h2"), /Who is signing in/);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.ok(!overflow, "no horizontal scroll on phone gate");
  await mp.screenshot({ path: path.join(SHOTS, "12-phone-gate.png"), fullPage: true });
});
await step("Transparent header + burger menu: nothing overlaps, keyboard friendly", async () => {
  for (const vp of [{ width: 1360, height: 900 }, { width: 820, height: 1180 }, { width: 390, height: 844 }]) {
    const hp = await newPage(vp);
    await loginStudent(hp, "Rina Putri", PIN["Rina Putri"], "self");
    await hp.waitForSelector("#site-shell:not([hidden])");
    await hp.evaluate(() => window.scrollTo(0, 0)); await hp.waitForTimeout(400);
    const bg = await hp.evaluate(() => [window.scrollY, getComputedStyle(document.getElementById("site-header")).backgroundColor].join(" "));
    assert.match(bg, /rgba\(0, 0, 0, 0\)|transparent/, "header is transparent at the top: " + bg);
    // tombol menu & logo tidak saling menutupi, tidak ada scroll horizontal
    const boxes = await hp.evaluate(() => ["#brand-home", "#menu-btn", "#header-mode"].map(q => { const r = document.querySelector(q).getBoundingClientRect(); return { q, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width }; }));
    const vis = boxes.filter(b => b.w > 0);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      assert.ok(a.r <= b.l + 0.5 || b.r <= a.l + 0.5 || a.b <= b.t || b.b <= a.t, `${a.q} overlaps ${b.q} at ${vp.width}px`);
    }
    assert.ok(!(await hp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)), "no horizontal scroll at " + vp.width);
    await hp.click("#welcome-start-btn");
    await hp.waitForSelector(".deck-slide");
    const top = await hp.evaluate(() => document.getElementById("topic-badge").getBoundingClientRect().top - document.getElementById("site-header").getBoundingClientRect().bottom);
    assert.ok(top >= 0, "topic title is not hidden under the header (" + top + ")");
    await hp.click("#menu-btn");
    await hp.waitForSelector("#menu-drawer.open");
    assert.equal(await hp.getAttribute("#menu-btn", "aria-expanded"), "true");
    assert.ok(await hp.isVisible('#topic-nav .nav-item[data-id="magnetic-fields"]'));
    if (vp.width === 390) await hp.screenshot({ path: path.join(SHOTS, "20-phone-menu.png") });
    await hp.keyboard.press("Escape");
    await hp.waitForSelector("#menu-drawer", { state: "hidden" });
    await hp.click("#menu-btn");
    await hp.waitForSelector("#menu-drawer.open");
    await hp.click("#settings-btn");
    await hp.waitForSelector("#settings-modal:not([hidden])");
    await hp.waitForSelector("#menu-drawer", { state: "hidden", timeout: 2000 }); // menu menutup, modal tidak tertimpa
    await hp.context().close();
  }
});
await step("Validator: explore code via gate link", async () => {
  const vp = await newPage();
  await vp.goto(BASE + "/");
  await vp.click("#gate-role-guest-btn");
  await vp.fill("#gate-guest-code-input", "kode-salah");
  await vp.click("#gate-guest-code-btn");
  await vp.waitForFunction(() => document.getElementById("gate-guest-code-status").textContent.length > 3);
  await vp.fill("#gate-guest-code-input", "  jelajah-uji ");
  await vp.click("#gate-guest-code-btn");
  await vp.waitForSelector("#site-shell:not([hidden])");
  await vp.close();
});
await step("no uncaught page errors", async () => {
  assert.deepEqual(pageErrors, []);
});
console.log(`\n${passed} E2E steps passed`);
await browser.close();
srv.kill();
process.exit(0);
