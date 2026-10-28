/* GET /api/health - cek koneksi database & konfigurasi.
   Juga dipanggil Vercel Cron setiap hari (lihat vercel.json) supaya proyek
   Supabase gratis tidak di-pause karena tidak aktif 7 hari. */
import { sendJson } from "../lib/http.js";
import { dispatch } from "../lib/handlers.js";

export default async function handler(req, res) {
  try {
    const out = await dispatch({ mode: "health" });
    return sendJson(res, 200, out);
  } catch (e) {
    return sendJson(res, 503, { ok: false, error: e && e.code === "DATABASE_NOT_CONFIGURED" ? "DATABASE_URL belum diatur" : String(e && e.message || e).slice(0, 200) });
  }
}
