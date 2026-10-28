/* ============================================================
   config.js - konfigurasi publik Emergent
   ------------------------------------------------------------
   TIDAK ADA RAHASIA DI FILE INI. API key AI, koneksi database,
   kode Panel Guru, kode belajar mandiri, dan kode eksplorasi semuanya
   disimpan di Environment Variables Vercel (lihat docs/SETUP.md).

   API_BASE:
   - ""  (kosong, default) jika situs dibuka dari domain Vercel yang sama
     dengan API-nya (mis. https://emergent-physics.vercel.app). Ini cara
     yang disarankan: tanpa CORS, paling cepat.
   - Isi dengan URL Vercel (tanpa garis miring di akhir) jika situs dibuka
     dari tempat lain, mis. GitHub Pages. Origin GitHub Pages itu juga harus
     ditambahkan ke env ALLOWED_ORIGINS di Vercel.
   ============================================================ */
const API_BASE = "";

/* Mode validasi ahli: hanya topik di daftar ini yang tampil di menu.
   Kosongkan ([]) untuk menampilkan semua topik. Panel Guru tidak terpengaruh. */
const VISIBLE_TOPIC_IDS = ["magnetic-fields"];

/* Batas edit lanjutan simulasi per simulasi (server juga punya batas harian). */
const MAX_FOLLOWUP_EDITS_PER_SIM = 5;
