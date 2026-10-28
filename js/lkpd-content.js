/* ============================================================
   LKPD INTERAKTIF - konten Eksperimen (dwibahasa id/en)
   ------------------------------------------------------------
   Dimuat SETELAH js/content.js. Menempelkan `eksperimen.lkpd` ke topik yang
   punya LKPD; renderer-nya ada di js/lkpd.js (V9: tiga mode = tiga varian
   eksperimen Virtual / Sederhana / Laboratorium) (mirip LiveWorksheet: tabel yang
   bisa diisi, ceklis alat & langkah, grafik otomatis, soal dengan tombol
   "Cek Jawaban", isian bebas, dan skor).

   Dua mode praktikum per topik:
     - "simple": Praktikum Sederhana - alat & bahan sehari-hari / barang bekas.
     - "lab"   : Praktikum Lab - alat praktikum nyata (kit yang bisa dibeli).

   Bentuk item section (field bertipe {id,en} diterjemahkan lewat trContent):
     info      {title, html}
     materials {title, items:[{n, note, qty?, photo?}], kits?:[{name, code, note, url, urlLabel}], footnote?}
               photo = kunci LKPD_PHOTOS, atau "svg:vlab" untuk ilustrasi susunan neraca arus.
               Jika ada item dengan photo/qty, daftar ditampilkan sebagai tabel No | Alat | Jumlah | Gambar.
     steps     {title, items:[{h}]}
     safety    {title, items:[{h}]}
     vars      {title, desc, fields:[{key, label, unit, toSI, fixed?, hint}]}
     table     {title, desc}            -> memakai mode.dataTable
     graph     {title, desc}            -> grafik F-I otomatis + gradien + B
     choice    {id, q, options[], correct, explain, hint?, onlyFor?}
     calc      {id, q, compute, tolPct, unit, explain, hint?, onlyFor?}
     open      {id, q, model, hint?, onlyFor?}
   `onlyFor: "lanjut"` = hanya tampil untuk siswa tingkat lanjut (pengayaan).
   `hint` = tombol Petunjuk (otomatis terbuka untuk siswa tingkat dasar).
   ============================================================ */

const LKPD_B = (idText, enText) => ({ id: idText, en: enText });

// Foto alat dari Wikimedia Commons (lisensi bebas; atribusi ditampilkan di bawah tabel).
// Dimuat langsung dari server gambar Wikimedia (thumbnail 330 px).
const LKPD_PHOTO_BASE = "https://thumb.wikimedia.org/wikipedia/commons/thumb/";
const LKPD_PHOTOS = {
  kitchenScale: { src: "c/c6/Kitchenscale.jpg/330px-Kitchenscale.jpg", file: "Kitchenscale.jpg", by: "Sarcyn", lic: "CC BY-SA 3.0" },
  hddMagnet:    { src: "4/4d/Neodymag.jpg/330px-Neodymag.jpg", file: "Neodymag.jpg", by: "Bloodshedder", lic: "Public domain" },
  enamelWire:   { url: "https://upload.wikimedia.org/wikipedia/commons/5/51/Enameled-Round-Copper-Wire_32510-360x480_%284999892055%29.jpg", file: "Enameled-Round-Copper-Wire_32510-360x480_(4999892055).jpg", by: "Emilian Robert Vicol", lic: "CC BY 2.0" },
  aaBattery:    { src: "6/6d/Panasonic_Power_Alkaline-_AA_Batery.jpg/330px-Panasonic_Power_Alkaline-_AA_Batery.jpg", file: "Panasonic_Power_Alkaline-_AA_Batery.jpg", by: "Mr Yukio", lic: "CC BY-SA 4.0" },
  batteryHolder:{ src: "5/56/6x_AA_battery_holder_with_DC_plug.jpg/330px-6x_AA_battery_holder_with_DC_plug.jpg", file: "6x_AA_battery_holder_with_DC_plug.jpg", by: "Limor Fried", lic: "CC BY 2.0" },
  crocLeads:    { src: "e/e2/Jumper_Wires_with_Crocodile_Clips.jpg/330px-Jumper_Wires_with_Crocodile_Clips.jpg", file: "Jumper_Wires_with_Crocodile_Clips.jpg", by: "oomlout", lic: "CC BY-SA 2.0" },
  paperClip:    { src: "5/53/Paper-clip.jpg/330px-Paper-clip.jpg", file: "Paper-clip.jpg", by: "Gangodit", lic: "CC BY-SA 4.0" },
  multimeter:   { src: "3/3c/Blue_digital_multimeter.jpg/330px-Blue_digital_multimeter.jpg", file: "Blue_digital_multimeter.jpg", by: "Publunch", lic: "Public domain" },
  ruler:        { src: "1/11/Plastic_ruler.jpg/330px-Plastic_ruler.jpg", file: "Plastic_ruler.jpg", by: "Corn cheese", lic: "CC0" },
  tape:         { src: "0/02/A_Roll_of_Masking_Tape_%2832410677827%29.jpg/330px-A_Roll_of_Masking_Tape_%2832410677827%29.jpg", file: "A_Roll_of_Masking_Tape_(32410677827).jpg", by: "HireAHelper", lic: "CC BY 2.0" },
  labBalance:   { src: "2/2d/Balance_Kern.jpg/330px-Balance_Kern.jpg", file: "Balance_Kern.jpg", by: "Karelj", lic: "Public domain" },
  dcSupply:     { src: "9/90/Bench_power_supply.jpg/330px-Bench_power_supply.jpg", file: "Bench_power_supply.jpg", by: "Derrick Parker", lic: "CC0" },
  ammeter:      { src: "e/e7/Ammeter.jpg/330px-Ammeter.jpg", file: "Ammeter.jpg", by: "Anders Jonsson", lic: "CC BY-SA 3.0" },
  bananaLead:   { src: "a/ae/Test_lead_banana-croco.JPG/330px-Test_lead_banana-croco.JPG", file: "Test_lead_banana-croco.JPG", by: "Dmitry G", lic: "Public domain" },
  retortStand:  { src: "c/c5/Retort_stand_with_a_clamp.jpg/330px-Retort_stand_with_a_clamp.jpg", file: "Retort_stand_with_a_clamp.jpg", by: "Tsaenmai", lic: "CC BY-SA 4.0" },
  caliper:      { src: "8/87/Vernier_caliper.jpg/330px-Vernier_caliper.jpg", file: "Vernier_caliper.jpg", by: "Lgreen", lic: "CC BY 2.5" }
};

/* ---------- Bagian yang dipakai bersama kedua mode ---------- */
const LKPD_MAGNETIC_GOAL = {
  type: "info",
  title: LKPD_B("1. Tujuan & Konsep", "1. Aim & Concept"),
  html: LKPD_B(
    `<p><strong>Tujuan:</strong> menyelidiki hubungan antara gaya magnetik $F$ pada penghantar berarus dan kuat arus $I$, lalu menentukan rapat fluks magnetik $B$ dari gradien grafik $F$-$I$.</p>
     <p>Untuk penghantar lurus sepanjang $L$ yang tegak lurus medan: $F = BIL$. Jika kawat dibuat kumparan $N$ lilitan, $F = NBIL$. Gaya reaksi pada magnet terbaca sebagai perubahan massa $\\Delta m$ pada timbangan:</p>
     <div class="formula-box">$$F = \\Delta m \\times g \\qquad (\\Delta m\\ \\text{dalam kg},\\ g = 9{,}81\\ \\text{m s}^{-2})$$</div>
     <p>Grafik $F$ terhadap $I$ berupa garis lurus dengan gradien $NBL$, sehingga $B = \\dfrac{\\text{gradien}}{N L}$.</p>`,
    `<p><strong>Aim:</strong> investigate how the magnetic force $F$ on a current-carrying conductor depends on the current $I$, and determine the magnetic flux density $B$ from the gradient of the $F$-$I$ graph.</p>
     <p>For a straight conductor of length $L$ perpendicular to the field: $F = BIL$. If the wire is made into a coil of $N$ turns, $F = NBIL$. The reaction force on the magnet is read as a change in mass $\\Delta m$ on the balance:</p>
     <div class="formula-box">$$F = \\Delta m \\times g \\qquad (\\Delta m\\ \\text{in kg},\\ g = 9.81\\ \\text{m s}^{-2})$$</div>
     <p>The graph of $F$ against $I$ is a straight line with gradient $NBL$, so $B = \\dfrac{\\text{gradient}}{N L}$.</p>`
  )
};

