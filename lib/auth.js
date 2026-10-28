/* ============================================================
   lib/auth.js - kode akses & token siswa
   ------------------------------------------------------------
   Semua kode rahasia sekarang ada di SERVER (Environment Variables
   Vercel), tidak lagi di js/config.js yang bisa dibaca siapa pun:
     ADMIN_PASSWORD        kata sandi awal Panel Admin (V10; bila kosong
                           dipakai TEACHER_CONTROL_CODE lama)
     ADMIN_USERNAME        opsional, default "admin"
     SELF_STUDY_CODE       opsional - kode "Belajar Mandiri" untuk siswa
     EXPLORE_CODE          opsional - kode "Eksplorasi Bebas" (semua tab terbuka)
     ACCESS_SECRET         opsional - kunci tanda tangan token (default:
                           diturunkan dari TEACHER_CONTROL_CODE)
   Setelah siswa lolos gerbang (kode sesi kelas / kode mandiri / kode
   eksplorasi), server memberi TOKEN bertanda tangan HMAC yang berlaku
   30 hari. Token inilah yang dipakai untuk memanggil AI, jadi kalau sesi
   kelas berakhir siswa tetap bisa lanjut belajar mandiri (bug V7: siswa
   dilempar kembali ke gerbang).
   ============================================================ */
import crypto from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Kunci tanda tangan token. Sebelumnya diturunkan dari TEACHER_CONTROL_CODE;
// itu berbahaya karena siapa pun yang memegang token siswa bisa menebak kode
// guru secara offline. Sekarang: ACCESS_SECRET (jika diisi) atau kunci acak
// 256-bit yang disimpan di database (ps_config), dimuat oleh primeAuth()
// di lib/accounts.js sebelum token dibuat/diperiksa.
let tokenKey = null;
export function setTokenKey(buf) { tokenKey = buf; }
function secret() {
  if (process.env.ACCESS_SECRET) return crypto.createHash("sha256").update("ps9:" + process.env.ACCESS_SECRET).digest();
  if (!tokenKey) throw new Error("Token key belum dimuat (primeAuth).");
  return tokenKey;
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// extra: { s: studentId, v: versi token akun } untuk token akun siswa.
export function issueToken(kind, extra, ttlMs) {
  const payload = Object.assign({ k: kind, e: Date.now() + (ttlMs || TOKEN_TTL_MS), n: crypto.randomBytes(6).toString("hex") }, extra || {});
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return body + "." + sig;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || token.length > 700) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  let key;
  try { key = secret(); } catch (e) { return null; }
  const expect = b64url(crypto.createHmac("sha256", key).update(body).digest());
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    if (!p || typeof p.e !== "number" || p.e < Date.now()) return null;
    return p;
  } catch (e) {
    return null;
  }
}

function eqCode(a, b) {
  const x = String(a || "").trim().toLowerCase();
  const y = String(b || "").trim().toLowerCase();
  if (!x || !y) return false;
  const ha = crypto.createHash("sha256").update(x).digest();
  const hb = crypto.createHash("sha256").update(y).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// V10: Panel Guru memakai akun guru (dibuat admin). TEACHER_CONTROL_CODE tidak lagi
// membuka Panel Guru; nilainya hanya dipakai sebagai kata sandi awal admin bila
// ADMIN_PASSWORD belum diisi (supaya situs lama tetap bisa diakses setelah update).
export function adminUsername() {
  return String(process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
}
export function adminEnvPassword() {
  return String(process.env.ADMIN_PASSWORD || process.env.TEACHER_CONTROL_CODE || "").trim();
}
export function adminConfigured() {
  return !!adminEnvPassword();
}
// Perbandingan string rahasia dengan waktu konstan (peka huruf besar/kecil).
export function eqSecret(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || !y) return false;
  const ha = crypto.createHash("sha256").update(x).digest();
  const hb = crypto.createHash("sha256").update(y).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function selfStudyCode() {
  return String(process.env.SELF_STUDY_CODE || "belajar-mandiri").trim();
}

export function exploreCode() {
  return String(process.env.EXPLORE_CODE || "").trim();
}

export function matchSelfStudy(code) {
  return eqCode(code, selfStudyCode());
}

export function matchExplore(code) {
  return !!exploreCode() && eqCode(code, exploreCode());
}
