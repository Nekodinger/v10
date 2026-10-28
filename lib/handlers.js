/* ============================================================
   lib/handlers.js - semua "mode" backend non-streaming
   ------------------------------------------------------------
   Pengganti apps-script/Code.gs V7. Bentuk permintaan tetap sama
   ({ mode: "...", ... }) supaya alur front-end lama tetap dikenali,
   tetapi data sekarang tersimpan di PostgreSQL (Supabase), bukan
   PropertiesService/Google Sheets: lebih cepat, tidak ada batas 9 KB
   per properti, dan SEMUA jawaban siswa terekam permanen untuk Panel Guru.
   ============================================================ */
import crypto from "node:crypto";
import { q, one, J, jsonSize } from "./db.js";
import { issueToken, verifyToken, matchExplore, exploreCode } from "./auth.js";
import {
  AccountError, loginStudent, accountInfo, resolveStudent, workKey, groupKey, isGroupKey, lockAction, assertGroupWriter,
  releaseGroupLocks, locksForGroups, newUniquePin, pinEncrypt, pinDecrypt, normalizeName, cleanLabel, studentIdFor, GROUP_SECTIONS,
  primeAuth, guardAccessCode
} from "./accounts.js";
import {
  loginAdmin, resolveAdmin, changeAdminPassword, adminReady, loginTeacher, resolveTeacher, createTeacher, updateTeacher,
  changeTeacherPassword, publicTeacher
} from "./staff.js";
import { aiConfigured, createMessage, extractJson, MODELS } from "./anthropic.js";
import { buildDataCheckPrompt } from "./prompts.js";
import { takeQuota, limits, usageToday } from "./usage.js";
import { recordTokens, usageReport } from "./tokens.js";
import { DEFAULT_TEST, sanitizeTest, publicTest, scoringItems, computeScores } from "./sumatif.js";

const MAX_SID = 80;
const ROSTER_WINDOW_MS = 5 * 60 * 1000;
const VALID_LEVELS = ["dasar", "menengah", "lanjut"];
const STAGES = ["eksperimen", "lab"];
const EVENT_KINDS = ["materi_check", "eksperimen_check", "latihan", "lab_prompt", "lab_generate", "lab_edit", "lab_reflection", "vlab_check", "lkpd_check", "slides_progress", "quiz_submit", "gate_submit"];
// Aktivitas kerja kelompok: disimpan dengan kunci kelompok dan hanya boleh dari ketua.
const GROUP_EVENT_KINDS = ["eksperimen_check", "vlab_check", "lkpd_check", "lab_prompt", "lab_reflection"];

export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);
const sidOf = b => str(b.studentId, MAX_SID);
const topicOf = b => str(b.topicId, 60);
const now = () => Date.now();
const lvl = v => (VALID_LEVELS.includes(String(v || "").toLowerCase()) ? String(v).toLowerCase() : null);
const isEn = b => b.lang === "en";
// ID tamu/validator ("Tamu-XXXX") tidak disimpan sebagai data siswa.
export const isGuestId = sid => /^Tamu-/.test(String(sid || ""));

// Identitas siswa SELALU diambil dari token akun (bukan dari studentId kiriman klien).
async function ctxOf(b, required) {
  const c = await resolveStudent(b);
  if (!c && required !== false) throw new HttpError(401, isEn(b)
    ? "Your login has ended. Sign in again with your name and PIN."
    : "Sesi login kamu sudah berakhir. Masuk lagi dengan nama dan PIN dari gurumu.", "AUTH");
  return c;
}

// Panel Guru: identitas guru SELALU dari token akun guru (dibuat admin).
async function requireTeacher(b) {
  const t = await resolveTeacher(b);
  if (!t) throw new HttpError(401, isEn(b) ? "Your teacher sign-in has ended. Sign in again." : "Sesi masuk guru sudah berakhir. Silakan masuk lagi.", "TEACHER_AUTH");
  return t;
}
async function requireAdmin(b) {
  const a = await resolveAdmin(b);
  if (!a) throw new HttpError(401, isEn(b) ? "Your admin sign-in has ended. Sign in again." : "Sesi masuk admin sudah berakhir. Silakan masuk lagi.", "ADMIN_AUTH");
  return a;
}

/* ---------------- Sesi kelas (satu sesi per guru) ---------------- */
const EMPTY_SESSION = { active: false, code: null, topicId: null, tabIndex: null, updatedAt: null, teacherId: null };
function sessionRow(r) {
  if (!r) return { ...EMPTY_SESSION };
  return { active: !!r.active, code: r.code || null, topicId: r.topic_id || null, tabIndex: r.tab_index == null ? null : Number(r.tab_index), updatedAt: r.updated_at, teacherId: r.teacher_id || null };
}
async function readTeacherSession(tid) {
  return sessionRow(await one(`select * from ps_sessions where teacher_id = $1`, [tid]));
}
async function writeTeacherSession(tid, s) {
  await q(`insert into ps_sessions (teacher_id, active, code, topic_id, tab_index, updated_at) values ($1, $2, $3, $4, $5, $6)
           on conflict (teacher_id) do update set active = excluded.active, code = excluded.code, topic_id = excluded.topic_id,
           tab_index = excluded.tab_index, updated_at = excluded.updated_at`,
    [tid, !!s.active, s.code, s.topicId, s.tabIndex, s.updatedAt]);
}
async function sessionByCode(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(c)) return { ...EMPTY_SESSION };
  return sessionRow(await one(`select * from ps_sessions where active = true and upper(code) = $1 limit 1`, [c]));
}
// Sesi kelas yang boleh diikuti siswa ini: kode cocok DAN (akun milik guru sesi itu,
// atau akun lama tanpa guru). Tamu/validator boleh mengikuti sesi mana pun.
async function sessionForStudent(ctx, code) {
  const st = await sessionByCode(code);
  if (!st.active) return st;
  const owner = ctx && ctx.account ? ctx.account.teacherId : null;
  if (owner && owner !== st.teacherId) return { ...EMPTY_SESSION };
  return st;
}
function codeMatches(state, code) {
  return !!(state.active && state.code && code && String(code).trim().toUpperCase() === state.code.toUpperCase());
}
function generateSessionCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, x => chars[x % chars.length]).join("");
}
async function uniqueSessionCode() {
  for (let i = 0; i < 20; i++) {
    const c = generateSessionCode();
    if (!(await one(`select 1 from ps_sessions where active = true and upper(code) = $1`, [c]))) return c;
  }
  return generateSessionCode();
}

/* ---------------- Kepemilikan data guru ---------------- */
// ID siswa & kunci kelompok milik guru ini (dipakai untuk menyaring semua rekap).
async function teacherScope(tid) {
  const accs = await q(`select student_id from ps_accounts where teacher_id = $1`, [tid]);
  const groups = await q(`select group_id from ps_groups where teacher_id = $1`, [tid]);
  const sids = accs.map(r => r.student_id);
  const gkeys = groups.map(g => groupKey(g.group_id));
  return { sids, gkeys, keys: sids.concat(gkeys), sidSet: new Set(sids), keySet: new Set(sids.concat(gkeys)) };
}
async function assertOwnsKey(tid, key, en) {
  const k = String(key || "");
  if (isGroupKey(k)) {
    if (await one(`select 1 from ps_groups where group_id = $1 and teacher_id = $2`, [k.slice(4), tid])) return;
  } else if (await one(`select 1 from ps_accounts where student_id = $1 and teacher_id = $2`, [k, tid])) return;
  throw new HttpError(404, en ? "Student not found in your classes." : "Siswa tidak ditemukan di kelas Anda.");
}

/* ---------------- Siswa ---------------- */
function mergeProgress(a, b) {
  const out = { ...(a && typeof a === "object" ? a : {}) };
  if (b && typeof b === "object") {
    Object.keys(b).slice(0, 40).forEach(k => {
      const v = parseInt(b[k], 10);
      if (!isNaN(v) && v >= 0 && v <= 3) out[k.slice(0, 60)] = Math.max(out[k] == null ? -1 : out[k], v);
    });
  }
  return out;
}
function splitName(sid) {
  const m = /^(.*)\(([^()]*)\)\s*$/.exec(sid);
  return m ? { name: m[1].trim(), cls: m[2].trim() } : { name: sid, cls: "" };
}
async function touchStudent(sid, fields) {
  if (!sid) return null;
  const existing = await one(`select progress from ps_students where student_id = $1`, [sid]);
  const progress = mergeProgress(existing ? existing.progress : {}, fields.progress);
  const nm = splitName(sid);
  await q(`insert into ps_students (student_id, name, class_name, created_at, last_seen, session_code, topic_id, tab_index, level, progress)
           values ($1, $2, $3, $4, $4, $5, $6, $7, $8, $9::jsonb)
           on conflict (student_id) do update set
             last_seen = excluded.last_seen,
             session_code = excluded.session_code,
             topic_id = coalesce(excluded.topic_id, ps_students.topic_id),
             tab_index = coalesce(excluded.tab_index, ps_students.tab_index),
             level = coalesce(excluded.level, ps_students.level),
             progress = excluded.progress`,
    [sid, nm.name, nm.cls, now(), fields.sessionCode || null, fields.topicId || null,
     typeof fields.tabIndex === "number" ? fields.tabIndex : null, fields.level || null, J(progress)]);
  return progress;
}

