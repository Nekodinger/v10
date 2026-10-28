/* ============================================================
   lib/accounts.js - akun siswa, kelompok, PIN, kunci satu perangkat
   ------------------------------------------------------------
   - Guru mendaftarkan siswa & kelompok di Panel Guru. Tiap siswa
     mendapat PIN 6 angka yang unik.
   - PIN disimpan sebagai HMAC (untuk login) + terenkripsi AES-256-GCM
     (supaya guru bisa mencetak ulang kartu login). Kuncinya acak dan
     disimpan di tabel ps_config (hanya server yang bisa membaca,
     RLS aktif), jadi tidak ikut berubah bila TEACHER_CONTROL_CODE diganti.
   - Token akun berisi studentId (s) dan versi token (v). Reset PIN atau
     nonaktifkan akun menaikkan versi -> token lama otomatis ditolak.
   - Eksperimen & Makerspace adalah kerja KELOMPOK: data disimpan dengan
     kunci "grp:<group_id>", hanya ketua yang boleh menulis, dan hanya
     dari SATU perangkat (ps_locks, diperbarui heartbeat).
   ============================================================ */
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { verifyToken, setTokenKey } from "./auth.js";

export const LOCK_TTL_MS = 2 * 60 * 1000;
export const GROUP_SECTIONS = ["eksperimen", "lab"];
const FAIL_WINDOW_MS = 15 * 60 * 1000;
// Per nama: 8 salah / 15 menit. Per IP lebih longgar karena satu kelas
// biasanya keluar lewat satu IP sekolah (NAT).
const FAIL_MAX_NAME = 8;
const FAIL_MAX_IP = 60;

export class AccountError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

let secretCache = null;
async function appSecret() {
  if (secretCache) return secretCache;
  let r = await one(`select value from ps_config where key = 'app_secret'`);
  if (!r) {
    const v = crypto.randomBytes(32).toString("hex");
    await q(`insert into ps_config (key, value) values ('app_secret', $1) on conflict (key) do nothing`, [v]);
    r = await one(`select value from ps_config where key = 'app_secret'`);
  }
  secretCache = Buffer.from(r.value, "hex");
  return secretCache;
}
export function _resetSecretCache() { secretCache = null; }
// Dipanggil di awal setiap permintaan API: memuat kunci token dari ps_config.
export async function primeAuth() {
  setTokenKey(crypto.createHmac("sha256", await appSecret()).update("token-key").digest());
}

