# Emergent

Platform pembelajaran fisika untuk **Cambridge International AS & A Level Physics (9702)** berbasis *Project Based Learning* dan Generative AI. Topik yang aktif: **Magnetic Fields** (media penelitian tesis, UNJ).

| Tahap | Tab | Isi |
| --- | --- | --- |
| 01 | Materi | 31 slide interaktif (animasi konsep, langkah bertahap, catatan slide) + versi teks |
| 02 | Eksperimen | LKPD 2 Neraca Arus dalam tiga pilihan: Praktikum Virtual, Alat Sederhana, Alat Laboratorium |
| 03 | Latihan Soal | Soal bergaya 9702 dengan pembahasan |
| 04 | Makerspace | Generator prompt terstruktur, simulasi dibuat Claude Opus 5.5, edit lanjutan, refleksi |

Tutor Fisika (Claude Haiku 5.5) bisa dibuka dari semua halaman.

## Tiga panel: siswa, guru, admin

| Panel | Alamat | Siapa | Isi |
| --- | --- | --- | --- |
| Siswa | `/` | siswa (nama + PIN) | belajar, LKPD, kuis pop-up, Tes Sumatif di web |
| Guru | `/teacher.html` | akun guru (nama pengguna + kata sandi) | **01 Class Management** (sesi kelas, checkpoint), **02 Group Management** (akun siswa & kelompok), **03 Group Monitoring** (progres, jawaban, ekspor Excel/PDF), **04 Quiz** (kuis manual atau Tes Sumatif) |
| Admin | `/admin.html` | satu akun admin | membuat dan mengelola akun guru, memantau pemakaian token per akun dan keseluruhan |

Setiap guru hanya melihat siswa, kelompok, sesi, kuis, dan tes miliknya sendiri.

## Quiz dan Tes Sumatif (V10)

- **Kuis**: guru menulis soal manual (pilihan ganda, isian, uraian; bisa tempel banyak soal sekaligus), lalu mempublikasikannya. Siswa menjawab lewat pop-up. Pembuatan kuis dengan AI sudah dihapus.
- **Tes Sumatif**: isi default sama dengan dokumen Tes Sumatif Magnetic Fields (10 PG, 3 uraian bertingkat, 4 soal berpikir kreatif, skor maksimum 48) dan bisa diedit guru. Siswa mengerjakannya di lembar bergaya kertas langsung di web: memilih opsi, mengetik (LaTeX `$...$` dengan pratinjau), menulis tangan di kanvas, dan menyisipkan persamaan lewat editor rumus MathLive. Jawaban tersimpan otomatis, ada hitung mundur, dan terkumpul otomatis saat waktu habis. PG dinilai otomatis; uraian dinilai guru dengan pedoman penskoran di Panel Guru.

## Akun siswa & kerja kelompok

- Guru mendaftarkan siswa di Panel Guru → **02 Group Management** (satu baris per siswa: `Nama; Kelompok`). Sistem membuat PIN 6 digit; kartu login bisa dicetak dan PIN bisa direset.
- Siswa masuk dengan **nama + PIN**, lalu memilih *Belajar di kelas* (kode sesi dari guru) atau *Belajar mandiri* (tanpa kode).
- **Materi & Latihan Soal** dikerjakan per siswa. **Eksperimen & Makerspace** dikerjakan per kelompok, hanya di **satu perangkat milik ketua kelompok**. Anggota lain melihat nama ketua dan pratinjau hasil kelompok (baca saja). Persetujuan guru membuka tahap berikutnya untuk seluruh kelompok.
- Guru bisa mengganti ketua dan melepas kunci perangkat bila ketua pindah perangkat.
- **AI hanya di kelas.** Tutor Fisika, Makerspace, dan pemeriksaan data eksperimen oleh AI hanya berjalan saat siswa berada di sesi kelas yang aktif (diperiksa di server). Mode mandiri tidak memakai AI sama sekali, jadi kuota API tidak terpakai di luar kelas. Kode eksplorasi (validator) tetap bisa mencoba semua fitur, jadi jangan sebarkan kode itu.

## Yang baru di V12

- Lembar Rencana Proyek Kelompok langsung di Emergent. Tombol Rencana Proyek muncul di pojok kanan bawah setelah siswa mencapai tab Eksperimen. Semua anggota kelompok mengisi satu lembar yang sama: setiap kolom tersimpan otomatis, perubahan anggota lain muncul dalam beberapa detik, dan nama anggota yang sedang mengisi sebuah kolom ditampilkan. Bila dua anggota mengubah kolom yang sama, simpanan dengan versi lama ditolak server sehingga tidak ada isian yang tertimpa diam-diam.
- Di Makerspace, tombol Isi dari Rencana Proyek memindahkan draf prompt kelompok ke Generator dan Prompt Final.
- Panel Guru menampilkan Rencana Proyek di detail siswa dan di lembar Excel "Rencana Proyek".
- Label tahap PjBL disesuaikan: sintaks 2-3 adalah mendesain produk akhir (simulasi di Makerspace) dan menyusun jadwal, sedangkan data eksperimen dipakai untuk menguji produk itu.
- Tabel baru: ps_plan dan ps_plan_presence (dibuat otomatis saat server pertama kali berjalan).