const LKPD_MAGNETIC_PREDICT = {
  type: "choice", id: "predict",
  q: LKPD_B(
    "<strong>Hipotesismu (sebelum praktikum):</strong> jika kuat arus $I$ dijadikan 2 kali semula (medan $B$ dan panjang kawat $L$ tetap), gaya magnetik $F$ pada kawat menjadi ...",
    "<strong>Your hypothesis (before the practical):</strong> if the current $I$ is doubled (field $B$ and wire length $L$ unchanged), the magnetic force $F$ on the wire becomes ..."
  ),
  options: [
    LKPD_B("tetap sama", "unchanged"),
    LKPD_B("2 kali semula", "twice as large"),
    LKPD_B("4 kali semula", "four times as large"),
    LKPD_B("setengah semula", "half as large")
  ],
  correct: 1,
  explain: LKPD_B(
    "Prediksi ini memakai teori $F = BIL$: karena $F$ sebanding $I$, $I$ dua kali lipat diprediksi membuat $F$ dua kali lipat. Ingat, ini baru PREDIKSI - nanti bentuk grafik $F$-$I$ dari data percobaanmu sendiri yang akan MENGONFIRMASI (atau membantah) prediksi ini. Saat menulis kesimpulan nanti, alasanmu harus datang dari grafik ('grafik berupa garis lurus melalui titik asal, jadi F sebanding I'), bukan sekadar mengutip rumus ini lagi.",
    "This prediction uses the theory $F = BIL$: since $F$ is proportional to $I$, doubling $I$ is predicted to double $F$. Remember, this is only a PREDICTION - later, the shape of the $F$-$I$ graph from your own data is what will CONFIRM (or contradict) it. When you write your conclusion, your reasoning must come from the graph ('the graph is a straight line through the origin, so F is proportional to I'), not just from quoting this formula again."
  ),
  hint: LKPD_B("Lihat rumus $F = BIL$: bagaimana $F$ berubah kalau hanya $I$ yang berubah?", "Look at $F = BIL$: how does $F$ change if only $I$ changes?")
};

const LKPD_MAGNETIC_Q_REVERSE = {
  type: "choice", id: "reverse",
  q: LKPD_B(
    "Apa yang terjadi pada pembacaan timbangan jika arah arus dibalik (magnet dan kawat tidak diubah)?",
    "What happens to the balance reading if the current direction is reversed (magnet and wire unchanged)?"
  ),
  options: [
    LKPD_B("Tidak berubah karena besar arus sama", "It does not change because the current magnitude is the same"),
    LKPD_B("Arah gaya pada kawat berbalik; gaya reaksi pada magnet juga berbalik sehingga pembacaan naik menjadi turun (atau sebaliknya)", "The force on the wire reverses; the reaction force on the magnet reverses too, so the reading goes from increasing to decreasing (or vice versa)"),
    LKPD_B("Pembacaan menjadi dua kali lebih besar", "The reading becomes twice as large"),
    LKPD_B("Kawat tidak lagi mengalami gaya", "The wire no longer experiences a force")
  ],
  correct: 1,
  explain: LKPD_B(
    "Arah $F$ ditentukan kaidah tangan kiri Fleming (arah $I$, $B$, $F$). Membalik $I$ membalik $F$; menurut Hukum III Newton gaya reaksi pada magnet ikut berbalik.",
    "The direction of $F$ follows Fleming's left-hand rule (directions of $I$, $B$, $F$). Reversing $I$ reverses $F$; by Newton's third law the reaction force on the magnet reverses too."
  ),
  hint: LKPD_B("Ingat kaidah tangan kiri Fleming dan Hukum III Newton (aksi-reaksi).", "Recall Fleming's left-hand rule and Newton's third law (action-reaction).")
};

const LKPD_MAGNETIC_Q_TARE = {
  type: "choice", id: "tare",
  q: LKPD_B(
    "Mengapa timbangan harus dinolkan (tare) dengan magnet sudah berada di atasnya, sebelum arus dinyalakan?",
    "Why must the balance be zeroed (tared) with the magnet already on it, before the current is switched on?"
  ),
  options: [
    LKPD_B("Agar berat magnet tidak ikut terbaca dan $\\Delta m$ hanya berasal dari gaya magnetik akibat arus", "So the weight of the magnet is not included and $\\Delta m$ comes only from the magnetic force due to the current"),
    LKPD_B("Agar arus listrik lebih kecil", "So the current is smaller"),
    LKPD_B("Agar magnet menjadi lebih kuat", "So the magnet becomes stronger"),
    LKPD_B("Tidak ada alasan khusus", "There is no particular reason")
  ],
  correct: 0,
  explain: LKPD_B(
    "Yang diukur adalah PERUBAHAN pembacaan akibat gaya magnetik. Berat magnet (dan dudukannya) adalah nilai awal yang harus dihapus lewat tare.",
    "What is measured is the CHANGE in reading caused by the magnetic force. The weight of the magnet (and its holder) is the starting value and must be removed by taring."
  )
};

const LKPD_MAGNETIC_Q_INTERCEPT = {
  type: "choice", id: "intercept",
  q: LKPD_B(
    "Jika garis terbaik grafik $F$-$I$ tidak melalui titik asal (memotong sumbu-$F$ di nilai tidak nol), penyebab paling mungkin adalah ...",
    "If the line of best fit of the $F$-$I$ graph does not pass through the origin (it cuts the $F$-axis at a non-zero value), the most likely cause is ..."
  ),
  options: [
    LKPD_B("timbangan tidak dinolkan dengan benar atau ada gaya lain (kawat menyentuh magnet/penyangga, hembusan angin)", "the balance was not zeroed properly or another force acts (wire touching the magnet/support, draught)"),
    LKPD_B("$F = BIL$ salah", "$F = BIL$ is wrong"),
    LKPD_B("arus terlalu kecil sehingga tidak ada gaya", "the current is too small so there is no force"),
    LKPD_B("gravitasi berubah selama percobaan", "gravity changed during the experiment")
  ],
  correct: 0,
  explain: LKPD_B(
    "Menurut $F = BIL$, $F = 0$ saat $I = 0$. Perpotongan sumbu-$F$ yang tidak nol menandakan galat sistematik (offset), misalnya tare kurang tepat atau gaya mekanis tambahan.",
    "By $F = BIL$, $F = 0$ when $I = 0$. A non-zero $F$-intercept indicates a systematic error (offset), e.g. imperfect taring or an extra mechanical force."
  )
};

const LKPD_MAGNETIC_Q_ERRORS = {
  type: "open", id: "errors",
  q: LKPD_B(
    "Tuliskan minimal dua sumber kesalahan (galat) dalam percobaanmu dan cara mengurangi masing-masing.",
    "Write at least two sources of error in your experiment and how to reduce each of them."
  ),
  model: LKPD_B(
    "Contoh jawaban: (1) Kawat/kumparan menyentuh magnet atau penyangga sehingga ada gaya mekanis tambahan; perbaiki dengan menata ulang posisi dan memeriksa celah. (2) Arus berubah (drift) karena kawat/baterai memanas atau tegangan baterai turun; baca arus tepat saat membaca timbangan dan beri jeda pendinginan. (3) Panjang efektif $L$ dalam medan tidak persis sama dengan yang diukur karena medan melemah di tepi magnet; ukur $L$ beberapa kali dan gunakan magnet dengan medan lebih homogen. (4) Getaran meja atau hembusan angin memengaruhi timbangan; letakkan di permukaan stabil dan lindungi dari angin. (5) Resolusi timbangan terbatas; gunakan arus/lilitan lebih besar agar $\\Delta m$ lebih besar terhadap ketelitian alat.",
    "Sample answer: (1) The wire/coil touches the magnet or support, adding a mechanical force; re-position it and check the gap. (2) The current drifts because the wire/battery heats up or the battery voltage sags; read the current exactly when reading the balance and allow cooling breaks. (3) The effective length $L$ in the field is not exactly the measured one because the field weakens at the magnet edges; measure $L$ several times and use magnets with a more uniform field. (4) Bench vibration or a draught disturbs the balance; use a stable surface and shield from air movement. (5) Limited balance resolution; use larger currents/more turns so $\\Delta m$ is large compared with the instrument resolution."
  )
};

