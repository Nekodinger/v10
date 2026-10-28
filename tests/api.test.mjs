/* Uji API backend Emergent end-to-end (PGlite/Postgres + mock Claude). Jalankan: node tests/api.test.mjs */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4510;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_PW = "admin-uji";
let TT = null, TT2 = null, ADM = null, teacherId = null;
const MF = "magnetic-fields";

const child = spawn(process.execPath, ["tests/dev-server.mjs"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), LIMIT_SIM_PER_STUDENT: "2" }, stdio: ["ignore", "pipe", "pipe"] });
child.stderr.on("data", d => process.stderr.write("[srv] " + d));
await new Promise((res, rej) => {
  const to = setTimeout(() => rej(new Error("server start timeout")), 20000);
  child.stdout.on("data", d => { if (String(d).includes("dev server")) { clearTimeout(to); res(); } });
});

let passed = 0;
async function api(body, headers = {}) {
  const r = await fetch(BASE + "/api/backend", { method: "POST", headers: { "content-type": "text/plain", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}
async function aiStream(body) {
  // Siswa hanya boleh memakai AI di sesi kelas: sertakan kode sesi aktif kecuali diuji sebaliknya.
  if (body.token && !("sessionCode" in body) && typeof classCode !== "undefined" && classCode) body = { ...body, sessionCode: classCode };
  const r = await fetch(BASE + "/api/ai", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) });
  if (!r.headers.get("content-type").includes("event-stream")) return { status: r.status, data: await r.json() };
  const txt = await r.text();
  const events = txt.split("\n\n").filter(Boolean).map(l => JSON.parse(l.replace(/^data: /, "")));
  return { status: r.status, events, text: events.filter(e => e.t === "delta").map(e => e.text).join("") };
}
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok  " + name); }
  catch (e) { console.error("  FAIL " + name + "\n", e); child.kill(); process.exit(1); }
}

const CLS = "XII IPA 1";
const S1 = `Budi Santoso (${CLS})`;     // ketua Kelompok 1
const S3 = `Rina Putri (${CLS})`;       // anggota Kelompok 1
const S2 = `Siti <b>Aminah</b> (${CLS})`; // tanpa kelompok
let pins = {}, tok1, tok2, tok3, classCode, quizId, gid;
const DEV_A = "d_aaaaaaaaaaaaaaaaaaaaaaaa", DEV_B = "d_bbbbbbbbbbbbbbbbbbbbbbbb";