/* ---------------- Kuis (bentuk data) ---------------- */
function validateQuestion(qn) {
  if (!qn || typeof qn !== "object") return null;
  const type = ["mcq", "short", "essay"].includes(qn.type) ? qn.type : null;
  if (!type) return null;
  const question = str(qn.question, 3000);
  if (!question) return null;
  const out = { id: str(qn.id, 40) || ("q_" + crypto.randomBytes(4).toString("hex")), type, question, modelAnswer: str(qn.modelAnswer, 3000) };
  if (type === "mcq") {
    let opts = Array.isArray(qn.options) ? qn.options.map(o => str(o, 500)) : [];
    while (opts.length < 4) opts.push("");
    out.options = opts.slice(0, 4);
    let c = parseInt(qn.correct, 10);
    out.correct = isNaN(c) || c < 0 || c > 3 ? 0 : c;
  }
  return out;
}
function publicQuiz(quiz) {
  if (!quiz) return null;
  return {
    active: !!quiz.active, id: quiz.id, topicId: quiz.topic_id || quiz.topicId, publishedAt: quiz.published_at || quiz.publishedAt,
    questions: (quiz.questions || []).map(x => {
      const o = { id: x.id, type: x.type, question: x.question };
      if (x.type === "mcq") o.options = x.options || [];
      return o;
    })
  };
}
function fullQuiz(r) {
  if (!r) return null;
  return { active: !!r.active, id: r.id, topicId: r.topic_id, kind: r.kind || "quiz", questions: r.questions || [], publishedAt: r.published_at, endedAt: r.ended_at, durationMin: r.duration_min == null ? null : Number(r.duration_min) };
}
async function latestQuiz(tid, kind) {
  return one(`select * from ps_quizzes where teacher_id = $1 and coalesce(kind, 'quiz') = $2 order by published_at desc limit 1`, [tid, kind || "quiz"]);
}
async function activeOf(tid, kind) {
  if (!tid) return null;
  return one(`select * from ps_quizzes where teacher_id = $1 and coalesce(kind, 'quiz') = $2 and active = true order by published_at desc limit 1`, [tid, kind]);
}
function testSummary(r) {
  if (!r) return null;
  return { active: !!r.active, id: r.id, topicId: r.topic_id, kind: "sumatif", title: (r.questions && r.questions.title) || "", publishedAt: r.published_at, endedAt: r.ended_at, durationMin: r.duration_min == null ? null : Number(r.duration_min) };
}

/* ============================================================
   Handler per mode
   ============================================================ */
const H = {};

H.health = async () => {
  await q(`select 1 as ok`);
  const t = await one(`select count(*)::int as n from ps_teachers where active = true`);
  return { ok: true, ai: aiConfigured(), admin: await adminReady(), teachers: t ? Number(t.n) : 0, explore: !!exploreCode() };
};

// Login akun siswa (nama + PIN dari guru).
H.student_login = async (b) => {
  const acc = await loginStudent(b.name, b.pin, b._ip, isEn(b));
  const info = await accountInfo(acc.student_id);
  const token = issueToken("account", { s: info.studentId, v: info.tokenVer });
  const progress = await touchStudent(info.studentId, { progress: b.progress });
  return { ok: true, token, account: info, progress };
};

H.student_me = async (b) => {
  const ctx = await ctxOf(b);
  if (ctx.guest) return { guest: true };
  const st = await one(`select progress from ps_students where student_id = $1`, [ctx.sid]);
  return { account: ctx.account, progress: st ? st.progress || {} : {} };
};

// Kode sesi kelas (untuk siswa yang sudah login) atau kode eksplorasi (validator).
H.verify_access = async (b) => {
  const code = str(b.code, 80);
  if (!code) throw new HttpError(400, isEn(b) ? "Enter a code first." : "Masukkan kode dulu.");
  if (matchExplore(code)) { await guardAccessCode(b, true, isEn(b)); return { ok: true, kind: "explore", token: issueToken("explore") }; }
  const ctx = await ctxOf(b, false);
  const state = ctx ? await sessionForStudent(ctx, code) : await sessionByCode(code);
  const okCode = codeMatches(state, code);
  await guardAccessCode(b, okCode, isEn(b));
  if (okCode) {
    if (!ctx) await ctxOf(b);
    let progress = {};
    if (!ctx.guest) progress = await touchStudent(ctx.sid, { sessionCode: state.code, progress: b.progress });
    return { ok: true, kind: "class", session: state, progress };
  }
  throw new HttpError(403, isEn(b) ? "That code is not valid. Check the 6-letter code on your teacher's screen." : "Kode tidak valid. Periksa lagi kode 6 huruf di layar gurumu.");
};

H.session_sync = async (b) => {
  const code = str(b.code, 20);
  const ctx = await ctxOf(b, false);
  const state = ctx ? await sessionForStudent(ctx, code) : { ...EMPTY_SESSION };
  const sid = ctx && !ctx.guest ? ctx.sid : null;
  const inSession = codeMatches(state, code);
  let progress = null;
  if (sid) {
    progress = await touchStudent(sid, {
      sessionCode: inSession ? state.code : null,
      topicId: topicOf(b) || null,
      tabIndex: typeof b.tabIndex === "number" ? b.tabIndex : null,
      level: lvl(b.level),
      progress: b.progress
    });
  }
  const resp = { ...state, teacherId: undefined, inSession, progress, serverNow: now(), account: ctx && !ctx.guest ? ctx.account : null };
  const quiz = inSession ? await activeOf(state.teacherId, "quiz") : null;
  if (quiz) {
    const pq = publicQuiz(quiz);
    if (sid) pq.submitted = !!(await one(`select 1 from ps_quiz_answers where quiz_id = $1 and student_id = $2`, [quiz.id, sid]));
    resp.activeQuiz = pq;
  } else {
    resp.activeQuiz = null;
  }
  const test = inSession ? await activeOf(state.teacherId, "sumatif") : null;
  if (test) {
    const ts = testSummary(test);
    if (sid) { const a = await one(`select status from ps_test_answers where quiz_id = $1 and student_id = $2`, [test.id, sid]); ts.status = a ? a.status : null; }
    resp.activeTest = ts;
  } else resp.activeTest = null;
  return resp;
};

/* ---------------- Login guru & admin ---------------- */
H.teacher_login = async (b) => {
  const out = await loginTeacher(b.username, b.password, b._ip, isEn(b));
  return { ok: true, token: out.token, teacher: out.teacher };
};
H.teacher_me = async (b) => {
  const t = await requireTeacher(b);
  return { teacher: publicTeacher(await one(`select * from ps_teachers where teacher_id = $1`, [t.teacherId])) };
};
H.teacher_change_password = async (b) => {
  const t = await requireTeacher(b);
  return { ok: true, ...(await changeTeacherPassword(t.teacherId, String(b.current || ""), String(b.next || ""), isEn(b))) };
};

H.teacher_session = async (b) => {
  const T = await requireTeacher(b);
  const action = str(b.action, 20);
  let s = await readTeacherSession(T.teacherId);
  const tab = typeof b.tabIndex === "number" ? b.tabIndex : 0;
  if (action === "start") {
    s = { active: true, code: await uniqueSessionCode(), topicId: topicOf(b) || null, tabIndex: tab, updatedAt: now() };
  } else if (action === "update") {
    if (!s.active) throw new HttpError(409, isEn(b) ? "No active session - start one first." : "Belum ada sesi aktif - mulai sesi baru dulu.");
    s.topicId = topicOf(b) || null; s.tabIndex = tab; s.updatedAt = now();
  } else if (action === "end") {
    s.active = false; s.updatedAt = now();
    await q(`update ps_quizzes set active = false, ended_at = $1 where active = true and teacher_id = $2`, [now(), T.teacherId]);
  } else {
    throw new HttpError(400, "Aksi tidak dikenal. Muat ulang halaman lalu coba lagi.");
  }
  await writeTeacherSession(T.teacherId, s);
  return { state: { ...s, teacherId: undefined } };
};

H.teacher_roster = async (b) => {
  const T = await requireTeacher(b);
  const state = await readTeacherSession(T.teacherId);
  const since = now() - ROSTER_WINDOW_MS;
  const rows = await q(`select s.student_id, s.topic_id, s.tab_index, s.level, s.last_seen, s.session_code
                        from ps_students s join ps_accounts a on a.student_id = s.student_id
                        where a.teacher_id = $2 and s.last_seen >= $1 order by s.last_seen desc limit 300`, [since, T.teacherId]);
  const roster = {};
  rows.forEach(r => {
    roster[r.student_id] = {
      topicId: r.topic_id, tabIndex: r.tab_index == null ? null : Number(r.tab_index), level: r.level,
      lastSeen: r.last_seen, inSession: !!(state.active && r.session_code && r.session_code === state.code)
    };
  });
  const scope = await teacherScope(T.teacherId);
  const pend = scope.keys.length
    ? await q(`select student_id, topic_id, stage, submitted_at, summary from ps_gates where status = 'pending' and student_id = any($1) order by submitted_at asc limit 200`, [scope.keys])
    : [];
  const labels = await groupLabels();
  return {
    state: { ...state, teacherId: undefined }, roster, serverNow: now(), teacher: { name: T.name, username: T.username },
    gatePending: pend.map(r => ({ studentId: r.student_id, label: labels[r.student_id] || r.student_id, topicId: r.topic_id, stage: r.stage, submittedAt: r.submitted_at, summary: r.summary || "" })),
    activeQuiz: fullQuiz(await latestQuiz(T.teacherId, "quiz")),
    activeTest: testSummary(await latestQuiz(T.teacherId, "sumatif"))
  };
};