const LKPD_MAGNETIC_Q_CONCLUSION = {
  type: "open", id: "conclusion",
  q: LKPD_B(
    "<strong>Kesimpulan:</strong> tuliskan hubungan antara $F$ dan $I$ yang kamu peroleh, nilai $B$ hasil percobaanmu, dan apakah data mendukung hipotesismu.",
    "<strong>Conclusion:</strong> state the relationship between $F$ and $I$ you found, the value of $B$ from your experiment, and whether your data support your hypothesis."
  ),
  model: LKPD_B(
    "Contoh: Data menunjukkan $F$ berbanding lurus dengan $I$ (grafik garis lurus mendekati titik asal). Gradien grafik = $NBL$ sehingga $B = \\text{gradien}/(NL) = \\dots$ T (sertakan nilai dan satuan). Hasil ini mendukung hipotesis bahwa $F \\propto I$, dengan ketidakpastian terutama dari ... (sebutkan sumber galat utama).",
    "Example: The data show $F$ is directly proportional to $I$ (a straight-line graph close to the origin). The gradient $= NBL$, so $B = \\text{gradient}/(NL) = \\dots$ T (give value and unit). This supports the hypothesis that $F \\propto I$, with uncertainty mainly from ... (name the main source of error)."
  )
};

/* ---------- MODE 1: Praktikum Sederhana (bahan sehari-hari) ---------- */
const LKPD_MAGNETIC_SIMPLE = {
  name: LKPD_B("Praktikum Sederhana", "Simple Practical"),
  badge: LKPD_B("Alat sehari-hari", "Everyday materials"),
  tagline: LKPD_B(
    "Neraca arus mini dari timbangan digital, magnet bekas (hard disk/speaker), dan kawat email. Cocok dikerjakan di rumah atau kelas tanpa laboratorium.",
    "A mini current balance from a digital scale, salvaged magnets (hard disk/speaker) and enamelled wire. Works at home or in a classroom without a laboratory."
  ),
  dataTable: {
    independentLabel: "I (A)",
    independentEditable: true,
    rowCount: 5,
    replicateCount: 3,
    replicateLabel: "Δm (g)",
    derivedLabel: "F = Δm×g (N)",
    derivedFactor: 9.81 / 1000,
    context: "Praktikum SEDERHANA neraca arus mini: kumparan kawat email N lilitan berarus I diletakkan tegak lurus medan dua magnet neodymium bekas di atas timbangan digital dapur/saku. Gaya magnetik F = N·B·I·L terbaca sebagai perubahan massa Δm (F = Δm/1000 × 9,81). Nilai I diukur siswa dengan multimeter (bervariasi per siswa, sekitar 0,2-1,0 A). Data valid: F naik kira-kira LINEAR terhadap I dan mendekati titik asal; tiga ulangan Δm pada I yang sama saling berdekatan; Δm biasanya beberapa gram atau kurang (timbangan dapur beresolusi 0,1 g)."
  },
  sections: [
    LKPD_MAGNETIC_GOAL,
    LKPD_MAGNETIC_PREDICT,
    {
      type: "materials",
      title: LKPD_B("2. Alat & Bahan (centang jika sudah siap)", "2. Materials (tick when ready)"),
      items: [
        { n: LKPD_B("Timbangan digital dapur (ketelitian 0,1 g); lebih baik timbangan saku 0,01 g", "Digital kitchen scale (0.1 g resolution); a 0.01 g pocket scale is better"),
          note: LKPD_B("Bisa dibeli murah di toko online/toko kue.", "Cheap to buy online or at a baking supply shop."), qty: LKPD_B("1 buah", "1"), photo: "kitchenScale" },
        { n: LKPD_B("Magnet neodymium dari hard disk bekas, lengkap dengan pelat bajanya", "Neodymium magnets from an old hard disk, with their steel bracket"),
          note: LKPD_B("Pelat baja bawaan dipakai sebagai dudukan. Bisa diganti magnet kotak kecil di atas tutup kaleng biskuit; magnet speaker/kulkas lebih lemah sehingga $\\Delta m$ lebih kecil.", "The original steel bracket is the holder. Small block magnets on a biscuit-tin lid also work; speaker/fridge magnets are weaker, giving a smaller $\\Delta m$."), qty: LKPD_B("2 buah", "2"), photo: "hddMagnet" },
        { n: LKPD_B("Kawat tembaga email untuk kumparan kecil 10-20 lilitan", "Enamelled copper wire for a small coil of 10-20 turns"),
          note: LKPD_B("Bisa diambil dari dinamo/trafo/kipas bekas. Kerik ujungnya dengan amplas agar kontaknya baik.", "Can be salvaged from an old dynamo/transformer/fan. Scrape the ends with sandpaper for good contact."), qty: LKPD_B("± 2 m", "about 2 m"), photo: "enamelWire" },
        { n: LKPD_B("Baterai AA 1,5 V", "1.5 V AA batteries"), note: null, qty: LKPD_B("2-4 buah", "2-4"), photo: "aaBattery" },
        { n: LKPD_B("Tempat baterai AA", "AA battery holder"), note: null, qty: LKPD_B("1 buah", "1"), photo: "batteryHolder" },
        { n: LKPD_B("Kabel penjepit buaya", "Crocodile-clip leads"), note: null, qty: LKPD_B("4 buah", "4"), photo: "crocLeads" },
        { n: LKPD_B("Klip kertas sebagai saklar", "Paper clip as a switch"), note: null, qty: LKPD_B("1 buah", "1"), photo: "paperClip" },
        { n: LKPD_B("Multimeter digital (mode arus DC) untuk mengukur $I$", "Digital multimeter (DC current mode) to measure $I$"), note: null, qty: LKPD_B("1 buah", "1"), photo: "multimeter" },
        { n: LKPD_B("Penggaris", "Ruler"), note: LKPD_B("Untuk mengukur panjang $L$ sisi kumparan.", "To measure the coil side length $L$."), qty: LKPD_B("1 buah", "1"), photo: "ruler" },
        { n: LKPD_B("Lakban, plus tumpukan buku atau kardus sebagai penyangga kumparan", "Tape, plus a stack of books or cardboard to support the coil"), note: null, qty: LKPD_B("secukupnya", "as needed"), photo: "tape" }
      ],
      footnote: LKPD_B(
        "Tips guru: uji dulu satu set sebelum dipakai di kelas. Jika $\\Delta m$ terlalu kecil, tambah jumlah lilitan atau gunakan magnet yang lebih kuat; besar $B$ pada celah magnet bekas tidak diketahui sebelumnya, justru itulah yang diukur.",
        "Teacher tip: test one set before class. If $\\Delta m$ is too small, add turns or use stronger magnets; the value of $B$ in the gap of salvaged magnets is not known in advance - that is exactly what is measured."
      )
    },
    {
      type: "steps",
      title: LKPD_B("3. Langkah Kerja (centang setiap langkah yang selesai)", "3. Procedure (tick each step when done)"),
      items: [
        { h: LKPD_B("Tempelkan dua magnet berdampingan di pelat baja dengan kutub berlawanan menghadap ke atas, celah sekitar 1 cm. Kerjakan satu magnet per satu; magnet kuat saling menarik dan bisa menjepit jari.", "Stick the two magnets side by side on the steel plate with opposite poles facing up, about 1 cm apart. Handle one magnet at a time; strong magnets attract each other and can pinch fingers.") },
        { h: LKPD_B("Letakkan dudukan magnet di tengah piringan timbangan digital.", "Place the magnet holder at the centre of the digital scale.") },
        { h: LKPD_B("Buat kumparan kecil: lilitkan kawat email $N$ lilitan (10-20) pada benda persegi panjang kecil, lalu lepaskan dan ikat lilitannya dengan lakban. Kerik kedua ujung kawat.", "Make a small coil: wind $N$ turns (10-20) of enamelled wire around a small rectangular object, remove it and tape the turns together. Scrape both wire ends.") },
        { h: LKPD_B("Tahan kumparan secara horizontal dari penyangga (buku + penggaris yang dilakban) sehingga sisi bawahnya (panjang $L$) berada di celah, tegak lurus garis medan, tanpa menyentuh magnet atau timbangan.", "Hold the coil horizontally from a support (books + taped ruler) so its lower side (length $L$) lies in the gap, perpendicular to the field lines, touching neither the magnets nor the scale.") },
        { h: LKPD_B("Ukur $L$ (panjang sisi kumparan yang berada di celah) dan hitung $N$; isi pada bagian Ukuran di bawah.", "Measure $L$ (length of the coil side in the gap) and count $N$; enter them in the Measurements section below.") },
        { h: LKPD_B("Rangkai: baterai - multimeter (mode arus DC) - saklar klip kertas - kumparan. Saklar masih terbuka.", "Assemble: battery - multimeter (DC current mode) - paper-clip switch - coil. Keep the switch open.") },
        { h: LKPD_B("Tekan tombol nol (tare) timbangan dengan magnet di atasnya dan arus mati.", "Press the scale's zero (tare) button with the magnets on it and the current off.") },
        { h: LKPD_B("Tutup saklar maksimal 5 detik: baca $I$ pada multimeter dan $\\Delta m$ pada timbangan, catat di tabel. Jika pembacaan turun (negatif), tukar kabel baterai agar arah arus terbalik.", "Close the switch for at most 5 seconds: read $I$ on the multimeter and $\\Delta m$ on the scale and record them in the table. If the reading decreases (negative), swap the battery leads to reverse the current.") },
        { h: LKPD_B("Ubah arus (tambah/kurangi baterai, atau ubah panjang kawat penghubung) dan ulangi untuk minimal 4 nilai $I$. Tiap $I$ diulang 3 kali ($\\Delta m_1, \\Delta m_2, \\Delta m_3$) dengan jeda pendinginan.", "Change the current (add/remove batteries, or change the length of connecting wire) and repeat for at least 4 values of $I$. Repeat each $I$ three times ($\\Delta m_1, \\Delta m_2, \\Delta m_3$) with cooling breaks.") },
        { h: LKPD_B("Matikan arus dan pastikan timbangan kembali ke 0,0 g; jika tidak, tare ulang dan ulangi pengukuran.", "Switch off and check the scale returns to 0.0 g; if not, re-tare and repeat the measurements.") }
      ]
    },
    {
      type: "safety",
      title: LKPD_B("Keselamatan Kerja", "Safety"),
      items: [
        { h: LKPD_B("Jangan menghubung-singkatkan baterai. Jaga arus di bawah sekitar 1 A dan nyalakan maksimal 5 detik per pembacaan; kawat dan baterai bisa panas.", "Never short-circuit the battery. Keep the current below about 1 A and switch on for at most 5 seconds per reading; wire and battery can get hot.") },
        { h: LKPD_B("Magnet neodymium sangat kuat: jari bisa terjepit dan magnet bisa pecah. Jauhkan dari HP, kartu magnetik, alat medis (mis. alat pacu jantung), dan anak kecil.", "Neodymium magnets are very strong: fingers can be pinched and magnets can shatter. Keep them away from phones, magnetic cards, medical devices (e.g. pacemakers) and small children.") },
        { h: LKPD_B("Mengerik kawat email dengan amplas: lakukan hati-hati agar tidak melukai jari.", "Scrape enamelled wire with sandpaper carefully so you do not hurt your fingers.") }
      ]
    },
    {
      type: "vars",
      title: LKPD_B("4. Ukuran Alat", "4. Measurements of Your Set-up"),
      desc: LKPD_B("Isi ukuran alat yang kamu buat. Nilai ini dipakai untuk menghitung $B$.", "Enter the dimensions of the set-up you built. These values are used to calculate $B$."),
      fields: [
        { key: "L", label: LKPD_B("Panjang sisi kumparan di celah, $L$", "Length of coil side in the gap, $L$"), unit: "cm", toSI: 0.01, step: "0.1", hint: LKPD_B("mis. 2,5", "e.g. 2.5") },
        { key: "N", label: LKPD_B("Jumlah lilitan kumparan, $N$", "Number of turns of the coil, $N$"), unit: LKPD_B("lilitan", "turns"), toSI: 1, step: "1", hint: LKPD_B("mis. 15", "e.g. 15") }
      ]
    },
    {
      type: "table",
      title: LKPD_B("5. Tabel Data (isi langsung di sini)", "5. Data Table (fill in right here)"),
      desc: LKPD_B(
        "Tulis $I$ yang terbaca di multimeter pada kolom pertama, lalu tiga pembacaan $\\Delta m$. Rata-rata dan $F$ dihitung otomatis. Klik Simpan Data agar tersimpan dan diperiksa kewajarannya.",
        "Write the $I$ read on the multimeter in the first column, then three readings of $\\Delta m$. The mean and $F$ are computed automatically. Click Save Data to store it and have it checked for plausibility."
      )
    },
    {
      type: "graph",
      title: LKPD_B("6. Grafik F terhadap I (otomatis)", "6. Graph of F against I (automatic)"),
      desc: LKPD_B("Grafik dan garis terbaik (regresi linear) dibuat dari tabelmu. Gradiennya dipakai untuk menghitung $B$.", "The graph and best-fit line (linear regression) are drawn from your table. Its gradient is used to calculate $B$.")
    },
    {
      type: "calc", id: "calcB",
      q: LKPD_B(
        "Hitung rapat fluks magnetik: $B = \\dfrac{\\text{gradien}}{N L}$ (dengan $L$ dalam meter). Tuliskan hasilmu dalam tesla (T).",
        "Calculate the magnetic flux density: $B = \\dfrac{\\text{gradient}}{N L}$ ($L$ in metres). Give your result in tesla (T)."
      ),
      compute: "B", tolPct: 15, unit: "T",
      explain: LKPD_B("$B$ dihitung dari gradien garis terbaik dibagi $N L$.", "$B$ is the best-fit gradient divided by $N L$."),
      hint: LKPD_B("Ubah $L$ dari cm ke m (bagi 100). Gradien ada di kotak hasil grafik di atas.", "Convert $L$ from cm to m (divide by 100). The gradient is in the graph result box above.")
    },
    {
      type: "choice", id: "gradient",
      q: LKPD_B("Apa makna gradien grafik $F$ terhadap $I$ pada susunan kumparanmu?", "What does the gradient of the $F$ against $I$ graph represent for your coil set-up?"),
      options: [
        LKPD_B("$N B L$", "$N B L$"),
        LKPD_B("Hanya $B$", "$B$ only"),
        LKPD_B("Massa magnet", "The mass of the magnet"),
        LKPD_B("Hambatan kumparan", "The resistance of the coil")
      ],
      correct: 0,
      explain: LKPD_B("Grafik $F$-$I$-mu berupa garis lurus melalui/dekat titik asal, jadi $F$ sebanding $I$ - ini sesuai dengan $F = N B I L$, sehingga gradien garis itu sama dengan $N B L$.", "Your $F$-$I$ graph is a straight line through/near the origin, so $F$ is proportional to $I$ - this matches $F = N B I L$, so the line's gradient equals $N B L$."),
      hint: LKPD_B("Bandingkan $F = (NBL) \\times I$ dengan bentuk $y = m x$.", "Compare $F = (NBL) \\times I$ with the form $y = m x$.")
    },
    LKPD_MAGNETIC_Q_REVERSE,
    LKPD_MAGNETIC_Q_TARE,
    LKPD_MAGNETIC_Q_INTERCEPT,
    LKPD_MAGNETIC_Q_ERRORS,
    {
      type: "choice", id: "extra-turns", onlyFor: "lanjut",
      q: LKPD_B(
        "<strong>Tantangan:</strong> jumlah lilitan kumparan digandakan ($N \\to 2N$) dengan arus $I$, panjang $L$, dan medan $B$ dijaga sama. Gradien grafik $F$-$I$ menjadi ...",
        "<strong>Challenge:</strong> the number of turns is doubled ($N \\to 2N$) while $I$, $L$ and $B$ are kept the same. The gradient of the $F$-$I$ graph becomes ..."
      ),
      options: [
        LKPD_B("2 kali semula", "twice as large"), LKPD_B("tetap", "unchanged"), LKPD_B("setengah semula", "half as large"), LKPD_B("4 kali semula", "four times as large")
      ],
      correct: 0,
      explain: LKPD_B("Gradien $= N B L$, jadi berbanding lurus dengan $N$.", "Gradient $= N B L$, so it is proportional to $N$.")
    },
    {
      type: "open", id: "extra-resolution", onlyFor: "lanjut",
      q: LKPD_B(
        "<strong>Tantangan:</strong> usulkan tiga cara memperbesar $\\Delta m$ agar pengukuran dengan timbangan beresolusi 0,1 g lebih teliti, dan jelaskan keterbatasan tiap cara.",
        "<strong>Challenge:</strong> suggest three ways to increase $\\Delta m$ so a 0.1 g-resolution scale gives a more precise measurement, and explain the limitation of each."
      ),
      model: LKPD_B(
        "Contoh: (1) Menambah lilitan $N$: $F \\propto N$, tetapi hambatan kumparan naik sehingga arus turun dan kawat memanas. (2) Memakai magnet lebih kuat/celah lebih sempit: $B$ lebih besar, tetapi medan kurang homogen dan lebih sulit ditata. (3) Memperbesar arus: $F \\propto I$, tetapi pemanasan dan turunnya tegangan baterai membatasi.",
        "Example: (1) Add turns $N$: $F \\propto N$, but the coil resistance rises so the current drops and the wire heats. (2) Use stronger magnets/narrower gap: larger $B$, but the field is less uniform and harder to arrange. (3) Increase the current: $F \\propto I$, but heating and battery voltage sag limit this."
      )
    },
    LKPD_MAGNETIC_Q_CONCLUSION
  ]
};

