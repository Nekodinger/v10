/* ============================================================
   POST /api/ai  -> Server-Sent Events (streaming)
   ------------------------------------------------------------
   mode "chat"     : Tutor Fisika, Claude Haiku 5.5 (cepat & murah)
   mode "simulate" : generate simulasi HTML, Claude Opus 5.5
   mode "edit"     : revisi simulasi yang sudah ada, Claude Opus 5.5
   mode "continue" : lanjutkan HTML yang terpotong (batas waktu/ token)
   Setiap event: data: {"t":"delta","text":"..."} | {"t":"phase",...} |
   {"t":"done","stop":"end_turn"} | {"t":"error","error":"..."} |
   {"t":"timeout"}.
   Respons di-stream supaya teks langsung muncul bertahap dan tidak
   terkena batas waktu 60 detik seperti Apps Script di V7.
   ============================================================ */
import { applyCors, originAllowed, readJsonBody, sendJson, sseStart, sseSend } from "../lib/http.js";
import { resolveStudent, workKey, assertGroupWriter, AccountError, primeAuth } from "../lib/accounts.js";
import { resolveTeacher } from "../lib/staff.js";
import { recordTokens } from "../lib/tokens.js";
import { aiConfigured, streamMessage, describeAiError, MODELS } from "../lib/anthropic.js";
import { SIM_SYSTEM_PROMPT, buildChatSystemPrompt } from "../lib/prompts.js";
import { takeQuota } from "../lib/usage.js";
import { q, J, jsonSize } from "../lib/db.js";
import { sessionForStudent, codeMatches } from "../lib/handlers.js";

const str = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

function simEffort() {
  const e = String(process.env.SIM_EFFORT || "low").toLowerCase();
  return ["low", "medium", "high"].includes(e) ? e : "low";
}
function timeBudgetMs() {
  const v = parseInt(process.env.SIM_TIME_BUDGET_MS, 10);
  return isNaN(v) ? 270000 : Math.max(20000, Math.min(v, 290000));
}

function chatMessages(history, message) {
  const out = [];
  (Array.isArray(history) ? history : []).slice(-12).forEach(h => {
    const role = h && (h.role === "model" || h.role === "assistant") ? "assistant" : "user";
    const text = str(h && h.text, 2000);
    if (!text) return;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += "\n\n" + text;
    else out.push({ role, content: text });
  });
  while (out.length && out[0].role !== "user") out.shift();
  if (out.length && out[out.length - 1].role === "user") out.pop(); // pesan baru selalu jadi giliran user terakhir
  out.push({ role: "user", content: message });
  return out;
}

function editPrompt(html, instruction, lang) {
  return (lang === "en"
    ? "Below is the complete HTML of an existing physics simulation. Revise it according to the student's instruction, keep everything else working, and reply with the FULL revised HTML document only.\n\nSTUDENT INSTRUCTION:\n"
    : "Berikut HTML lengkap sebuah simulasi fisika yang sudah ada. Revisi sesuai instruksi siswa, pertahankan bagian lain tetap berfungsi, dan balas HANYA dengan dokumen HTML hasil revisi yang LENGKAP.\n\nINSTRUKSI SISWA:\n")
    + instruction + "\n\nHTML:\n" + html;
}

function continuePrompt(task, partial, lang) {
  return (lang === "en"
    ? "You were writing a single HTML document for this task but the output stopped early. Continue EXACTLY from the last character of the partial output below. Output ONLY the remaining text (no repetition, no explanation, no code fence) until '</html>'.\n\nTASK:\n"
    : "Kamu sedang menulis satu dokumen HTML untuk tugas ini, tetapi keluaran terhenti sebelum selesai. Lanjutkan PERSIS dari karakter terakhir keluaran sebagian di bawah. Tulis HANYA sisa teksnya (tanpa mengulang, tanpa penjelasan, tanpa code fence) sampai '</html>'.\n\nTUGAS:\n")
    + task + "\n\nPARTIAL OUTPUT (last part):\n" + partial.slice(-24000);
}

async function logGeneration(sid, topicId, kind, payload) {
  if (/^Tamu-|^teacher(:|$)|^anon$/.test(sid)) return;
  try {
    const json = J(payload);
    if (jsonSize(payload) > 400000) return;
    await q(`insert into ps_events (student_id, topic_id, kind, item, payload, score, created_at) values ($1, $2, $3, null, $4::jsonb, null, $5)`,
      [sid, topicId || null, kind, json, Date.now()]);
  } catch (e) { console.error("[ai] log", e); }
}

