/* ============================================================
   lib/staff.js - akun ADMIN (satu) dan akun GURU (dikelola admin)
   ------------------------------------------------------------
   - Admin: hanya satu. Nama pengguna dari env ADMIN_USERNAME (default
     "admin"). Kata sandi awal dari env ADMIN_PASSWORD (bila kosong:
     TEACHER_CONTROL_CODE lama). Setelah admin mengganti kata sandi di
     Panel Admin, hash-nya disimpan di ps_config dan menggantikan env.
   - Guru: dibuat, diubah, dinonaktifkan, dan dihapus oleh admin. Login
     dengan nama pengguna + kata sandi. Kata sandi disimpan sebagai hash
     scrypt (tidak bisa dibaca ulang); admin hanya bisa menyetel ulang.
   - Token admin/guru bertanda tangan HMAC (lib/auth.js). Menaikkan
     token_ver (reset sandi, nonaktif) membuat token lama ditolak.
   ============================================================ */
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { issueToken, verifyToken, adminUsername, adminEnvPassword, adminConfigured, eqSecret } from "./auth.js";
import { AccountError, failCount, addFail, clearFail } from "./accounts.js";

const TEACHER_TTL_MS = 12 * 60 * 60 * 1000;
const ADMIN_TTL_MS = 8 * 60 * 60 * 1000;
const STAFF_FAIL_MAX = 10;     // per nama pengguna per 15 menit
const STAFF_FAIL_MAX_IP = 40;  // per IP per 15 menit

/* ---------------- Hash kata sandi (scrypt) ---------------- */
function scrypt(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(String(pw), salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));
}
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return "s1$" + salt.toString("base64") + "$" + key.toString("base64");
}
export async function checkPassword(pw, stored) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 3 || parts[0] !== "s1") return false;
  const key = await scrypt(pw, Buffer.from(parts[1], "base64"));
  const want = Buffer.from(parts[2], "base64");
  return key.length === want.length && crypto.timingSafeEqual(key, want);
}
export function randomPassword() {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const b = crypto.randomBytes(10);
  return Array.from(b, x => chars[x % chars.length]).join("");
}
export function normalizeUsername(s) {
  return String(s || "").trim().toLowerCase();
}
export function validUsername(u) {
  return /^[a-z0-9][a-z0-9._-]{2,29}$/.test(u);
}

async function throttle(keys, en) {
  for (const k of keys) {
    if (await failCount(k) >= (k.startsWith("sip:") ? STAFF_FAIL_MAX_IP : STAFF_FAIL_MAX)) {
      throw new AccountError(429, en ? "Too many failed sign-in attempts. Try again in 15 minutes." : "Terlalu banyak percobaan masuk yang gagal. Coba lagi 15 menit lagi.", "THROTTLED");
    }
  }
}

/* ---------------- Admin ---------------- */
async function adminRecord() {
  const r = await one(`select value from ps_config where key = 'admin_auth'`);
  if (!r) return { pwHash: null, ver: 1 };
  try { const v = JSON.parse(r.value); return { pwHash: v.pwHash || null, ver: Number(v.ver) || 1 }; } catch (e) { return { pwHash: null, ver: 1 }; }
}
async function saveAdminRecord(rec) {
  await q(`insert into ps_config (key, value) values ('admin_auth', $1) on conflict (key) do update set value = excluded.value`, [JSON.stringify(rec)]);
}
export async function adminReady() {
  const rec = await adminRecord();
  return !!rec.pwHash || adminConfigured();
}