## Yang baru di V11

- Tombol tutup (X) di menu, Pengaturan, kuis, detail siswa dan semua jendela lain menempel di kanan atas, jadi tetap bisa diklik walau isinya sudah digulir ke bawah.
- Progress bar di atas panel siswa dihapus. Tab yang sudah selesai diberi lingkaran hijau bercentang langsung di tombol tabnya.
- Tombol "Lanjut ke ..." pindah ke bawah konten tab, lengkap dengan petunjuk singkat. Setelah diklik, halaman otomatis kembali ke awal tab berikutnya.
- Tampilan HP: tab boleh turun baris, rumus panjang bisa digeser, tabel alat & bahan jadi kartu, tombol slide rapi, tombol mengambang jadi ikon bulat, Tutor Fisika hampir layar penuh, dan Panel Guru/Admin tidak lagi melebar di layar kecil.

## Yang baru di V9

- **Tanpa API key di sisi pengguna.** Semua panggilan AI lewat server Vercel; API key Claude disimpan sebagai Environment Variable.
- **Backend baru:** Vercel Functions + PostgreSQL (Supabase) menggantikan Google Apps Script. Respons AI di-*stream*, jadi tidak ada lagi batas 60 detik.
- **Semua jawaban terekam:** konfirmasi Materi/Eksperimen (setiap percobaan), LKPD, data eksperimen + analisis, latihan, kuis, prompt dan simulasi, refleksi.
- **Desain baru** mengikuti deck materi (Newsreader, Public Sans, IBM Plex Mono; bone, graphite, merah bata, teal) dan logo baru.
- **Perbaikan bug V7:**
  - Kode belajar mandiri dan kode eksplorasi kini berbeda dan diperiksa server.
  - Siswa tidak lagi dilempar ke gerbang saat sesi kelas berakhir.
  - Hipotesis, gradien, B, dan kesimpulan praktikum virtual kini ikut tersimpan.
  - Umpan balik cek B tidak lagi membocorkan nilai jawaban.
  - Soal konfirmasi Materi diacak (urutan soal dan opsi).
  - Kode guru dipindah ke server.
  - Kuis lama tidak lagi menghapus jawaban siswa; semua kuis diarsipkan.
  - Progres siswa tersinkron antarperangkat.

## Struktur

```
index.html, teacher.html,    halaman siswa, guru, admin
admin.html
css/style.css                design system
js/                          app, slide viewer, LKPD, chatbot, Panel Guru, ekspor, i18n
materi/magnetic-fields/      sumber slide (format Claude Slides) -> tools/build-slides.mjs
api/                         Vercel Functions: backend, ai (streaming), health
lib/                         database, prompt, klien Claude, kuota, handler
vendor/                      SheetJS & jsPDF (ekspor), MathLive (editor rumus Tes Sumatif), di-host sendiri
tests/                       dev server lokal, uji API, uji end-to-end Playwright
docs/SETUP.md                panduan pemasangan Vercel + Supabase + env vars
```

## Pemasangan

Ikuti **[docs/SETUP.md](docs/SETUP.md)**. Ringkasnya: import repo ke Vercel, sambungkan Supabase, isi `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD` (dan opsional `ADMIN_USERNAME`, `EXPLORE_CODE`), lalu redeploy. Masuk ke `/admin.html`, ganti kata sandi admin, lalu buat akun guru.

## Pengembangan lokal

```
npm install
npm run dev     # http://localhost:4010 (PGlite + AI tiruan)
npm test        # 15 uji API + 13 langkah uji browser
```

Pengembang: Muhammad Afta Jadid, S.Pd., Gr. · Magister Pendidikan Fisika, Universitas Negeri Jakarta.


## Desain & aset

- Tampilan mengikuti template **Eduleb - Education HTML Template**, Copyright (c) Bestwpware, lisensi MIT, didistribusikan oleh ThemeWagon (https://themewagon.com/themes/eduleb/). Yang dipakai hanya bahasa visualnya (warna, tipografi Jost/DM Sans, bentuk kartu); foto dan gambar stok dari template tidak disertakan.
- Maskot Emergent (anak berambut keriting bermain laptop, gaya chibi) dan logo di `assets/` adalah gambar vektor buatan sendiri untuk proyek ini.