await test("health reports config", async () => {
  const r = await fetch(BASE + "/api/health"); const d = await r.json();
  assert.equal(d.ok, true); assert.equal(d.ai, true); assert.equal(d.explore, true); assert.equal(d.admin, true);
  assert.equal(d.models, undefined, "model names are not exposed publicly");
});
await test("admin signs in, manages teacher accounts; teachers sign in with username + password", async () => {
  assert.equal((await api({ mode: "admin_login", username: "admin", password: "salah" })).status, 401);
  const a = await api({ mode: "admin_login", username: "Admin", password: ADMIN_PW });
  assert.equal(a.status, 200); ADM = a.data.token; assert.equal(a.data.mustChange, true);
  assert.equal((await api({ mode: "admin_teachers", adminToken: "x" })).status, 401);
  assert.equal((await api({ mode: "admin_teacher_create", adminToken: ADM, username: "x", name: "A" })).status, 400, "username too short");
  const c = await api({ mode: "admin_teacher_create", adminToken: ADM, username: "bu.rina", name: "Bu Rina", password: "rahasia123" });
  assert.equal(c.status, 200); teacherId = c.data.teacher.teacherId; assert.equal(c.data.password, null);
  const c2 = await api({ mode: "admin_teacher_create", adminToken: ADM, username: "pak.adi", name: "Pak Adi" });
  assert.equal(c2.data.password.length, 10, "generated password shown once");
  assert.equal((await api({ mode: "admin_teacher_create", adminToken: ADM, username: "bu.rina", name: "Lagi" })).status, 409);
  assert.equal((await api({ mode: "teacher_login", username: "bu.rina", password: "salah123" })).status, 401);
  const l = await api({ mode: "teacher_login", username: "BU.RINA", password: "rahasia123" });
  assert.equal(l.status, 200); TT = l.data.token; assert.equal(l.data.teacher.name, "Bu Rina");
  TT2 = (await api({ mode: "teacher_login", username: "pak.adi", password: c2.data.password })).data.token;
  assert.equal((await api({ mode: "teacher_me", teacherToken: TT })).data.teacher.username, "bu.rina");
  assert.equal((await api({ mode: "teacher_roster", teacherToken: ADM })).status, 401, "admin token is not a teacher token");
  assert.equal((await api({ mode: "admin_teachers", adminToken: TT })).status, 401, "teacher token is not an admin token");
  const list = await api({ mode: "admin_teachers", adminToken: ADM });
  assert.equal(list.data.teachers.length, 2);
  await api({ mode: "admin_teacher_update", adminToken: ADM, teacherId: c2.data.teacher.teacherId, active: false });
  assert.equal((await api({ mode: "teacher_me", teacherToken: TT2 })).status, 401);
  assert.equal((await api({ mode: "teacher_login", username: "pak.adi", password: c2.data.password })).status, 403);
  await api({ mode: "admin_teacher_update", adminToken: ADM, teacherId: c2.data.teacher.teacherId, active: true });
  const rp = await api({ mode: "admin_teacher_update", adminToken: ADM, teacherId: c2.data.teacher.teacherId, resetPassword: true });
  TT2 = (await api({ mode: "teacher_login", username: "pak.adi", password: rp.data.password })).data.token;
  assert.ok(TT2);
});
await test("teacher registers students into groups with unique PINs", async () => {
  const no = await api({ mode: "teacher_accounts_add", teacherToken: "x", lines: [{ name: "A", className: "B" }] });
  assert.equal(no.status, 401);
  const r = await api({ mode: "teacher_accounts_add", teacherToken: TT, lines: [
    { name: "Budi Santoso", className: CLS, group: "Kelompok 1" },
    { name: "Rina Putri", className: CLS, group: "Kelompok 1" },
    { name: "Siti <b>Aminah</b>", className: CLS, group: "" },
    { name: "Budi Santoso", className: CLS, group: "Kelompok 2" }
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.data.created.length, 3); assert.equal(r.data.skipped.length, 1, "duplicate name in the same class is skipped");
  r.data.created.forEach(c => { assert.match(c.pin, /^\d{6}$/); pins[c.studentId] = c.pin; });
  assert.equal(new Set(Object.values(pins)).size, 3);
  const l = await api({ mode: "teacher_accounts", teacherToken: TT });
  assert.equal(l.data.accounts.length, 3); assert.equal(l.data.groups.length, 1);
  const g = l.data.groups[0]; gid = g.groupId;
  assert.equal(g.leaderId, S1, "first member becomes leader");
  assert.equal(l.data.accounts.find(a => a.studentId === S3).pin, pins[S3], "teacher can read PINs back for login cards");
});
await test("student login: name + PIN, first name only works, wrong PIN rejected, throttled", async () => {
  const bad = await api({ mode: "student_login", name: "Budi Santoso", pin: "000000" });
  assert.equal(bad.status, 401);
  const wrongName = await api({ mode: "student_login", name: "Rina Putri", pin: pins[S1] });
  assert.equal(wrongName.status, 401, "PIN must belong to the typed name");
  const ok = await api({ mode: "student_login", name: "  budi ", pin: pins[S1], progress: { [MF]: 1 } });
  assert.equal(ok.status, 200); tok1 = ok.data.token;
  assert.equal(ok.data.account.studentId, S1); assert.equal(ok.data.account.isLeader, true); assert.equal(ok.data.account.groupName, "Kelompok 1");
  assert.equal(ok.data.progress[MF], 1);
  tok3 = (await api({ mode: "student_login", name: "Rina Putri", pin: pins[S3] })).data.token;
  tok2 = (await api({ mode: "student_login", name: "Siti <b>Aminah</b>", pin: pins[S2] })).data.token;
  const me3 = await api({ mode: "student_me", token: tok3 });
  assert.equal(me3.data.account.isLeader, false); assert.equal(me3.data.account.leaderName, "Budi Santoso");
  for (let i = 0; i < 8; i++) await api({ mode: "student_login", name: "Nama Acak", pin: "11111" + (i % 10) });
  const locked = await api({ mode: "student_login", name: "Nama Acak", pin: "999999" });
  assert.equal(locked.status, 429);
});
await test("student endpoints require a valid account token (no spoofed studentId)", async () => {
  const r = await api({ mode: "record_event", studentId: S1, kind: "materi_check", score: 100 });
  assert.equal(r.status, 401); assert.equal(r.data.code, "AUTH");
  const forged = await api({ mode: "lkpd_get", token: tok1.slice(0, -3) + "abc", topicId: MF });
  assert.equal(forged.status, 401);
  const ai = await aiStream({ mode: "chat", message: "hai" });
  assert.equal(ai.status, 401);
});
await test("verify_access: wrong code, explore code, class code needs login", async () => {
  assert.equal((await api({ mode: "verify_access", code: "salah" })).status, 403);
  const e = await api({ mode: "verify_access", code: " JELAJAH-UJI " });
  assert.equal(e.data.kind, "explore"); assert.ok(e.data.token.includes("."));
  const s = await api({ mode: "teacher_session", teacherToken: TT, action: "start", topicId: MF, tabIndex: 0 });
  classCode = s.data.state.code; assert.equal(classCode.length, 6);
  assert.equal((await api({ mode: "verify_access", code: classCode })).status, 401, "class code without account login");
  const j = await api({ mode: "verify_access", code: classCode.toLowerCase(), token: tok2 });
  assert.equal(j.data.kind, "class");
  const sy = await api({ mode: "session_sync", token: tok2, code: classCode, topicId: MF, tabIndex: 1, progress: { [MF]: 2 } });
  assert.equal(sy.data.inSession, true); assert.equal(sy.data.progress[MF], 2); assert.equal(sy.data.account.studentId, S2);
  const sy2 = await api({ mode: "session_sync", token: tok2, code: classCode, progress: { [MF]: 0 } });
  assert.equal(sy2.data.progress[MF], 2, "progress never goes backwards");
  const ro = await api({ mode: "teacher_roster", teacherToken: TT });
  assert.ok(ro.data.roster[S2].inSession);
});
await test("group work: only the leader, only from one device (lock, takeover)", async () => {
  const mem = await api({ mode: "lkpd_save", token: tok3, deviceId: DEV_A, topicId: MF, lkpdMode: "virtual", data: { a: { predict: 1 } }, progress: 10 });
  assert.equal(mem.status, 403); assert.equal(mem.data.code, "NOT_LEADER"); assert.match(mem.data.error, /Budi Santoso/);
  const nolock = await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_A, topicId: MF, lkpdMode: "virtual", data: {}, progress: 0 });
  assert.equal(nolock.status, 409); assert.equal(nolock.data.code, "LOCKED");
  const a = await api({ mode: "group_lock", token: tok1, deviceId: DEV_A, topicId: MF, section: "eksperimen", action: "acquire" });
  assert.equal(a.data.ok, true);
  const b = await api({ mode: "group_lock", token: tok1, deviceId: DEV_B, topicId: MF, section: "eksperimen", action: "acquire" });
  assert.equal(b.data.ok, false); assert.equal(b.data.otherDevice, true);
  const m = await api({ mode: "group_lock", token: tok3, deviceId: DEV_B, topicId: MF, section: "eksperimen", action: "acquire" });
  assert.equal(m.data.ok, false); assert.equal(m.data.notLeader, true); assert.equal(m.data.leaderName, "Budi Santoso");
  const save = await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_A, topicId: MF, lkpdMode: "virtual", data: { a: { predict: 1 }, updatedAt: 1 }, progress: 40 });
  assert.equal(save.status, 200);
  assert.equal((await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_B, topicId: MF, lkpdMode: "virtual", data: {}, progress: 0 })).status, 409);
  const tk = await api({ mode: "group_lock", token: tok1, deviceId: DEV_B, topicId: MF, section: "eksperimen", action: "takeover" });
  assert.equal(tk.data.ok, true);
  assert.equal((await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_A, topicId: MF, lkpdMode: "virtual", data: {}, progress: 0 })).status, 409, "old device loses the lock");
  await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_B, topicId: MF, lkpdMode: "virtual", data: { a: { predict: 1, conclusion: "F sebanding I" }, updatedAt: 2 }, progress: 100, submit: true });
  await api({ mode: "lkpd_save", token: tok1, deviceId: DEV_B, topicId: MF, lkpdMode: "virtual", data: { a: { predict: 2 }, updatedAt: 3 }, progress: 100 });
  const g3 = await api({ mode: "lkpd_get", token: tok3, topicId: MF });
  assert.equal(g3.data.modes.virtual.status, "submitted", "member sees the group LKPD; submitted stays submitted");
  assert.equal(g3.data.modes.virtual.data.a.predict, 2);
  const x = await api({ mode: "eksperimen_data_save", token: tok1, deviceId: DEV_B, topicId: MF, variant: "virtual", context: "Current balance", rows: [{ I: 0.5, values: [0.51, 0.5, null] }, { I: 1, values: [1.02, "", 1.0] }], meta: { replicateCount: 3 }, analysis: { gradient: 0.02, B: 0.4 } });
  assert.equal(x.data.ok, true); assert.match(x.data.feedback, /hanya aktif saat belajar di kelas/, "self-study: no AI data check");
  const x2 = await api({ mode: "eksperimen_data_save", token: tok1, deviceId: DEV_B, sessionCode: classCode, topicId: MF, variant: "virtual", context: "Current balance", rows: [{ I: 0.5, values: [0.51, 0.5, null] }, { I: 1, values: [1.02, "", 1.0] }], meta: { replicateCount: 3 }, analysis: { gradient: 0.02, B: 0.4 } });
  assert.equal(x2.data.ok, true); assert.match(x2.data.feedback, /wajar/);
  const st = await api({ mode: "group_state", token: tok3, deviceId: DEV_A, topicId: MF });
  assert.equal(st.data.locks.eksperimen.active, true); assert.equal(st.data.lkpd.virtual.progress, 100); assert.equal(st.data.lastVariant, "virtual");
});
await test("events: individual vs group kinds", async () => {
  assert.equal((await api({ mode: "record_event", token: tok3, topicId: MF, kind: "materi_check", item: "attempt", score: 80, payload: { answers: [1] } })).data.ok, true);
  const skip = await api({ mode: "record_event", token: tok3, topicId: MF, kind: "eksperimen_check", score: 100 });
  assert.equal(skip.data.skipped, true, "members cannot write group events");
  assert.equal((await api({ mode: "record_event", token: tok1, topicId: MF, kind: "eksperimen_check", item: "attempt", score: 100, payload: { answers: [] } })).data.ok, true);
  assert.equal((await api({ mode: "record_event", token: tok1, kind: "hack" })).status, 400);
});
await test("group gate: leader submits, teacher approves, members unlocked", async () => {
  assert.equal((await api({ mode: "gate_submit", token: tok3, deviceId: DEV_A, topicId: MF, stage: "eksperimen", summary: "x" })).status, 403);
  const sub = await api({ mode: "gate_submit", token: tok1, deviceId: DEV_B, topicId: MF, stage: "eksperimen", summary: "lulus 2/2" });
  assert.equal(sub.data.ok, true);
  assert.equal((await api({ mode: "gate_status", token: tok3, topicId: MF })).data.eksperimen.status, "pending");
  const ro = await api({ mode: "teacher_roster", teacherToken: TT });
  const p = ro.data.gatePending.find(g => g.stage === "eksperimen");
  assert.equal(p.studentId, "grp:" + gid); assert.equal(p.label, `Kelompok 1 (${CLS})`);
  assert.equal((await api({ mode: "teacher_gate_decide", teacherToken: TT, topicId: MF, studentId: p.studentId, stage: "eksperimen", decision: "approved" })).data.ok, true);
  assert.equal((await api({ mode: "teacher_gate_decide", teacherToken: TT, topicId: MF, studentId: p.studentId, stage: "eksperimen", decision: "approved" })).status, 404);
  assert.equal((await api({ mode: "gate_status", token: tok3, topicId: MF })).data.eksperimen.status, "approved");
  assert.equal((await api({ mode: "gate_status", token: tok1, topicId: MF })).data.eksperimen.status, "approved");
});
await test("quiz bank (manual, per teacher), publish, submit, results, archive", async () => {
  assert.equal((await api({ mode: "quiz_generate", teacherToken: TT, topicTitle: "Magnetic Fields", count: 2 })).status, 400, "AI quiz generation removed");
  const manual = [
    { type: "mcq", question: "Sebuah kawat sepanjang $0{,}20$ m membawa arus 3,0 A tegak lurus medan 0,50 T. Gaya pada kawat adalah", options: ["0,30 N", "0,15 N", "3,0 N", "0,60 N"], correct: 0, modelAnswer: "F = BIL" },
    { type: "short", question: "Nyatakan definisi tesla.", modelAnswer: "1 T = 1 N A^-1 m^-1" }
  ];
  await api({ mode: "quiz_bank_save", teacherToken: TT, topicId: MF, questions: manual });
  assert.equal((await api({ mode: "quiz_bank_get", teacherToken: TT2, topicId: MF })).data.questions.length, 0, "question banks are per teacher");
  const gb = await api({ mode: "quiz_bank_get", teacherToken: TT, topicId: MF });
  const p = await api({ mode: "quiz_publish", teacherToken: TT, topicId: MF, questions: gb.data.questions });
  quizId = p.data.quiz.id;
  const s = await api({ mode: "session_sync", token: tok2, code: classCode });
  assert.equal(s.data.activeQuiz.id, quizId); assert.equal(s.data.activeQuiz.questions[0].correct, undefined, "answer key never sent to students");
  const sub = await api({ mode: "quiz_submit", token: tok2, code: classCode, quizId, answers: { [gb.data.questions[0].id]: 0, [gb.data.questions[1].id]: "1 T = 1 N/(A m)" } });
  assert.equal(sub.data.ok, true);
  assert.equal((await api({ mode: "session_sync", token: tok2, code: classCode })).data.activeQuiz.submitted, true);
  assert.equal((await api({ mode: "quiz_results", teacherToken: TT })).data.answers[0].score, 100);
  await api({ mode: "quiz_publish", teacherToken: TT, topicId: MF, questions: [gb.data.questions[1]] });
  assert.equal((await api({ mode: "quiz_results", teacherToken: TT, quizId })).data.answers.length, 1);
  const list = await api({ mode: "quiz_list", teacherToken: TT });
  assert.equal(list.data.quizzes.length, 2); assert.equal(list.data.quizzes.filter(z => z.active).length, 1);
});
await test("tes sumatif: default = PDF test (48 marks), edit, publish, student draft & submit, grading", async () => {
  const g = await api({ mode: "test_get", teacherToken: TT, topicId: MF });
  assert.equal(g.data.isDefault, true);
  const items = g.data.test.sections.flatMap(S => S.items);
  assert.equal(items.length, 17); assert.equal(items.filter(i => i.type === "mcq").length, 10);
  const max = items.reduce((a, i) => a + (i.type === "structured" ? i.parts.reduce((x, p) => x + p.marks, 0) : i.marks), 0);
  assert.equal(max, 48);
  // Guru mengedit: ubah judul + tambah satu soal pilihan ganda
  const t2 = JSON.parse(JSON.stringify(g.data.test));
  t2.title = "Tes Sumatif MF (revisi)";
  t2.sections[0].items.push({ id: "A11", type: "mcq", stem: "Soal tambahan", options: ["a", "b", "c", "d"], correct: 3, marks: 1 });
  const sv = await api({ mode: "test_save", teacherToken: TT, topicId: MF, test: t2 });
  assert.equal(sv.data.isDefault, false); assert.equal(sv.data.test.sections[0].items.length, 11);
  assert.equal((await api({ mode: "test_get", teacherToken: TT2, topicId: MF })).data.isDefault, true, "other teachers keep the default");
  const pub = await api({ mode: "test_publish", teacherToken: TT, topicId: MF, durationMin: 60 });
  assert.equal(pub.status, 200); const testId = pub.data.test.id;
  const sy = await api({ mode: "session_sync", token: tok2, code: classCode });
  assert.equal(sy.data.activeTest.id, testId); assert.equal(sy.data.activeQuiz.id !== testId, true, "quiz and test are separate");
  const st = await api({ mode: "student_test_get", token: tok2, code: classCode });
  assert.equal(st.data.test.title, "Tes Sumatif MF (revisi)");
  const a1 = st.data.test.sections[0].items[0];
  assert.equal(a1.correct, undefined, "answer key hidden"); assert.equal(a1.explanation, undefined);
  assert.equal(st.data.test.sections[1].items[0].parts[0].key, undefined, "rubric hidden");
  const ink = "data:image/png;base64," + Buffer.from("fakepng").toString("base64");
  const d1 = await api({ mode: "student_test_save", token: tok2, code: classCode, quizId: testId, answers: { A1: 2, A2: 1, "B1.a": { text: "Gaya ke atas, $F = BIL$", ink }, "B1.zzz": { text: "abaikan" }, C1: { text: "naikkan $I$" } } });
  assert.equal(d1.data.status, "draft");
  const st2 = await api({ mode: "student_test_get", token: tok2, code: classCode });
  assert.equal(st2.data.answers.A1, 2); assert.equal(st2.data.answers["B1.a"].ink, ink); assert.equal(st2.data.answers["B1.zzz"], undefined);
  assert.equal((await api({ mode: "student_test_save", token: tok2, code: classCode, quizId: testId, answers: { "B1.a": { ink: "javascript:alert(1)" } } })).data.status, "draft");
  assert.equal((await api({ mode: "student_test_get", token: tok2, code: classCode })).data.answers["B1.a"], undefined, "non-image ink rejected");
  await api({ mode: "student_test_save", token: tok2, code: classCode, quizId: testId, answers: { A1: 2, A2: 0, A11: 3, "B1.a": { text: "Gaya ke atas", ink } } });
  const sub = await api({ mode: "student_test_submit", token: tok2, code: classCode, quizId: testId, answers: { A1: 2, A2: 0, A11: 3, "B1.a": { text: "Gaya ke atas", ink } } });
  assert.equal(sub.data.status, "submitted");
  assert.equal((await api({ mode: "student_test_save", token: tok2, code: classCode, quizId: testId, answers: {} })).status, 409, "no changes after submit");
  const res = await api({ mode: "test_results", teacherToken: TT });
  const row = res.data.rows.find(r => r.studentId === S2);
  assert.equal(row.status, "submitted"); assert.equal(row.autoScore, 3, "A1, A2, A11 correct"); assert.equal(res.data.test.max, 49);
  const det = await api({ mode: "test_answer_detail", teacherToken: TT, quizId: testId, studentId: S2 });
  assert.equal(det.data.test.sections[1].items[0].parts[0].key.length > 10, true, "teacher sees rubric");
  const gr = await api({ mode: "test_grade", teacherToken: TT, quizId: testId, studentId: S2, manual: { "B1.a": 9, "C1": 3 } });
  assert.equal(gr.data.scores.total, 3 + 2 + 3, "manual score clamped to max (B1.a max 2)");
  assert.equal((await api({ mode: "test_answer_detail", teacherToken: TT2, quizId: testId, studentId: S2 })).status, 404);
  const ov = await api({ mode: "teacher_overview", teacherToken: TT });
  assert.equal(ov.data.testAnswers.find(x => x.studentId === S2).total, 8);
  await api({ mode: "test_end", teacherToken: TT });
  assert.equal((await api({ mode: "session_sync", token: tok2, code: classCode })).data.activeTest, null);
  const rs = await api({ mode: "test_save", teacherToken: TT, topicId: MF, reset: true });
  assert.equal(rs.data.isDefault, true, "reset to default");
});
await test("AI: chat per student; simulate = group work with lock and group quota", async () => {
  const c = await aiStream({ mode: "chat", token: tok3, topic: "Magnetic Fields", message: "Apa itu F=BIL?", history: [{ role: "model", text: "Halo" }, { role: "user", text: "hai" }, { role: "model", text: "Silakan" }] });
  assert.equal(c.status, 200); assert.ok(c.text.length > 20); assert.equal(c.events.at(-1).t, "done");
  const log = await (await fetch(BASE + "/__mocklog")).json();
  const chat = log.filter(l => l.model === "claude-haiku-5-5" && l.stream).at(-1);
  assert.deepEqual(chat.thinking, { type: "disabled" }); assert.equal(chat.output_config.effort, "low"); assert.equal(chat.system, true);
  const self = await aiStream({ mode: "chat", token: tok3, sessionCode: "", topic: "Magnetic Fields", message: "hai" });
  assert.equal(self.status, 403); assert.equal(self.data.code, "CLASS_ONLY", "self-study students cannot use the tutor");
  const selfSim = await aiStream({ mode: "simulate", token: tok1, deviceId: DEV_A, sessionCode: "ZZZZZZ", topicId: MF, prompt: "x" });
  assert.equal(selfSim.status, 403); assert.equal(selfSim.data.code, "CLASS_ONLY", "wrong session code cannot use Makerspace");
  const mem = await aiStream({ mode: "simulate", token: tok3, deviceId: DEV_A, topicId: MF, prompt: "x" });
  assert.equal(mem.status, 403); assert.equal(mem.data.code, "NOT_LEADER");
  const nolock = await aiStream({ mode: "simulate", token: tok1, deviceId: DEV_A, topicId: MF, prompt: "x" });
  assert.equal(nolock.status, 409);
  assert.equal((await api({ mode: "group_lock", token: tok1, deviceId: DEV_A, topicId: MF, section: "lab", action: "acquire" })).data.ok, true);
  const r = await aiStream({ mode: "simulate", token: tok1, deviceId: DEV_A, topicId: MF, prompt: "Buat simulasi F=BIL" });
  assert.ok(r.text.startsWith("<!DOCTYPE html>")); assert.ok(r.text.trim().endsWith("</html>"));
  const sim = (await (await fetch(BASE + "/__mocklog")).json()).filter(l => l.model === "claude-opus-5-5").at(-1);
  assert.equal(sim.thinking, undefined); assert.equal(sim.output_config.effort, "low"); assert.equal(sim.max_tokens, 32000);
  const ed = await aiStream({ mode: "edit", token: tok1, deviceId: DEV_A, topicId: MF, html: r.text, instruction: "ubah warna" });
  assert.ok(ed.text.includes("</html>"));
  const cont = await aiStream({ mode: "continue", token: tok1, deviceId: DEV_A, topicId: MF, prompt: "Buat simulasi F=BIL", partial: r.text.slice(0, 300) });
  assert.ok(cont.text.length > 10);
  const st = await api({ mode: "group_state", token: tok3, topicId: MF });
  assert.equal(st.data.sim.kind, "lab_edit"); assert.equal(st.data.sim.html, r.text.slice(0, 300) + cont.text, "member sees the latest (continued) group simulation");
  assert.equal(st.data.sim.prompt, "ubah warna");
  await aiStream({ mode: "simulate", token: tok1, deviceId: DEV_A, topicId: MF, prompt: "lagi" });
  const third = await aiStream({ mode: "simulate", token: tok1, deviceId: DEV_A, topicId: MF, prompt: "lagi lagi" });
  assert.equal(third.status, 429, "quota counted per group");
  const solo = await aiStream({ mode: "simulate", token: tok2, deviceId: DEV_B, topicId: MF, prompt: "solo" });
  assert.ok(solo.text.includes("</html>"), "students without a group work alone, no lock needed");
});
await test("teacher overview & detail show group work for every member", async () => {
  const o = await api({ mode: "teacher_overview", teacherToken: TT });
  assert.ok(o.data.students.find(s => s.studentId === S2 && s.name === "Siti <b>Aminah</b>"), "XSS name stored raw (escaped on render)");
  assert.ok(o.data.lkpd.find(l => l.studentId === S3 && l.group && l.status === "submitted"));
  assert.ok(o.data.lkpd.find(l => l.studentId === S1 && l.group));
  assert.ok(o.data.events.find(e => e.studentId === S3 && e.kind === "lab_generate" && e.n === 2));
  assert.ok(o.data.events.find(e => e.studentId === S3 && e.kind === "materi_check" && e.best === 80));
  assert.ok(o.data.gates.find(g => g.studentId === S3 && g.stage === "eksperimen" && g.status === "approved"));
  assert.ok(!o.data.lkpd.find(l => /^grp:/.test(l.studentId)), "raw group keys are not listed as students");
  assert.equal(o.data.accounts.length, 3); assert.equal(o.data.groups.length, 1);
  const d = await api({ mode: "teacher_student_detail", teacherToken: TT, studentId: S3 });
  assert.equal(d.data.student.groupName, "Kelompok 1"); assert.equal(d.data.student.isLeader, false);
  assert.ok(d.data.events.find(e => e.kind === "lab_generate" && e.group && e.payload.html.includes("</html>")));
  assert.equal(d.data.experiments[0].analysis.B, 0.4); assert.equal(d.data.experiments[0].rows[1].values[1], null);
  const x = await api({ mode: "teacher_export", teacherToken: TT });
  assert.equal(x.data.students.length, 3); assert.equal(x.data.quizzes.length, 2);
  assert.equal((await api({ mode: "teacher_usage", teacherToken: TT })).status, 400, "AI usage moved to the Admin Panel");
  const u = await api({ mode: "admin_usage", adminToken: ADM, period: "today" });
  assert.equal(u.data.today.simulate, 3);
  const sim = u.data.byKind.find(k => k.kind === "simulate");
  assert.equal(sim.requests, 3); assert.ok(sim.output > 0, "output tokens recorded");
  const chat = u.data.byKind.find(k => k.kind === "chat");
  assert.ok(chat.input > 0 && chat.output > 0, "chat input & output tokens recorded");
  const acc = u.data.byAccount.find(a => a.accountId === S3);
  assert.ok(acc && acc.chatTokens > 0, "usage per student account");
  assert.equal(u.data.accounts[S3].teacherId, teacherId);
  assert.ok(u.data.byTeacher.find(t => t.teacherId === teacherId).requests >= 4, "usage per teacher");
  const o2 = await api({ mode: "teacher_overview", teacherToken: TT2 });
  assert.equal(o2.data.students.length, 0); assert.equal(o2.data.accounts.length, 0);
  assert.equal((await api({ mode: "teacher_student_detail", teacherToken: TT2, studentId: S3 })).status, 404);
  assert.equal((await api({ mode: "teacher_account_update", teacherToken: TT2, studentId: S1, resetPin: true })).status, 404);
});
await test("teacher: change leader, release lock, reset PIN, deactivate", async () => {
  assert.equal((await api({ mode: "teacher_group_update", teacherToken: TT, groupId: gid, leaderId: S2 })).status, 400, "leader must be a member");
  assert.equal((await api({ mode: "teacher_group_update", teacherToken: TT, groupId: gid, leaderId: S3 })).data.ok, true);
  const me3 = await api({ mode: "student_me", token: tok3 });
  assert.equal(me3.data.account.isLeader, true);
  const st = await api({ mode: "group_state", token: tok3, topicId: MF });
  assert.equal(st.data.locks.lab.active, false, "changing leader releases device locks");
  const rp = await api({ mode: "teacher_account_update", teacherToken: TT, studentId: S1, resetPin: true });
  assert.match(rp.data.pin, /^\d{6}$/); assert.notEqual(rp.data.pin, pins[S1]);
  const old = await api({ mode: "student_me", token: tok1 });
  assert.equal(old.status, 401, "old token invalid after PIN reset");
  assert.equal((await api({ mode: "student_login", name: "Budi Santoso", pin: rp.data.pin })).status, 200);
  await api({ mode: "teacher_account_update", teacherToken: TT, studentId: S1, active: false });
  assert.equal((await api({ mode: "student_login", name: "Budi Santoso", pin: rp.data.pin })).status, 403);
  await api({ mode: "teacher_account_update", teacherToken: TT, studentId: S1, groupName: "Kelompok 2" });
  const l = await api({ mode: "teacher_accounts", teacherToken: TT });
  assert.equal(l.data.groups.length, 2);
  assert.equal(l.data.groups.find(g => g.name === "Kelompok 2").leaderId, S1);
});
await test("end session -> student keeps token, sync says not in session", async () => {
  await api({ mode: "teacher_session", teacherToken: TT, action: "end" });
  const s = await api({ mode: "session_sync", token: tok2, code: classCode });
  assert.equal(s.data.inSession, false); assert.equal(s.data.activeQuiz, null);
  assert.equal((await api({ mode: "quiz_submit", token: tok2, code: classCode, quizId, answers: {} })).status, 409);
  const after = await aiStream({ mode: "chat", token: tok2, topic: "Magnetic Fields", message: "hai" });
  assert.equal(after.data.code, "CLASS_ONLY", "AI closes when the class session ends");
});
await test("bulk: move to class re-keys answers, move to group, delete", async () => {
  const add = await api({ mode: "teacher_accounts_add", teacherToken: TT, lines: [
    { name: "Eka", className: "X-1", group: "G1" }, { name: "Fajar", className: "X-1", group: "G1" }, { name: "Gita", className: "X-2", group: "" }] });
  assert.equal(add.data.created.length, 3);
  const eka = (await api({ mode: "student_login", name: "Eka", pin: add.data.created[0].pin })).data.token;
  assert.equal((await api({ mode: "record_event", token: eka, topicId: MF, kind: "latihan", item: "q1", payload: { answer: "A" }, score: 1 })).status, 200);
  const ev0 = await api({ mode: "teacher_student_detail", teacherToken: TT, studentId: "Eka (X-1)" });
  assert.equal(ev0.data.events.length, 1);
  assert.equal((await api({ mode: "teacher_accounts_bulk", teacherToken: TT, studentIds: [], action: "delete" })).status, 400);
  const mv = await api({ mode: "teacher_accounts_bulk", teacherToken: TT, studentIds: ["Eka (X-1)", "Fajar (X-1)"], action: "move", className: "X-2", groupName: "G9" });
  assert.deepEqual(mv.data.done.sort(), ["Eka (X-2)", "Fajar (X-2)"]);
  const l = await api({ mode: "teacher_accounts", teacherToken: TT });
  const g9 = l.data.groups.find(g => g.name === "G9" && g.className === "X-2");
  assert.ok(g9 && g9.leaderId === "Eka (X-2)", "first moved student leads the new group");
  assert.equal(l.data.accounts.filter(a => a.groupId === g9.groupId).length, 2);
  assert.ok(!l.data.accounts.some(a => a.studentId === "Eka (X-1)"));
  assert.equal((await api({ mode: "student_me", token: eka })).status, 401, "old token invalid after class move");
  const ev1 = await api({ mode: "teacher_student_detail", teacherToken: TT, studentId: "Eka (X-2)" });
  assert.equal(ev1.data.events.length, 1, "answers move with the student");
  assert.equal(ev1.data.student.className, "X-2");
  const dup = await api({ mode: "teacher_accounts_add", teacherToken: TT, lines: [{ name: "Gita", className: "X-1", group: "" }] });
  const gx = await api({ mode: "teacher_accounts_bulk", teacherToken: TT, studentIds: ["Gita (X-2)"], action: "move", className: "X-1" });
  assert.equal(gx.data.skipped.length, 1, "name clash in target class is skipped");
  const ng = await api({ mode: "teacher_accounts_bulk", teacherToken: TT, studentIds: ["Fajar (X-2)"], action: "move", groupName: "" });
  assert.deepEqual(ng.data.done, ["Fajar (X-2)"]);
  const del = await api({ mode: "teacher_accounts_bulk", teacherToken: TT, studentIds: ["Eka (X-2)", "Fajar (X-2)", "Gita (X-2)", "Gita (X-1)"], action: "delete" });
  assert.equal(del.data.done.length, 4);
  const l2 = await api({ mode: "teacher_accounts", teacherToken: TT });
  assert.ok(!l2.data.accounts.some(a => ["Eka", "Fajar", "Gita"].includes(a.name)));
  assert.ok(dup.data.created.length === 1);
});
await test("foreign origin rejected, delete student removes account", async () => {
  assert.equal((await api({ mode: "health" }, { origin: "https://evil.example" })).status, 403);
  assert.equal((await api({ mode: "teacher_delete_student", teacherToken: TT, studentId: S2 })).data.ok, true);
  assert.equal((await api({ mode: "student_me", token: tok2 })).status, 401);
  const o = await api({ mode: "teacher_overview", teacherToken: TT });
  assert.equal(o.data.students.length, 2); assert.equal(o.data.accounts.length, 2);
});