/* ---------------- Gate (checkpoint guru PjBL) ---------------- */
H.gate_submit = async (b) => {
  const topicId = topicOf(b), stage = str(b.stage, 20);
  const ctx = await ctxOf(b);
  if (!topicId || !STAGES.includes(stage)) throw new HttpError(400, "Data konfirmasi tidak lengkap.");
  if (ctx.guest) return { ok: true, skipped: true };
  await assertGroupWriter(ctx, topicId, stage, str(b.deviceId, 80), isEn(b));
  const key = workKey(ctx);
  const summary = str(b.summary, 2000);
  await q(`insert into ps_gates (topic_id, student_id, stage, status, summary, note, submitted_at, decided_at)
           values ($1, $2, $3, 'pending', $4, '', $5, null)
           on conflict (topic_id, student_id, stage) do update set status = 'pending', summary = excluded.summary,
             note = '', submitted_at = excluded.submitted_at, decided_at = null`,
    [topicId, key, stage, summary, now()]);
  await q(`insert into ps_events (student_id, topic_id, kind, item, payload, score, created_at) values ($1, $2, 'gate_submit', $3, $4::jsonb, null, $5)`,
    [key, topicId, stage, J({ summary, by: ctx.sid }), now()]);
  return { ok: true };
};

H.gate_status = async (b) => {
  const ctx = await ctxOf(b);
  const out = { eksperimen: null, lab: null };
  if (ctx.guest) return out;
  const rows = await q(`select stage, status, note, summary, submitted_at, decided_at from ps_gates where topic_id = $1 and student_id = $2`, [topicOf(b), workKey(ctx)]);
  rows.forEach(r => { out[r.stage] = { status: r.status, note: r.note || "", summary: r.summary || "", submittedAt: r.submitted_at, decidedAt: r.decided_at }; });
  return out;
};

H.teacher_gate_decide = async (b) => {
  const T = await requireTeacher(b);
  const topicId = topicOf(b), sid = sidOf(b), stage = str(b.stage, 20), decision = str(b.decision, 20);
  if (!topicId || !sid || !STAGES.includes(stage) || !["approved", "rejected"].includes(decision)) throw new HttpError(400, "Data keputusan tidak lengkap.");
  await assertOwnsKey(T.teacherId, sid, isEn(b));
  const rows = await q(`update ps_gates set status = $4, note = $5, decided_at = $6
                        where topic_id = $1 and student_id = $2 and stage = $3 and status = 'pending' returning stage`,
    [topicId, sid, stage, decision, str(b.note, 500), now()]);
  if (!rows.length) throw new HttpError(404, isEn(b) ? "Request not found or already decided." : "Permintaan tidak ditemukan atau sudah diproses.");
  return { ok: true };
};

/* ---------------- Kuis (bank soal manual per guru) ---------------- */
async function readBank(tid, topicId, kind) {
  const r = await one(`select data from ps_question_banks where teacher_id = $1 and topic_id = $2 and kind = $3`, [tid, topicId, kind]);
  return r ? r.data : null;
}
async function writeBank(tid, topicId, kind, data) {
  await q(`insert into ps_question_banks (teacher_id, topic_id, kind, data, updated_at) values ($1, $2, $3, $4::jsonb, $5)
           on conflict (teacher_id, topic_id, kind) do update set data = excluded.data, updated_at = excluded.updated_at`, [tid, topicId, kind, J(data), now()]);
}

H.quiz_bank_get = async (b) => {
  const T = await requireTeacher(b);
  const topicId = topicOf(b);
  const data = await readBank(T.teacherId, topicId, "quiz");
  if (data) return { questions: Array.isArray(data.questions) ? data.questions : [] };
  // Bank lama (V9, sebelum ada akun guru) dipakai sebagai titik awal.
  const legacy = await one(`select questions from ps_quiz_bank where topic_id = $1`, [topicId]);
  return { questions: legacy ? legacy.questions || [] : [], legacy: !!legacy };
};

H.quiz_bank_save = async (b) => {
  const T = await requireTeacher(b);
  const topicId = topicOf(b);
  if (!topicId) throw new HttpError(400, "Pilih topik terlebih dahulu.");
  const raw = Array.isArray(b.questions) ? b.questions : [];
  if (raw.length > 150) throw new HttpError(400, "Maksimal 150 soal per bank topik.");
  const questions = raw.map(validateQuestion).filter(Boolean);
  await writeBank(T.teacherId, topicId, "quiz", { questions });
  return { ok: true, questions };
};

H.quiz_publish = async (b) => {
  const T = await requireTeacher(b);
  const state = await readTeacherSession(T.teacherId);
  if (!state.active) throw new HttpError(409, isEn(b) ? "No active class session. Start one first, then publish the quiz." : "Belum ada sesi kelas aktif. Mulai sesi kelas dulu, baru publikasikan kuis.");
  const raw = Array.isArray(b.questions) ? b.questions : [];
  if (!raw.length) throw new HttpError(400, isEn(b) ? "Select at least one question." : "Pilih minimal 1 soal.");
  if (raw.length > 40) throw new HttpError(400, "Maksimal 40 soal per kuis.");
  const questions = raw.map(validateQuestion).filter(Boolean);
  if (!questions.length) throw new HttpError(400, "Soal yang dipilih tidak valid.");
  // Kuis lama tidak dihapus: hanya dinonaktifkan (arsip jawaban tetap ada).
  await q(`update ps_quizzes set active = false, ended_at = $1 where active = true and teacher_id = $2 and coalesce(kind, 'quiz') = 'quiz'`, [now(), T.teacherId]);
  const id = "quiz_" + now().toString(36) + crypto.randomBytes(2).toString("hex");
  await q(`insert into ps_quizzes (id, topic_id, questions, active, published_at, teacher_id, kind) values ($1, $2, $3::jsonb, true, $4, $5, 'quiz')`, [id, topicOf(b), J(questions), now(), T.teacherId]);
  return { quiz: fullQuiz(await one(`select * from ps_quizzes where id = $1`, [id])) };
};

H.quiz_unpublish = async (b) => {
  const T = await requireTeacher(b);
  await q(`update ps_quizzes set active = false, ended_at = $1 where active = true and teacher_id = $2 and coalesce(kind, 'quiz') = 'quiz'`, [now(), T.teacherId]);
  return { ok: true };
};

H.quiz_list = async (b) => {
  const T = await requireTeacher(b);
  const rows = await q(`select z.id, z.topic_id, z.active, z.published_at, z.ended_at, coalesce(z.kind, 'quiz') as kind,
                          case when jsonb_typeof(z.questions) = 'array' then jsonb_array_length(z.questions) else null end as n,
                          (select count(*) from ps_quiz_answers a where a.quiz_id = z.id) as answers,
                          (select count(*) from ps_test_answers t where t.quiz_id = z.id) as test_answers
                        from ps_quizzes z where z.teacher_id = $1 order by z.published_at desc limit 100`, [T.teacherId]);
  return { quizzes: rows.map(r => ({ id: r.id, topicId: r.topic_id, kind: r.kind, active: !!r.active, publishedAt: r.published_at, endedAt: r.ended_at, count: r.n == null ? null : Number(r.n), answers: Number(r.kind === "sumatif" ? r.test_answers : r.answers) })) };
};

H.quiz_results = async (b) => {
  const T = await requireTeacher(b);
  const quiz = b.quizId ? await one(`select * from ps_quizzes where id = $1 and teacher_id = $2`, [str(b.quizId, 60), T.teacherId]) : await latestQuiz(T.teacherId, "quiz");
  if (!quiz) return { quiz: null, answers: [] };
  const answers = await q(`select student_id, answers, score, submitted_at from ps_quiz_answers where quiz_id = $1 order by submitted_at asc`, [quiz.id]);
  return { quiz: fullQuiz(quiz), answers: answers.map(a => ({ studentId: a.student_id, answers: a.answers || {}, score: a.score, submittedAt: a.submitted_at })) };
};

H.quiz_submit = async (b) => {
  const ctx = await ctxOf(b);
  if (ctx.guest) return { ok: true, skipped: true, submittedAt: now() };
  const sid = ctx.sid;
  const state = await sessionForStudent(ctx, b.code);
  if (!codeMatches(state, b.code)) throw new HttpError(409, isEn(b) ? "The class session is no longer active." : "Sesi kelas sudah tidak aktif, jawaban tidak bisa dikirim.");
  const quiz = await one(`select * from ps_quizzes where id = $1`, [str(b.quizId, 60)]);
  if (!quiz || !quiz.active || quiz.teacher_id !== state.teacherId || (quiz.kind || "quiz") !== "quiz") throw new HttpError(409, isEn(b) ? "This quiz has ended." : "Kuis ini sudah tidak aktif (diakhiri/diganti guru).");
  const raw = b.answers && typeof b.answers === "object" ? b.answers : {};
  const clean = {};
  let mcq = 0, right = 0;
  (quiz.questions || []).forEach(qn => {
    if (qn.type === "mcq") mcq++;
    if (!(qn.id in raw)) return;
    if (qn.type === "mcq") {
      const i = parseInt(raw[qn.id], 10);
      clean[qn.id] = isNaN(i) || i < 0 || i > 3 ? null : i;
      if (clean[qn.id] === qn.correct) right++;
    } else {
      clean[qn.id] = str(raw[qn.id], qn.type === "essay" ? 4000 : 800);
    }
  });
  const score = mcq ? Math.round((right / mcq) * 1000) / 10 : null;
  await q(`insert into ps_quiz_answers (quiz_id, student_id, answers, score, submitted_at) values ($1, $2, $3::jsonb, $4, $5)
           on conflict (quiz_id, student_id) do update set answers = excluded.answers, score = excluded.score, submitted_at = excluded.submitted_at`,
    [quiz.id, sid, J(clean), score, now()]);
  return { ok: true, submittedAt: now() };
};

