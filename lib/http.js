/* Helper HTTP bersama untuk fungsi Vercel (Node, gaya req/res). */

export function allowedOrigins() {
  return String(process.env.ALLOWED_ORIGINS || "")
    .split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
}

// CORS: situs yang di-host di Vercel yang SAMA tidak butuh CORS sama sekali.
// Kalau situs di-host di tempat lain (mis. GitHub Pages), tambahkan origin-nya
// di env ALLOWED_ORIGINS (dipisah koma), mis. "https://nekodinger.github.io".
export function applyCors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  const list = allowedOrigins();
  if (origin && list.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }
}

// Origin asing (bukan situs ini & bukan ALLOWED_ORIGINS) ditolak supaya situs
// lain tidak bisa memakai kuota API dari browser pengunjungnya.
export function originAllowed(req) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (!origin) return true; // permintaan non-browser / same-origin GET
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  try {
    if (new URL(origin).host === host) return true;
  } catch (e) { return false; }
  return allowedOrigins().includes(origin);
}

export async function readJsonBody(req) {
  let body = req.body;
  if (body === undefined || body === null) {
    body = await new Promise((resolve, reject) => {
      let data = "";
      req.setEncoding && req.setEncoding("utf8");
      req.on("data", c => { data += c; if (data.length > 4.4e6) reject(new Error("BODY_TOO_LARGE")); });
      req.on("end", () => resolve(data));
      req.on("error", reject);
    });
  }
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") {
    if (!body.trim()) return {};
    return JSON.parse(body);
  }
  return body && typeof body === "object" ? body : {};
}

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

export function clientIp(req) {
  const xf = String(req.headers["x-forwarded-for"] || "");
  return (xf.split(",")[0] || req.socket?.remoteAddress || "unknown").trim();
}

export function sseStart(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
}

export function sseSend(res, obj) {
  res.write("data: " + JSON.stringify(obj) + "\n\n");
}
