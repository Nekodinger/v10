/* Skema database Emergent (PostgreSQL / Supabase).
   Semua waktu disimpan sebagai epoch milidetik (double precision) supaya
   sama dengan Date.now() di klien. Setiap tabel diberi ROW LEVEL SECURITY
   tanpa policy: artinya kunci publik Supabase (anon/publishable) TIDAK bisa
   membaca apa pun lewat REST API Supabase; hanya server Vercel (koneksi
   langsung sebagai pemilik tabel) yang bisa. */
export const SCHEMA_SQL = [
  `create table if not exists ps_students (
     student_id text primary key,
     name text,
     class_name text,
     created_at double precision,
     last_seen double precision,
     session_code text,
     topic_id text,
     tab_index int,
     level text,
     progress jsonb not null default '{}'::jsonb
   )`,
  `create table if not exists ps_session (
     id int primary key,
     active boolean not null default false,
     code text,
     topic_id text,
     tab_index int,
     updated_at double precision
   )`,
  `create table if not exists ps_gates (
     topic_id text not null,
     student_id text not null,
     stage text not null,
     status text not null,
     summary text,
     note text,
     submitted_at double precision,
     decided_at double precision,
     primary key (topic_id, student_id, stage)
   )`,
  `create table if not exists ps_quiz_bank (
     topic_id text primary key,
     questions jsonb not null default '[]'::jsonb,
     updated_at double precision
   )`,
  `create table if not exists ps_quizzes (
     id text primary key,
     topic_id text,
     questions jsonb not null default '[]'::jsonb,
     active boolean not null default false,
     published_at double precision,
     ended_at double precision
   )`,
  `create table if not exists ps_quiz_answers (
     quiz_id text not null,
     student_id text not null,
     answers jsonb not null default '{}'::jsonb,
     score double precision,
     submitted_at double precision,
     primary key (quiz_id, student_id)
   )`,
  `create table if not exists ps_events (
     id bigserial primary key,
     student_id text not null,
     topic_id text,
     kind text not null,
     item text,
     payload jsonb,
     score double precision,
     created_at double precision
   )`,
  `create index if not exists ps_events_student_idx on ps_events (student_id, created_at)`,
  `create table if not exists ps_lkpd (
     student_id text not null,
     topic_id text not null,
     mode text not null,
     data jsonb not null default '{}'::jsonb,
     progress double precision,
     score double precision,
     status text,
     updated_at double precision,
     submitted_at double precision,
     primary key (student_id, topic_id, mode)
   )`,
  `create table if not exists ps_experiment (
     student_id text not null,
     topic_id text not null,
     variant text not null,
     rows jsonb not null default '[]'::jsonb,
     meta jsonb,
     analysis jsonb,
     feedback text,
     flagged boolean,
     updated_at double precision,
     primary key (student_id, topic_id, variant)
   )`,
  `create table if not exists ps_ai_usage (
     day text not null,
     bucket text not null,
     kind text not null,
     n int not null default 0,
     primary key (day, bucket, kind)
   )`,
  // ---- Akun siswa & kelompok (dibuat guru di Panel Guru) ----
  `create table if not exists ps_config (
     key text primary key,
     value text not null
   )`,
  `create table if not exists ps_groups (
     group_id text primary key,
     class_name text not null,
     name text not null,
     leader_id text,
     created_at double precision,
     updated_at double precision
   )`,
  `create table if not exists ps_accounts (
     student_id text primary key,
     name text not null,
     name_key text not null,
     class_name text not null,
     group_id text,
     pin_hash text not null,
     pin_enc text not null,
     token_ver int not null default 1,
     active boolean not null default true,
     created_at double precision,
     last_login double precision
   )`,
  `create unique index if not exists ps_accounts_pin_idx on ps_accounts (pin_hash)`,
  `create index if not exists ps_accounts_group_idx on ps_accounts (group_id)`,
  // Kunci "satu perangkat" untuk Eksperimen & Makerspace per kelompok
  `create table if not exists ps_locks (
     group_id text not null,
     topic_id text not null,
     section text not null,
     device_id text not null,
     student_id text not null,
     acquired_at double precision,
     heartbeat_at double precision,
     primary key (group_id, topic_id, section)
   )`,
  `create table if not exists ps_login_fail (
     key text primary key,
     n int not null default 0,
     first_at double precision
   )`,
  // ---- V10: akun guru (dikelola admin), sesi kelas per guru, bank soal & tes sumatif, pemakaian token ----
  `create table if not exists ps_teachers (
     teacher_id text primary key,
     username text not null,
     name text not null,
     pw_hash text not null,
     active boolean not null default true,
     token_ver int not null default 1,
     created_at double precision,
     last_login double precision
   )`,
  `create unique index if not exists ps_teachers_username_idx on ps_teachers (username)`,
  `create table if not exists ps_sessions (
     teacher_id text primary key,
     active boolean not null default false,
     code text,
     topic_id text,
     tab_index int,
     updated_at double precision
   )`,
  `alter table ps_accounts add column if not exists teacher_id text`,
  `alter table ps_groups add column if not exists teacher_id text`,
  `alter table ps_quizzes add column if not exists teacher_id text`,
  `alter table ps_quizzes add column if not exists kind text not null default 'quiz'`,
  `alter table ps_quizzes add column if not exists duration_min int`,
  `create index if not exists ps_accounts_teacher_idx on ps_accounts (teacher_id)`,
  `create table if not exists ps_question_banks (
     teacher_id text not null,
     topic_id text not null,
     kind text not null,
     data jsonb not null default '{}'::jsonb,
     updated_at double precision,
     primary key (teacher_id, topic_id, kind)
   )`,
  `create table if not exists ps_test_answers (
     quiz_id text not null,
     student_id text not null,
     answers jsonb not null default '{}'::jsonb,
     status text not null default 'draft',
     auto_score double precision,
     manual jsonb not null default '{}'::jsonb,
     total double precision,
     updated_at double precision,
     submitted_at double precision,
     graded_at double precision,
     primary key (quiz_id, student_id)
   )`,
  `create table if not exists ps_token_usage (
     id bigserial primary key,
     created_at double precision not null,
     day text not null,
     account_kind text not null,
     account_id text not null,
     teacher_id text,
     work_key text,
     kind text not null,
     model text,
     requests int not null default 1,
     input_tokens bigint not null default 0,
     output_tokens bigint not null default 0,
     cache_read_tokens bigint not null default 0,
     cache_write_tokens bigint not null default 0
   )`,
  `create index if not exists ps_token_usage_day_idx on ps_token_usage (day)`,
  `create index if not exists ps_token_usage_account_idx on ps_token_usage (account_id)`,
  `alter table ps_teachers enable row level security`,
  `alter table ps_sessions enable row level security`,
  `alter table ps_question_banks enable row level security`,
  `alter table ps_test_answers enable row level security`,
  `alter table ps_token_usage enable row level security`,
  `alter table ps_config enable row level security`,
  `alter table ps_groups enable row level security`,
  `alter table ps_accounts enable row level security`,
  `alter table ps_locks enable row level security`,
  `alter table ps_login_fail enable row level security`,
  `alter table ps_students enable row level security`,
  `alter table ps_session enable row level security`,
  `alter table ps_gates enable row level security`,
  `alter table ps_quiz_bank enable row level security`,
  `alter table ps_quizzes enable row level security`,
  `alter table ps_quiz_answers enable row level security`,
  `alter table ps_events enable row level security`,
  `alter table ps_lkpd enable row level security`,
  `alter table ps_experiment enable row level security`,
  `alter table ps_ai_usage enable row level security`
];
