/* ============================================================
   plan-def.js - isi Lembar Rencana Proyek Kelompok (V12)
   ------------------------------------------------------------
   Dipakai bersama oleh halaman siswa (js/plan.js) dan Panel Guru
   (detail siswa & ekspor). Sintaks PjBL 2-3: kelompok mendesain
   PRODUK AKHIR, yaitu simulasi virtual yang akan dibangun di
   Makerspace, lalu menyusun jadwal pembuatannya. Data eksperimen
   neraca arus dipakai untuk menguji produk itu.
   Setiap kolom (k) disimpan terpisah di server (mode plan_save).
   ============================================================ */
window.PlanDef = (function () {
  const B = (id, en) => ({ id, en });
  const L = o => (o && typeof o === "object") ? ((typeof getLang === "function" && getLang() === "en") ? o.en : o.id) : (o || "");
  const CATS = [
    ["a", B("kontrol variabel", "variable control")],
    ["b", B("tampilan visual", "visual display")],
    ["c", B("grafik atau data", "graph or data")],
    ["d", B("tantangan atau soal", "challenge or question")],
    ["e", B("arah atau vektor", "direction or vector")],
    ["f", B("perbandingan dengan data kelompok", "comparison with group data")]
  ];
  const IDEAS = 10;
  const SCHEDULE = [
    { k: "s1", when: B("Pertemuan 1", "Meeting 1"), what: B("Menyepakati rancangan simulasi (bagian 2-5) dan mengambil data neraca arus untuk menguji simulasi nanti", "Agree on the simulation design (parts 2-5) and collect current-balance data to test the simulation later") },
    { k: "s2", when: B("Di rumah", "At home"), what: B("Mempelajari slide 22-27 (mode Belajar mandiri) dan melengkapi ide fitur", "Study slides 22-27 (Self-study mode) and add feature ideas") },
    { k: "s3", when: B("Pertemuan 2", "Meeting 2"), what: B("Menghitung $B$ dari data dan mengajukan konfirmasi Eksperimen agar Makerspace terbuka", "Calculate $B$ from the data and request the Experiment confirmation to open the Makerspace") },
    { k: "s4", when: B("Pertemuan 2", "Meeting 2"), what: B("Membuat simulasi dari prompt ini di Makerspace, mengujinya dengan data, dan merevisi (maksimal 5 prompt lanjutan)", "Build the simulation from this prompt in the Makerspace, test it against the data and revise it (at most 5 follow-up prompts)") },
    { k: "s5", when: B("Pertemuan 2", "Meeting 2"), what: B("Mengirim refleksi validasi dan presentasi", "Send the validation reflection and present") }
  ];
  const SECTIONS = [
    { id: "roles", title: B("1. Peran Kelompok", "1. Group Roles"),
      hint: B("Tulis nama anggota untuk setiap peran. Ketua mengoperasikan perangkat kelompok di Eksperimen dan Makerspace.", "Write a member's name for each role. The leader operates the group device in Experiments and the Makerspace."),
      fields: [
        { k: "role_ketua", type: "text", label: B("Ketua (operator perangkat)", "Leader (device operator)") },
        { k: "role_pencatat", type: "text", label: B("Pencatat", "Recorder") },
        { k: "role_penguji", type: "text", label: B("Penguji", "Tester") },
        { k: "role_presenter", type: "text", label: B("Presenter", "Presenter") }
      ] },
    { id: "product", title: B("2. Produk Akhir: Simulasi Virtual Kelompok", "2. Final Product: the Group's Virtual Simulation"),
      hint: B("Pertanyaan pendorong: \"Bagaimana kita bisa menimbang gaya magnet pada kawat berarus untuk menentukan kuat medan sebuah magnet, lalu merancang simulasi yang membuktikan hasil itu?\" Rancang dulu simulasi yang akan kalian bangun di Makerspace.", "Driving question: \"How can we weigh the magnetic force on a current-carrying wire to find the strength of a magnet, then design a simulation that proves the result?\" First design the simulation you will build in the Makerspace."),
      fields: [
        { k: "product_goal", type: "area", rows: 3, label: B("Simulasi apa yang akan kalian buat, untuk siapa, dan apa yang harus bisa dibuktikan pengguna dengan simulasi itu?", "What simulation will you build, for whom, and what must a user be able to prove with it?") },
        { k: "predict", type: "area", rows: 3, label: B("Prediksi yang akan ditunjukkan simulasi: bagaimana $F$ berubah bila $I$ dinaikkan, sedangkan $B$ dan $L$ tetap? Tulis alasannya.", "Prediction the simulation will show: how does $F$ change when $I$ increases while $B$ and $L$ stay fixed? Give your reason.") },
        { k: "test_data", type: "area", rows: 2, label: B("Data eksperimen apa yang akan dipakai untuk menguji simulasi? (misalnya $\\Delta m$ pada lima nilai arus, gradien, atau nilai $B$)", "Which experimental data will you use to test the simulation? (for example $\\Delta m$ at five currents, the gradient or the value of $B$)") }
      ] },
    { id: "prompt", title: B("3. Draf Prompt Simulasi", "3. Simulation Prompt Draft"),
      hint: B("Lima komponen ini sama dengan kolom Generator Prompt Terstruktur di Makerspace. Tulis rumus, nama variabel beserta rentang dan satuannya, serta tujuan yang bisa diuji.", "These five parts match the Structured Prompt Generator in the Makerspace. Write formulas, variable names with ranges and units, and a goal that can be tested."),
      fields: [
        { k: "p_concept", type: "area", rows: 2, label: B("Konsep fisika (hukum atau hubungan, tulis rumusnya)", "Physics concept (law or relationship, with its formula)") },
        { k: "p_visual", type: "area", rows: 2, label: B("Jenis visualisasi (animasi, alat peraga virtual, grafik interaktif, atau diagram vektor)", "Type of visualisation (animation, virtual apparatus, interactive graph or vector diagram)") },
        { k: "p_vars", type: "area", rows: 2, label: B("Variabel yang bisa diubah pengguna, dengan rentang dan satuan (misalnya arus 0-3 A)", "Variables the user can change, with ranges and units (for example current 0-3 A)") },
        { k: "p_goal", type: "area", rows: 2, label: B("Tujuan pembelajaran simulasi (apa yang harus bisa diamati atau dibuktikan)", "Learning goal of the simulation (what must be observed or proved)") },
        { k: "p_extra", type: "area", rows: 2, label: B("Instruksi tambahan (fitur, tampilan, atau batasan khusus)", "Extra instructions (features, display or constraints)") }
      ] },
    { id: "ideas", title: B("4. Ide Fitur Simulasi", "4. Simulation Feature Ideas"),
      hint: B("Tulis sebanyak mungkin ide fitur yang berhubungan dengan $F = BIL$, lalu pilih kategorinya: (a) kontrol variabel, (b) tampilan visual, (c) grafik atau data, (d) tantangan atau soal, (e) arah atau vektor, (f) perbandingan dengan data eksperimen kelompok.", "Write as many feature ideas linked to $F = BIL$ as you can, then pick a category: (a) variable control, (b) visual display, (c) graph or data, (d) challenge or question, (e) direction or vector, (f) comparison with the group's experimental data."),
      ideas: IDEAS },
    { id: "unique", title: B("5. Ide Khas Kelompok", "5. The Group's Own Idea"),
      fields: [{ k: "unique", type: "area", rows: 2, label: B("Fitur yang belum pernah kalian lihat di simulasi lain", "A feature you have not seen in other simulations") }] },
    { id: "full", title: B("6. Kalimat Prompt Lengkap", "6. Full Prompt"),
      hint: B("Gabungkan bagian 3-5 menjadi satu prompt utuh. Di Makerspace, tombol Isi dari Rencana Proyek memindahkan isinya ke Generator dan Prompt Final.", "Combine parts 3-5 into one complete prompt. In the Makerspace, the Fill from Project Plan button copies it into the Generator and the Final Prompt."),
      fields: [{ k: "full_prompt", type: "area", rows: 5, label: B("Prompt lengkap", "Full prompt") }] },
    { id: "schedule", title: B("7. Jadwal dan Pembagian Tugas", "7. Schedule and Tasks"), schedule: SCHEDULE }
  ];

  function allKeys() {
    const ks = [];
    SECTIONS.forEach(s => {
      (s.fields || []).forEach(f => ks.push(f.k));
      if (s.ideas) for (let i = 1; i <= s.ideas; i++) ks.push("idea_" + i, "cat_" + i);
      if (s.schedule) s.schedule.forEach(r => ks.push("sched_" + r.k + "_who", "sched_" + r.k + "_done"));
    });
    return ks;
  }
  const val = (f, k) => (f && f[k] && f[k].v != null ? String(f[k].v) : "");

  // Daftar periksa yang dihitung otomatis dari isi rencana (sesuai indikator FFOE rubrik R4).
  function checks(f) {
    const ideas = [], cats = new Set();
    for (let i = 1; i <= IDEAS; i++) { if (val(f, "idea_" + i).trim()) { ideas.push(i); const c = val(f, "cat_" + i); if (c) cats.add(c); } }
    const filled = ["p_concept", "p_visual", "p_vars", "p_goal", "p_extra"].filter(k => val(f, k).trim().length >= 8).length;
    return [
      { ok: val(f, "product_goal").trim().length >= 15 && val(f, "predict").trim().length >= 15, label: B("Produk akhir dan prediksi sudah ditulis dengan alasan.", "The final product and the prediction are written with a reason.") },
      { ok: ideas.length >= 5, label: B("Minimal 5 ide fitur yang berhubungan dengan $F = BIL$ (" + ideas.length + " tertulis).", "At least 5 feature ideas linked to $F = BIL$ (" + ideas.length + " written).") },
      { ok: cats.size >= 4, label: B("Ide fitur mencakup minimal 4 kategori (" + cats.size + " kategori).", "Ideas cover at least 4 categories (" + cats.size + " categories).") },
      { ok: val(f, "unique").trim().length >= 8, label: B("Ada minimal satu ide khas kelompok.", "There is at least one idea of the group's own.") },
      { ok: filled === 5 && /\d/.test(val(f, "p_vars")), label: B("Kelima komponen prompt terisi, variabel ditulis dengan rentang dan satuan.", "All five prompt parts are filled and variables have ranges and units.") },
      { ok: ["role_ketua", "role_pencatat", "role_penguji", "role_presenter"].every(k => val(f, k).trim()) && SCHEDULE.every(r => val(f, "sched_" + r.k + "_who").trim()), label: B("Peran dan penanggung jawab jadwal sudah disepakati.", "Roles and the people responsible for each step are agreed.") }
    ];
  }

  // Baris "label: isi" untuk Panel Guru dan ekspor Excel.
  function rows(f) {
    const out = [];
    SECTIONS.forEach(s => {
      (s.fields || []).forEach(x => { const v = val(f, x.k); if (v.trim()) out.push({ section: L(s.title), label: L(x.label), value: v, by: f[x.k].by || "" }); });
      if (s.ideas) for (let i = 1; i <= s.ideas; i++) {
        const v = val(f, "idea_" + i); if (!v.trim()) continue;
        const c = val(f, "cat_" + i);
        out.push({ section: L(s.title), label: (getLang && getLang() === "en" ? "Idea " : "Ide ") + i + (c ? " (" + c + ")" : ""), value: v, by: f["idea_" + i].by || "" });
      }
      if (s.schedule) s.schedule.forEach(r => {
        const who = val(f, "sched_" + r.k + "_who"), done = val(f, "sched_" + r.k + "_done") === "1";
        if (who.trim() || done) out.push({ section: L(s.title), label: L(r.when) + ": " + L(r.what), value: (who || "-") + (done ? " ✓" : ""), by: (f["sched_" + r.k + "_who"] || f["sched_" + r.k + "_done"] || {}).by || "" });
      });
    });
    return out;
  }
  return { SECTIONS, CATS, IDEAS, SCHEDULE, L, allKeys, checks, rows, val };
})();