export async function loginAdmin(usernameRaw, password, ip, en) {
  const username = normalizeUsername(usernameRaw);
  const keys = ["adm:" + username.slice(0, 40), "sip:" + String(ip || "-").slice(0, 60)];
  await throttle(keys, en);
  const rec = await adminRecord();
  if (!rec.pwHash && !adminConfigured()) {
    console.error("[setup] ADMIN_PASSWORD belum diatur di Vercel > Settings > Environment Variables");
    throw new AccountError(503, en ? "The Admin Panel hasn't been set up yet (ADMIN_PASSWORD)." : "Panel Admin belum disiapkan (ADMIN_PASSWORD belum diisi di Vercel).");
  }
  const pwOk = rec.pwHash ? await checkPassword(password, rec.pwHash) : eqSecret(String(password || "").trim(), adminEnvPassword());
  if (username !== adminUsername() || !pwOk) {
    for (const k of keys) await addFail(k);
    throw new AccountError(401, en ? "Username or password is not correct." : "Nama pengguna atau kata sandi salah.");
  }
  for (const k of keys) await clearFail(k);
  return { token: issueToken("admin", { v: rec.ver }, ADMIN_TTL_MS), username, mustChange: !rec.pwHash };
}

export async function resolveAdmin(b) {
  const tok = verifyToken(b && b.adminToken);
  if (!tok || tok.k !== "admin") return null;
  const rec = await adminRecord();
  if (Number(tok.v) !== rec.ver) return null;
  return { username: adminUsername() };
}

export async function changeAdminPassword(current, next, en) {
  const rec = await adminRecord();
  const ok = rec.pwHash ? await checkPassword(current, rec.pwHash) : eqSecret(String(current || "").trim(), adminEnvPassword());
  if (!ok) throw new AccountError(401, en ? "Current password is not correct." : "Kata sandi saat ini salah.");
  if (String(next || "").length < 10) throw new AccountError(400, en ? "The new password must be at least 10 characters." : "Kata sandi baru minimal 10 karakter.");
  const ver = rec.ver + 1;
  await saveAdminRecord({ pwHash: await hashPassword(String(next)), ver });
  return { token: issueToken("admin", { v: ver }, ADMIN_TTL_MS) };
}

/* ---------------- Guru ---------------- */
export function publicTeacher(r) {
  return r ? { teacherId: r.teacher_id, username: r.username, name: r.name, active: !!r.active, createdAt: r.created_at, lastLogin: r.last_login } : null;
}

export async function loginTeacher(usernameRaw, password, ip, en) {
  const username = normalizeUsername(usernameRaw);
  if (!username || !password) throw new AccountError(400, en ? "Type your username and password." : "Ketik nama pengguna dan kata sandi.");
  const keys = ["tch:" + username.slice(0, 40), "sip:" + String(ip || "-").slice(0, 60)];
  await throttle(keys, en);
  const t = await one(`select * from ps_teachers where username = $1`, [username]);
  const ok = t && await checkPassword(password, t.pw_hash);
  if (!ok) {
    for (const k of keys) await addFail(k);
    throw new AccountError(401, en ? "Username or password is not correct." : "Nama pengguna atau kata sandi salah. Hubungi admin bila lupa.");
  }
  if (!t.active) throw new AccountError(403, en ? "This teacher account has been deactivated by the admin." : "Akun guru ini sedang dinonaktifkan admin.");
  for (const k of keys) await clearFail(k);
  await q(`update ps_teachers set last_login = $2 where teacher_id = $1`, [t.teacher_id, Date.now()]);
  return { token: issueToken("teacher", { t: t.teacher_id, v: Number(t.token_ver) }, TEACHER_TTL_MS), teacher: publicTeacher(t) };
}

export async function resolveTeacher(b) {
  const tok = verifyToken(b && b.teacherToken);
  if (!tok || tok.k !== "teacher" || !tok.t) return null;
  const t = await one(`select * from ps_teachers where teacher_id = $1`, [String(tok.t)]);
  if (!t || !t.active || Number(t.token_ver) !== Number(tok.v)) return null;
  return { teacherId: t.teacher_id, username: t.username, name: t.name };
}