/* ---------- MODE 2: Praktikum Lab (alat & kit praktikum nyata) ---------- */
const LKPD_MAGNETIC_LAB = {
  name: LKPD_B("Praktikum Lab", "Laboratory Practical"),
  badge: LKPD_B("Kit & alat lab nyata", "Real lab kit & apparatus"),
  tagline: LKPD_B(
    "Neraca arus (current balance) standar laboratorium dengan neraca elektronik 0,01 g dan catu daya DC. Cocok untuk praktikum Cambridge di laboratorium sekolah.",
    "A standard laboratory current balance with a 0.01 g electronic balance and a DC power supply. Suitable for a Cambridge practical in a school laboratory."
  ),
  dataTable: {
    independentLabel: "I (A)",
    independentValues: [0.50, 1.00, 1.50, 2.00, 2.50],
    replicateCount: 3,
    replicateLabel: "Δm (g)",
    derivedLabel: "F = Δm×g (N)",
    derivedFactor: 9.81 / 1000,
    context: "Praktikum LAB Current Balance: kawat/papan kawat berarus I (N = 1) diletakkan tegak lurus medan magnet homogen di celah magnet, magnet berada di atas neraca elektronik (ketelitian 0,01 g). Gaya magnetik F = B·I·L terbaca sebagai perubahan massa Δm (F = Δm/1000 × 9,81). Data yang valid: F naik kira-kira LINEAR terhadap I dan melalui/dekat titik asal (I=0 -> F=0); tiga ulangan Δm pada arus yang sama berdekatan; rapat fluks kit sekolah (gradien F-I dibagi L) tipikal sekitar 0,05-0,5 T."
  },
  sections: [
    LKPD_MAGNETIC_GOAL,
    LKPD_MAGNETIC_PREDICT,
    {
      type: "materials",
      title: LKPD_B("2. Alat & Bahan (centang jika sudah siap)", "2. Apparatus (tick when ready)"),
      items: [
        { n: LKPD_B("Neraca arus (current balance): rumah magnet/yoke besi dengan sepasang magnet, plus papan/loop kawat dengan panjang $L$ diketahui", "Current balance: magnet assembly/iron yoke with a pair of magnets, plus wire boards/loops of known length $L$"),
          note: LKPD_B("Gambar: ilustrasi susunan. Lihat contoh kit di bawah tabel.", "Picture: set-up illustration. See the example kits below the table."), qty: LKPD_B("1 set", "1 set"), photo: "svg:vlab" },
        { n: LKPD_B("Neraca elektronik (top-pan balance), ketelitian minimal 0,01 g", "Electronic top-pan balance, resolution of at least 0.01 g"), note: null, qty: LKPD_B("1 buah", "1"), photo: "labBalance" },
        { n: LKPD_B("Catu daya DC yang dapat diatur, sampai sekitar 5-6 A", "Variable DC power supply, up to about 5-6 A"), note: null, qty: LKPD_B("1 buah", "1"), photo: "dcSupply" },
        { n: LKPD_B("Amperemeter (sampai 5 A) atau multimeter digital mode arus", "Ammeter (up to 5 A) or a digital multimeter in current mode"), note: null, qty: LKPD_B("1 buah", "1"), photo: "ammeter" },
        { n: LKPD_B("Kabel penghubung (banana / penjepit buaya)", "Connecting leads (banana / crocodile clip)"), note: null, qty: LKPD_B("3-4 buah", "3-4"), photo: "bananaLead" },
        { n: LKPD_B("Statif/alas dan batang penyangga untuk menahan papan kawat tetap di celah magnet", "Stand/base and support rod to hold the wire board fixed in the magnet gap"), note: null, qty: LKPD_B("1 set", "1 set"), photo: "retortStand" },
        { n: LKPD_B("Jangka sorong atau penggaris untuk memverifikasi $L$", "Vernier callipers or a ruler to verify $L$"), note: null, qty: LKPD_B("1 buah", "1"), photo: "caliper" }
      ],
      kits: [
        { name: LKPD_B("PASCO Current Balance EM-8607", "PASCO Current Balance EM-8607"),
          code: "EM-8607",
          note: LKPD_B(
            "Isi kit: 5 magnet tapal kuda, 1 pemegang magnet, 4 papan kawat (2, 3, 4, 5 cm), 1 pemegang papan kawat; arus maksimum 8 A. Perlu neraca 0,01 g dan catu daya DC sampai 6 A (tidak termasuk). Tercantum sekitar US$249 di halaman produk PASCO saat dicek (Sep 2026); harga dan ketersediaan bisa berubah.",
            "Contents: 5 horseshoe magnets, 1 magnet holder, 4 wire boards (2, 3, 4, 5 cm), 1 wire-board holder; maximum current 8 A. Needs a 0.01 g balance and a DC supply up to 6 A (not included). Listed at about US$249 on PASCO's product page when checked (Sep 2026); price and availability may change."),
          url: "https://www.pasco.com/products/lab-apparatus/electricity-and-magnetism/magnetic-fields/current-balance",
          urlLabel: LKPD_B("Halaman produk PASCO", "PASCO product page") },
        { name: LKPD_B("PASCO Basic Current Balance SF-8607 (model lama)", "PASCO Basic Current Balance SF-8607 (older model)"),
          code: "SF-8607",
          note: LKPD_B(
            "Sudah tidak dijual (digantikan EM-8607) tetapi manualnya berguna sebagai panduan prosedur: 6 loop kawat 1-8 cm, 6 magnet dan yoke besi, arus 0-5 A, neraca minimal 0,01 g. Sering masih ada di laboratorium sekolah.",
            "Discontinued (replaced by EM-8607) but its manual is a useful procedure guide: 6 wire loops of 1-8 cm, 6 magnets and an iron yoke, current 0-5 A, balance of at least 0.01 g. Often still found in school labs."),
          url: "https://d2n0lz049icia2.cloudfront.net/product_document/Basic-Current-Balance-Manual-SF-8607.pdf",
          urlLabel: LKPD_B("Manual SF-8607 (PDF)", "SF-8607 manual (PDF)") },
        { name: LKPD_B("PHYWE Current balance, P2410601", "PHYWE Current balance, P2410601"),
          code: "P2410601",
          note: LKPD_B(
            "Set lengkap: neraca arus, elektromagnet inti U dengan kumparan 900 lilitan (medan $B$ diatur lewat arus kumparan), empat loop kawat, catu daya universal 18 V DC/5 A, multimeter, kabel, dan penyangga. Cocok untuk variasi $B$ dan $L$.",
            "Complete set: current balance, U-core electromagnet with 900-turn coils (field $B$ set by the coil current), four wire loops, universal 18 V DC/5 A supply, multimeters, leads and stands. Good for varying both $B$ and $L$."),
          url: "https://www.phywe.com/experiments-sets/university-experiments/current-balance-force-acting-on-a-current-carrying-conductor-with-an-amperemeter_9520_10451/",
          urlLabel: LKPD_B("Halaman eksperimen PHYWE", "PHYWE experiment page") },
        { name: LKPD_B("Pudak Scientific - Kit Listrik dan Magnet SMA (FU-04)", "Pudak Scientific - Electricity & Magnetism Kit for Senior High (FU-04)"),
          code: "FU-04",
          note: LKPD_B(
            "Produsen Indonesia. Kit 22 topik percobaan (50 komponen) yang mencakup Medan Magnet di Sekitar Arus Listrik, Elektromagnetik, Gaya Magnet (Lorentz), induksi elektromagnetik, dan transformator. Untuk pengukuran gaya secara kuantitatif dengan neraca, periksa manual/vendor apakah alat pendukungnya sudah termasuk.",
            "Indonesian manufacturer. A kit of 22 experiment topics (50 components) covering Magnetic Field around a Current, Electromagnet, Magnetic (Lorentz) Force, electromagnetic induction and transformers. For quantitative force measurement with a balance, check the manual/vendor for whether the needed parts are included."),
          url: "https://www.pudak-scientific.com/detail_products.php?id=289",
          urlLabel: LKPD_B("Halaman produk Pudak FU-04", "Pudak FU-04 product page") },
        { name: LKPD_B("Pudak Scientific - Kit Listrik dan Magnet Internasional (PEK 500)", "Pudak Scientific - International Electricity & Magnetism Kit (PEK 500)"),
          code: "PEK 500",
          note: LKPD_B(
            "Pelengkap materi: medan magnet di sekitar kawat lurus, kawat melingkar, dan solenoid; elektromagnet; induksi elektromagnetik; arus eddy (sekitar 50 percobaan). Bukan neraca arus, tetapi memperkuat pemahaman medan oleh arus.",
            "Companion for the topic: magnetic field around a straight wire, circular loop and solenoid; electromagnet; electromagnetic induction; eddy currents (about 50 experiments). Not a current balance, but it strengthens understanding of fields due to currents."),
          url: "https://www.pudak-scientific.com/detail_products.php?id=303",
          urlLabel: LKPD_B("Halaman produk Pudak PEK 500", "Pudak PEK 500 product page") },
        { name: LKPD_B("Pudak Scientific - Medan Magnet, Induksi dan Motor Listrik (PEI 300)", "Pudak Scientific - Magnetic Field, Induction & Electric Motor (PEI 300)"),
          code: "PEI 300",
          note: LKPD_B(
            "Sistem berbasis sensor: sensor medan magnet (-10 sampai 50 mT dan -100 sampai 500 mT), antarmuka Eurolab, sensor gerbang cahaya, catu daya 12 V/3 A, reostat, dan 2 multimeter digital. Berguna untuk MEMVERIFIKASI nilai $B$ hasil gradienmu dengan pengukuran langsung.",
            "Sensor-based system: magnetic field sensor (-10 to 50 mT and -100 to 500 mT), Eurolab interface, light-gate sensor, 12 V/3 A supply, rheostat and 2 digital multimeters. Useful to VERIFY your gradient-derived $B$ with a direct measurement."),
          url: "https://www.pudak-scientific.com/detail_products.php?id=536",
          urlLabel: LKPD_B("Halaman produk Pudak PEI 300", "Pudak PEI 300 product page") }
      ],
      footnote: LKPD_B(
        "Harga dan ketersediaan berubah; hubungi vendor atau distributor resmi. Batas arus, jenis magnet, dan ukuran loop mengikuti manual kit yang kamu pakai. Tabel di bawah dirancang untuk kit sekelas EM-8607/SF-8607 (arus 0,5-2,5 A).",
        "Prices and availability change; contact the vendor or an authorised distributor. Current limits, magnet type and loop sizes follow the manual of the kit you use. The table below is designed for EM-8607/SF-8607-class kits (0.5-2.5 A)."
      )
    },
    {
      type: "steps",
      title: LKPD_B("3. Langkah Kerja (centang setiap langkah yang selesai)", "3. Procedure (tick each step when done)"),
      items: [
        { h: LKPD_B("Pasang magnet pada yoke/pemegangnya lalu letakkan di tengah piringan neraca elektronik. Dudukkan papan kawat pada penyangganya sehingga bagian horizontalnya berada di tengah celah magnet, tegak lurus medan, dan tidak menyentuh magnet.", "Fit the magnets on the yoke/holder and place them at the centre of the balance pan. Mount the wire board on its holder so its horizontal section lies in the middle of the magnet gap, perpendicular to the field, not touching the magnets.") },
        { h: LKPD_B("Catat panjang $L$ papan kawat yang dipakai (bagian yang berada di medan). Verifikasi dengan penggaris/jangka sorong.", "Record the length $L$ of the wire board used (the part in the field). Verify it with a ruler/vernier callipers.") },
        { h: LKPD_B("Hubungkan papan kawat ke catu daya DC lewat amperemeter. Catu daya masih mati dan pengatur arus di posisi minimum.", "Connect the wire board to the DC supply through the ammeter. Supply still off and current control at minimum.") },
        { h: LKPD_B("Dengan arus mati, tekan tombol nol (tare) neraca sehingga terbaca 0,00 g dengan magnet di atasnya.", "With the current off, press the balance tare button so it reads 0.00 g with the magnets on it.") },
        { h: LKPD_B("Nyalakan catu daya dan atur $I = 0{,}50$ A. Setelah pembacaan stabil, catat $\\Delta m$. Jika pembacaan negatif, tukar polaritas arus (atau kutub magnet) agar pembacaan positif.", "Switch on the supply and set $I = 0.50$ A. When the reading is steady, record $\\Delta m$. If the reading is negative, swap the current polarity (or the magnet poles) so the reading is positive.") },
        { h: LKPD_B("Naikkan arus tiap 0,50 A (sampai 2,50 A) dan catat $\\Delta m$ pada setiap nilai $I$. Jangan melebihi batas arus pada manual kit.", "Increase the current in 0.50 A steps (up to 2.50 A) and record $\\Delta m$ at each $I$. Do not exceed the current limit in the kit manual.") },
        { h: LKPD_B("Matikan arus, pastikan neraca kembali ke 0,00 g (jika tidak, tare ulang dan ulangi). Ulangi seluruh rangkaian pengukuran dua kali lagi untuk mendapat tiga ulangan ($\\Delta m_1, \\Delta m_2, \\Delta m_3$).", "Switch off and make sure the balance returns to 0.00 g (if not, re-tare and repeat). Repeat the whole series twice more for three repeats ($\\Delta m_1, \\Delta m_2, \\Delta m_3$).") },
        { h: LKPD_B("Opsional: jika tersedia sensor/teslameter, ukur $B$ langsung di celah magnet dan bandingkan dengan hasil gradien.", "Optional: if a sensor/teslameter is available, measure $B$ directly in the magnet gap and compare with the gradient result.") }
      ]
    },
    {
      type: "safety",
      title: LKPD_B("Keselamatan Kerja", "Safety"),
      items: [
        { h: LKPD_B("Arus beberapa ampere memanaskan kawat: jangan menyentuh kawat saat arus mengalir; matikan catu daya di antara pengukuran bila kawat terasa hangat.", "Currents of several amperes heat the wire: do not touch the wire while current flows; switch off between readings if the wire feels warm.") },
        { h: LKPD_B("Pastikan sambungan kabel rapi, tanpa bagian logam terbuka, dan tangan kering.", "Make sure leads are tidy with no exposed metal, and hands are dry.") },
        { h: LKPD_B("Magnet mudah retak jika jatuh dan dapat menjepit jari; jauhkan dari HP dan kartu magnetik.", "Magnets crack easily if dropped and can pinch fingers; keep them away from phones and magnetic cards.") }
      ]
    },
    {
      type: "vars",
      title: LKPD_B("4. Ukuran Alat", "4. Measurements of Your Apparatus"),
      desc: LKPD_B("Isi panjang kawat di dalam medan. Jumlah lilitan $N = 1$ (satu kawat tunggal).", "Enter the wire length inside the field. Number of turns $N = 1$ (a single wire)."),
      fields: [
        { key: "L", label: LKPD_B("Panjang kawat di dalam medan, $L$", "Wire length in the field, $L$"), unit: "cm", toSI: 0.01, step: "0.1", hint: LKPD_B("mis. 4,0", "e.g. 4.0") },
        { key: "N", label: LKPD_B("Jumlah lilitan, $N$", "Number of turns, $N$"), unit: LKPD_B("lilitan", "turns"), toSI: 1, fixed: 1 }
      ]
    },
    {
      type: "table",
      title: LKPD_B("5. Tabel Data (isi langsung di sini)", "5. Data Table (fill in right here)"),
      desc: LKPD_B(
        "Isi tiga ulangan $\\Delta m$ untuk setiap arus. Rata-rata dan $F = \\Delta m \\times g$ dihitung otomatis (gram diubah ke kg). Klik Simpan Data agar tersimpan dan diperiksa kewajarannya.",
        "Enter three repeats of $\\Delta m$ for each current. The mean and $F = \\Delta m \\times g$ are computed automatically (grams converted to kg). Click Save Data to store it and have it checked for plausibility."
      )
    },
    {
      type: "graph",
      title: LKPD_B("6. Grafik F terhadap I (otomatis)", "6. Graph of F against I (automatic)"),
      desc: LKPD_B("Grafik dan garis terbaik (regresi linear) dibuat dari tabelmu. Gradiennya dipakai untuk menghitung $B$.", "The graph and best-fit line (linear regression) are drawn from your table. Its gradient is used to calculate $B$.")
    },
    {
      type: "calc", id: "calcB",
      q: LKPD_B(
        "Hitung rapat fluks magnetik: $B = \\dfrac{\\text{gradien}}{L}$ (dengan $L$ dalam meter, $N = 1$). Tuliskan hasilmu dalam tesla (T).",
        "Calculate the magnetic flux density: $B = \\dfrac{\\text{gradient}}{L}$ ($L$ in metres, $N = 1$). Give your result in tesla (T)."
      ),
      compute: "B", tolPct: 15, unit: "T",
      explain: LKPD_B("$B$ dihitung dari gradien garis terbaik dibagi $L$.", "$B$ is the best-fit gradient divided by $L$."),
      hint: LKPD_B("Ubah $L$ dari cm ke m (bagi 100). Gradien ada di kotak hasil grafik di atas.", "Convert $L$ from cm to m (divide by 100). The gradient is in the graph result box above.")
    },
    {
      type: "choice", id: "gradient",
      q: LKPD_B("Apa makna gradien grafik $F$ terhadap $I$ pada percobaan neraca arus ini?", "What does the gradient of the $F$ against $I$ graph represent in this current balance experiment?"),
      options: [
        LKPD_B("$B L$", "$B L$"),
        LKPD_B("Hanya $B$", "$B$ only"),
        LKPD_B("Hanya $L$", "$L$ only"),
        LKPD_B("Massa pada neraca", "The mass on the balance")
      ],
      correct: 0,
      explain: LKPD_B("Grafik $F$-$I$-mu berupa garis lurus melalui/dekat titik asal, jadi $F$ sebanding $I$ - ini sesuai dengan $F = B I L$, sehingga gradien garis itu sama dengan $B L$; $B$ didapat setelah dibagi $L$.", "Your $F$-$I$ graph is a straight line through/near the origin, so $F$ is proportional to $I$ - this matches $F = B I L$, so the line's gradient equals $B L$; $B$ follows after dividing by $L$."),
      hint: LKPD_B("Bandingkan $F = (BL) \\times I$ dengan bentuk $y = m x$.", "Compare $F = (BL) \\times I$ with the form $y = m x$.")
    },
    LKPD_MAGNETIC_Q_REVERSE,
    LKPD_MAGNETIC_Q_TARE,
    LKPD_MAGNETIC_Q_INTERCEPT,
    LKPD_MAGNETIC_Q_ERRORS,
    {
      type: "choice", id: "extra-length", onlyFor: "lanjut",
      q: LKPD_B(
        "<strong>Tantangan:</strong> dengan $I$ dan $B$ tetap, papan kawat 2 cm diganti papan kawat 4 cm. Gradien grafik $F$-$I$ menjadi ...",
        "<strong>Challenge:</strong> with $I$ and $B$ fixed, a 2 cm wire board is replaced by a 4 cm one. The gradient of the $F$-$I$ graph becomes ..."
      ),
      options: [
        LKPD_B("2 kali semula", "twice as large"), LKPD_B("tetap", "unchanged"), LKPD_B("setengah semula", "half as large"), LKPD_B("4 kali semula", "four times as large")
      ],
      correct: 0,
      explain: LKPD_B("Gradien $= B L$, sehingga berbanding lurus dengan $L$: $L$ dua kali lipat, gradien dua kali lipat.", "Gradient $= B L$ is proportional to $L$: doubling $L$ doubles the gradient.")
    },
    {
      type: "open", id: "extra-verify", onlyFor: "lanjut",
      q: LKPD_B(
        "<strong>Tantangan:</strong> rancang cara memverifikasi nilai $B$ hasil gradienmu memakai pengukuran independen (mis. sensor medan magnet/teslameter). Apa yang kamu bandingkan dan bagaimana menilai kecocokannya?",
        "<strong>Challenge:</strong> design a way to verify your gradient-derived $B$ with an independent measurement (e.g. a magnetic field sensor/teslameter). What do you compare and how do you judge the agreement?"
      ),
      model: LKPD_B(
        "Contoh: letakkan probe sensor medan magnet di tengah celah, tegak lurus medan, ukur $B$ beberapa kali di beberapa titik sepanjang $L$ dan ambil rata-rata; bandingkan dengan $B$ dari gradien memakai selisih persen $\\left|\\dfrac{B_1 - B_2}{B_2}\\right| \\times 100\\%$. Kecocokan dinilai dengan mempertimbangkan ketidakpastian kedua metode dan ketidakhomogenan medan di tepi magnet.",
        "Example: place the field-sensor probe in the middle of the gap, perpendicular to the field, measure $B$ several times at several points along $L$ and average; compare with the gradient-derived $B$ using the percentage difference $\\left|\\dfrac{B_1 - B_2}{B_2}\\right| \\times 100\\%$. Judge agreement by considering the uncertainties of both methods and field non-uniformity at the magnet edges."
      )
    },
    LKPD_MAGNETIC_Q_CONCLUSION
  ]
};

