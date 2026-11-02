/* ============================================================
   js/tour.js - tutorial interaktif (spotlight) + Panduan & Modul PDF
   ------------------------------------------------------------
   Dipakai di tiga halaman: siswa (index.html), guru (teacher.html),
   admin (admin.html). Setiap halaman punya beberapa tutorial yang
   berjalan otomatis saat bagiannya pertama kali muncul. Pengguna bisa
   melewati tutorial, mengulanginya dari tombol Panduan, dan membuka
   Modul Penggunaan (PDF).
   Status disimpan di localStorage perangkat (boleh gagal: try/catch).
   ============================================================ */
(function () {
  "use strict";

  const PDF_URL = "assets/panduan/Modul-Penggunaan-Emergent.pdf";
  const PDF_NAME = "Modul-Penggunaan-Emergent.pdf";
  const PAGE = /teacher\.html$/.test(location.pathname) ? "teacher" : /admin\.html$/.test(location.pathname) ? "admin" : "student";
  const KEY = "emergent.tour.";

  const $ = (s) => document.querySelector(s);
  const lang = () => { try { return (typeof getLang === "function" ? getLang() : "id") === "en" ? "en" : "id"; } catch (e) { return "id"; } };
  const L = (v) => (v && typeof v === "object" ? (v[lang()] || v.id) : v || "");
  const store = {
    get(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) { /* mode privat */ } },
    del(k) { try { localStorage.removeItem(KEY + k); } catch (e) { /* abaikan */ } }
  };
  function visible(el) {
    if (!el) return false;
    if (el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  }
  const vis = (s) => visible($(s));
  const card = (s) => () => { const el = $(s); return el ? (el.closest(".t-card") || el) : null; };

  /* ---------------- teks antarmuka ---------------- */
  const UI = {
    help: { id: "Panduan", en: "Guide" },
    helpTitle: { id: "Panduan & Tutorial", en: "Guide & Tutorials" },
    helpDesc: { id: "Ulangi tutorial interaktif kapan saja, atau baca Modul Penggunaan lengkap untuk siswa, guru, dan admin.", en: "Replay the interactive tutorials any time, or read the full user guide for students, teachers and admins." },
    pdfTitle: { id: "Modul Penggunaan Emergent (PDF)", en: "Emergent User Guide (PDF, Indonesian)" },
    pdfDesc: { id: "Alur lengkap: akun guru dibuat admin, akun siswa dibuat guru, cara belajar, Tutor Fisika, dan Makerspace AI.", en: "Full flow: admin creates teacher accounts, teachers create student accounts, learning flow, Physics Tutor and AI Makerspace." },
    open: { id: "Buka", en: "Open" },
    download: { id: "Unduh", en: "Download" },
    tutorialsHere: { id: "Tutorial di halaman ini", en: "Tutorials on this page" },
    steps: { id: "langkah", en: "steps" },
    start: { id: "Mulai", en: "Start" },
    done: { id: "Selesai", en: "Done" },
    skipped: { id: "Dilewati", en: "Skipped" },
    notYet: { id: "Belum", en: "Not yet" },
    auto: { id: "Jalankan tutorial otomatis saat bagian baru pertama kali dibuka", en: "Run tutorials automatically when a new part opens for the first time" },
    resetAll: { id: "Ulang semua dari awal", en: "Reset all tutorials" },
    resetDone: { id: "Semua tutorial akan muncul lagi.", en: "All tutorials will show again." },
    close: { id: "Tutup", en: "Close" },
    tutorial: { id: "Tutorial", en: "Tutorial" },
    of: { id: "dari", en: "of" },
    step: { id: "Langkah", en: "Step" },
    next: { id: "Lanjut", en: "Next" },
    back: { id: "Kembali", en: "Back" },
    skip: { id: "Lewati", en: "Skip" },
    finish: { id: "Selesai", en: "Finish" },
    nextTour: { id: "Tutorial berikutnya muncul otomatis saat bagiannya kamu buka.", en: "The next tutorial starts automatically when you open its part." },
    welcomeEyebrow: { id: "Selamat datang", en: "Welcome" },
    welcomeTitle: {
      student: { id: "Kenalan dulu dengan Emergent", en: "Get to know Emergent" },
      teacher: { id: "Selamat datang di Panel Guru", en: "Welcome to the Teacher Panel" },
      admin: { id: "Selamat datang di Panel Admin", en: "Welcome to the Admin Panel" }
    },
    welcomeText: {
      student: { id: "Emergent memandu proyek fisikamu dari materi, eksperimen, latihan soal, sampai membuat simulasi sendiri bersama AI. Tutorial singkat akan menunjukkan setiap tombol penting langsung di layar.", en: "Emergent guides your physics project from lessons, experiments and practice to building your own simulation with AI. Short tutorials point out every important button right on the screen." },
      teacher: { id: "Akun guru dibuat oleh admin. Dari panel ini Anda membuat akun siswa, membuka sesi kelas, memantau kelompok, dan menyelenggarakan kuis atau tes sumatif.", en: "Teacher accounts are created by the admin. From this panel you create student accounts, open class sessions, monitor groups and run quizzes or the summative test." },
      admin: { id: "Admin membuat dan mengelola akun guru serta memantau pemakaian token AI. Akun siswa tidak dibuat di sini, melainkan oleh masing-masing guru.", en: "The admin creates and manages teacher accounts and monitors AI token usage. Student accounts are not created here but by each teacher." }
    },
    welcomeCount: { id: "{t} tutorial · total {s} langkah. Setiap tutorial bisa dilewati.", en: "{t} tutorials · {s} steps in total. Every tutorial can be skipped." },
    welcomeStart: { id: "Mulai tutorial", en: "Start tutorial" },
    welcomePdf: { id: "Buka Modul (PDF)", en: "Open guide (PDF)" },
    welcomeSkip: { id: "Lewati, saya sudah paham", en: "Skip, I know my way" },
    welcomeFoot: { id: "Tutorial dan modul bisa dibuka lagi lewat tombol Panduan.", en: "Tutorials and the guide stay available under the Guide button." },
    unavailable: { id: "Belum tersedia di layar ini", en: "Not available on this screen" }
  };

  /* ---------------- definisi tutorial ---------------- */
  const inClass = () => { const m = $("#user-chip-mode"); return !!(m && /kelas|class/i.test(m.textContent)); };
  const openDrawer = () => { const d = $("#menu-drawer"); if (d && d.hidden && typeof openMenu === "function") openMenu(); };
  const closeDrawer = () => { const d = $("#menu-drawer"); if (d && !d.hidden && typeof closeMenu === "function") closeMenu(); };
  const pane = (name) => () => { const b = $(`.t-tab[data-pane="${name}"]`); if (b && !b.classList.contains("active")) b.click(); };
  const qmode = (m) => () => { const b = $(`.qz-seg-btn[data-qmode="${m}"]`); if (b && !b.classList.contains("active")) b.click(); };

  const TOURS = {
    student: [
      {
        id: "gate", title: { id: "Halaman masuk", en: "Sign-in page" },
        where: { id: "Halaman masuk (sebelum login)", en: "Sign-in page (before signing in)" },
        when: () => vis("#gate-step-role"),
        steps: [
          { el: "#gate-role-student-btn", title: { id: "Masuk sebagai siswa", en: "Sign in as a student" },
            body: { id: "Pilih <b>Saya siswa</b>, lalu ketik <b>nama</b> dan <b>PIN 6 digit</b>. Akun siswa <b>dibuat oleh gurumu</b> di Panel Guru, jadi kamu tidak perlu mendaftar sendiri. Minta kartu login ke guru bila belum punya.", en: "Choose <b>I am a student</b>, then type your <b>name</b> and <b>6-digit PIN</b>. Student accounts are <b>created by your teacher</b> in the Teacher Panel, so you never register yourself." } },
          { el: "#gate-role-teacher-link", title: { id: "Pintu untuk guru", en: "Door for teachers" },
            body: { id: "Guru masuk ke <b>Panel Guru</b> dengan nama pengguna dan kata sandi. Akun guru <b>dibuat oleh admin</b>.", en: "Teachers sign in to the <b>Teacher Panel</b> with a username and password. Teacher accounts are <b>created by the admin</b>." } },
          { el: () => $("#gate-step-role .gate-teacher-link"), title: { id: "Kode Eksplorasi", en: "Exploration code" },
            body: { id: "Khusus validator atau penguji yang diberi kode oleh pengembang. Siswa tidak memakai jalur ini.", en: "Only for validators or testers who received a code from the developer. Students do not use this." } },
          { el: "#tour-help-gate", title: { id: "Panduan selalu ada di sini", en: "The guide is always here" },
            body: { id: "Buka lagi tutorial atau <b>Modul Penggunaan (PDF)</b> kapan saja lewat tombol ini.", en: "Reopen the tutorials or the <b>user guide (PDF)</b> any time from this button." } }
        ]
      },
      {
        id: "home", title: { id: "Ruang belajar", en: "Learning space" },
        where: { id: "Beranda setelah masuk", en: "Home after signing in" },
        when: () => vis("#site-shell"),
        steps: [
          { el: null, drawer: false, title: { id: "Satu topik = satu proyek", en: "One topic = one project" },
            body: { id: "Setiap topik dikerjakan sebagai proyek PjBL: pelajari konsep, ukur lewat eksperimen, latihan soal, lalu bangun simulasi sendiri bersama AI.", en: "Each topic runs as a PjBL project: learn the concept, measure it in an experiment, practise, then build your own simulation with AI." } },
          { el: ".stage-strip", extra: true, optional: () => vis("#welcome-panel"), drawer: false, title: { id: "Empat tahap berurutan", en: "Four stages in order" },
            body: { id: "<b>Materi → Eksperimen → Latihan Soal → Makerspace.</b> Tab berikutnya terbuka setelah kamu lulus pertanyaan konfirmasi. Eksperimen dan Makerspace perlu <b>persetujuan guru</b>.", en: "<b>Lessons → Experiment → Practice → Makerspace.</b> The next tab opens once you pass the check questions. Experiment and Makerspace need <b>teacher approval</b>." } },
          { el: "#header-mode", drawer: false, title: { id: "Mode belajar", en: "Learning mode" },
            body: { id: "<b>Kelas</b> = kamu memakai kode sesi dari guru, fitur AI aktif. <b>Mandiri</b> = belajar sendiri tanpa AI; Materi, Eksperimen, dan Latihan tetap bisa dikerjakan.", en: "<b>Class</b> = you joined with the teacher's session code, AI features are on. <b>Self-study</b> = no AI; Lessons, Experiment and Practice still work." } },
          { el: "#menu-btn", drawer: false, title: { id: "Menu", en: "Menu" },
            body: { id: "Semua pengaturan ada di menu ini. Kita buka sebentar.", en: "Everything else lives in this menu. Let us open it." } },
          { el: "#user-chip", drawer: true, title: { id: "Akun dan kelompokmu", en: "Your account and group" },
            body: { id: "Nama, kelas, dan mode belajarmu. Eksperimen dan Makerspace dikerjakan per kelompok di <b>perangkat ketua</b>; anggota lain melihat hasilnya.", en: "Your name, class and mode. Experiment and Makerspace are group work on the <b>leader's device</b>; other members see the results." } },
          { el: "#settings-btn", drawer: true, title: { id: "Pengaturan & kode kelas", en: "Settings & class code" },
            body: { id: "Di <b>Pengaturan</b> kamu memasukkan <b>kode kelas 6 huruf</b> dari guru untuk pindah ke mode Kelas, atau keluar dari sesi.", en: "Use <b>Settings</b> to enter the teacher's <b>6-letter class code</b> to switch to Class mode, or to leave the session." } },
          { el: "#tour-help-link", drawer: true, title: { id: "Panduan & Tutorial", en: "Guide & Tutorials" },
            body: { id: "Ulangi tutorial atau buka Modul PDF dari sini.", en: "Replay tutorials or open the PDF guide from here." } },
          { el: () => (vis("#chatbot-toggle-btn") ? $("#chatbot-toggle-btn") : $("#welcome-chat-btn")), drawer: false, title: { id: "Tutor Fisika (AI chat)", en: "Physics Tutor (AI chat)" },
            body: { id: "Tanya konsep yang belum jelas. Tutor membimbing dengan pertanyaan balik, bukan memberi kunci jawaban. <b>Hanya aktif saat sesi kelas.</b>", en: "Ask about concepts you do not get. The tutor guides you with questions instead of handing out answers. <b>Only during a class session.</b>" } },
          { el: "#welcome-start-btn", extra: true, optional: () => vis("#welcome-panel"), drawer: false, title: { id: "Mulai belajar", en: "Start learning" },
            body: { id: "Klik di sini untuk masuk ke topik <b>Magnetic Fields</b>. Tutorial berikutnya akan menunjukkan isi topik.", en: "Click here to enter <b>Magnetic Fields</b>. The next tutorial shows what is inside a topic." } }
        ]
      },
      {
        id: "topic", title: { id: "Di dalam topik", en: "Inside a topic" },
        where: { id: "Setelah membuka topik", en: "After opening a topic" },
        when: () => vis("#topic-view") && !!$(".deck-slide"),
        canPrep: () => vis("#welcome-start-btn"), prep: () => $("#welcome-start-btn").click(),
        steps: [
          { el: () => $(".topic-view .tabs"), title: { id: "Tab tahapan", en: "Stage tabs" },
            body: { id: "Empat tab proyek. Tab bergembok belum terbuka. Tab yang selesai diberi <b>lingkaran hijau bercentang</b>.", en: "The four project tabs. Locked tabs are not open yet. Finished tabs get a <b>green tick</b>." } },
          { el: () => $(".deck-stage") || $("#panel-materi"), title: { id: "Slide interaktif", en: "Interactive slides" },
            body: { id: "31 slide Materi dengan animasi. Pakai tombol panah atau tombol ← → di keyboard. Beberapa slide memuat simulasi kecil yang bisa digeser.", en: "31 lesson slides with animation. Use the arrow buttons or ← → keys. Some slides contain small simulations you can drag." } },
          { el: "#topic-progress", title: { id: "Lanjut ke tahap berikutnya", en: "Move to the next stage" },
            body: { id: "Setelah selesai, klik tombol ini. Akan muncul <b>pertanyaan konfirmasi</b> (5 soal Materi, ketuntasan 80%). Lulus = tab berikutnya terbuka.", en: "When you finish, click this button. <b>Check questions</b> appear (5 lesson questions, pass mark 80%). Pass = the next tab opens." } },
          { el: "#plan-toggle-btn", extra: true, optional: () => vis("#plan-toggle-btn"), title: { id: "Rencana Proyek kelompok", en: "Group project plan" },
            body: { id: "Satu lembar yang diisi bersama semua anggota. Setiap kolom tersimpan otomatis, dan isinya bisa dipindah ke Makerspace dengan tombol <b>Isi dari Rencana Proyek</b>.", en: "One sheet filled in by every member. Each field saves itself and can be moved to the Makerspace with <b>Fill from project plan</b>." } },
          { el: "#quiz-toggle-btn", extra: true, optional: () => vis("#quiz-toggle-btn"), title: { id: "Kuis dari guru", en: "Quiz from your teacher" },
            body: { id: "Saat guru menerbitkan kuis, tombol ini muncul. Jawab di jendela pop-up lalu kirim.", en: "When your teacher publishes a quiz this button appears. Answer in the pop-up and submit." } },
          { el: "#ts-toggle-btn", extra: true, optional: () => vis("#ts-toggle-btn"), title: { id: "Tes Sumatif", en: "Summative test" },
            body: { id: "Lembar tes di web: pilih jawaban, ketik, tulis tangan, atau sisipkan persamaan. Jawaban tersimpan otomatis dan terkumpul saat waktu habis.", en: "A test sheet in the browser: choose, type, handwrite or insert equations. Answers save automatically and are collected when time runs out." } }
        ]
      },
      {
        id: "chat", title: { id: "Tutor Fisika (AI chat)", en: "Physics Tutor (AI chat)" },
        where: { id: "Buka Tutor Fisika saat sesi kelas", en: "Open the Physics Tutor during a class session" },
        when: () => vis("#chatbot-panel"),
        canPrep: () => vis("#chatbot-toggle-btn"), prep: () => $("#chatbot-toggle-btn").click(),
        steps: [
          { el: "#chatbot-panel", title: { id: "Tutor Fisika", en: "Physics Tutor" },
            body: { id: "Asisten AI yang paham topik yang sedang kamu buka. Gayanya bertanya balik supaya kamu menemukan jawabannya sendiri.", en: "An AI assistant that knows the topic you have open. It asks questions back so you find the answer yourself." } },
          { el: "#chatbot-input", title: { id: "Cara bertanya yang baik", en: "How to ask well" },
            body: { id: "Tulis <b>apa yang sudah kamu tahu</b> dan <b>di mana bingungnya</b>. Contoh: <i>\"Saya tahu F = BIL, tapi kenapa F nol saat kawat sejajar medan?\"</i> Rumus boleh ditulis seperti <code>F = B*I*L</code>.", en: "Say <b>what you already know</b> and <b>where you are stuck</b>. Example: <i>\"I know F = BIL, but why is F zero when the wire is parallel to the field?\"</i>" } },
          { el: "#chatbot-messages", title: { id: "Aturan pakai", en: "House rules" },
            body: { id: "• Tutor <b>tidak memberi kunci jawaban</b> kuis atau tes.<br>• Hanya aktif saat <b>sesi kelas</b>; ada batas pertanyaan harian.<br>• Jangan menulis data pribadi.<br>• Cek ulang jawabannya dengan materi; AI bisa keliru.", en: "• The tutor <b>never gives quiz or test answers</b>.<br>• Only during a <b>class session</b>, with a daily question limit.<br>• Never type personal data.<br>• Double-check answers against the lesson; AI can be wrong." } },
          { el: "#chatbot-close-btn", title: { id: "Tutup kapan saja", en: "Close any time" },
            body: { id: "Riwayat percakapan tetap ada. Buka lagi dari tombol Tutor Fisika di pojok kanan bawah atau dari Menu.", en: "Your chat history stays. Reopen it from the Physics Tutor button or the Menu." } }
        ]
      },
      {
        id: "lab", title: { id: "Makerspace (AI)", en: "Makerspace (AI)" },
        where: { id: "Buka tab Makerspace", en: "Open the Makerspace tab" },
        when: () => vis("#panel-lab") && (vis("#prompt-form") || vis("#lab-class-only")),
        canPrep: () => { const b = $('.tab-btn[data-tab="lab"]'); return !!(b && visible(b) && !b.classList.contains("locked")); },
        prep: () => { if (typeof switchTab === "function") switchTab("lab"); },
        steps: [
          { el: "#lab-class-only", extra: true, optional: () => vis("#lab-class-only"), title: { id: "Makerspace butuh sesi kelas", en: "Makerspace needs a class session" },
            body: { id: "AI pembuat simulasi hanya berjalan di kelas. Klik <b>Masukkan kode kelas</b> lalu ketik kode 6 huruf dari guru.", en: "The simulation AI only runs in class. Click <b>Enter class code</b> and type the teacher's 6-letter code." } },
          { el: () => $("#group-banner-lab"), extra: true, optional: () => vis("#group-banner-lab"), title: { id: "Kerja kelompok", en: "Group work" },
            body: { id: "Simulasi dibuat dari <b>perangkat ketua kelompok</b>. Anggota lain melihat pratinjau dan prompt kelompok.", en: "The simulation is built on the <b>group leader's device</b>. Other members see the preview and the group prompt." } },
          { el: "#lab-formula-ref-box", optional: () => vis("#prompt-form"), title: { id: "Lembar rumus", en: "Formula sheet" },
            body: { id: "Referensi cepat rumus topik ini. Rumus ini juga dikirim ke AI agar simulasinya akurat.", en: "Quick reference for the topic formulas. They are also sent to the AI so the simulation stays accurate." } },
          { el: "#prompt-form", optional: () => vis("#prompt-form"), title: { id: "01 Generator Prompt", en: "01 Prompt generator" },
            body: { id: "Isi kolomnya: <b>konsep</b>, <b>jenis visualisasi</b>, <b>variabel yang bisa diubah</b> (misal I, B, L, θ), <b>tujuan</b>, dan <b>tingkat kompleksitas</b>. Tidak perlu jago menulis prompt.", en: "Fill in the <b>concept</b>, <b>visual type</b>, <b>adjustable variables</b> (e.g. I, B, L, θ), <b>goal</b> and <b>complexity</b>. No prompt-writing skill needed." } },
          { el: "#pf-build-btn", optional: () => vis("#prompt-form"), title: { id: "Susun Prompt", en: "Build the prompt" },
            body: { id: "Klik untuk merangkai isian menjadi prompt utuh. Ada juga tombol <b>Isi dari Rencana Proyek</b> untuk memakai draf kelompok.", en: "Click to turn your entries into one full prompt. You can also use <b>Fill from project plan</b>." } },
          { el: "#final-prompt", optional: () => vis("#prompt-form"), title: { id: "02 Prompt Final", en: "02 Final prompt" },
            body: { id: "Baca dan perbaiki prompt sebelum dikirim. Prompt yang jelas = simulasi yang benar.", en: "Read and improve the prompt before sending it. A clear prompt gives a correct simulation." } },
          { el: "#generate-btn", optional: () => vis("#prompt-form"), title: { id: "Generate Simulasi", en: "Generate the simulation" },
            body: { id: "AI menulis simulasi HTML, biasanya 1-3 menit. Kuota pembuatan simulasi per hari terbatas, jadi rapikan prompt dulu.", en: "The AI writes an HTML simulation, usually in 1-3 minutes. Daily generations are limited, so polish the prompt first." } },
          { el: () => $("#preview-frame"), optional: () => vis("#prompt-form"), title: { id: "03 Preview & uji", en: "03 Preview & test" },
            body: { id: "Coba simulasinya. Uji dengan <b>data eksperimen kelompokmu</b> dan nilai ekstrem: I = 0 harus memberi F = 0; I dua kali, F dua kali.", en: "Try the simulation. Test it with <b>your group's experiment data</b> and extreme values: I = 0 must give F = 0; double I, double F." } },
          { el: "#lab-edit-followup", optional: () => vis("#prompt-form"), title: { id: "Prompt lanjutan", en: "Follow-up prompt" },
            body: { id: "Minta perbaikan tanpa membuat ulang, misal <i>\"tambahkan satuan pada sumbu grafik\"</i>. Maksimal <b>5 kali edit</b> per simulasi.", en: "Ask for fixes without starting over, e.g. <i>\"add units to the graph axes\"</i>. Up to <b>5 edits</b> per simulation." } },
          { el: "#lab-reflection-section", optional: () => vis("#prompt-form"), title: { id: "04 Refleksi untuk guru", en: "04 Reflection for your teacher" },
            body: { id: "Jelaskan apakah simulasi sudah sesuai konsep fisika dan bagaimana kamu mengujinya, lalu kirim. Guru menyetujui untuk menandai Makerspace selesai.", en: "Explain whether the simulation matches the physics and how you tested it, then send it. Your teacher approves it to finish the Makerspace." } }
        ]
      }
    ],
    teacher: [
      {
        id: "login", title: { id: "Masuk Panel Guru", en: "Teacher sign-in" },
        where: { id: "Halaman masuk guru", en: "Teacher sign-in page" },
        when: () => vis("#teacher-login-card"),
        steps: [
          { el: () => $("#teacher-username-input").closest("section"), title: { id: "Akun dari admin", en: "Account from the admin" },
            body: { id: "Masukkan <b>nama pengguna</b> dan <b>kata sandi</b> yang diberikan admin. Belum punya akun? Hubungi admin Emergent.", en: "Enter the <b>username</b> and <b>password</b> from the admin. No account yet? Contact the Emergent admin." } },
          { el: "#tour-help-btn", title: { id: "Panduan", en: "Guide" },
            body: { id: "Tutorial dan Modul Penggunaan (PDF) bisa dibuka lagi dari tombol ini.", en: "Reopen tutorials and the user guide (PDF) from this button." } }
        ]
      },
      {
        id: "panel", title: { id: "Panel Guru", en: "Teacher Panel" },
        where: { id: "Setelah masuk Panel Guru", en: "After signing in" },
        when: () => vis("#teacher-panel"),
        steps: [
          { el: () => $(".t-tabs"), before: pane("session"), title: { id: "Empat menu kerja", en: "Four work areas" },
            body: { id: "<b>01 Class Management</b> sesi kelas · <b>02 Group Management</b> akun siswa & kelompok · <b>03 Group Monitoring</b> progres & ekspor · <b>04 Quiz</b> kuis & tes sumatif.", en: "<b>01 Class Management</b> sessions · <b>02 Group Management</b> student accounts & groups · <b>03 Group Monitoring</b> progress & export · <b>04 Quiz</b> quizzes & summative test." } },
          { el: () => $('.t-tab[data-pane="accounts"]'), before: pane("session"), title: { id: "Mulai dari sini: buat akun siswa", en: "Start here: create student accounts" },
            body: { id: "Siswa tidak mendaftar sendiri. Langkah pertama guru adalah mendaftarkan siswa di <b>Group Management</b>.", en: "Students never register themselves. Your first job is to register them in <b>Group Management</b>." } },
          { el: card("#acc-add-lines"), before: pane("accounts"), title: { id: "Daftarkan siswa", en: "Register students" },
            body: { id: "Isi kelas, lalu satu baris per siswa: <code>Nama; Kelompok</code>. Sistem membuat <b>PIN 6 digit</b> untuk tiap siswa. Siswa pertama di kelompok menjadi ketua (bisa diganti).", en: "Fill in the class, then one line per student: <code>Name; Group</code>. The system creates a <b>6-digit PIN</b> for each. The first student in a group becomes leader (changeable)." } },
          { el: "#acc-print-btn", before: pane("accounts"), title: { id: "Bagikan kartu login", en: "Hand out login cards" },
            body: { id: "Cetak kartu berisi nama + PIN, atau unduh Excel. PIN tersembunyi secara bawaan; centang <b>Tampilkan PIN</b> bila perlu, dan reset PIN siswa yang lupa.", en: "Print cards with name + PIN, or download Excel. PINs are hidden by default; tick <b>Show PINs</b> if needed and reset forgotten PINs." } },
          { el: "#acc-groups", before: pane("accounts"), title: { id: "Kelompok & ketua", en: "Groups & leaders" },
            body: { id: "Atur ketua, pindahkan siswa, atau <b>lepas kunci perangkat</b> bila ketua berganti perangkat. Centang beberapa siswa untuk aksi massal.", en: "Set leaders, move students, or <b>release the device lock</b> when a leader switches devices. Tick several students for bulk actions." } },
          { el: card("#teacher-start-btn"), before: pane("session"), title: { id: "Buka sesi kelas", en: "Open a class session" },
            body: { id: "Pilih topik lalu <b>Mulai Sesi Baru</b>. Bagikan <b>kode 6 huruf</b> ke siswa. Selama sesi aktif, fitur AI (Tutor Fisika & Makerspace) menyala untuk siswa yang bergabung.", en: "Choose the topic and click <b>Start new session</b>. Share the <b>6-letter code</b>. While the session runs, AI features are on for students who join." } },
          { el: card("#gate-pending-body"), before: pane("session"), title: { id: "Menunggu konfirmasi", en: "Waiting for approval" },
            body: { id: "Kelompok yang lulus konfirmasi Eksperimen atau mengirim refleksi Makerspace muncul di sini. <b>Setujui</b> untuk membuka tahap berikutnya.", en: "Groups that passed the Experiment check or sent a Makerspace reflection appear here. <b>Approve</b> to open the next stage." } },
          { el: card("#roster-body"), before: pane("session"), title: { id: "Siswa online", en: "Students online" },
            body: { id: "Siapa yang aktif dan sedang di tab mana, diperbarui otomatis.", en: "Who is active and on which tab, refreshed automatically." } },
          { el: () => $("#records-table") ? ($("#records-table").closest(".t-card") || $("#pane-records")) : $("#pane-records"), before: pane("records"), title: { id: "Group Monitoring", en: "Group Monitoring" },
            body: { id: "Rekap tiap siswa: konfirmasi, LKPD, data eksperimen, latihan, Rencana Proyek, prompt, simulasi, dan refleksi. Klik nama siswa untuk detail.", en: "Every student's record: checks, worksheet, experiment data, practice, project plan, prompts, simulation and reflection. Click a name for details." } },
          { el: "#export-xlsx-btn", before: pane("records"), title: { id: "Ekspor data penelitian", en: "Export research data" },
            body: { id: "Unduh rekap <b>Excel</b> (banyak lembar) atau <b>PDF</b>.", en: "Download the <b>Excel</b> workbook (many sheets) or a <b>PDF</b>." } },
          { el: () => $(".qz-seg"), before: () => { pane("quiz")(); qmode("quiz")(); }, title: { id: "Kuis atau Tes Sumatif", en: "Quiz or summative test" },
            body: { id: "<b>Kuis</b>: tulis soal manual lalu terbitkan sebagai pop-up. <b>Tes Sumatif</b>: lembar tes lengkap di web (bisa diedit), dengan durasi; PG dinilai otomatis, uraian dinilai guru. Keduanya butuh sesi kelas aktif.", en: "<b>Quiz</b>: write questions and publish them as a pop-up. <b>Summative test</b>: a full editable test sheet with a timer; MCQs are auto-marked, written answers are marked by you. Both need an active session." } },
          { el: "#teacher-changepw-btn", before: pane("session"), title: { id: "Ganti kata sandi", en: "Change password" },
            body: { id: "Ganti kata sandi dari admin dengan kata sandi Anda sendiri setelah masuk pertama kali.", en: "Replace the admin-issued password with your own after your first sign-in." } }
        ]
      }
    ],
    admin: [
      {
        id: "login", title: { id: "Masuk Panel Admin", en: "Admin sign-in" },
        where: { id: "Halaman masuk admin", en: "Admin sign-in page" },
        when: () => vis("#admin-login-card"),
        steps: [
          { el: () => $("#admin-username-input").closest("section") || $("#admin-login-card"), title: { id: "Satu akun admin", en: "One admin account" },
            body: { id: "Masuk dengan akun admin. Pertama kali, kata sandinya diambil dari Environment Variable <code>ADMIN_PASSWORD</code> di Vercel.", en: "Sign in with the admin account. The first password comes from the <code>ADMIN_PASSWORD</code> environment variable in Vercel." } },
          { el: "#tour-help-btn", title: { id: "Panduan", en: "Guide" },
            body: { id: "Tutorial dan Modul Penggunaan (PDF) ada di sini.", en: "Tutorials and the user guide (PDF) live here." } }
        ]
      },
      {
        id: "panel", title: { id: "Panel Admin", en: "Admin Panel" },
        where: { id: "Setelah masuk Panel Admin", en: "After signing in" },
        when: () => vis("#admin-panel"),
        steps: [
          { el: card("#adm-new-name"), before: pane("teachers"), title: { id: "Buat akun guru", en: "Create teacher accounts" },
            body: { id: "Isi nama guru dan nama pengguna. Kosongkan kata sandi agar dibuatkan otomatis, lalu berikan data masuk ke guru (kata sandi hanya tampil sekali).", en: "Enter the teacher's name and username. Leave the password empty to generate one, then give the sign-in details to the teacher (shown only once)." } },
          { el: card("#adm-teachers-body"), before: pane("teachers"), title: { id: "Daftar akun guru", en: "Teacher accounts" },
            body: { id: "Ubah, reset sandi, nonaktifkan, atau hapus akun. Setiap guru hanya melihat siswa, kelompok, dan tes miliknya sendiri. <b>Akun siswa dibuat oleh guru</b>, bukan admin.", en: "Edit, reset passwords, deactivate or delete. Each teacher only sees their own students, groups and tests. <b>Student accounts are created by teachers</b>, not the admin." } },
          { el: () => $('.t-tab[data-pane="usage"]'), before: pane("teachers"), title: { id: "Pemakaian token", en: "Token usage" },
            body: { id: "Pantau pemakaian AI per guru, per jenis (chat, simulasi, cek data), per hari, dan per akun siswa. Bisa diunduh CSV.", en: "Monitor AI usage per teacher, per kind (chat, simulation, data check), per day and per student account. Downloadable as CSV." } },
          { el: () => $("#adm-stats") || $("#pane-usage"), before: pane("usage"), title: { id: "Ringkasan biaya AI", en: "AI cost summary" },
            body: { id: "Total token dan perkiraan biaya untuk periode yang dipilih.", en: "Total tokens and estimated cost for the selected period." } },
          { el: card("#adm-pw-current"), before: pane("settings"), title: { id: "Amankan akun admin", en: "Secure the admin account" },
            body: { id: "Segera ganti kata sandi admin dari Environment Variable dengan kata sandi sendiri.", en: "Replace the environment-variable password with your own straight away." } }
        ]
      }
    ]
  };

  const tours = TOURS[PAGE] || [];
  const tourById = (id) => tours.find(t => t.id === id);
  const totalSteps = () => tours.reduce((a, t) => a + t.steps.filter(s => !s.extra).length, 0);

  /* ---------------- tombol Panduan ---------------- */
  const ICON_HELP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/><path d="M12 17.2h.01"/></svg>';
  function helpButton(id) {
    const b = document.createElement("button");
    b.type = "button"; b.id = id; b.className = "tour-help-pill";
    b.innerHTML = ICON_HELP + '<span class="tour-help-label">' + L(UI.help) + "</span>";
    b.title = L(UI.helpTitle); b.setAttribute("aria-label", L(UI.helpTitle));
    b.addEventListener("click", openHelp);
    return b;
  }
  function injectButtons() {
    if (PAGE === "student") {
      const top = $(".gate-topbar");
      if (top && !$("#tour-help-gate")) top.insertBefore(helpButton("tour-help-gate"), top.firstChild);
      const settings = $("#settings-btn");
      if (settings && !$("#tour-help-link")) {
        const a = document.createElement("button");
        a.type = "button"; a.id = "tour-help-link"; a.className = "drawer-link";
        a.innerHTML = ICON_HELP + "<span>" + L(UI.helpTitle) + "</span>";
        a.addEventListener("click", () => { closeDrawer(); setTimeout(openHelp, 280); });
        settings.insertAdjacentElement("afterend", a);
      }
    } else {
      const act = $(".header-actions");
      if (act && !$("#tour-help-btn")) act.insertBefore(helpButton("tour-help-btn"), act.firstChild);
    }
  }

  /* ---------------- modal (sambutan & panduan) ---------------- */
  function modal(html, cls) {
    closeModal();
    const wrap = document.createElement("div");
    wrap.className = "tour-modal-wrap " + (cls || "");
    wrap.id = "tour-modal";
    wrap.innerHTML = '<div class="tour-modal" role="dialog" aria-modal="true">' + html + "</div>";
    document.body.appendChild(wrap);
    wrap.addEventListener("click", e => { if (e.target === wrap) closeModal(); });
    const first = wrap.querySelector("button.tour-btn-primary") || wrap.querySelector("button");
    if (first) setTimeout(() => first.focus({ preventScroll: true }), 40);
    return wrap;
  }
  function closeModal() { const m = $("#tour-modal"); if (m) m.remove(); }
  const fmt = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);

  function openWelcome() {
    const w = modal(
      '<button type="button" class="tour-x" data-x aria-label="' + L(UI.close) + '">&times;</button>' +
      '<img class="tour-modal-logo" src="assets/logo-192.png" alt="" width="72" height="72">' +
      '<p class="tour-eyebrow">' + L(UI.welcomeEyebrow) + "</p>" +
      "<h3>" + L(UI.welcomeTitle[PAGE]) + "</h3>" +
      "<p>" + L(UI.welcomeText[PAGE]) + "</p>" +
      '<ol class="tour-list">' + tours.map((t, i) => '<li><span class="tour-list-n">' + (i + 1) + "</span><span>" + L(t.title) + '</span><span class="tour-list-c">' + t.steps.filter(s => !s.extra).length + " " + L(UI.steps) + "</span></li>").join("") + "</ol>" +
      '<p class="tour-small">' + fmt(L(UI.welcomeCount), { t: tours.length, s: totalSteps() }) + "</p>" +
      '<div class="tour-modal-actions">' +
      '<button type="button" class="tour-btn tour-btn-primary" data-start>' + L(UI.welcomeStart) + "</button>" +
      '<a class="tour-btn tour-btn-ghost" href="' + PDF_URL + '" target="_blank" rel="noopener" data-pdf>' + L(UI.welcomePdf) + "</a>" +
      "</div>" +
      '<button type="button" class="tour-link" data-skip>' + L(UI.welcomeSkip) + "</button>" +
      '<p class="tour-small tour-muted">' + L(UI.welcomeFoot) + "</p>", "tour-welcome");
    store.set(PAGE + ".welcome", "1");
    w.querySelector("[data-start]").addEventListener("click", () => { closeModal(); store.del("off"); schedule(true); });
    w.querySelector("[data-skip]").addEventListener("click", () => { store.set("off", "1"); closeModal(); });
    w.querySelector("[data-x]").addEventListener("click", closeModal);
  }

  function openHelp() {
    if (active) end(false);
    const rows = tours.map((t, i) => {
      const st = store.get(PAGE + "." + t.id);
      const can = safe(t.when) || safe(t.canPrep || (() => false));
      const n = t.steps.filter(s => !s.extra).length;
      return '<li class="tour-help-row">' +
        '<span class="tour-list-n">' + (i + 1) + "</span>" +
        '<span class="tour-help-main"><b>' + L(t.title) + '</b><small>' + n + " " + L(UI.steps) + " · " +
        (st === "done" ? L(UI.done) : st === "skipped" ? L(UI.skipped) : L(UI.notYet)) +
        (can ? "" : " · " + L(UI.unavailable) + ": " + L(t.where)) + "</small></span>" +
        '<button type="button" class="tour-btn tour-btn-small ' + (can ? "tour-btn-primary" : "tour-btn-ghost") + '" data-tour="' + t.id + '"' + (can ? "" : " disabled") + ">" + L(UI.start) + "</button></li>";
    }).join("");
    const w = modal(
      '<button type="button" class="tour-x" data-x aria-label="' + L(UI.close) + '">&times;</button>' +
      '<p class="tour-eyebrow">Emergent</p><h3>' + L(UI.helpTitle) + "</h3><p>" + L(UI.helpDesc) + "</p>" +
      '<div class="tour-pdf-card"><div class="tour-pdf-ic" aria-hidden="true">PDF</div><div><b>' + L(UI.pdfTitle) + "</b><small>" + L(UI.pdfDesc) + "</small>" +
      '<div class="tour-pdf-actions"><a class="tour-btn tour-btn-small tour-btn-primary" href="' + PDF_URL + '" target="_blank" rel="noopener">' + L(UI.open) + '</a><a class="tour-btn tour-btn-small tour-btn-ghost" href="' + PDF_URL + '" download="' + PDF_NAME + '">' + L(UI.download) + "</a></div></div></div>" +
      '<p class="tour-section">' + L(UI.tutorialsHere) + " (" + tours.length + ")</p>" +
      '<ol class="tour-help-list">' + rows + "</ol>" +
      '<label class="tour-check"><input type="checkbox" data-auto' + (store.get("off") ? "" : " checked") + "> " + L(UI.auto) + "</label>" +
      '<button type="button" class="tour-link" data-reset>' + L(UI.resetAll) + "</button>", "tour-help");
    w.querySelector("[data-x]").addEventListener("click", closeModal);
    w.querySelectorAll("[data-tour]").forEach(b => b.addEventListener("click", () => {
      closeModal();
      const t = tourById(b.dataset.tour);
      if (t && !safe(t.when) && t.prep) { safe(() => { t.prep(); return true; }); setTimeout(() => start(t.id, true), 900); }
      else start(b.dataset.tour, true);
    }));
    w.querySelector("[data-auto]").addEventListener("change", e => { if (e.target.checked) store.del("off"); else store.set("off", "1"); });
    w.querySelector("[data-reset]").addEventListener("click", e => {
      tours.forEach(t => store.del(PAGE + "." + t.id)); store.del("off");
      e.target.textContent = L(UI.resetDone);
      const cb = w.querySelector("[data-auto]"); if (cb) cb.checked = true;
    });
  }

  /* ---------------- mesin spotlight ---------------- */
  let active = null; // { tour, steps, i }
  let root = null, spot = null, box = null, raf = 0, target = null;
  function safe(fn) { try { return !!fn(); } catch (e) { return false; } }

  function build() {
    root = document.createElement("div");
    root.id = "tour-root";
    root.innerHTML = '<div class="tour-block"></div><div class="tour-spot"></div>' +
      '<div class="tour-card" role="dialog" aria-live="polite" aria-labelledby="tour-card-title"></div>';
    document.body.appendChild(root);
    spot = root.querySelector(".tour-spot");
    box = root.querySelector(".tour-card");
    window.addEventListener("resize", queue, true);
    window.addEventListener("scroll", queue, true);
    document.addEventListener("keydown", onKey, true);
  }
  function teardown() {
    window.removeEventListener("resize", queue, true);
    window.removeEventListener("scroll", queue, true);
    document.removeEventListener("keydown", onKey, true);
    if (root) root.remove();
    root = spot = box = target = null;
    document.documentElement.classList.remove("tour-on");
  }
  function onKey(e) {
    if (!active) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); skip(); }
    else if (e.key === "ArrowRight" || e.key === "Enter") { if (!/^(INPUT|TEXTAREA|SELECT)$/.test((e.target || {}).tagName || "")) { e.preventDefault(); e.stopPropagation(); next(); } }
    else if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); back(); }
  }

  function start(id, manual) {
    const tour = tourById(id);
    if (!tour) return false;
    if (!manual && !safe(tour.when)) return false;
    const steps = tour.steps.filter(s => !s.optional || safe(s.optional));
    if (!steps.length) return false;
    closeModal();
    if (active) end(false);
    active = { tour, steps, i: 0 };
    build();
    document.documentElement.classList.add("tour-on");
    show(0);
    return true;
  }
  function resolve(step) {
    if (!step.el) return null;
    const el = typeof step.el === "function" ? safe(() => (step._r = step.el())) && step._r : $(step.el);
    return el && visible(el) ? el : null;
  }
  function show(i) {
    if (!active) return;
    active.i = i;
    const step = active.steps[i];
    if (step.drawer === true) openDrawer(); else if (step.drawer === false) closeDrawer();
    if (step.before) safe(() => { step.before(); return true; });
    // beri waktu animasi (laci menu, pindah pane) sebelum mengukur
    const wait = (step.drawer !== undefined || step.before) ? 300 : 0;
    box.classList.add("is-switching");
    setTimeout(() => {
      if (!active || active.i !== i) return;
      target = resolve(step);
      if (target) {
        const r = target.getBoundingClientRect();
        const fixed = isFixed(target);
        if (!fixed && (r.top < 90 || r.bottom > innerHeight - (innerWidth < 640 ? 240 : 40))) {
          target.scrollIntoView({ block: innerWidth < 640 ? "start" : "center", behavior: "instant" });
          if (innerWidth < 640) window.scrollBy(0, -96);
        }
      }
      renderCard(step);
      place();
      box.classList.remove("is-switching");
      const nb = box.querySelector("[data-next]"); if (nb) nb.focus({ preventScroll: true });
    }, wait);
  }
  function isFixed(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "fixed" || p === "sticky") return true;
    }
    return false;
  }
  function renderCard(step) {
    const { tour, steps, i } = active;
    const tIdx = tours.indexOf(tour) + 1;
    const last = i === steps.length - 1;
    box.innerHTML =
      '<div class="tour-card-top"><span class="tour-chip">' + L(UI.tutorial) + " " + tIdx + " " + L(UI.of) + " " + tours.length + " · " + L(tour.title) + "</span>" +
      '<button type="button" class="tour-x tour-x-sm" data-skip aria-label="' + L(UI.skip) + '">&times;</button></div>' +
      '<p class="tour-count">' + L(UI.step) + " " + (i + 1) + " " + L(UI.of) + " " + steps.length + "</p>" +
      '<div class="tour-bar"><span style="width:' + Math.round((i + 1) / steps.length * 100) + '%"></span></div>' +
      '<h4 id="tour-card-title">' + L(step.title) + "</h4>" +
      '<div class="tour-body">' + L(step.body) + "</div>" +
      (last && tIdx < tours.length ? '<p class="tour-small tour-muted">' + L(UI.nextTour) + "</p>" : "") +
      '<div class="tour-actions">' +
      '<button type="button" class="tour-link" data-skip>' + L(UI.skip) + "</button>" +
      '<span class="tour-dots">' + (steps.length > 9 ? '' : steps.map((_, k) => '<i class="' + (k === i ? "on" : k < i ? "past" : "") + '"></i>').join("")) + "</span>" +
      '<span class="tour-nav">' +
      (i > 0 ? '<button type="button" class="tour-btn tour-btn-ghost tour-btn-small" data-back>' + L(UI.back) + "</button>" : "") +
      '<button type="button" class="tour-btn tour-btn-primary tour-btn-small" data-next>' + (last ? L(UI.finish) : L(UI.next) + " →") + "</button>" +
      "</span></div>";
    box.querySelectorAll("[data-skip]").forEach(b => b.addEventListener("click", skip));
    const bb = box.querySelector("[data-back]"); if (bb) bb.addEventListener("click", back);
    box.querySelector("[data-next]").addEventListener("click", next);
  }
  function queue() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); }
  function place() {
    if (!active || !box) return;
    const pad = 8, gap = 14, vw = innerWidth, vh = innerHeight, mobile = vw < 640;
    if (target && !document.contains(target)) target = resolve(active.steps[active.i]);
    const r = target ? target.getBoundingClientRect() : null;
    if (r && r.bottom > 0 && r.top < vh) {
      spot.style.display = "block";
      const top = Math.max(r.top - pad, 4), left = Math.max(r.left - pad, 4);
      spot.style.top = top + "px"; spot.style.left = left + "px";
      spot.style.width = Math.min(r.width + pad * 2, vw - left - 4) + "px";
      spot.style.height = Math.min(r.bottom + pad, vh - 4) - top + "px";
      root.classList.remove("tour-center");
    } else {
      spot.style.display = "none";
      root.classList.add("tour-center");
    }
    box.style.left = box.style.top = box.style.right = box.style.bottom = "";
    box.removeAttribute("data-side");
    if (mobile) { box.setAttribute("data-side", "sheet"); return; }
    const cw = box.offsetWidth, ch = box.offsetHeight;
    if (!r || !(r.bottom > 0 && r.top < vh)) {
      box.style.left = Math.round((vw - cw) / 2) + "px";
      box.style.top = Math.round((vh - ch) / 2) + "px";
      return;
    }
    let side, x, y;
    if (vh - r.bottom - gap >= ch + 8) { side = "bottom"; y = r.bottom + pad + gap; }
    else if (r.top - gap >= ch + 8) { side = "top"; y = r.top - pad - gap - ch; }
    else if (vw - r.right - gap >= cw + 8) { side = "right"; x = r.right + pad + gap; }
    else if (r.left - gap >= cw + 8) { side = "left"; x = r.left - pad - gap - cw; }
    else { side = "inside"; }
    if (side === "bottom" || side === "top") x = Math.min(Math.max(r.left + r.width / 2 - cw / 2, 12), vw - cw - 12);
    if (side === "left" || side === "right") y = Math.min(Math.max(r.top + r.height / 2 - ch / 2, 12), vh - ch - 12);
    if (side === "inside") { x = vw - cw - 16; y = vh - ch - 16; }
    box.setAttribute("data-side", side);
    box.style.left = Math.round(x) + "px";
    box.style.top = Math.round(y) + "px";
  }
  function next() { if (!active) return; if (active.i < active.steps.length - 1) show(active.i + 1); else end(true); }
  function back() { if (active && active.i > 0) show(active.i - 1); }
  function skip() { end(false); }
  function end(completed) {
    if (!active) return;
    const { tour } = active;
    store.set(PAGE + "." + tour.id, completed ? "done" : "skipped");
    // kembalikan keadaan halaman
    if (tour.steps.some(s => s.drawer)) closeDrawer();
    if (PAGE !== "student" && tour.id === "panel") safe(() => { pane(PAGE === "teacher" ? "session" : "teachers")(); return true; });
    active = null;
    teardown();
    lastEnd = Date.now();
  }

  /* ---------------- penjadwal otomatis ---------------- */
  let lastEnd = 0, pending = null;
  function blocking() {
    // jangan menimpa jendela lain yang sedang terbuka
    return !!document.querySelector(".modal:not([hidden]), .modal-backdrop:not([hidden]), #confirm-modal:not([hidden]), #ts-overlay:not([hidden]), #plan-overlay:not([hidden]), #tour-modal");
  }
  function schedule(now) {
    if (active || pending) return;
    if (store.get("off") === "1" && !now) return;
    if (store.get("disabled") === "1") return;
    if (!now && Date.now() - lastEnd < 1500) return;
    const tour = tours.find(t => !store.get(PAGE + "." + t.id) && safe(t.when));
    if (!tour) return;
    if (!now && tour.id !== "chat" && blocking()) return;
    pending = setTimeout(() => {
      pending = null;
      if (active || (!now && store.get("off") === "1")) return;
      if (!store.get(PAGE + "." + tour.id) && safe(tour.when)) start(tour.id, false);
    }, now ? 50 : 700);
  }
  function tick() {
    injectButtons();
    if (store.get("disabled") === "1") return;
    if (!store.get(PAGE + ".welcome")) {
      if (!$("#tour-modal") && !active) openWelcome();
      return;
    }
    schedule(false);
  }

  function init() {
    injectButtons();
    setTimeout(tick, 600);
    setInterval(tick, 900);
  }

  window.EmergentTour = {
    start: (id) => start(id, true),
    openHelp, closeModal,
    reset() { tours.forEach(t => store.del(PAGE + "." + t.id)); store.del(PAGE + ".welcome"); store.del("off"); },
    tours: () => tours.map(t => ({ id: t.id, steps: t.steps.length })),
    get active() { return active ? { id: active.tour.id, step: active.i + 1, of: active.steps.length } : null; },
    PDF_URL
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