export async function createTeacher({ username: u, name, password }, en) {
  const username = normalizeUsername(u);
  const nm = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!validUsername(username)) throw new AccountError(400, en ? "Username: 3-30 characters, letters, numbers, dot, dash or underscore." : "Nama pengguna: 3-30 karakter berupa huruf kecil, angka, titik, minus, atau garis bawah.");
  if (!nm) throw new AccountError(400, en ? "Teacher name is required." : "Nama guru wajib diisi.");
  if (username === adminUsername()) throw new AccountError(409, en ? "That username is reserved for the admin." : "Nama pengguna itu dipakai admin.");
  if (await one(`select 1 from ps_teachers where username = $1`, [username])) throw new AccountError(409, en ? "That username is already taken." : "Nama pengguna sudah dipakai.");
  const pw = password ? String(password) : randomPassword();
  if (pw.length < 8) throw new AccountError(400, en ? "The password must be at least 8 characters." : "Kata sandi minimal 8 karakter.");
  const id = "t_" + crypto.randomBytes(5).toString("hex");
  await q(`insert into ps_teachers (teacher_id, username, name, pw_hash, active, token_ver, created_at, last_login) values ($1, $2, $3, $4, true, 1, $5, null)`,
    [id, username, nm, await hashPassword(pw), Date.now()]);
  return { teacher: publicTeacher(await one(`select * from ps_teachers where teacher_id = $1`, [id])), password: password ? null : pw };
}

export async function updateTeacher(id, patch, en) {
  const t = await one(`select * from ps_teachers where teacher_id = $1`, [String(id || "")]);
  if (!t) throw new AccountError(404, en ? "Teacher account not found." : "Akun guru tidak ditemukan.");
  const out = { ok: true };
  if (patch.name !== undefined) {
    const nm = String(patch.name || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!nm) throw new AccountError(400, en ? "Teacher name is required." : "Nama guru wajib diisi.");
    await q(`update ps_teachers set name = $2 where teacher_id = $1`, [t.teacher_id, nm]);
  }
  if (patch.username !== undefined) {
    const username = normalizeUsername(patch.username);
    if (!validUsername(username)) throw new AccountError(400, en ? "Username: 3-30 characters, letters, numbers, dot, dash or underscore." : "Nama pengguna: 3-30 karakter berupa huruf kecil, angka, titik, minus, atau garis bawah.");
    if (username !== t.username) {
      if (username === adminUsername() || await one(`select 1 from ps_teachers where username = $1`, [username])) throw new AccountError(409, en ? "That username is already taken." : "Nama pengguna sudah dipakai.");
      await q(`update ps_teachers set username = $2 where teacher_id = $1`, [t.teacher_id, username]);
    }
  }
  if (typeof patch.active === "boolean") await q(`update ps_teachers set active = $2, token_ver = token_ver + 1 where teacher_id = $1`, [t.teacher_id, patch.active]);
  if (patch.resetPassword || patch.password) {
    const pw = patch.password ? String(patch.password) : randomPassword();
    if (pw.length < 8) throw new AccountError(400, en ? "The password must be at least 8 characters." : "Kata sandi minimal 8 karakter.");
    await q(`update ps_teachers set pw_hash = $2, token_ver = token_ver + 1 where teacher_id = $1`, [t.teacher_id, await hashPassword(pw)]);
    if (!patch.password) out.password = pw;
  }
  out.teacher = publicTeacher(await one(`select * from ps_teachers where teacher_id = $1`, [t.teacher_id]));
  return out;
}

export async function changeTeacherPassword(teacherId, current, next, en) {
  const t = await one(`select * from ps_teachers where teacher_id = $1`, [teacherId]);
  if (!t || !(await checkPassword(current, t.pw_hash))) throw new AccountError(401, en ? "Current password is not correct." : "Kata sandi saat ini salah.");
  if (String(next || "").length < 8) throw new AccountError(400, en ? "The new password must be at least 8 characters." : "Kata sandi baru minimal 8 karakter.");
  await q(`update ps_teachers set pw_hash = $2, token_ver = token_ver + 1 where teacher_id = $1`, [teacherId, await hashPassword(String(next))]);
  const nt = await one(`select * from ps_teachers where teacher_id = $1`, [teacherId]);
  return { token: issueToken("teacher", { t: teacherId, v: Number(nt.token_ver) }, TEACHER_TTL_MS) };
}