export async function pinHash(pin) {
  return crypto.createHmac("sha256", await appSecret()).update("pin:" + pin).digest("hex");
}
async function encKey() {
  return crypto.createHash("sha256").update(Buffer.concat([Buffer.from("enc:"), await appSecret()])).digest();
}
export async function pinEncrypt(pin) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", await encKey(), iv);
  const enc = Buffer.concat([c.update(String(pin), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString("base64")).join(".");
}
export async function pinDecrypt(s) {
  try {
    const [iv, tag, enc] = String(s).split(".").map(x => Buffer.from(x, "base64"));
    const d = crypto.createDecipheriv("aes-256-gcm", await encKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
  } catch (e) { return null; }
}
// PIN 6 angka yang belum dipakai akun lain
export async function newUniquePin() {
  for (let i = 0; i < 40; i++) {
    const pin = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
    if (/^(\d)\1{5}$/.test(pin) || pin === "123456" || pin === "654321") continue;
    const h = await pinHash(pin);
    if (!(await one(`select 1 from ps_accounts where pin_hash = $1`, [h]))) return { pin, hash: h };
  }
  throw new AccountError(500, "Gagal membuat PIN unik, coba lagi.");
}

export function normalizeName(s) {
  return String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9\s'.-]/g, " ").replace(/\s+/g, " ").trim();
}
export function cleanLabel(s, n) {
  return String(s == null ? "" : s).replace(/[()]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
}
export const studentIdFor = (name, cls) => `${name} (${cls})`;
export const groupKey = gid => "grp:" + gid;
export const isGroupKey = k => /^grp:/.test(String(k || ""));

/* ---------------- Pembatas percobaan login ---------------- */
export async function failCount(key) {
  const r = await one(`select n, first_at from ps_login_fail where key = $1`, [key]);
  if (!r || Date.now() - r.first_at > FAIL_WINDOW_MS) return 0;
  return Number(r.n);
}
export async function addFail(key) {
  await q(`insert into ps_login_fail (key, n, first_at) values ($1, 1, $2)
           on conflict (key) do update set
             n = case when $2 - ps_login_fail.first_at > $3 then 1 else ps_login_fail.n + 1 end,
             first_at = case when $2 - ps_login_fail.first_at > $3 then $2 else ps_login_fail.first_at end`,
    [key, Date.now(), FAIL_WINDOW_MS]);
}
export async function clearFail(key) { await q(`delete from ps_login_fail where key = $1`, [key]); }

// Kode akses: batasi tebakan per IP (anti brute force).
const CODE_FAIL_MAX = 20;
export async function guardAccessCode(b, ok, en) {
  const key = "vc:" + String((b && b._ip) || "unknown").slice(0, 64);
  if (await failCount(key) >= CODE_FAIL_MAX * 2) throw new AccountError(429, en ? "Too many wrong codes. Try again in 15 minutes." : "Terlalu banyak kode yang salah. Coba lagi 15 menit lagi.", "THROTTLED");
  if (!ok) await addFail(key);
}

/* ---------------- Login ---------------- */
export async function loginStudent(nameRaw, pinRaw, ip, en) {
  const nameKey = normalizeName(nameRaw);
  const pin = String(pinRaw || "").replace(/\D/g, "");
  if (!nameKey || pin.length !== 6) throw new AccountError(400, en ? "Type your name and your 6-digit PIN." : "Ketik nama dan PIN 6 angka kamu.");
  const keys = ["name:" + nameKey, "ip:" + String(ip || "-").slice(0, 60)];
  for (const k of keys) {
    if (await failCount(k) >= (k.startsWith("ip:") ? FAIL_MAX_IP : FAIL_MAX_NAME)) throw new AccountError(429, en ? "Too many wrong attempts. Wait 15 minutes or ask your teacher." : "Terlalu banyak percobaan salah. Tunggu 15 menit atau minta bantuan gurumu.");
  }
  const acc = await one(`select * from ps_accounts where pin_hash = $1`, [await pinHash(pin)]);
  // Nama boleh lengkap atau hanya kata depannya (mis. "Rina" untuk "Rina Putri")
  const nameOk = acc && (acc.name_key === nameKey || acc.name_key.startsWith(nameKey + " "));
  if (!acc || !nameOk || !acc.active) {
    for (const k of keys) await addFail(k);
    if (acc && nameOk && !acc.active) throw new AccountError(403, en ? "This account has been deactivated by your teacher." : "Akun ini sedang dinonaktifkan gurumu.");
    throw new AccountError(401, en ? "Name or PIN is not correct." : "Nama atau PIN tidak cocok. Periksa kartu login dari gurumu.");
  }
  for (const k of keys) await clearFail(k);
  await q(`update ps_accounts set last_login = $2 where student_id = $1`, [acc.student_id, Date.now()]);
  return acc;
}

/* ---------------- Konteks siswa dari token ---------------- */
export async function accountInfo(sid) {
  const acc = await one(`select student_id, name, class_name, group_id, token_ver, active, teacher_id from ps_accounts where student_id = $1`, [sid]);
  if (!acc) return null;
  let group = null, members = [];
  if (acc.group_id) {
    group = await one(`select group_id, class_name, name, leader_id from ps_groups where group_id = $1`, [acc.group_id]);
    if (group) members = await q(`select student_id, name from ps_accounts where group_id = $1 and active = true order by name asc`, [acc.group_id]);
  }
  const leader = group && group.leader_id ? members.find(m => m.student_id === group.leader_id) : null;
  return {
    studentId: acc.student_id, name: acc.name, className: acc.class_name, active: !!acc.active, tokenVer: Number(acc.token_ver), teacherId: acc.teacher_id || null,
    groupId: group ? group.group_id : null, groupName: group ? group.name : null,
    leaderId: leader ? leader.student_id : null, leaderName: leader ? leader.name : null,
    isLeader: !group || (!!leader && leader.student_id === acc.student_id),
    members: members.map(m => ({ studentId: m.student_id, name: m.name }))
  };
}
// Mengembalikan { sid, guest, account } atau null bila token tidak sah.
export async function resolveStudent(b) {
  const tok = verifyToken(b && b.token);
  if (!tok) return null;
  if (tok.k === "explore") {
    const sid = String(b.studentId || "").trim().slice(0, 80);
    return { sid: /^Tamu-/.test(sid) ? sid : "Tamu-" + (tok.n || "x"), guest: true, account: null };
  }
  if (tok.k !== "account" || !tok.s) return null;
  const info = await accountInfo(tok.s);
  if (!info || !info.active || info.tokenVer !== Number(tok.v)) return null;
  return { sid: info.studentId, guest: false, account: info };
}
// Kunci penyimpanan untuk kerja kelompok (Eksperimen/Makerspace)
export function workKey(ctx) {
  if (!ctx || ctx.guest || !ctx.account || !ctx.account.groupId) return ctx ? ctx.sid : null;
  return groupKey(ctx.account.groupId);
}

/* ---------------- Kunci satu perangkat ---------------- */
async function readLock(gid, topicId, section) {
  return one(`select device_id, student_id, acquired_at, heartbeat_at from ps_locks where group_id = $1 and topic_id = $2 and section = $3`, [gid, topicId, section]);
}
const fresh = l => !!(l && Date.now() - Number(l.heartbeat_at) < LOCK_TTL_MS);

// action: "acquire" | "heartbeat" | "release" | "takeover"
export async function lockAction(ctx, topicId, section, deviceId, action, en) {
  if (!GROUP_SECTIONS.includes(section)) throw new AccountError(400, "Bagian tidak dikenal.");
  const acc = ctx && ctx.account;
  if (!acc || !acc.groupId) return { ok: true, solo: true, mine: true };
  const gid = acc.groupId;
  const lock = await readLock(gid, topicId, section);
  const state = l => ({ active: fresh(l), mine: !!(l && fresh(l) && l.device_id === deviceId && l.student_id === acc.studentId), since: l ? l.acquired_at : null });
  if (!acc.isLeader) return { ok: false, notLeader: true, leaderName: acc.leaderName, lock: state(lock) };
  if (!deviceId) throw new AccountError(400, en ? "This device wasn't recognised. Reload the page and try again." : "Perangkat tidak dikenali. Muat ulang halaman lalu coba lagi.");
  if (action === "release") {
    if (lock && lock.device_id === deviceId) await q(`delete from ps_locks where group_id = $1 and topic_id = $2 and section = $3`, [gid, topicId, section]);
    return { ok: true, released: true };
  }
  const t = Date.now();
  if (lock && fresh(lock) && lock.device_id !== deviceId && action !== "takeover") {
    return { ok: false, otherDevice: true, lock: state(lock) };
  }
  await q(`insert into ps_locks (group_id, topic_id, section, device_id, student_id, acquired_at, heartbeat_at) values ($1, $2, $3, $4, $5, $6, $6)
           on conflict (group_id, topic_id, section) do update set
             device_id = excluded.device_id, student_id = excluded.student_id, heartbeat_at = excluded.heartbeat_at,
             acquired_at = case when ps_locks.device_id = excluded.device_id then ps_locks.acquired_at else excluded.acquired_at end`,
    [gid, topicId, section, deviceId, acc.studentId, t]);
  return { ok: true, mine: true, lock: { active: true, mine: true, since: lock && lock.device_id === deviceId ? lock.acquired_at : t } };
}

// Penjaga untuk semua penulisan kerja kelompok.
export async function assertGroupWriter(ctx, topicId, section, deviceId, en) {
  const acc = ctx && ctx.account;
  if (!acc || !acc.groupId) return;
  if (!acc.isLeader) throw new AccountError(403, en
    ? `Group work is done on your group leader's device${acc.leaderName ? " (" + acc.leaderName + ")" : ""}.`
    : `Kerja kelompok dikerjakan di perangkat ketua kelompok${acc.leaderName ? " (" + acc.leaderName + ")" : ""}.`, "NOT_LEADER");
  const lock = await readLock(acc.groupId, topicId, section);
  if (!lock || !fresh(lock) || lock.device_id !== deviceId) throw new AccountError(409, en
    ? "This section is open on another device. Use one device only, or take it over on this device."
    : "Bagian ini sedang dibuka di perangkat lain. Gunakan satu perangkat saja, atau pindahkan ke perangkat ini.", "LOCKED");
  await q(`update ps_locks set heartbeat_at = $4 where group_id = $1 and topic_id = $2 and section = $3`, [acc.groupId, topicId, section, Date.now()]);
}

export async function releaseGroupLocks(gid) {
  await q(`delete from ps_locks where group_id = $1`, [gid]);
}
export async function locksForGroups() {
  const rows = await q(`select group_id, topic_id, section, device_id, student_id, acquired_at, heartbeat_at from ps_locks`);
  return rows.filter(fresh).map(r => ({ groupId: r.group_id, topicId: r.topic_id, section: r.section, studentId: r.student_id, since: r.acquired_at, heartbeatAt: r.heartbeat_at }));
}