// Mode "continue": sambungkan hasil lanjutan ke catatan generate/edit terakhir siswa ini,
// supaya Panel Guru menampilkan simulasi yang utuh (bukan versi yang terpotong).
async function appendContinuation(sid, fullHtml, done) {
  if (/^Tamu-|^teacher(:|$)|^anon$/.test(sid)) return;
  try {
    const patch = { html: fullHtml.slice(0, 200000), truncated: !done, continued: true };
    if (jsonSize(patch) > 400000) return;
    await q(`update ps_events set payload = coalesce(payload, '{}'::jsonb) || $1::jsonb
             where id = (select id from ps_events where student_id = $2 and kind in ('lab_generate', 'lab_edit') order by created_at desc limit 1)`,
      [J(patch), sid]);
  } catch (e) { console.error("[ai] continue log", e); }
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (!originAllowed(req)) return sendJson(res, 403, { error: "Permintaan ditolak. / Request blocked." });
  let b;
  try { b = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: "Permintaan tidak valid. Muat ulang halaman. / Invalid request." }); }
  const lang = b.lang === "en" ? "en" : "id";
  const en = lang === "en";
  const mode = str(b.mode, 20);
  if (!["chat", "simulate", "edit", "continue"].includes(mode)) return sendJson(res, 400, { error: "Permintaan tidak dikenal. / Unknown request." });
  if (!aiConfigured()) return sendJson(res, 503, { error: en ? "The AI isn't available yet. Please tell your teacher." : "AI belum tersedia. Beri tahu gurumu." });

  b._ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();
  let teacher = null;
  let ctx = null;
  try {
    await primeAuth();
    teacher = b.teacherToken ? await resolveTeacher(b) : null;
    ctx = teacher ? null : await resolveStudent(b);
  } catch (e) {
    if (e instanceof AccountError) return sendJson(res, e.status, { error: e.message, code: e.code });
    return sendJson(res, 500, { error: (console.error("[ai]", e), en ? "Something went wrong. Please try again." : "Terjadi kendala. Silakan coba lagi.") });
  }
  if (!teacher && !ctx) return sendJson(res, 401, { error: en ? "Your login has ended. Sign in again with your name and PIN." : "Sesi login kamu sudah berakhir. Masuk lagi dengan nama dan PIN dari gurumu.", code: "AUTH" });
  // AI (Tutor Fisika & Makerspace) untuk siswa hanya saat belajar di kelas:
  // harus ada sesi kelas aktif dan siswa memakai kode sesi itu. Mode mandiri
  // tidak memakai AI sehingga kuota API guru tidak terpakai di luar kelas.
  // Guru dan validator (kode eksplorasi) tidak terkena aturan ini.
  if (!teacher && !ctx.guest) {
    let st;
    try { st = await sessionForStudent(ctx, str(b.sessionCode, 20)); }
    catch (e) { return sendJson(res, 500, { error: (console.error("[ai]", e), en ? "Something went wrong. Please try again." : "Terjadi kendala. Silakan coba lagi.") }); }
    if (!codeMatches(st, str(b.sessionCode, 20))) {
      return sendJson(res, 403, { code: "CLASS_ONLY", error: en
        ? "The AI tutor and Makerspace are only available during a class session with your teacher."
        : "Tutor Fisika dan Makerspace hanya bisa dipakai saat belajar di kelas bersama guru (sesi kelas aktif)." });
    }
  }
  const topicId = str(b.topicId, 60);
  // Chat tutor: per siswa. Simulasi Makerspace: kerja kelompok (kuota & catatan per kelompok,
  // hanya ketua, hanya dari satu perangkat).
  const sid = teacher ? "teacher:" + teacher.teacherId : (mode === "chat" ? ctx.sid : workKey(ctx));
  if (!teacher && mode !== "chat" && !ctx.guest) {
    try { await assertGroupWriter(ctx, topicId, "lab", str(b.deviceId, 80), en); }
    catch (e) {
      if (e instanceof AccountError) return sendJson(res, e.status, { error: e.message, code: e.code });
      return sendJson(res, 500, { error: (console.error("[ai]", e), en ? "Something went wrong. Please try again." : "Terjadi kendala. Silakan coba lagi.") });
    }
  }

  // ---- Susun permintaan ke Claude ----
  let body, quotaKind, logKind = null, logPayload = null, contPartial = null;
  if (mode === "chat") {
    const message = str(b.message, 1500);
    if (!message) return sendJson(res, 400, { error: en ? "Empty message." : "Pesan kosong." });
    quotaKind = "chat";
    const restricted = (Array.isArray(b.restrictedQuestions) ? b.restrictedQuestions : []).slice(0, 40).map(s => str(s, 600)).filter(Boolean);
    const system = buildChatSystemPrompt({ topic: str(b.topic, 200) || "Physics", kbContext: str(b.kbContext, 6000), lang, level: str(b.level, 20), restrictedQuestions: restricted });
    body = {
      model: MODELS.chat,
      max_tokens: 1200,
      output_config: { effort: "low" },
      thinking: { type: "disabled" },
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: chatMessages(b.history, message)
    };
  } else {
    let userContent;
    if (mode === "simulate") {
      const prompt = str(b.prompt, 8000);
      if (!prompt) return sendJson(res, 400, { error: en ? "Empty prompt." : "Prompt kosong." });
      userContent = prompt; quotaKind = "simulate"; logKind = "lab_generate";
      logPayload = { prompt };
    } else if (mode === "edit") {
      const html = String(b.html || "").slice(0, 160000);
      const instruction = str(b.instruction, 2000);
      if (!html || !instruction) return sendJson(res, 400, { error: en ? "Nothing to edit." : "Tidak ada simulasi/instruksi untuk diedit." });
      userContent = editPrompt(html, instruction, lang); quotaKind = "edit"; logKind = "lab_edit";
      logPayload = { instruction };
    } else {
      const partial = String(b.partial || "").slice(0, 200000);
      const task = b.html ? editPrompt(String(b.html).slice(0, 160000), str(b.instruction, 2000), lang) : str(b.prompt, 8000);
      if (!partial || !task) return sendJson(res, 400, { error: en ? "Nothing to continue." : "Tidak ada yang bisa dilanjutkan." });
      userContent = continuePrompt(task, partial, lang); quotaKind = "edit"; contPartial = partial;
    }
    body = {
      model: MODELS.sim,
      max_tokens: 32000,
      output_config: { effort: simEffort() },
      system: [{ type: "text", text: SIM_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }]
    };
  }

  let quota;
  try {
    quota = await takeQuota(quotaKind, sid);
  } catch (e) {
    if (e && e.code === "DATABASE_NOT_CONFIGURED") quota = { ok: true, release: async () => {} };
    else return sendJson(res, 500, { error: (console.error("[ai]", e), en ? "Something went wrong. Please try again." : "Terjadi kendala. Silakan coba lagi.") });
  }
  if (!quota.ok) {
    const msg = quota.reason === "student"
      ? (en ? `You have reached today's limit for this AI feature (${quota.limit}). It resets at midnight (WIB).` : `Kamu sudah mencapai batas harian fitur AI ini (${quota.limit}x). Kuota direset tengah malam WIB.`)
      : (en ? "The class has used today's AI budget. Try again tomorrow or ask your teacher." : "Kuota AI kelas untuk hari ini sudah habis. Coba lagi besok atau hubungi gurumu.");
    return sendJson(res, 429, { error: msg });
  }

  // ---- Stream ke browser ----
  sseStart(res);
  sseSend(res, { t: "start", model: body.model });
  const controller = new AbortController();
  let closed = false, timedOut = false, gotText = false, full = "", finishedOk = false, usage = null;
  req.on("close", () => { if (!res.writableEnded) { closed = true; controller.abort(); } });
  const budget = mode === "chat" ? 60000 : timeBudgetMs();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, budget);
  const ping = setInterval(() => { if (!closed) sseSend(res, { t: "ping" }); }, 10000);
  try {
    const out = await streamMessage(body, {
      signal: controller.signal,
      onPhase: phase => sseSend(res, { t: "phase", phase }),
      onText: d => { gotText = true; full += d; sseSend(res, { t: "delta", text: d }); }
    });
    usage = out.usage || null;
    sseSend(res, { t: "done", stop: out.stopReason || "end_turn", usage });
    finishedOk = out.stopReason !== "max_tokens";
    if (logKind) logPayload.html = full.slice(0, 200000);
  } catch (e) {
    if (timedOut) {
      sseSend(res, { t: "timeout" });
      if (logKind) { logPayload.html = full.slice(0, 200000); logPayload.truncated = true; }
    } else if (!closed) {
      if (!gotText) await quota.release();
      sseSend(res, { t: "error", error: describeAiError(e, lang) });
      logKind = null;
    }
  } finally {
    clearTimeout(timer);
    clearInterval(ping);
    // Pemakaian token per akun (Panel Admin). Bila stream terputus sebelum Claude
    // melaporkan usage, panggilan tetap dicatat (token 0) supaya jumlah permintaan akurat.
    if (gotText || usage) await recordTokens({
      accountKind: teacher ? "teacher" : (ctx.guest ? "guest" : "student"),
      accountId: teacher ? teacher.teacherId : ctx.sid,
      teacherId: teacher ? teacher.teacherId : (ctx.account ? ctx.account.teacherId : null),
      workKey: sid, kind: mode, model: body.model, usage
    });
    if (logKind && full) await logGeneration(sid, topicId, logKind, logPayload);
    if (contPartial && full) await appendContinuation(sid, contPartial + full, finishedOk);
    if (!res.writableEnded) res.end();
  }
}