await test("security: forged tokens rejected; password & code guessing is throttled", async () => {
  const crypto = await import("node:crypto");
  const b64 = x => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const body = b64(JSON.stringify({ k: "account", e: Date.now() + 1e9, n: "x", s: S1, v: 1 }));
  const legacyKey = crypto.createHash("sha256").update("ps9:" + ADMIN_PW).digest();
  const forged = body + "." + b64(crypto.createHmac("sha256", legacyKey).update(body).digest());
  assert.equal((await api({ mode: "student_me", token: forged })).status, 401, "token signed with the teacher code is rejected");
  const ip = { "x-real-ip": "10.66.6.6" };
  for (let i = 0; i < 10; i++) assert.equal((await api({ mode: "teacher_login", username: "bu.rina", password: "tebak-" + i }, ip)).status, 401);
  const blocked = await api({ mode: "teacher_login", username: "bu.rina", password: "rahasia123" }, ip);
  assert.equal(blocked.status, 429, "even the right password waits after 10 wrong guesses");
  for (let i = 0; i < 10; i++) await api({ mode: "admin_login", username: "admin", password: "tebak-" + i }, ip);
  assert.equal((await api({ mode: "admin_login", username: "admin", password: ADMIN_PW }, ip)).status, 429, "admin password guessing throttled");
  for (let i = 0; i < 40; i++) await api({ mode: "verify_access", code: "SALAH" + i }, ip);
  assert.equal((await api({ mode: "verify_access", code: "jelajah-uji" }, ip)).status, 429, "access-code guessing throttled");
});
console.log(`\n${passed} API tests passed`);
child.kill();
process.exit(0);
