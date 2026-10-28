/* ============================================================
   lib/tokens.js - catatan pemakaian token AI per akun (V10)
   ------------------------------------------------------------
   Setiap panggilan Claude dicatat: siapa pemakainya (akun siswa / guru /
   tamu), guru pemilik akun siswa, fitur (chat, simulate, edit, continue,
   datacheck), model, dan jumlah token masukan/keluaran/cache dari field
   `usage` respons Claude. Dibaca oleh Panel Admin (admin_usage).
   ============================================================ */
import { q } from "./db.js";
import { dayKey } from "./usage.js";

const n = v => (typeof v === "number" && isFinite(v) && v > 0 ? Math.round(v) : 0);

export async function recordTokens({ accountKind, accountId, teacherId, workKey, kind, model, usage }) {
  if (!accountId) return;
  const u = usage || {};
  try {
    await q(`insert into ps_token_usage (created_at, day, account_kind, account_id, teacher_id, work_key, kind, model, requests, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
             values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11, $12)`,
      [Date.now(), dayKey(), String(accountKind || "student").slice(0, 20), String(accountId).slice(0, 120), teacherId || null, workKey || null,
       String(kind || "").slice(0, 30), model ? String(model).slice(0, 60) : null,
       n(u.input_tokens), n(u.output_tokens), n(u.cache_read_input_tokens), n(u.cache_creation_input_tokens)]);
  } catch (e) {
    console.error("[tokens] gagal mencatat pemakaian", e && e.message);
  }
}

// period: "today" | "7d" | "30d" | "all"
export function periodDays(period) {
  if (period === "all") return null;
  const days = period === "30d" ? 30 : period === "7d" ? 7 : 1;
  const out = [];
  for (let i = 0; i < days; i++) out.push(dayKey(Date.now() - i * 86400000));
  return out;
}

export async function usageReport(period) {
  const days = periodDays(period);
  const where = days ? `where day = any($1)` : ``;
  const params = days ? [days] : [];
  const sum = `count(*)::int as requests, coalesce(sum(input_tokens),0)::bigint as input, coalesce(sum(output_tokens),0)::bigint as output,
               coalesce(sum(cache_read_tokens),0)::bigint as cache_read, coalesce(sum(cache_write_tokens),0)::bigint as cache_write`;
  const total = (await q(`select ${sum} from ps_token_usage ${where}`, params))[0] || {};
  const byKind = await q(`select kind, ${sum} from ps_token_usage ${where} group by kind order by kind`, params);
  const byModel = await q(`select coalesce(model, '-') as model, ${sum} from ps_token_usage ${where} group by model order by model`, params);
  const byDay = await q(`select day, ${sum} from ps_token_usage ${where} group by day order by day`, params);
  const byTeacher = await q(`select coalesce(teacher_id, '') as teacher_id, ${sum} from ps_token_usage ${where} group by teacher_id`, params);
  const byAccount = await q(`select account_kind, account_id, max(teacher_id) as teacher_id, ${sum},
                               max(created_at) as last_at,
                               coalesce(sum(case when kind = 'chat' then input_tokens + output_tokens else 0 end),0)::bigint as chat_tokens,
                               coalesce(sum(case when kind in ('simulate','edit','continue') then input_tokens + output_tokens else 0 end),0)::bigint as sim_tokens,
                               coalesce(sum(case when kind = 'datacheck' then input_tokens + output_tokens else 0 end),0)::bigint as check_tokens
                             from ps_token_usage ${where} group by account_kind, account_id
                             order by (coalesce(sum(input_tokens),0) + coalesce(sum(output_tokens),0)) desc limit 1000`, params);
  const num = r => ({ requests: Number(r.requests) || 0, input: Number(r.input) || 0, output: Number(r.output) || 0, cacheRead: Number(r.cache_read) || 0, cacheWrite: Number(r.cache_write) || 0 });
  return {
    period: days ? period : "all", days: days || null,
    total: num(total),
    byKind: byKind.map(r => ({ kind: r.kind, ...num(r) })),
    byModel: byModel.map(r => ({ model: r.model, ...num(r) })),
    byDay: byDay.map(r => ({ day: r.day, ...num(r) })),
    byTeacher: byTeacher.map(r => ({ teacherId: r.teacher_id || null, ...num(r) })),
    byAccount: byAccount.map(r => ({ accountKind: r.account_kind, accountId: r.account_id, teacherId: r.teacher_id || null, lastAt: r.last_at,
      chatTokens: Number(r.chat_tokens) || 0, simTokens: Number(r.sim_tokens) || 0, checkTokens: Number(r.check_tokens) || 0, ...num(r) }))
  };
}
