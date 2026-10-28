/* ============================================================
   lib/db.js - koneksi PostgreSQL (Supabase) untuk Emergent
   ------------------------------------------------------------
   - Produksi: memakai paket `postgres` (postgres.js) dengan connection
     string dari env DATABASE_URL (atau POSTGRES_URL yang otomatis dibuat
     integrasi Supabase di Vercel). Mode "transaction pooler" Supabase
     (port 6543) tidak mendukung prepared statement, jadi prepare:false.
   - Tes lokal: tests/ memanggil setQueryImpl() dengan PGlite (Postgres
     WASM) sehingga SQL yang sama persis ikut teruji.
   - Skema dibuat otomatis (CREATE TABLE IF NOT EXISTS) saat query pertama
     di setiap cold start, jadi guru TIDAK perlu menjalankan SQL manual.
   ============================================================ */
import { SCHEMA_SQL } from "./schema.js";

let impl = null;        // async (text, params) => rows[]
let schemaPromise = null;

function cleanConnectionString(raw) {
  // Connection string integrasi Vercel kadang membawa parameter tambahan
  // (mis. "supa=base-pooler.x") yang akan dikirim postgres.js ke server
  // sebagai parameter startup dan ditolak Postgres. Simpan hanya sslmode.
  try {
    const u = new URL(raw);
    const keep = new URLSearchParams();
    if (u.searchParams.get("sslmode")) keep.set("sslmode", u.searchParams.get("sslmode"));
    u.search = keep.toString();
    return u.toString();
  } catch (e) {
    return raw;
  }
}

async function defaultImpl() {
  const raw = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || "";
  if (!raw) {
    const err = new Error("DATABASE_NOT_CONFIGURED");
    err.code = "DATABASE_NOT_CONFIGURED";
    throw err;
  }
  const { default: postgres } = await import("postgres");
  const local = /localhost|127\.0\.0\.1/.test(raw);
  const sql = postgres(cleanConnectionString(raw), {
    ssl: local ? false : "require",
    prepare: false,
    max: 2,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {}
  });
  return async (text, params) => {
    const rows = await sql.unsafe(text, params || []);
    return Array.from(rows);
  };
}

export function setQueryImpl(fn) {
  impl = fn;
  schemaPromise = null;
}

async function getImpl() {
  if (!impl) impl = await defaultImpl();
  return impl;
}

export async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const run = await getImpl();
      for (const stmt of SCHEMA_SQL) {
        try {
          await run(stmt, []);
        } catch (e) {
          // Dua cold start bersamaan bisa balapan membuat objek yang sama
          // ("already exists"/duplicate) - aman diabaikan.
          if (!/already exists|duplicate/i.test(String(e && e.message))) throw e;
        }
      }
    })().catch(e => { schemaPromise = null; throw e; });
  }
  return schemaPromise;
}

export async function q(text, params) {
  await ensureSchema();
  const run = await getImpl();
  return run(text, params || []);
}

export async function one(text, params) {
  const rows = await q(text, params);
  return rows[0] || null;
}

// Nilai jsonb dikirim sebagai objek JS biasa + cast ::jsonb di SQL. Server
// melaporkan tipe parameter jsonb, lalu driver (postgres.js / PGlite) yang
// men-serialisasi. JANGAN JSON.stringify sendiri: hasilnya ter-encode dua kali
// (jsonb berisi string) - bug ini hanya muncul di Postgres sungguhan.
export function J(v) {
  return v === undefined ? null : v;
}
export function jsonSize(v) {
  return JSON.stringify(v === undefined ? null : v).length;
}
