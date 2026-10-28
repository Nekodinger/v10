/* ============================================================
   tests/dev-server.mjs - server lokal untuk uji coba tanpa Vercel
   ------------------------------------------------------------
   - Database: PGlite (PostgreSQL WASM, in-memory) memakai SQL yang SAMA
     dengan produksi (lib/schema.js, lib/handlers.js).
   - AI: server tiruan Claude API (SSE) di port terpisah, kecuali env
     ANTHROPIC_API_KEY asli diberikan dan MOCK_AI=0.
   Jalankan:  npm run dev   lalu buka http://localhost:4010
   ============================================================ */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = parseInt(process.env.PORT || "4010", 10);
const MOCK_PORT = PORT + 1;

process.env.ADMIN_PASSWORD ||= "admin-uji";
process.env.SELF_STUDY_CODE ||= "mandiri-uji";
process.env.EXPLORE_CODE ||= "jelajah-uji";
if (process.env.MOCK_AI !== "0") {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;
}

// DATABASE_URL diisi -> pakai Postgres sungguhan lewat postgres.js (jalur produksi);
// kosong -> PGlite in-memory.
if (!process.env.DATABASE_URL) {
  const { setQueryImpl } = await import("../lib/db.js");
  const pg = new PGlite();
  setQueryImpl(async (text, params) => (await pg.query(text, params || [])).rows);
}

const backend = (await import("../api/backend.js")).default;
const ai = (await import("../api/ai.js")).default;
const health = (await import("../api/health.js")).default;

/* ---------- Mock Claude API ---------- */
export const mockLog = [];
let dropNext = false;
const DEMO_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Mock F=BIL</title>
<style>body{font-family:sans-serif;background:#F3F1EC;margin:0;padding:16px}#out{font-size:22px}</style></head>
<body><h1>Mock simulation F = BIL</h1><label>I <input id="i" type="range" min="0" max="5" step="0.5" value="2"></label>
<p id="out"></p><canvas id="c" width="300" height="120"></canvas>
<script>
const i=document.getElementById('i'),o=document.getElementById('out'),c=document.getElementById('c').getContext('2d');
function draw(){const I=parseFloat(i.value),F=0.2*I*0.05;o.textContent='F = '+F.toFixed(3)+' N';c.clearRect(0,0,300,120);c.fillStyle='#B8391F';c.fillRect(10,60,F*2000,20);requestAnimationFrame(draw);}
draw();
</script></body></html>`;

function sse(res, events, delayMs) {
  res.writeHead(200, { "content-type": "text/event-stream" });
  let k = 0;
  const tick = () => {
    if (k >= events.length) return res.end();
    res.write(`event: ${events[k].type}\ndata: ${JSON.stringify(events[k])}\n\n`);
    k++;
    setTimeout(tick, delayMs);
  };
  tick();
}
function chunks(s, n) { const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out; }

const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", c => raw += c);
  req.on("end", () => {
    let body = {};
    try { body = JSON.parse(raw); } catch (e) {}
    mockLog.push({ headers: req.headers, body });
    if (req.headers["x-api-key"] !== "test-key") { res.writeHead(401); return res.end(JSON.stringify({ error: { type: "authentication_error", message: "bad key" } })); }
    const lastUser = (body.messages || []).slice(-1)[0];
    const userText = typeof lastUser?.content === "string" ? lastUser.content : "";
    const isSim = /opus/.test(body.model || "");
    let text;
    if (/JSON/.test(userText) && /flagged/.test(userText)) text = JSON.stringify({ flagged: false, feedback: "Data terlihat wajar: F naik linear terhadap I." });
    else if (/array JSON|JSON array/.test(userText)) text = JSON.stringify([
      { type: "mcq", question: "Sebuah kawat sepanjang $0{,}20$ m membawa arus 3,0 A tegak lurus medan 0,50 T. Gaya pada kawat adalah", options: ["0,30 N", "0,15 N", "3,0 N", "0,60 N"], correct: 0, modelAnswer: "F = BIL = 0,50 x 3,0 x 0,20 = 0,30 N" },
      { type: "short", question: "Nyatakan definisi tesla.", modelAnswer: "1 T = 1 N A^-1 m^-1" }
    ]);
    else if (isSim) text = /PARTIAL OUTPUT/.test(userText) ? DEMO_HTML.slice(DEMO_HTML.length / 2) : DEMO_HTML;
    else text = "Pertanyaan bagus! Menurutmu, apa yang terjadi pada $F$ jika arus $I$ dijadikan dua kali lipat?";
    if (!body.stream) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } }));
    }
    const ev = [{ type: "message_start", message: { id: "m", model: body.model, usage: { input_tokens: 2500, cache_read_input_tokens: 400, output_tokens: 1 } } }];
    if (isSim) ev.push({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }, { type: "content_block_stop", index: 0 });
    ev.push({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    chunks(text, isSim ? 400 : 12).forEach(c => ev.push({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: c } }));
    ev.push({ type: "content_block_stop", index: 1 }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 99 } }, { type: "message_stop" });
    sse(res, ev, isSim ? 15 : 20);
  });
});

/* ---------- Static + API ---------- */
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8" };
// Header keamanan sama dengan produksi (vercel.json), supaya tes ikut menguji CSP.
const PROD_HEADERS = (() => { try { const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8")); const h = {}; (v.headers || []).filter(x => x.source === "/(.*)").forEach(x => x.headers.forEach(k => { if (k.key !== "Strict-Transport-Security") h[k.key] = String(k.value).replace("; upgrade-insecure-requests", ""); })); return h; } catch (e) { return {}; } })();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/backend") return backend(req, res);
  // /__dropnext: request /api/ai berikutnya diputus di tengah streaming (simulasi Wi-Fi putus).
  if (url.pathname === "/__dropnext") { dropNext = true; res.writeHead(204); return res.end(); }
  if (url.pathname === "/api/ai" && dropNext) {
    dropNext = false;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ t: "start", model: "mock" })}\n\n`);
    res.write(`data: ${JSON.stringify({ t: "delta", text: DEMO_HTML.slice(0, DEMO_HTML.length / 2) })}\n\n`);
    return setTimeout(() => res.socket.destroy(), 150);
  }
  if (url.pathname === "/api/ai") return ai(req, res);
  if (url.pathname === "/api/health") return health(req, res);
  if (url.pathname === "/__mocklog") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(mockLog.map(m => ({ model: m.body.model, stream: m.body.stream, thinking: m.body.thinking, output_config: m.body.output_config, system: !!m.body.system, max_tokens: m.body.max_tokens })))); }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || /node_modules|\.\.|\/lib\/|\/tests\//.test(p)) { res.writeHead(404); return res.end("not found"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { ...PROD_HEADERS, "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

if (process.env.MOCK_AI !== "0") mock.listen(MOCK_PORT, "127.0.0.1");
server.listen(PORT, "127.0.0.1", () => console.log(`Emergent dev server: http://localhost:${PORT}  (admin: admin / ${process.env.ADMIN_PASSWORD})`));
