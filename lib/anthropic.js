/* ============================================================
   lib/anthropic.js - klien minimal Claude Messages API (tanpa SDK)
   ------------------------------------------------------------
   API key HANYA dibaca dari env ANTHROPIC_API_KEY di server Vercel,
   tidak pernah dikirim ke browser.
   - Haiku 5.5  (claude-haiku-5-5): tutor chat, generate kuis, cek data.
     effort "low" + thinking dimatikan untuk chat -> respons tercepat.
   - Opus 5.5   (claude-opus-5-5): generate & edit simulasi HTML. Thinking
     Opus 5.5 selalu aktif (tidak bisa dimatikan); kedalamannya diatur
     dengan output_config.effort.
   Error sementara (429 rate limit, 500, 529 overloaded) dicoba ulang
   otomatis dengan exponential backoff + jitter.
   ============================================================ */

export const MODELS = {
  chat: process.env.CHAT_MODEL || "claude-haiku-5-5",
  sim: process.env.SIM_MODEL || "claude-opus-5-5"
};

const API_VERSION = "2023-06-01";

function baseUrl() {
  return (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "");
}

export function aiConfigured() {
  return !!String(process.env.ANTHROPIC_API_KEY || "").trim();
}

function headers() {
  return {
    "content-type": "application/json",
    "x-api-key": String(process.env.ANTHROPIC_API_KEY || "").trim(),
    "anthropic-version": API_VERSION
  };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504, 529]);

export class AiError extends Error {
  constructor(status, message, type) {
    super(message);
    this.status = status;
    this.type = type || "";
  }
}

async function readError(resp) {
  let msg = "HTTP " + resp.status, type = "";
  try {
    const data = await resp.json();
    if (data && data.error) { msg = data.error.message || msg; type = data.error.type || ""; }
  } catch (e) { /* abaikan */ }
  return new AiError(resp.status, msg, type);
}

async function postWithRetry(body, { attempts = 4, baseDelay = 900, maxDelay = 8000, signal } = {}) {
  let lastErr = null;
  for (let i = 1; i <= attempts; i++) {
    let resp;
    try {
      resp = await fetch(baseUrl() + "/v1/messages", { method: "POST", headers: headers(), body: JSON.stringify(body), signal });
    } catch (e) {
      if (signal && signal.aborted) throw e;
      lastErr = new AiError(0, "Koneksi ke server AI gagal: " + e.message, "network");
      resp = null;
    }
    if (resp && resp.ok) return resp;
    if (resp) {
      lastErr = await readError(resp);
      if (!RETRYABLE.has(resp.status)) throw lastErr;
      const ra = parseFloat(resp.headers.get("retry-after") || "");
      if (!isNaN(ra) && ra > 0 && ra < 20 && i < attempts) { await sleep(ra * 1000); continue; }
    }
    if (i === attempts) break;
    const exp = Math.min(maxDelay, baseDelay * Math.pow(2, i - 1));
    await sleep(exp + Math.random() * exp * 0.4);
  }
  throw lastErr || new AiError(0, "Server AI tidak merespons.");
}

// Panggilan biasa (non-stream). Mengembalikan { text, stopReason, usage }.
export async function createMessage(body, opts) {
  const resp = await postWithRetry({ ...body, stream: false }, opts);
  const data = await resp.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
  return { text, stopReason: data.stop_reason, usage: data.usage || null };
}

// Panggilan streaming. onText(delta) dipanggil untuk setiap potongan teks
// jawaban (blok "thinking" tidak diteruskan ke siswa). onPhase("thinking"|
// "writing") dipakai klien untuk menampilkan status. Mengembalikan
// { text, stopReason, usage }.
export async function streamMessage(body, { onText, onPhase, signal, attempts = 3 } = {}) {
  const resp = await postWithRetry({ ...body, stream: true }, { attempts, signal });
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", text = "", stopReason = null, usage = null, phase = null;
  const setPhase = p => { if (p !== phase) { phase = p; onPhase && onPhase(p); } };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rawEvent = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const dataLine = rawEvent.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
      if (!dataLine) continue;
      let ev;
      try { ev = JSON.parse(dataLine); } catch (e) { continue; }
      if (ev.type === "message_start") {
        // input_tokens & cache tokens dilaporkan di awal; output_tokens di message_delta.
        if (ev.message && ev.message.usage) usage = { ...(usage || {}), ...ev.message.usage };
      } else if (ev.type === "content_block_start") {
        const bt = ev.content_block && ev.content_block.type;
        if (bt === "thinking" || bt === "redacted_thinking") setPhase("thinking");
        else if (bt === "text") setPhase("writing");
      } else if (ev.type === "content_block_delta") {
        const d = ev.delta || {};
        if (d.type === "text_delta" && d.text) {
          setPhase("writing");
          text += d.text;
          onText && onText(d.text);
        }
      } else if (ev.type === "message_delta") {
        if (ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
        if (ev.usage) usage = { ...(usage || {}), ...ev.usage };
      } else if (ev.type === "error") {
        throw new AiError(500, (ev.error && ev.error.message) || "Stream AI error", ev.error && ev.error.type);
      }
    }
  }
  return { text, stopReason, usage };
}

// Pesan error ramah siswa (Bahasa Indonesia / Inggris).
export function describeAiError(err, lang) {
  const en = lang === "en";
  const s = err && err.status;
  if (s === 401 || s === 403) { console.error("[ai] API key ditolak - periksa ANTHROPIC_API_KEY di Vercel"); return en ? "The AI service isn't available right now. Please tell your teacher." : "Layanan AI sedang tidak bisa dipakai. Beri tahu gurumu."; }
  if (s === 402 || /credit|billing|balance/i.test(String(err && err.message))) return en ? "The AI credit balance has run out. Tell your teacher." : "Saldo kredit AI sudah habis. Beri tahu gurumu.";
  if (s === 429) return en ? "Too many AI requests right now. Wait about 30 seconds and try again." : "Permintaan AI sedang terlalu banyak. Tunggu sekitar 30 detik lalu coba lagi.";
  if (s === 529 || s === 503 || s === 500) return en ? "The AI is busy right now. Try again in about a minute." : "AI sedang sibuk. Coba lagi sekitar 1 menit lagi.";
  console.error("[ai] error", s, err && err.message);
  if (s === 400) return en ? "The AI couldn't process that request. Try rewording it." : "AI belum bisa memproses permintaan itu. Coba tulis ulang dengan kalimat lain.";
  return en ? "The AI ran into a problem. Please try again." : "AI mengalami kendala. Silakan coba lagi.";
}

// Ambil JSON pertama yang valid dari teks (mengabaikan code fence / teks pengantar).
export function extractJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return JSON.parse(t); } catch (e) { /* lanjut */ }
  const starts = [t.indexOf("["), t.indexOf("{")].filter(i => i >= 0).sort((a, b) => a - b);
  for (const s of starts) {
    const open = t[s], close = open === "[" ? "]" : "}";
    const e = t.lastIndexOf(close);
    if (e > s) {
      try { return JSON.parse(t.slice(s, e + 1)); } catch (err) { /* coba berikutnya */ }
    }
  }
  return null;
}