/* ---------------- Tes Sumatif ---------------- */
const INK_MAX = 450000;          // ~450 KB per gambar tulisan tangan
const TEST_ANSWERS_MAX = 3000000; // total jawaban satu siswa
function cleanTestAnswers(doc, raw) {
  const out = {};
  const src = raw && typeof raw === "object" ? raw : {};
  const items = scoringItems(doc);
  items.forEach(x => {
    const v = src[x.key];
    if (v === undefined || v === null) return;
    if (x.auto) {
      const i = parseInt(v, 10);
      if (!isNaN(i) && i >= 0 && i < 6) out[x.key] = i;
    } else if (typeof v === "object") {
      const o = {};
      const text = str(v.text, 8000);
      if (text) o.text = text;
      const ink = typeof v.ink === "string" ? v.ink : "";
      if (ink && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(ink) && ink.length <= INK_MAX) o.ink = ink;
      if (o.text || o.ink) out[x.key] = o;
    } else if (typeof v === "string" && v.trim()) {
      out[x.key] = { text: str(v, 8000) };
    }
  });
  return out;
}
async function teacherTestDoc(tid, topicId) {
  const data = await readBank(tid, topicId, "sumatif");
  return data && data.sections ? { test: sanitizeTest(data), isDefault: false } : { test: sanitizeTest(DEFAULT_TEST), isDefault: true };
}

H.test_get = async (b) => {
  const T = await requireTeacher(b);
  return teacherTestDoc(T.teacherId, topicOf(b));
};
H.test_default = async (b) => {
  await requireTeacher(b);
  return { test: sanitizeTest(DEFAULT_TEST) };
};
H.test_save = async (b) => {
  const T = await requireTeacher(b);
  const topicId = topicOf(b);
  if (!topicId) throw new HttpError(400, "Pilih topik terlebih dahulu.");
  if (jsonSize(b.test) > 400000) throw new HttpError(413, isEn(b) ? "The test is too large." : "Isi tes terlalu besar.");
  if (b.reset) { await q(`delete from ps_question_banks where teacher_id = $1 and topic_id = $2 and kind = 'sumatif'`, [T.teacherId, topicId]); return { ok: true, ...(await teacherTestDoc(T.teacherId, topicId)) }; }
  const test = sanitizeTest(b.test);
  if (!test.sections.some(S => S.items.length)) throw new HttpError(400, isEn(b) ? "The test has no questions." : "Tes belum berisi soal.");
  await writeBank(T.teacherId, topicId, "sumatif", test);
  return { ok: true, test, isDefault: false };
};
H.test_publish = async (b) => {
  const T = await requireTeacher(b);
  const state = await readTeacherSession(T.teacherId);
  if (!state.active) throw new HttpError(409, isEn(b) ? "No active class session. Start one first, then publish the test." : "Belum ada sesi kelas aktif. Mulai sesi kelas dulu, baru publikasikan tes sumatif.");
  const topicId = topicOf(b);
  const test = b.test ? sanitizeTest(b.test) : (await teacherTestDoc(T.teacherId, topicId)).test;
  if (!test.sections.some(S => S.items.length)) throw new HttpError(400, isEn(b) ? "The test has no questions." : "Tes belum berisi soal.");
  const duration = Math.max(5, Math.min(240, parseInt(b.durationMin, 10) || test.durationMin || 60));
  test.durationMin = duration;
  await q(`update ps_quizzes set active = false, ended_at = $1 where active = true and teacher_id = $2 and kind = 'sumatif'`, [now(), T.teacherId]);
  const id = "test_" + now().toString(36) + crypto.randomBytes(2).toString("hex");
  await q(`insert into ps_quizzes (id, topic_id, questions, active, published_at, teacher_id, kind, duration_min) values ($1, $2, $3::jsonb, true, $4, $5, 'sumatif', $6)`,
    [id, topicId, J(test), now(), T.teacherId, duration]);
  return { test: testSummary(await one(`select * from ps_quizzes where id = $1`, [id])) };
};
H.test_end = async (b) => {
  const T = await requireTeacher(b);
  await q(`update ps_quizzes set active = false, ended_at = $1 where active = true and teacher_id = $2 and kind = 'sumatif'`, [now(), T.teacherId]);
  return { ok: true };
};
H.test_results = async (b) => {
  const T = await requireTeacher(b);
  const quiz = b.quizId ? await one(`select * from ps_quizzes where id = $1 and teacher_id = $2 and kind = 'sumatif'`, [str(b.quizId, 60), T.teacherId]) : await latestQuiz(T.teacherId, "sumatif");
  if (!quiz) return { test: null, rows: [] };
  const answers = await q(`select student_id, status, auto_score, total, manual, updated_at, submitted_at, graded_at from ps_test_answers where quiz_id = $1`, [quiz.id]);
  const accs = await q(`select student_id, name, class_name from ps_accounts where teacher_id = $1 order by class_name, name`, [T.teacherId]);
  const items = scoringItems(quiz.questions);
  const byId = {};
  answers.forEach(a => { byId[a.student_id] = a; });
  const rows = accs.map(acc => {
    const a = byId[acc.student_id];
    const sc = a ? computeScores(quiz.questions, null, a.manual) : null;
    return { studentId: acc.student_id, name: acc.name, className: acc.class_name, status: a ? a.status : null,
      autoScore: a ? a.auto_score : null, total: a ? a.total : null, gradedAll: a ? sc.gradedAll : false,
      updatedAt: a ? a.updated_at : null, submittedAt: a ? a.submitted_at : null, gradedAt: a ? a.graded_at : null };
  });
  return { test: { ...testSummary(quiz), max: items.reduce((x, y) => x + y.max, 0) }, rows };
};
H.test_answer_detail = async (b) => {
  const T = await requireTeacher(b);
  const quiz = await one(`select * from ps_quizzes where id = $1 and teacher_id = $2 and kind = 'sumatif'`, [str(b.quizId, 60), T.teacherId]);
  if (!quiz) throw new HttpError(404, isEn(b) ? "Test not found." : "Tes tidak ditemukan.");
  const sid = sidOf(b);
  await assertOwnsKey(T.teacherId, sid, isEn(b));
  const a = await one(`select * from ps_test_answers where quiz_id = $1 and student_id = $2`, [quiz.id, sid]);
  const sc = computeScores(quiz.questions, a ? a.answers : {}, a ? a.manual : {});
  return { test: sanitizeTest(quiz.questions), quizId: quiz.id, studentId: sid, answers: a ? a.answers || {} : {}, manual: a ? a.manual || {} : {},
    status: a ? a.status : null, submittedAt: a ? a.submitted_at : null, scores: sc };
};
H.test_grade = async (b) => {
  const T = await requireTeacher(b);
  const quiz = await one(`select * from ps_quizzes where id = $1 and teacher_id = $2 and kind = 'sumatif'`, [str(b.quizId, 60), T.teacherId]);
  if (!quiz) throw new HttpError(404, isEn(b) ? "Test not found." : "Tes tidak ditemukan.");
  const sid = sidOf(b);
  await assertOwnsKey(T.teacherId, sid, isEn(b));
  const raw = b.manual && typeof b.manual === "object" ? b.manual : {};
  const manual = {};
  scoringItems(quiz.questions).filter(x => !x.auto).forEach(x => {
    const v = raw[x.key];
    if (v === "" || v === null || v === undefined) return;
    const n = Number(v);
    if (isFinite(n)) manual[x.key] = Math.max(0, Math.min(x.max, Math.round(n * 2) / 2));
  });
  const a = await one(`select answers from ps_test_answers where quiz_id = $1 and student_id = $2`, [quiz.id, sid]);
  const sc = computeScores(quiz.questions, a ? a.answers : {}, manual);
  await q(`insert into ps_test_answers (quiz_id, student_id, answers, status, auto_score, manual, total, updated_at, submitted_at, graded_at)
           values ($1, $2, '{}'::jsonb, 'draft', $3, $4::jsonb, $5, $6, null, $6)
           on conflict (quiz_id, student_id) do update set manual = excluded.manual, auto_score = excluded.auto_score, total = excluded.total, graded_at = excluded.graded_at`,
    [quiz.id, sid, sc.auto, J(manual), sc.total, now()]);
  return { ok: true, scores: sc };
};

// Siswa: tes sumatif yang sedang aktif di sesi kelasnya.
async function studentActiveTest(ctx, code) {
  const state = await sessionForStudent(ctx, code);
  if (!codeMatches(state, code)) return null;
  return activeOf(state.teacherId, "sumatif");
}
H.student_test_get = async (b) => {
  const ctx = await ctxOf(b);
  const quiz = await studentActiveTest(ctx, b.code);
  if (!quiz) return { test: null };
  const a = ctx.guest ? null : await one(`select answers, status, updated_at, submitted_at from ps_test_answers where quiz_id = $1 and student_id = $2`, [quiz.id, ctx.sid]);
  return { test: publicTest(quiz.questions), quizId: quiz.id, publishedAt: quiz.published_at, durationMin: quiz.duration_min == null ? null : Number(quiz.duration_min),
    serverNow: now(), answers: a ? a.answers || {} : {}, status: a ? a.status : null, savedAt: a ? a.updated_at : null, submittedAt: a ? a.submitted_at : null };
};
async function saveStudentTest(b, submit) {
  const ctx = await ctxOf(b);
  const quiz = await studentActiveTest(ctx, b.code);
  if (!quiz || quiz.id !== str(b.quizId, 60)) throw new HttpError(409, isEn(b) ? "This test has ended." : "Tes ini sudah diakhiri guru. Jawaban terakhir yang tersimpan tetap tercatat.", "TEST_ENDED");
  if (ctx.guest) return { ok: true, skipped: true, savedAt: now() };
  const prev = await one(`select status, manual from ps_test_answers where quiz_id = $1 and student_id = $2`, [quiz.id, ctx.sid]);
  if (prev && prev.status === "submitted") throw new HttpError(409, isEn(b) ? "You have already submitted this test." : "Kamu sudah mengumpulkan tes ini.", "TEST_SUBMITTED");
  const answers = cleanTestAnswers(quiz.questions, b.answers);
  if (jsonSize(answers) > TEST_ANSWERS_MAX) throw new HttpError(413, isEn(b) ? "Your answers are too large. Make the handwriting smaller or remove a drawing." : "Jawaban terlalu besar. Kecilkan atau hapus salah satu tulisan tangan.");
  const sc = computeScores(quiz.questions, answers, prev ? prev.manual : {});
  await q(`insert into ps_test_answers (quiz_id, student_id, answers, status, auto_score, manual, total, updated_at, submitted_at, graded_at)
           values ($1, $2, $3::jsonb, $4, $5, '{}'::jsonb, $6, $7, $8, null)
           on conflict (quiz_id, student_id) do update set answers = excluded.answers, status = excluded.status, auto_score = excluded.auto_score,
             total = excluded.total, updated_at = excluded.updated_at, submitted_at = coalesce(excluded.submitted_at, ps_test_answers.submitted_at)`,
    [quiz.id, ctx.sid, J(answers), submit ? "submitted" : "draft", sc.auto, sc.total, now(), submit ? now() : null]);
  return { ok: true, savedAt: now(), status: submit ? "submitted" : "draft" };
}
H.student_test_save = async (b) => saveStudentTest(b, false);
H.student_test_submit = async (b) => saveStudentTest(b, true);