/* ---------- MODE 3: Praktikum Virtual (tanpa alat sama sekali) ---------- */
const LKPD_MAGNETIC_VIRTUAL = {
  name: LKPD_B("Praktikum Virtual", "Virtual Practical"),
  badge: LKPD_B("Tanpa alat", "No apparatus"),
  tagline: LKPD_B(
    "Neraca arus virtual di layar: pilih arus, baca neraca, catat, lalu olah datamu sendiri seperti praktikum sungguhan. Untuk sekolah yang belum memiliki alat.",
    "An on-screen current balance: choose a current, read the balance, record and analyse your own data exactly as in a real practical. For schools without apparatus."
  ),
  dataTable: {
    independentLabel: "I (A)",
    independentValues: [0.50, 1.00, 1.50, 2.00, 2.50],
    replicateCount: 3,
    replicateLabel: "Δm (g)",
    derivedLabel: "F = Δm×g (N)",
    derivedFactor: 9.81 / 1000,
    readonly: true,
    context: "Eksperimen Current Balance VIRTUAL (simulasi di layar): kawat lurus N = 1 sepanjang L = 4,5 cm berarus I tegak lurus medan sepasang magnet virtual di atas neraca virtual (resolusi 0,01 g). F = BIL terbaca sebagai perubahan massa Δm (F = Δm/1000 × 9,81). B tiap siswa diacak antara 0,15 dan 0,35 T dan pembacaan diberi derau ±5%. Data valid: F naik linear terhadap I melalui titik asal; tiga ulangan berdekatan; Δm berorde sepersepuluh gram sampai beberapa gram."
  },
  apparatus: { lengthM: 0.045, bTrueMin: 0.15, bTrueMax: 0.35, noiseFrac: 0.05, noiseAbsG: 0.02 },
  sections: [
    LKPD_MAGNETIC_GOAL,
    LKPD_MAGNETIC_PREDICT,
    {
      type: "steps",
      title: LKPD_B("Langkah Kerja (centang setiap langkah yang selesai)", "Procedure (tick each step when done)"),
      items: [
        { h: LKPD_B("Rakit alat virtual di meja kerja: pilih (ketuk atau seret) setiap alat sesuai urutan, termasuk menekan tare neraca setelah magnet terpasang. Kawat uji harus melewati celah magnet tanpa menyentuhnya.", "Assemble the virtual apparatus on the workbench: pick (tap or drag) each item in order, including taring the balance once the magnets are on it. The test wire must pass through the magnet gap without touching it.") },
        { h: LKPD_B("Amati rangkaian yang sudah jadi: kawat uji melewati celah sepasang magnet yang bertumpu di atas neraca elektronik. Panjang kawat di dalam medan $L$ tertulis di bawah diagram.", "Study the finished set-up: the test wire passes through the gap of a pair of magnets resting on an electronic balance. The wire length in the field, $L$, is given below the diagram.") },
        { h: LKPD_B("Pilih nilai arus $I$, lalu klik <strong>Baca Neraca</strong>. Pembacaan otomatis masuk ke kolom kosong pertama pada baris arus itu.", "Choose a current $I$, then click <strong>Read Balance</strong>. The reading goes into the first empty cell of that current's row.") },
        { h: LKPD_B("Ulangi sampai setiap arus punya tiga pembacaan ($\\Delta m_1, \\Delta m_2, \\Delta m_3$). Pembacaan sedikit berbeda setiap kali, seperti alat sungguhan.", "Repeat until every current has three readings ($\\Delta m_1, \\Delta m_2, \\Delta m_3$). Readings vary slightly each time, like a real instrument.") },
        { h: LKPD_B("Klik <strong>Simpan Data</strong> agar datamu tersimpan (saat belajar di kelas, kewajarannya juga diperiksa AI).", "Click <strong>Save Data</strong> to store your data (in a class session the AI also checks its plausibility).") },
        { h: LKPD_B("Gunakan grafik untuk menjawab soal hitungan dan soal pemahaman di bawah.", "Use the graph to answer the calculation and understanding questions below.") }
      ]
    },
    { type: "vlab", title: LKPD_B("Alat Virtual: Neraca Arus", "Virtual Apparatus: Current Balance") },
    {
      type: "vars",
      title: LKPD_B("Ukuran Alat", "Measurements of the Apparatus"),
      desc: LKPD_B("Alat virtual memakai satu kawat lurus, jadi $N = 1$. Panjang $L$ sudah ditetapkan.", "The virtual apparatus uses a single straight wire, so $N = 1$. The length $L$ is fixed."),
      fields: [
        { key: "L", label: LKPD_B("Panjang kawat di dalam medan, $L$", "Wire length in the field, $L$"), unit: "cm", toSI: 0.01, fixed: 4.5 },
        { key: "N", label: LKPD_B("Jumlah lilitan, $N$", "Number of turns, $N$"), unit: LKPD_B("lilitan", "turns"), toSI: 1, fixed: 1 }
      ]
    },
    {
      type: "table",
      title: LKPD_B("Tabel Data", "Data Table"),
      desc: LKPD_B("Kolom $\\Delta m$ terisi dari pembacaan neraca virtual. Rata-rata dan $F = \\Delta m \\times g$ dihitung otomatis (gram diubah ke kg).", "The $\\Delta m$ columns fill from the virtual balance readings. The mean and $F = \\Delta m \\times g$ are computed automatically (grams converted to kg).")
    },
    {
      type: "graph",
      title: LKPD_B("Grafik F terhadap I", "Graph of F against I"),
      desc: LKPD_B("Garis terbaik (regresi linear) dibuat dari tabelmu. Baca gradiennya untuk menghitung $B$.", "The best-fit line (linear regression) is drawn from your table. Read its gradient to calculate $B$.")
    },
    {
      type: "calc", id: "calcB",
      q: LKPD_B(
        "Hitung rapat fluks magnetik: $B = \\dfrac{\\text{gradien}}{L}$ (dengan $L$ dalam meter, $N = 1$). Tuliskan hasilmu dalam tesla (T).",
        "Calculate the magnetic flux density: $B = \\dfrac{\\text{gradient}}{L}$ ($L$ in metres, $N = 1$). Give your result in tesla (T)."
      ),
      compute: "B", tolPct: 15, unit: "T",
      explain: LKPD_B("$B$ = gradien garis terbaik dibagi $L$ (dalam meter).", "$B$ = best-fit gradient divided by $L$ (in metres)."),
      hint: LKPD_B("$L = 4{,}5$ cm $= 0{,}045$ m. Gradien ada di kotak hasil grafik.", "$L = 4.5$ cm $= 0.045$ m. The gradient is in the graph result box.")
    },
    {
      type: "choice", id: "gradient",
      q: LKPD_B("Apa makna gradien grafik $F$ terhadap $I$ pada percobaan ini?", "What does the gradient of the $F$ against $I$ graph represent in this experiment?"),
      options: [
        LKPD_B("$B L$", "$B L$"),
        LKPD_B("Hanya $B$", "$B$ only"),
        LKPD_B("Hanya $L$", "$L$ only"),
        LKPD_B("Massa pada neraca", "The mass on the balance")
      ],
      correct: 0,
      explain: LKPD_B("Grafik berupa garis lurus melalui titik asal, jadi $F$ sebanding $I$. Sesuai $F = BIL$, gradiennya $= BL$.", "The graph is a straight line through the origin, so $F$ is proportional to $I$. From $F = BIL$, the gradient $= BL$."),
      hint: LKPD_B("Bandingkan $F = (BL) \\times I$ dengan bentuk $y = m x$.", "Compare $F = (BL) \\times I$ with the form $y = m x$.")
    },
    LKPD_MAGNETIC_Q_REVERSE,
    LKPD_MAGNETIC_Q_INTERCEPT,
    {
      type: "open", id: "virtual-vs-real",
      q: LKPD_B(
        "Sebutkan dua hal yang pada praktikum sungguhan menimbulkan ketidakpastian, tetapi tidak muncul (atau disederhanakan) pada alat virtual ini.",
        "Name two things that cause uncertainty in a real practical but are absent (or simplified) in this virtual apparatus."
      ),
      model: LKPD_B(
        "Contoh: (1) pemanasan kawat yang membuat arus berubah (drift) selama pengukuran; (2) kawat menyentuh magnet atau penyangga sehingga ada gaya mekanis tambahan; (3) medan di celah tidak homogen dan panjang efektif $L$ sulit diukur tepat; (4) tare neraca bergeser. Alat virtual hanya meniru derau acak kecil.",
        "Example: (1) the wire heating up so the current drifts during a reading; (2) the wire touching the magnet or support, adding a mechanical force; (3) the field in the gap is not uniform and the effective $L$ is hard to measure; (4) the balance tare drifts. The virtual apparatus only imitates small random noise."
      )
    },
    LKPD_MAGNETIC_Q_CONCLUSION
  ]
};

const MAGNETIC_LKPD = {
  code: "LKPD 2",
  title: LKPD_B("Neraca Arus: Menentukan $B$ dari $F = BIL$", "Current Balance: Determining $B$ from $F = BIL$"),
  // Kunci mode = kunci varian eksperimen di js/content.js (virtual, sederhana, laboratorium)
  modes: { virtual: LKPD_MAGNETIC_VIRTUAL, sederhana: LKPD_MAGNETIC_SIMPLE, laboratorium: LKPD_MAGNETIC_LAB },
  // Rentang kewajaran B (T) untuk pengecekan hasil siswa (bukan nilai "benar" mutlak)
  plausibleB: [0.005, 1.2]
};

(function attachMagneticLkpd() {
  if (typeof TOPICS === "undefined") return;
  const topic = TOPICS.find(x => x.id === "magnetic-fields");
  if (topic && topic.eksperimen) topic.eksperimen.lkpd = MAGNETIC_LKPD;
})();
