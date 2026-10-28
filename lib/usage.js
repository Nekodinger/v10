/* Pembatas pemakaian AI harian (melindungi saldo kredit API).
   Batas bisa diubah lewat Environment Variables Vercel tanpa ubah kode. */
import { q } from "./db.js";

function envInt(name, def) {
  const v = parseInt(process.env[name], 10);
  return isNaN(v) || v < 0 ? def : v;
}

export function limits() {
  return {
    chat: { perStudent: envInt("LIMIT_CHAT_PER_STUDENT", 150), global: envInt("LIMIT_CHAT_GLOBAL", 6000) },
    simulate: { perStudent: envInt("LIMIT_SIM_PER_STUDENT", 6), global: envInt("LIMIT_SIM_GLOBAL", 80) },
    edit: { perStudent: envInt("LIMIT_EDIT_PER_STUDENT", 10), global: envInt("LIMIT_EDIT_GLOBAL", 150) },
    datacheck: { perStudent: envInt("LIMIT_DATACHECK_PER_STUDENT", 40), global: envInt("LIMIT_DATACHECK_GLOBAL", 3000) }
  };
}

// Hari dihitung di zona WIB (UTC+7) supaya reset tengah malam waktu sekolah.
export function dayKey(now = Date.now()) {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

async function bump(day, bucket, kind) {
  const rows = await q(
    `insert into ps_ai_usage (day, bucket, kind, n) values ($1, $2, $3, 1)
     on conflict (day, bucket, kind) do update set n = ps_ai_usage.n + 1
     returning n`, [day, bucket, kind]);
  return rows[0] ? Number(rows[0].n) : 1;
}

async function unbump(day, bucket, kind) {
  await q(`update ps_ai_usage set n = greatest(0, n - 1) where day = $1 and bucket = $2 and kind = $3`, [day, bucket, kind]);
}

// Mengembalikan { ok, reason, release() }. release() mengembalikan kuota bila
// panggilan AI gagal sebelum menghasilkan apa pun (supaya siswa tidak rugi).
export async function takeQuota(kind, studentKey) {
  const lim = limits()[kind];
  if (!lim) return { ok: true, release: async () => {} };
  const day = dayKey();
  const sKey = "s:" + String(studentKey || "anon").toLowerCase().slice(0, 100);
  const g = await bump(day, "global", kind);
  if (lim.global && g > lim.global) {
    await unbump(day, "global", kind);
    return { ok: false, reason: "global", release: async () => {} };
  }
  const s = await bump(day, sKey, kind);
  if (lim.perStudent && s > lim.perStudent) {
    await unbump(day, sKey, kind);
    await unbump(day, "global", kind);
    return { ok: false, reason: "student", limit: lim.perStudent, release: async () => {} };
  }
  return {
    ok: true, used: s, limit: lim.perStudent,
    release: async () => { await unbump(day, sKey, kind); await unbump(day, "global", kind); }
  };
}

export async function usageToday() {
  const rows = await q(`select kind, n from ps_ai_usage where day = $1 and bucket = 'global'`, [dayKey()]);
  const out = {};
  rows.forEach(r => { out[r.kind] = Number(r.n); });
  return out;
}