/* ---------------- Rekam jawaban & aktivitas ---------------- */
H.record_event = async (b) => {
  const ctx = await ctxOf(b);
  const kind = str(b.kind, 40);
  if (!EVENT_KINDS.includes(kind)) throw new HttpError(400, "Data aktivitas tidak valid.");
  if (ctx.guest) return { ok: true, skipped: true };
  let sid = ctx.sid;
  let payload = b.payload === undefined ? null : b.payload;
  if (GROUP_EVENT_KINDS.includes(kind) && ctx.account && ctx.account.groupId) {
    if (!ctx.account.isLeader) return { ok: true, skipped: true, notLeader: true };
    sid = workKey(ctx);
    payload = payload && typeof payload === "object" && !Array.isArray(payload) ? { ...payload, by: ctx.sid } : { value: payload, by: ctx.sid };
  }
  const json = J(payload);
  if (jsonSize(payload) > 60000) throw new HttpError(413, "Data aktivitas terlalu besar.");
  const score = typeof b.score === "number" && isFinite(b.score) ? b.score : null;
  await q(`insert into ps_events (student_id, topic_id, kind, item, payload, score, created_at) values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [sid, topicOf(b) || null, kind, str(b.item, 120) || null, json, score, now()]);
  return { ok: true };
};

H.lkpd_save = async (b) => {
  const ctx = await ctxOf(b);
  const topicId = topicOf(b), mode = str(b.lkpdMode, 30);
  if (!topicId || !mode) throw new HttpError(400, "Data LKPD tidak lengkap.");
  if (ctx.guest) return { ok: true, skipped: true };
  await assertGroupWriter(ctx, topicId, "eksperimen", str(b.deviceId, 80), isEn(b));
  const sid = workKey(ctx);
  const json = J(b.data && typeof b.data === "object" ? b.data : {});
  if (jsonSize(json) > 200000) throw new HttpError(413, "Isi LKPD terlalu besar.");
  const progress = Math.max(0, Math.min(100, Number(b.progress) || 0));
  const score = typeof b.score === "number" && isFinite(b.score) ? b.score : null;
  const submit = !!b.submit;
  await q(`insert into ps_lkpd (student_id, topic_id, mode, data, progress, score, status, updated_at, submitted_at)
           values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
           on conflict (student_id, topic_id, mode) do update set data = excluded.data, progress = excluded.progress,
             score = excluded.score, updated_at = excluded.updated_at,
             status = case when excluded.status = 'submitted' then 'submitted' else ps_lkpd.status end,
             submitted_at = coalesce(excluded.submitted_at, ps_lkpd.submitted_at)`,
    [sid, topicId, mode, json, progress, score, submit ? "submitted" : "draft", now(), submit ? now() : null]);
  return { ok: true, savedAt: now(), status: submit ? "submitted" : undefined };
};

H.lkpd_get = async (b) => {
  const ctx = await ctxOf(b);
  if (ctx.guest) return { modes: {} };
  const rows = await q(`select mode, data, progress, score, status, updated_at, submitted_at from ps_lkpd where student_id = $1 and topic_id = $2`, [workKey(ctx), topicOf(b)]);
  const modes = {};
  rows.forEach(r => { modes[r.mode] = { data: r.data || {}, progress: r.progress, score: r.score, status: r.status, updatedAt: r.updated_at, submittedAt: r.submitted_at }; });
  return { modes };
};

H.eksperimen_data_save = async (b) => {
  const ctx = await ctxOf(b);
  const topicId = topicOf(b);
  const lang = isEn(b) ? "en" : "id";
  if (!ctx.guest) await assertGroupWriter(ctx, topicId, "eksperimen", str(b.deviceId, 80), isEn(b));
  const sid = ctx.guest ? ctx.sid : workKey(ctx);
  const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 30).map(r => ({
    I: r && r.I != null && isFinite(Number(r.I)) ? Number(r.I) : null,
    values: (Array.isArray(r && r.values) ? r.values : []).slice(0, 8).map(v => (v === null || v === "" || !isFinite(Number(v))) ? null : Number(v))
  }));
  if (!rows.some(r => r.values.some(v => v !== null))) throw new HttpError(400, lang === "en" ? "No observation data to save." : "Tidak ada data pengamatan untuk disimpan.");
  const variant = str(b.variant, 30) || "default";
  const meta = b.meta && typeof b.meta === "object" ? b.meta : null;
  const analysis = b.analysis && typeof b.analysis === "object" ? b.analysis : null;

  let feedback = lang === "en" ? "Data saved." : "Data tersimpan.", flagged = false;
  // Pemeriksaan AI hanya saat belajar di kelas (mode mandiri tidak memakai AI).
  const aiAllowed = ctx.guest || codeMatches(await sessionForStudent(ctx, str(b.sessionCode, 20)), str(b.sessionCode, 20));
  if (!aiAllowed) feedback += " " + (lang === "en" ? "(The AI data check runs only during a class session.)" : "(Pemeriksaan data oleh AI hanya aktif saat belajar di kelas.)");
  if (aiConfigured() && aiAllowed) {
    const quota = await takeQuota("datacheck", sid);
    if (quota.ok) {
      const rowsText = rows.map(r => `I=${r.I} A -> ${r.values.map(v => v === null ? "-" : v).join(", ")}`).join("\n");
      try {
        const res = await createMessage({
          model: MODELS.chat, max_tokens: 500,
          output_config: { effort: "low" }, thinking: { type: "disabled" },
          messages: [{ role: "user", content: buildDataCheckPrompt({ context: str(b.context, 2500), rowsText, lang }) }]
        }, { attempts: 2 });
        await recordTokens({ accountKind: ctx.guest ? "guest" : "student", accountId: ctx.sid, teacherId: ctx.account ? ctx.account.teacherId : null, workKey: sid, kind: "datacheck", model: MODELS.chat, usage: res.usage });
        const p = extractJson(res.text);
        if (p && typeof p === "object") {
          feedback = str(p.feedback, 900) || feedback;
          flagged = !!p.flagged;
        }
      } catch (e) {
        await quota.release();
        feedback += " " + (lang === "en" ? "(The AI check is unavailable right now.)" : "(Pemeriksaan AI sedang tidak tersedia.)");
      }
    }
  }
  if (isGuestId(sid)) return { ok: true, feedback, flagged, savedAt: now() };
  await q(`insert into ps_experiment (student_id, topic_id, variant, rows, meta, analysis, feedback, flagged, updated_at)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9)
           on conflict (student_id, topic_id, variant) do update set rows = excluded.rows, meta = excluded.meta,
             analysis = coalesce(excluded.analysis, ps_experiment.analysis), feedback = excluded.feedback,
             flagged = excluded.flagged, updated_at = excluded.updated_at`,
    [sid, topicId, variant, J(rows), J(meta), analysis ? J(analysis) : null, feedback, flagged, now()]);
  return { ok: true, feedback, flagged, savedAt: now() };
};

/* ---------------- Panel Guru: rekap & ekspor ---------------- */
H.teacher_overview = async (b) => {
  const T = await requireTeacher(b);
  const scope = await teacherScope(T.teacherId);
  const keys = scope.keys.length ? scope.keys : ["__none__"];
  const sids = scope.sids.length ? scope.sids : ["__none__"];
  const students = await q(`select student_id, name, class_name, created_at, last_seen, topic_id, tab_index, level, progress, session_code from ps_students where student_id = any($1) order by class_name asc, name asc limit 1000`, [sids]);
  const events = await q(`select student_id, kind, count(*) as n, max(score) as best, max(created_at) as last from ps_events where student_id = any($1) group by student_id, kind`, [keys]);
  const lastScore = await q(`select distinct on (student_id, kind) student_id, kind, score from ps_events where score is not null and student_id = any($1) order by student_id, kind, created_at desc`, [keys]);
  const lkpd = await q(`select student_id, topic_id, mode, progress, score, status, updated_at, submitted_at from ps_lkpd where student_id = any($1)`, [keys]);
  const gates = await q(`select student_id, topic_id, stage, status, submitted_at, decided_at from ps_gates where student_id = any($1)`, [keys]);
  const quizzes = await q(`select a.student_id, a.quiz_id, a.score, a.submitted_at, z.topic_id from ps_quiz_answers a join ps_quizzes z on z.id = a.quiz_id where a.student_id = any($1)`, [sids]);
  const tests = await q(`select t.student_id, t.quiz_id, t.status, t.total, t.submitted_at, z.topic_id, z.questions from ps_test_answers t join ps_quizzes z on z.id = t.quiz_id where t.student_id = any($1) and z.teacher_id = $2`, [sids, T.teacherId]);
  const exp = await q(`select student_id, topic_id, variant, updated_at, flagged, analysis from ps_experiment where student_id = any($1)`, [keys]);
  // Latihan: hasil percobaan PERTAMA per soal (indikator penguasaan, bukan hasil setelah melihat pembahasan)
  const lat = await q(`select student_id, item, (array_agg(score order by created_at asc))[1] as first_score
                       from ps_events where kind = 'latihan' and score is not null and student_id = any($1) group by student_id, item`, [sids]);
  const { members, accounts, groups } = await groupMembership(T.teacherId);
  const ex = rows => expandGroupRows(rows, members);
  return {
    accounts, groups,
    serverNow: now(),
    latihanFirst: lat.map(r => ({ studentId: r.student_id, item: r.item, firstScore: r.first_score })),
    students: students.map(s => ({ studentId: s.student_id, name: s.name, className: s.class_name, createdAt: s.created_at, lastSeen: s.last_seen, topicId: s.topic_id, tabIndex: s.tab_index, level: s.level, progress: s.progress || {} })),
    events: ex(events).map(e => ({ studentId: e.student_id, group: !!e._group, kind: e.kind, n: Number(e.n), best: e.best, last: e.last })),
    lastScores: ex(lastScore).map(e => ({ studentId: e.student_id, kind: e.kind, score: e.score })),
    lkpd: ex(lkpd).map(l => ({ studentId: l.student_id, group: !!l._group, topicId: l.topic_id, mode: l.mode, progress: l.progress, score: l.score, status: l.status, updatedAt: l.updated_at, submittedAt: l.submitted_at })),
    gates: ex(gates).map(g => ({ studentId: g.student_id, group: !!g._group, topicId: g.topic_id, stage: g.stage, status: g.status, submittedAt: g.submitted_at, decidedAt: g.decided_at })),
    quizAnswers: quizzes.map(a => ({ studentId: a.student_id, quizId: a.quiz_id, topicId: a.topic_id, score: a.score, submittedAt: a.submitted_at })),
    testAnswers: tests.map(a => { const mx = scoringItems(a.questions).reduce((x, y) => x + y.max, 0); return { studentId: a.student_id, quizId: a.quiz_id, topicId: a.topic_id, status: a.status, total: a.total, max: mx, submittedAt: a.submitted_at }; }),
    experiments: ex(exp).map(x => ({ studentId: x.student_id, group: !!x._group, topicId: x.topic_id, variant: x.variant, updatedAt: x.updated_at, flagged: x.flagged, analysis: x.analysis }))
  };
};

async function studentFull(sid) {
  const s = await one(`select * from ps_students where student_id = $1`, [sid]);
  const acc = await one(`select a.group_id, g.name as group_name, g.leader_id from ps_accounts a left join ps_groups g on g.group_id = a.group_id where a.student_id = $1`, [sid]);
  // Kerja kelompok (Eksperimen & Makerspace) tersimpan dengan kunci kelompok
  const keys = acc && acc.group_id ? [sid, groupKey(acc.group_id)] : [sid];
  const events = await q(`select student_id, topic_id, kind, item, payload, score, created_at from ps_events where student_id = any($1) order by created_at asc limit 5000`, [keys]);
  const lkpd = await q(`select student_id, topic_id, mode, data, progress, score, status, updated_at, submitted_at from ps_lkpd where student_id = any($1)`, [keys]);
  const exp = await q(`select student_id, topic_id, variant, rows, meta, analysis, feedback, flagged, updated_at from ps_experiment where student_id = any($1)`, [keys]);
  const gates = await q(`select student_id, topic_id, stage, status, summary, note, submitted_at, decided_at from ps_gates where student_id = any($1)`, [keys]);
  const quiz = await q(`select a.quiz_id, a.answers, a.score, a.submitted_at, z.topic_id, z.questions from ps_quiz_answers a join ps_quizzes z on z.id = a.quiz_id where a.student_id = $1 order by a.submitted_at asc`, [sid]);
  return {
    student: s ? { studentId: s.student_id, name: s.name, className: s.class_name, createdAt: s.created_at, lastSeen: s.last_seen, topicId: s.topic_id, tabIndex: s.tab_index, level: s.level, progress: s.progress || {},
      groupId: acc ? acc.group_id : null, groupName: acc ? acc.group_name : null, isLeader: !!(acc && acc.leader_id === sid) } : null,
    events: events.map(e => ({ group: isGroupKey(e.student_id), topicId: e.topic_id, kind: e.kind, item: e.item, payload: e.payload, score: e.score, createdAt: e.created_at })),
    lkpd: lkpd.map(l => ({ group: isGroupKey(l.student_id), topicId: l.topic_id, mode: l.mode, data: l.data, progress: l.progress, score: l.score, status: l.status, updatedAt: l.updated_at, submittedAt: l.submitted_at })),
    experiments: exp.map(x => ({ group: isGroupKey(x.student_id), topicId: x.topic_id, variant: x.variant, rows: x.rows, meta: x.meta, analysis: x.analysis, feedback: x.feedback, flagged: x.flagged, updatedAt: x.updated_at })),
    gates: gates.map(g => ({ group: isGroupKey(g.student_id), topicId: g.topic_id, stage: g.stage, status: g.status, summary: g.summary, note: g.note, submittedAt: g.submitted_at, decidedAt: g.decided_at })),
    quizzes: quiz.map(a => ({ quizId: a.quiz_id, topicId: a.topic_id, answers: a.answers, score: a.score, submittedAt: a.submitted_at, questions: a.questions }))
  };
}

H.teacher_student_detail = async (b) => {
  const T = await requireTeacher(b);
  const sid = sidOf(b);
  if (!sid) throw new HttpError(400, isEn(b) ? "Choose a student first." : "Pilih siswa terlebih dahulu.");
  await assertOwnsKey(T.teacherId, sid, isEn(b));
  return studentFull(sid);
};

H.teacher_export = async (b) => {
  const T = await requireTeacher(b);
  const scope = await teacherScope(T.teacherId);
  const ids = (Array.isArray(b.studentIds) && b.studentIds.length
    ? b.studentIds.slice(0, 400).map(s => str(s, MAX_SID))
    : (await q(`select a.student_id from ps_accounts a where a.teacher_id = $1 order by a.class_name, a.name limit 400`, [T.teacherId])).map(r => r.student_id))
    .filter(sid => scope.sidSet.has(sid));
  const out = [];
  for (const sid of ids) out.push(await studentFull(sid));
  const quizzes = await q(`select id, topic_id, questions, published_at from ps_quizzes where teacher_id = $1 and coalesce(kind, 'quiz') = 'quiz' order by published_at asc`, [T.teacherId]);
  return { exportedAt: now(), students: out, quizzes: quizzes.map(z => ({ id: z.id, topicId: z.topic_id, questions: z.questions, publishedAt: z.published_at })) };
};

H.teacher_delete_student = async (b) => {
  const T = await requireTeacher(b);
  const sid = sidOf(b);
  if (!sid) throw new HttpError(400, isEn(b) ? "Choose a student first." : "Pilih siswa terlebih dahulu.");
  await assertOwnsKey(T.teacherId, sid, isEn(b));
  await deleteStudentData(sid);
  return { ok: true };
};

/* ---------------- Kerja kelompok: kunci perangkat & tampilan anggota ---------------- */
H.group_lock = async (b) => {
  const ctx = await ctxOf(b);
  if (ctx.guest) return { ok: true, solo: true, mine: true };
  const action = ["acquire", "heartbeat", "release", "takeover"].includes(b.action) ? b.action : "acquire";
  const out = await lockAction(ctx, topicOf(b), str(b.section, 20), str(b.deviceId, 80), action, isEn(b));
  return { ...out, account: ctx.account };
};

// Untuk anggota (bukan ketua): pratinjau baca-saja kerja kelompok.
H.group_state = async (b) => {
  const ctx = await ctxOf(b);
  const topicId = topicOf(b);
  if (ctx.guest || !ctx.account.groupId) return { account: ctx.account || null, solo: true };
  const key = workKey(ctx);
  const lk = await q(`select section, device_id, heartbeat_at from ps_locks where group_id = $1 and topic_id = $2`, [ctx.account.groupId, topicId]);
  const locks = {};
  GROUP_SECTIONS.forEach(sec => {
    const l = lk.find(x => x.section === sec);
    locks[sec] = { active: !!(l && now() - Number(l.heartbeat_at) < 120000), mine: !!(l && l.device_id === str(b.deviceId, 80)) };
  });
  const lkpd = await q(`select mode, data, progress, score, status, updated_at, submitted_at from ps_lkpd where student_id = $1 and topic_id = $2`, [key, topicId]);
  const modes = {};
  lkpd.forEach(r => { modes[r.mode] = { data: r.data || {}, progress: r.progress, score: r.score, status: r.status, updatedAt: r.updated_at, submittedAt: r.submitted_at }; });
  const sim = await one(`select kind, payload, created_at from ps_events where student_id = $1 and topic_id = $2 and kind in ('lab_generate', 'lab_edit') order by created_at desc limit 1`, [key, topicId]);
  const variant = await one(`select variant from ps_experiment where student_id = $1 and topic_id = $2 order by updated_at desc limit 1`, [key, topicId]);
  return {
    account: ctx.account, locks, lkpd: modes, lastVariant: variant ? variant.variant : null,
    sim: sim ? { kind: sim.kind, html: sim.payload && sim.payload.html || "", prompt: sim.payload && (sim.payload.instruction || sim.payload.prompt) || "", createdAt: sim.created_at } : null
  };
};

/* ---------------- Panel Guru: akun siswa & kelompok (milik guru) ---------------- */
async function groupMembership(tid) {
  const accounts = await q(`select student_id, name, class_name, group_id, active, created_at, last_login from ps_accounts where teacher_id = $1 order by class_name asc, name asc`, [tid]);
  const groups = await q(`select group_id, class_name, name, leader_id, created_at from ps_groups where teacher_id = $1 order by class_name asc, name asc`, [tid]);
  const members = {};
  accounts.forEach(a => { if (a.group_id) (members[groupKey(a.group_id)] = members[groupKey(a.group_id)] || []).push(a.student_id); });
  return {
    members,
    accounts: accounts.map(a => ({ studentId: a.student_id, name: a.name, className: a.class_name, groupId: a.group_id, active: !!a.active, createdAt: a.created_at, lastLogin: a.last_login })),
    groups: groups.map(g => ({ groupId: g.group_id, className: g.class_name, name: g.name, leaderId: g.leader_id }))
  };
}
function expandGroupRows(rows, members) {
  const out = [];
  rows.forEach(r => {
    if (!isGroupKey(r.student_id)) { out.push(r); return; }
    (members[r.student_id] || []).forEach(sid => out.push({ ...r, student_id: sid, _group: true }));
  });
  return out;
}
async function groupLabels() {
  const groups = await q(`select group_id, class_name, name from ps_groups`);
  const out = {};
  groups.forEach(g => { out[groupKey(g.group_id)] = `${g.name} (${g.class_name})`; });
  return out;
}
// ID kelompok memuat ID guru, jadi "Kelompok 1" kelas yang sama milik dua guru tidak tercampur.
const groupIdFor = (tid, cls, name) => "g_" + crypto.createHash("sha1").update(String(tid) + "|" + normalizeName(cls) + "|" + normalizeName(name)).digest("hex").slice(0, 12);

async function ensureGroup(tid, cls, name) {
  const gname = cleanLabel(name, 40);
  if (!gname) return null;
  // Kelompok lama (V9) dengan nama & kelas yang sama milik guru ini dipakai ulang.
  const existing = await one(`select group_id from ps_groups where teacher_id = $1 and class_name = $2 and lower(name) = lower($3) limit 1`, [tid, cls, gname]);
  if (existing) return existing.group_id;
  const gid = groupIdFor(tid, cls, gname);
  await q(`insert into ps_groups (group_id, class_name, name, leader_id, created_at, updated_at, teacher_id) values ($1, $2, $3, null, $4, $4, $5)
           on conflict (group_id) do nothing`, [gid, cls, gname, now(), tid]);
  return gid;
}
async function createAccount(tid, nameRaw, clsRaw, groupName, en) {
  const name = cleanLabel(nameRaw, 50), cls = cleanLabel(clsRaw, 20);
  if (!name || !cls) throw new HttpError(400, en ? "Name and class are required." : "Nama dan kelas wajib diisi.");
  const sid = studentIdFor(name, cls);
  const ex = await one(`select teacher_id from ps_accounts where student_id = $1`, [sid]);
  if (ex) throw new HttpError(409, ex.teacher_id && ex.teacher_id !== tid
    ? (en ? `${name} (${cls}) is already registered by another teacher. Use a different class name.` : `${name} (${cls}) sudah didaftarkan guru lain. Gunakan nama kelas yang berbeda.`)
    : (en ? `${name} (${cls}) already exists.` : `${name} (${cls}) sudah terdaftar.`));
  const gid = groupName ? await ensureGroup(tid, cls, groupName) : null;
  const { pin, hash } = await newUniquePin();
  await q(`insert into ps_accounts (student_id, name, name_key, class_name, group_id, pin_hash, pin_enc, token_ver, active, created_at, last_login, teacher_id)
           values ($1, $2, $3, $4, $5, $6, $7, 1, true, $8, null, $9)`, [sid, name, normalizeName(name), cls, gid, hash, await pinEncrypt(pin), now(), tid]);
  await q(`insert into ps_students (student_id, name, class_name, created_at, last_seen, progress) values ($1, $2, $3, $4, null, '{}'::jsonb)
           on conflict (student_id) do nothing`, [sid, name, cls, now()]);
  // Anggota pertama kelompok otomatis jadi ketua (bisa diganti guru)
  if (gid) await q(`update ps_groups set leader_id = $2 where group_id = $1 and leader_id is null`, [gid, sid]);
  return { studentId: sid, name, className: cls, groupId: gid, pin };
}
async function ownAccount(tid, sid, en) {
  const acc = await one(`select * from ps_accounts where student_id = $1 and teacher_id = $2`, [sid, tid]);
  if (!acc) throw new HttpError(404, en ? "Account not found." : "Akun tidak ditemukan.");
  return acc;
}

H.teacher_accounts = async (b) => {
  const T = await requireTeacher(b);
  const { accounts, groups } = await groupMembership(T.teacherId);
  const pins = await q(`select student_id, pin_enc from ps_accounts where teacher_id = $1`, [T.teacherId]);
  const pinMap = {};
  for (const p of pins) pinMap[p.student_id] = await pinDecrypt(p.pin_enc);
  const gids = new Set(groups.map(g => g.groupId));
  return {
    accounts: accounts.map(a => ({ ...a, pin: pinMap[a.studentId] || null })),
    groups, locks: (await locksForGroups()).filter(l => gids.has(l.groupId)), serverNow: now()
  };
};

// lines: [{ name, className, group }]  (dari formulir atau tempel dari Excel)
H.teacher_accounts_add = async (b) => {
  const T = await requireTeacher(b);
  const en = isEn(b);
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 200);
  if (!lines.length) throw new HttpError(400, en ? "No students to add." : "Belum ada siswa yang ditambahkan.");
  const created = [], skipped = [];
  for (const l of lines) {
    try { created.push(await createAccount(T.teacherId, l && l.name, l && l.className, l && l.group, en)); }
    catch (e) { if (e instanceof HttpError && e.status < 500) skipped.push({ name: l && l.name, reason: e.message }); else throw e; }
  }
  return { created, skipped };
};

H.teacher_account_update = async (b) => {
  const T = await requireTeacher(b);
  const sid = sidOf(b);
  const acc = await ownAccount(T.teacherId, sid, isEn(b));
  if (b.groupName !== undefined) {
    const gid = b.groupName ? await ensureGroup(T.teacherId, acc.class_name, b.groupName) : null;
    if (acc.group_id !== gid) {
      await q(`update ps_groups set leader_id = null where group_id = $1 and leader_id = $2`, [acc.group_id, sid]);
      await q(`update ps_accounts set group_id = $2 where student_id = $1`, [sid, gid]);
      if (gid) await q(`update ps_groups set leader_id = $2 where group_id = $1 and leader_id is null`, [gid, sid]);
    }
  }
  if (typeof b.active === "boolean") await q(`update ps_accounts set active = $2, token_ver = token_ver + 1 where student_id = $1`, [sid, b.active]);
  if (b.resetPin) {
    const { pin, hash } = await newUniquePin();
    await q(`update ps_accounts set pin_hash = $2, pin_enc = $3, token_ver = token_ver + 1 where student_id = $1`, [sid, hash, await pinEncrypt(pin)]);
    return { ok: true, pin };
  }
  return { ok: true };
};

// Hapus/pindahkan banyak siswa sekaligus (pilih per kelompok, semua, atau siswa tertentu).
// action "delete": hapus akun beserta semua jawabannya.
// action "move": className (opsional, kelas tujuan) dan/atau groupName ("" = tanpa kelompok).
// Pindah kelas mengganti ID siswa ("Nama (Kelas)") di semua tabel supaya rekap tetap utuh;
// siswa perlu masuk lagi dengan PIN yang sama.
const SID_TABLES = ["ps_events", "ps_lkpd", "ps_experiment", "ps_gates", "ps_quiz_answers", "ps_test_answers", "ps_locks"];
async function deleteStudentData(sid) {
  for (const t of ["ps_events", "ps_lkpd", "ps_experiment", "ps_gates", "ps_quiz_answers", "ps_test_answers", "ps_locks", "ps_students", "ps_accounts"]) {
    await q(`delete from ${t} where student_id = $1`, [sid]);
  }
  await q(`update ps_groups set leader_id = null where leader_id = $1`, [sid]);
}
H.teacher_accounts_bulk = async (b) => {
  const T = await requireTeacher(b);
  const en = isEn(b);
  const ids = [...new Set((Array.isArray(b.studentIds) ? b.studentIds : []).slice(0, 400).map(x => str(x, MAX_SID)).filter(Boolean))];
  if (!ids.length) throw new HttpError(400, en ? "Select at least one student." : "Pilih minimal satu siswa.");
  const action = b.action === "delete" ? "delete" : b.action === "move" ? "move" : null;
  if (!action) throw new HttpError(400, en ? "Unknown action." : "Aksi tidak dikenal.");
  const done = [], skipped = [];
  if (action === "delete") {
    for (const sid of ids) {
      if (!(await one(`select 1 from ps_accounts where student_id = $1 and teacher_id = $2`, [sid, T.teacherId]))) { skipped.push({ studentId: sid, reason: en ? "not found" : "tidak ditemukan" }); continue; }
      await deleteStudentData(sid); done.push(sid);
    }
    return { ok: true, done, skipped };
  }
  const toClass = b.className != null && String(b.className).trim() ? cleanLabel(b.className, 20) : null;
  const hasGroup = b.groupName !== undefined && b.groupName !== null;
  if (!toClass && !hasGroup) throw new HttpError(400, en ? "Choose a target class or group." : "Pilih kelas atau kelompok tujuan.");
  for (const sid0 of ids) {
    const acc = await one(`select * from ps_accounts where student_id = $1 and teacher_id = $2`, [sid0, T.teacherId]);
    if (!acc) { skipped.push({ studentId: sid0, reason: en ? "not found" : "tidak ditemukan" }); continue; }
    let sid = sid0, cls = acc.class_name;
    if (toClass && toClass !== acc.class_name) {
      const nsid = studentIdFor(acc.name, toClass);
      if (await one(`select 1 from ps_accounts where student_id = $1`, [nsid])) {
        skipped.push({ studentId: sid0, reason: en ? `${acc.name} already exists in ${toClass}` : `${acc.name} sudah ada di kelas ${toClass}` });
        continue;
      }
      await q(`update ps_groups set leader_id = null where leader_id = $1`, [sid0]);
      if (acc.group_id) await releaseGroupLocks(acc.group_id);
      await q(`update ps_accounts set student_id = $2, class_name = $3, group_id = null, token_ver = token_ver + 1 where student_id = $1`, [sid0, nsid, toClass]);
      await q(`update ps_students set student_id = $2, class_name = $3 where student_id = $1`, [sid0, nsid, toClass]);
      for (const t of SID_TABLES) await q(`update ${t} set student_id = $2 where student_id = $1`, [sid0, nsid]);
      await q(`update ps_ai_usage set bucket = $2 where bucket = $1`, [sid0, nsid]).catch(() => {});
      await q(`update ps_token_usage set account_id = $2 where account_id = $1`, [sid0, nsid]).catch(() => {});
      sid = nsid; cls = toClass;
      acc.group_id = null;
    }
    if (hasGroup || (toClass && toClass !== acc.class_name)) {
      const gid = hasGroup && String(b.groupName).trim() ? await ensureGroup(T.teacherId, cls, b.groupName) : null;
      if (acc.group_id !== gid) {
        if (acc.group_id) await q(`update ps_groups set leader_id = null where group_id = $1 and leader_id = $2`, [acc.group_id, sid]);
        await q(`update ps_accounts set group_id = $2 where student_id = $1`, [sid, gid]);
        if (gid) await q(`update ps_groups set leader_id = $2 where group_id = $1 and leader_id is null`, [gid, sid]);
      }
    }
    done.push(sid);
  }
  return { ok: true, done, skipped };
};

H.teacher_group_update = async (b) => {
  const T = await requireTeacher(b);
  const gid = str(b.groupId, 40);
  const g = await one(`select * from ps_groups where group_id = $1 and teacher_id = $2`, [gid, T.teacherId]);
  if (!g) throw new HttpError(404, isEn(b) ? "Group not found." : "Kelompok tidak ditemukan.");
  if (b.leaderId !== undefined) {
    const leader = str(b.leaderId, MAX_SID) || null;
    if (leader && !(await one(`select 1 from ps_accounts where student_id = $1 and group_id = $2`, [leader, gid]))) throw new HttpError(400, isEn(b) ? "The leader must be a member of this group." : "Ketua harus anggota kelompok ini.");
    await q(`update ps_groups set leader_id = $2, updated_at = $3 where group_id = $1`, [gid, leader, now()]);
    await releaseGroupLocks(gid);
  }
  if (b.unlock) await releaseGroupLocks(gid);
  if (b.delete) {
    await q(`update ps_accounts set group_id = null where group_id = $1`, [gid]);
    await q(`delete from ps_groups where group_id = $1`, [gid]);
    await releaseGroupLocks(gid);
  }
  return { ok: true };
};

/* ============================================================
   Panel Admin: akun guru & pemakaian token
   ============================================================ */
H.admin_login = async (b) => {
  const out = await loginAdmin(b.username, b.password, b._ip, isEn(b));
  return { ok: true, ...out };
};
H.admin_me = async (b) => {
  const a = await requireAdmin(b);
  return { admin: a, ai: aiConfigured() };
};
H.admin_change_password = async (b) => {
  await requireAdmin(b);
  return { ok: true, ...(await changeAdminPassword(String(b.current || ""), String(b.next || ""), isEn(b))) };
};
H.admin_teachers = async (b) => {
  await requireAdmin(b);
  const rows = await q(`select * from ps_teachers order by name asc`);
  const counts = await q(`select teacher_id, count(*)::int as n, count(distinct class_name)::int as classes from ps_accounts where teacher_id is not null group by teacher_id`);
  const groups = await q(`select teacher_id, count(*)::int as n from ps_groups where teacher_id is not null group by teacher_id`);
  const sess = await q(`select teacher_id, active, code from ps_sessions`);
  const cMap = {}, gMap = {}, sMap = {};
  counts.forEach(r => { cMap[r.teacher_id] = r; });
  groups.forEach(r => { gMap[r.teacher_id] = Number(r.n); });
  sess.forEach(r => { sMap[r.teacher_id] = !!r.active; });
  const legacy = await one(`select (select count(*)::int from ps_accounts where teacher_id is null) as accounts, (select count(*)::int from ps_groups where teacher_id is null) as groups, (select count(*)::int from ps_quizzes where teacher_id is null) as quizzes`);
  return {
    teachers: rows.map(r => ({ ...publicTeacher(r), students: cMap[r.teacher_id] ? Number(cMap[r.teacher_id].n) : 0, classes: cMap[r.teacher_id] ? Number(cMap[r.teacher_id].classes) : 0, groups: gMap[r.teacher_id] || 0, sessionActive: !!sMap[r.teacher_id] })),
    legacy: { accounts: Number(legacy.accounts), groups: Number(legacy.groups), quizzes: Number(legacy.quizzes) }
  };
};
H.admin_teacher_create = async (b) => {
  await requireAdmin(b);
  return { ok: true, ...(await createTeacher({ username: b.username, name: b.name, password: b.password || null }, isEn(b))) };
};
H.admin_teacher_update = async (b) => {
  await requireAdmin(b);
  const patch = {};
  ["name", "username", "password"].forEach(k => { if (b[k] !== undefined && b[k] !== null && b[k] !== "") patch[k] = b[k]; });
  if (typeof b.active === "boolean") patch.active = b.active;
  if (b.resetPassword) patch.resetPassword = true;
  return updateTeacher(str(b.teacherId, 40), patch, isEn(b));
};
// Hapus akun guru. Siswa, kelompok, dan kuis milik guru itu TIDAK dihapus:
// bisa dipindahkan ke guru lain (targetTeacherId) atau dibiarkan tanpa guru.
H.admin_teacher_delete = async (b) => {
  await requireAdmin(b);
  const tid = str(b.teacherId, 40);
  const t = await one(`select * from ps_teachers where teacher_id = $1`, [tid]);
  if (!t) throw new HttpError(404, isEn(b) ? "Teacher account not found." : "Akun guru tidak ditemukan.");
  const target = str(b.targetTeacherId, 40) || null;
  if (target && (target === tid || !(await one(`select 1 from ps_teachers where teacher_id = $1`, [target])))) throw new HttpError(400, isEn(b) ? "Choose another teacher to receive the students." : "Pilih guru lain untuk menerima siswa.");
  for (const tb of ["ps_accounts", "ps_groups", "ps_quizzes"]) await q(`update ${tb} set teacher_id = $2 where teacher_id = $1`, [tid, target]);
  if (target) {
    const banks = await q(`select topic_id, kind, data from ps_question_banks where teacher_id = $1`, [tid]);
    for (const bk of banks) await q(`insert into ps_question_banks (teacher_id, topic_id, kind, data, updated_at) values ($1, $2, $3, $4::jsonb, $5) on conflict do nothing`, [target, bk.topic_id, bk.kind, J(bk.data), now()]);
  }
  await q(`delete from ps_question_banks where teacher_id = $1`, [tid]);
  await q(`delete from ps_sessions where teacher_id = $1`, [tid]);
  await q(`delete from ps_teachers where teacher_id = $1`, [tid]);
  return { ok: true };
};
// Data lama V9 (sebelum ada akun guru) diserahkan ke satu guru.
H.admin_assign_legacy = async (b) => {
  await requireAdmin(b);
  const tid = str(b.teacherId, 40);
  if (!(await one(`select 1 from ps_teachers where teacher_id = $1`, [tid]))) throw new HttpError(404, isEn(b) ? "Teacher account not found." : "Akun guru tidak ditemukan.");
  const a = await q(`update ps_accounts set teacher_id = $1 where teacher_id is null returning student_id`, [tid]);
  const g = await q(`update ps_groups set teacher_id = $1 where teacher_id is null returning group_id`, [tid]);
  const z = await q(`update ps_quizzes set teacher_id = $1 where teacher_id is null returning id`, [tid]);
  return { ok: true, accounts: a.length, groups: g.length, quizzes: z.length };
};
H.admin_usage = async (b) => {
  await requireAdmin(b);
  const period = ["today", "7d", "30d", "all"].includes(b.period) ? b.period : "7d";
  const rep = await usageReport(period);
  const teachers = await q(`select teacher_id, name, username from ps_teachers`);
  const accounts = await q(`select student_id, name, class_name, teacher_id from ps_accounts`);
  const groups = await q(`select group_id, name, class_name from ps_groups`);
  const tMap = {}, aMap = {}, gMap = {};
  teachers.forEach(t => { tMap[t.teacher_id] = { name: t.name, username: t.username }; });
  accounts.forEach(a => { aMap[a.student_id] = { name: a.name, className: a.class_name, teacherId: a.teacher_id }; });
  groups.forEach(g => { gMap[groupKey(g.group_id)] = `${g.name} (${g.class_name})`; });
  return { ...rep, teachers: tMap, accounts: aMap, groups: gMap, limits: limits(), today: await usageToday(), ai: aiConfigured(), models: { chat: MODELS.chat, sim: MODELS.sim } };
};

export async function dispatch(body) {
  const mode = str(body.mode, 40);
  const fn = H[mode];
  if (!fn) throw new HttpError(400, "Permintaan tidak dikenal. Muat ulang halaman lalu coba lagi.");
  try {
    await primeAuth();
    return await fn(body);
  } catch (e) {
    if (e instanceof AccountError) throw new HttpError(e.status, e.message, e.code);
    throw e;
  }
}

export { verifyToken, sessionForStudent, codeMatches };
