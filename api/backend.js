/* POST /api/backend  { mode: "...", ... }  -> JSON
   Semua aksi non-AI-streaming (sesi kelas, gate, kuis, LKPD, rekap guru). */
import { applyCors, originAllowed, readJsonBody, sendJson } from "../lib/http.js";
import { dispatch, HttpError } from "../lib/handlers.js";

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); }
  if (req.method !== "POST") return sendJson(res, 405, { error: "POST only" });
  if (!originAllowed(req)) return sendJson(res, 403, { error: "Permintaan ditolak. / Request blocked." });
  let body;
  try { body = await readJsonBody(req); } catch (e) { return sendJson(res, 400, { error: "Permintaan tidak valid. Muat ulang halaman. / Invalid request." }); }
  body = body && typeof body === "object" ? body : {};
  // Alamat IP hanya dipakai pembatas percobaan login (tidak disimpan sebagai data siswa)
  // Vercel mengisi x-real-ip / x-forwarded-for dengan IP klien yang sebenarnya.
  body._ip = String(req.headers["x-real-ip"] || req.headers["x-forwarded-for"] || (req.socket && req.socket.remoteAddress) || "").split(",")[0].trim();
  try {
    const out = await dispatch(body);
    return sendJson(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status || 400, e.code ? { error: e.message, code: e.code } : { error: e.message });
    if (e && e.code === "DATABASE_NOT_CONFIGURED") {
      console.error("[backend] DATABASE_URL/POSTGRES_URL belum diatur di Vercel > Settings > Environment Variables");
      return sendJson(res, 503, { error: body && body.lang === "en"
        ? "Emergent can't save data right now. Please tell your teacher or the site administrator."
        : "Emergent belum bisa menyimpan data saat ini. Beri tahu guru atau pengelola situs." });
    }
    console.error("[backend]", body && body.mode, e);
    return sendJson(res, 500, { error: body && body.lang === "en" ? "Something went wrong. Please try again in a moment." : "Terjadi kendala. Coba lagi sebentar lagi." });
  }
}
