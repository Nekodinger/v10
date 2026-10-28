/* ============================================================
   lib/sumatif.js - Tes Sumatif (V10)
   ------------------------------------------------------------
   - DEFAULT_TEST: isi bawaan = dokumen "Tes Sumatif Magnetic Fields"
     (10 pilihan ganda, 3 uraian bertingkat, 4 soal berpikir kreatif,
     skor maksimum 48). Guru bisa mengedit lalu menyimpan versinya
     sendiri; tombol "Kembalikan ke default" memuat isi ini lagi.
   - Teks memakai LaTeX di antara $...$ (dirender MathJax di browser).
   - Kunci jawaban (correct, key, explanation) TIDAK pernah dikirim ke
     siswa: lihat publicTest().
   ============================================================ */

export const DEFAULT_TEST = {
  version: 1,
  title: "Tes Sumatif Magnetic Fields",
  durationMin: 60,
  instructions: "Kerjakan semua soal secara mandiri dalam 60 menit. Tuliskan langkah perhitungan dan satuan pada soal uraian. Gunakan $g = 9{,}81\\ \\mathrm{m\\,s^{-2}}$ dan $\\mu_0 = 4\\pi \\times 10^{-7}\\ \\mathrm{T\\,m\\,A^{-1}}$. Kalkulator diperbolehkan.",
  sections: [
    {
      id: "A", title: "Bagian A. Pilihan Ganda", note: "Pilih satu jawaban yang paling tepat.",
      items: [
        { id: "A1", type: "mcq", marks: 1, stem: "Pernyataan manakah yang benar tentang garis medan magnet?",
          options: ["Garis medan dapat berpotongan di daerah yang medannya kuat.", "Di luar magnet batang, garis medan keluar dari kutub selatan menuju kutub utara.", "Makin rapat garis medan, makin besar rapat fluks magnet di daerah itu.", "Garis medan menunjukkan arah gaya pada muatan yang bergerak di dalam medan."],
          correct: 2, explanation: "Kerapatan garis menunjukkan kuat medan. Garis tidak pernah berpotongan, di luar magnet arahnya dari U ke S, dan gaya pada muatan bergerak tegak lurus garis medan." },
        { id: "A2", type: "mcq", marks: 1, stem: "Sebuah kawat lurus panjang tegak lurus bidang kertas dialiri arus yang arahnya masuk bidang kertas. Dilihat dari depan kertas, garis medan magnet di sekitar kawat berbentuk ....",
          options: ["lingkaran searah jarum jam", "lingkaran berlawanan arah jarum jam", "garis lurus menjauhi kawat", "garis lurus sejajar kawat"],
          correct: 0, explanation: "Kaidah genggaman tangan kanan: ibu jari masuk bidang kertas, jari-jari melingkar searah jarum jam." },
        { id: "A3", type: "mcq", marks: 1, stem: "Satuan tesla (T) setara dengan ....",
          options: ["$\\mathrm{N\\,A\\,m^{-1}}$", "$\\mathrm{N\\,A^{-1}\\,m^{-1}}$", "$\\mathrm{N\\,m\\,A^{-1}}$", "$\\mathrm{kg\\,A\\,s^{-2}}$"],
          correct: 1, explanation: "$B = F/(IL)$ sehingga $1\\ \\mathrm{T} = 1\\ \\mathrm{N\\,A^{-1}\\,m^{-1}}$." },
        { id: "A4", type: "mcq", marks: 1, stem: "Pada bidang kertas, sebuah kawat dialiri arus ke arah kanan. Medan magnet homogen berarah masuk bidang kertas. Arah gaya magnetik pada kawat adalah ....",
          options: ["keluar bidang kertas", "masuk bidang kertas", "ke atas (menuju tepi atas kertas)", "ke bawah (menuju tepi bawah kertas)"],
          correct: 2, explanation: "Jari tengah ke kanan (arus), telunjuk masuk bidang (medan), ibu jari ke atas (gaya). Secara vektor $\\vec F = I\\vec L \\times \\vec B$ berarah ke atas." },
        { id: "A5", type: "mcq", marks: 1, stem: "Kawat sepanjang 0,50 m dialiri arus 2,0 A dan membentuk sudut 30° terhadap medan magnet homogen 0,30 T. Besar gaya magnetik pada kawat adalah ....",
          options: ["0,075 N", "0,15 N", "0,26 N", "0,30 N"],
          correct: 1, explanation: "$F = BIL\\sin\\theta = 0{,}30 \\times 2{,}0 \\times 0{,}50 \\times \\sin 30^\\circ = 0{,}15$ N. Pilihan C muncul bila memakai $\\cos 30^\\circ$." },
        { id: "A6", type: "mcq", marks: 1, stem: "Pada neraca arus, panjang kawat di dalam medan 5,0 cm. Saat arus 2,0 A dialirkan, pembacaan neraca bertambah 2,04 g. Rapat fluks magnet di celah magnet adalah ....",
          options: ["0,020 T", "0,10 T", "0,20 T", "2,0 T"],
          correct: 2, explanation: "$F = \\Delta m\\,g = 2{,}04 \\times 10^{-3} \\times 9{,}81 = 0{,}0200$ N, sehingga $B = F/(IL) = 0{,}0200/(2{,}0 \\times 0{,}050) = 0{,}20$ T." },
        { id: "A7", type: "mcq", marks: 1, stem: "Pada neraca arus, magnet diletakkan di atas neraca dan kawat dijepit di atasnya tanpa menyentuh magnet. Saat arus dialirkan, pembacaan neraca bertambah. Penjelasan yang tepat adalah ....",
          options: ["Magnet menarik kawat sehingga massa kawat ikut terbaca oleh neraca.", "Gaya magnetik pada kawat berarah ke atas, sehingga menurut hukum III Newton magnet mendapat gaya yang sama besar ke bawah.", "Arus memanaskan magnet sehingga massa magnet bertambah.", "Medan magnet kawat menambah berat magnet secara langsung."],
          correct: 1, explanation: "Kawat ditahan klem; gaya reaksi pada magnet ke bawah sama besar dengan gaya magnetik pada kawat (hukum III Newton)." },
        { id: "A8", type: "mcq", marks: 1, stem: "Sebuah kawat lurus panjang dialiri arus 5,0 A. Rapat fluks magnet pada jarak 2,0 cm dari kawat adalah ....",
          options: ["$2{,}5 \\times 10^{-5}$ T", "$5{,}0 \\times 10^{-5}$ T", "$1{,}0 \\times 10^{-4}$ T", "$3{,}1 \\times 10^{-4}$ T"],
          correct: 1, explanation: "$B = \\dfrac{\\mu_0 I}{2\\pi r} = \\dfrac{4\\pi \\times 10^{-7} \\times 5{,}0}{2\\pi \\times 0{,}020} = 5{,}0 \\times 10^{-5}$ T. Pilihan D muncul bila lupa $2\\pi$." },
        { id: "A9", type: "mcq", marks: 1, stem: "Solenoida sepanjang 0,40 m memiliki 800 lilitan dan dialiri arus 0,50 A. Rapat fluks magnet di bagian tengah solenoida adalah ....",
          options: ["$6{,}3 \\times 10^{-4}$ T", "$1{,}3 \\times 10^{-3}$ T", "$2{,}5 \\times 10^{-3}$ T", "$5{,}0 \\times 10^{-1}$ T"],
          correct: 1, explanation: "$n = 800/0{,}40 = 2000\\ \\mathrm{m^{-1}}$, $B = \\mu_0 n I = 4\\pi \\times 10^{-7} \\times 2000 \\times 0{,}50 = 1{,}26 \\times 10^{-3}$ T." },
        { id: "A10", type: "mcq", marks: 1, stem: "Dua kawat sejajar panjang dialiri arus searah. Jika arus pada kedua kawat dijadikan dua kali semula dan jarak antarkawat juga dijadikan dua kali semula, gaya per satuan panjang di antara kedua kawat menjadi ....",
          options: ["setengah kali semula", "sama dengan semula", "dua kali semula", "empat kali semula"],
          correct: 2, explanation: "$F/L = \\mu_0 I_1 I_2/(2\\pi d)$. Pembilang menjadi 4 kali, penyebut 2 kali, sehingga gaya per satuan panjang menjadi 2 kali." }
      ]
    },
    {
      id: "B", title: "Bagian B. Uraian", note: "Tuliskan langkah perhitungan dan satuan. Kamu boleh mengetik, menulis tangan, atau menambahkan persamaan.",
      items: [
        { id: "B1", type: "structured",
          stem: "Sekelompok siswa memakai neraca arus dengan satu kawat lurus ($N = 1$). Panjang kawat di dalam medan $L = 4{,}5$ cm. Rata-rata pertambahan pembacaan neraca $\\Delta m$ untuk setiap arus $I$ ditunjukkan pada tabel.",
          table: [["$I$ (A)", "0,50", "1,00", "1,50", "2,00", "2,50"], ["$\\Delta m$ (g)", "0,46", "0,92", "1,37", "1,85", "2,30"]],
          parts: [
            { id: "a", marks: 2, text: "Jelaskan mengapa pembacaan neraca bertambah saat arus dialirkan.",
              key: "Kawat berarus di medan magnet mendapat gaya ke atas ($F = BIL$). Kawat dijepit, sehingga gaya reaksi ke bawah bekerja pada magnet (hukum III Newton) dan terbaca sebagai pertambahan massa. Skor 1 untuk gaya pada kawat, 1 untuk hukum III Newton." },
            { id: "b", marks: 2, text: "Hitung gaya magnetik $F$ pada arus 2,00 A.",
              key: "$F = \\Delta m\\,g = 1{,}85 \\times 10^{-3} \\times 9{,}81 = 1{,}81 \\times 10^{-2}$ N. Skor 1 konversi gram ke kilogram, 1 hasil dan satuan." },
            { id: "c", marks: 4, text: "Tentukan gradien grafik $F$ terhadap $I$, lalu hitung rapat fluks magnet $B$.",
              key: "Gradien dari dua titik garis yang berjauhan, misalnya (0,50 A; $4{,}51 \\times 10^{-3}$ N) dan (2,50 A; $2{,}26 \\times 10^{-2}$ N): gradien $\\approx 9{,}0 \\times 10^{-3}\\ \\mathrm{N\\,A^{-1}}$ (regresi $9{,}04 \\times 10^{-3}$). $B = \\text{gradien}/(NL) = 9{,}0 \\times 10^{-3}/0{,}045 = 0{,}20$ T (terima 0,19-0,21 T). Skor: 1 nilai $F$ dua titik, 1 gradien dan satuan, 1 rumus dengan $L$ dalam meter, 1 hasil." },
            { id: "d", marks: 2, text: "Sebutkan satu sumber galat pada percobaan ini dan cara menguranginya.",
              key: "Contoh: kawat menyentuh magnet (atur ulang agar ada celah); arus berubah karena kawat memanas (baca arus bersamaan dengan neraca, beri jeda); tare bergeser (tare ulang). Skor 1 sumber galat, 1 cara mengurangi." }
          ] },
        { id: "B2", type: "structured",
          stem: "Dua kawat lurus panjang sejajar berjarak 0,10 m. Kawat 1 dialiri arus 4,0 A dan kawat 2 dialiri arus 6,0 A dengan arah sama.",
          parts: [
            { id: "a", marks: 3, text: "Hitung besar gaya per satuan panjang di antara kedua kawat dan tentukan apakah gayanya tarik-menarik atau tolak-menolak.",
              key: "$F/L = \\dfrac{\\mu_0 I_1 I_2}{2\\pi d} = \\dfrac{4\\pi \\times 10^{-7} \\times 4{,}0 \\times 6{,}0}{2\\pi \\times 0{,}10} = 4{,}8 \\times 10^{-5}\\ \\mathrm{N\\,m^{-1}}$, tarik-menarik karena arus searah. Skor 1 rumus, 1 hasil dan satuan, 1 sifat gaya." },
            { id: "b", marks: 3, text: "Tentukan letak titik di antara kedua kawat yang rapat fluks magnet totalnya nol.",
              key: "Di antara kawat, medan kedua kawat berlawanan arah. $\\dfrac{4{,}0}{x} = \\dfrac{6{,}0}{0{,}10 - x}$ sehingga $x = 0{,}040$ m dari kawat 1. Skor 1 alasan arah, 1 persamaan, 1 hasil." }
          ] },
        { id: "B3", type: "structured",
          stem: "Sebuah solenoida sepanjang 0,20 m memiliki 400 lilitan dan dialiri arus 1,5 A.",
          parts: [
            { id: "a", marks: 2, text: "Hitung rapat fluks magnet di bagian tengah solenoida.",
              key: "$n = 400/0{,}20 = 2000\\ \\mathrm{m^{-1}}$; $B = \\mu_0 n I = 4\\pi \\times 10^{-7} \\times 2000 \\times 1{,}5 = 3{,}8 \\times 10^{-3}$ T. Skor 1 nilai $n$, 1 hasil dan satuan." },
            { id: "b", marks: 2, text: "Sebutkan dua cara berbeda untuk menjadikan rapat fluks itu dua kali lipat tanpa mengubah panjang solenoida.",
              key: "Arus dijadikan 3,0 A, atau jumlah lilitan dijadikan 800 pada panjang yang sama. Skor 1 per cara yang benar." },
            { id: "c", marks: 2, text: "Seutas kawat lurus berarus diletakkan di dalam solenoida, sejajar dengan sumbunya. Jelaskan besar gaya magnetik pada kawat itu.",
              key: "Nol, karena kawat sejajar medan ($\\theta = 0^\\circ$, $F = BIL\\sin 0^\\circ = 0$). Skor 1 jawaban nol, 1 alasan." }
          ] }
      ]
    },
    {
      id: "C", title: "Bagian C. Berpikir Kreatif", note: "Tidak ada satu jawaban tunggal. Tuliskan ide sebanyak, seberagam, seunik, dan serinci mungkin, dengan alasan fisika yang benar.",
      items: [
        { id: "C1", type: "open", marks: 4, stem: "Tuliskan sebanyak mungkin cara untuk memperbesar pembacaan $\\Delta m$ pada neraca arus tanpa mengganti neraca. Berikan alasan singkat untuk setiap cara.",
          key: "Fluency. 4: 5 cara relevan atau lebih dengan alasan benar (menaikkan $I$, kumparan $N$ lilitan, memperpanjang $L$, magnet lebih kuat, $\\theta = 90^\\circ$, yoke besi). 3: 3-4 cara. 2: 2 cara. 1: 1 cara. 0: kosong/tidak relevan." },
        { id: "C2", type: "open", marks: 4, stem: "Gaya pada penghantar berarus dan medan magnet oleh arus dimanfaatkan di banyak bidang. Tuliskan penerapan dari sebanyak mungkin bidang yang berbeda (misalnya transportasi, kesehatan, rumah tangga, industri, energi, atau penelitian), lalu jelaskan prinsipnya masing-masing.",
          key: "Flexibility. 4: 4 bidang berbeda atau lebih dengan prinsip benar (maglev/motor kendaraan listrik, MRI, kipas/mesin cuci, derek elektromagnet, generator, neraca Kibble). 3: 3 bidang. 2: 2 bidang. 1: 1 bidang. 0: kosong/tidak relevan." },
        { id: "C3", type: "open", marks: 4, stem: "Rancanglah sebuah alat sederhana yang belum pernah kamu lihat (bukan motor listrik atau pengeras suara biasa) yang memanfaatkan gaya $F = BIL$. Jelaskan fungsi, bagian-bagian, dan cara kerjanya. Boleh disertai sketsa.",
          key: "Originality. 4: ide unik di kelas (kurang dari 5% jawaban), fisika benar, cara kerja jelas. 3: ide jarang (5-10%). 2: ide umum atau modifikasi kecil. 1: menyalin alat yang ada atau fisika keliru. 0: kosong." },
        { id: "C4", type: "open", marks: 4, stem: "Nilai $B$ yang diperoleh kelompokmu berubah-ubah pada setiap pengulangan. Rancang perbaikan prosedur atau alat neraca arus secara rinci: langkah demi langkah, alat yang dipakai, dan alasan fisika setiap perbaikan.",
          key: "Elaboration. 4: minimal 4 perbaikan rinci dengan langkah, alat, dan alasan fisika. 3: 3 perbaikan rinci. 2: 1-2 perbaikan sedikit rincian. 1: perbaikan umum tanpa alasan. 0: kosong." }
      ]
    }
  ]
};

const s = (v, n) => String(v == null ? "" : v).replace(/\r/g, "").slice(0, n);
const marksOf = v => { const x = Number(v); return isFinite(x) && x >= 0 ? Math.min(50, Math.round(x * 2) / 2) : 1; };
const cleanId = (v, d) => (String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 12) || d);

// Bersihkan dokumen tes kiriman guru (batas ukuran, tipe, id unik).
export function sanitizeTest(doc) {
  const d = doc && typeof doc === "object" ? doc : {};
  const out = {
    version: 1,
    title: s(d.title, 200).trim() || DEFAULT_TEST.title,
    durationMin: Math.max(5, Math.min(240, parseInt(d.durationMin, 10) || 60)),
    instructions: s(d.instructions, 3000),
    sections: []
  };
  const seen = new Set();
  (Array.isArray(d.sections) ? d.sections : []).slice(0, 8).forEach((sec, si) => {
    const sid = cleanId(sec && sec.id, String.fromCharCode(65 + si));
    const S = { id: sid, title: s(sec && sec.title, 200), note: s(sec && sec.note, 1500), items: [] };
    (Array.isArray(sec && sec.items) ? sec.items : []).slice(0, 40).forEach((it, ii) => {
      if (!it || typeof it !== "object") return;
      const type = ["mcq", "structured", "open"].includes(it.type) ? it.type : null;
      if (!type) return;
      let id = cleanId(it.id, sid + (ii + 1));
      while (seen.has(id)) id = id + "x";
      seen.add(id);
      const I = { id, type, stem: s(it.stem, 4000) };
      if (type === "mcq") {
        const opts = (Array.isArray(it.options) ? it.options : []).slice(0, 6).map(o => s(o, 800));
        while (opts.length < 2) opts.push("");
        I.options = opts;
        const c = parseInt(it.correct, 10);
        I.correct = isNaN(c) || c < 0 || c >= opts.length ? 0 : c;
        I.marks = marksOf(it.marks == null ? 1 : it.marks);
        I.explanation = s(it.explanation, 2000);
      } else if (type === "structured") {
        if (Array.isArray(it.table) && it.table.length) {
          I.table = it.table.slice(0, 8).map(r => (Array.isArray(r) ? r : []).slice(0, 10).map(c => s(c, 200)));
        }
        const pseen = new Set();
        I.parts = (Array.isArray(it.parts) ? it.parts : []).slice(0, 10).map((p, pi) => {
          let pid = cleanId(p && p.id, String.fromCharCode(97 + pi)).toLowerCase();
          while (pseen.has(pid)) pid += "x";
          pseen.add(pid);
          return { id: pid, text: s(p && p.text, 2000), marks: marksOf(p && p.marks), key: s(p && p.key, 3000) };
        });
        if (!I.parts.length) I.parts = [{ id: "a", text: "", marks: 1, key: "" }];
      } else {
        I.marks = marksOf(it.marks == null ? 4 : it.marks);
        I.key = s(it.key, 3000);
      }
      S.items.push(I);
    });
    out.sections.push(S);
  });
  return out;
}

// Versi untuk siswa: tanpa kunci, tanpa pembahasan, tanpa rubrik.
export function publicTest(doc) {
  const d = sanitizeTest(doc);
  return {
    title: d.title, durationMin: d.durationMin, instructions: d.instructions,
    sections: d.sections.map(S => ({
      id: S.id, title: S.title, note: S.note,
      items: S.items.map(I => {
        const o = { id: I.id, type: I.type, stem: I.stem };
        if (I.type === "mcq") { o.options = I.options; o.marks = I.marks; }
        else if (I.type === "structured") { if (I.table) o.table = I.table; o.parts = I.parts.map(p => ({ id: p.id, text: p.text, marks: p.marks })); }
        else o.marks = I.marks;
        return o;
      })
    }))
  };
}

// Daftar butir yang dinilai: { key, label, max, auto, correct? }
export function scoringItems(doc) {
  const d = sanitizeTest(doc);
  const out = [];
  d.sections.forEach(S => S.items.forEach(I => {
    if (I.type === "mcq") out.push({ key: I.id, label: I.id, max: I.marks, auto: true, correct: I.correct });
    else if (I.type === "structured") I.parts.forEach(p => out.push({ key: I.id + "." + p.id, label: I.id + p.id, max: p.marks, auto: false }));
    else out.push({ key: I.id, label: I.id, max: I.marks, auto: false });
  }));
  return out;
}

export function maxScore(doc) {
  return scoringItems(doc).reduce((a, x) => a + x.max, 0);
}

// Skor otomatis pilihan ganda + skor manual guru (dibatasi 0..max).
export function computeScores(doc, answers, manual) {
  const items = scoringItems(doc);
  let auto = 0, total = 0, gradedAll = true;
  const m = manual && typeof manual === "object" ? manual : {};
  items.forEach(x => {
    if (x.auto) {
      const a = answers ? answers[x.key] : undefined;
      const v = (a !== undefined && a !== null && Number(a) === x.correct) ? x.max : 0;
      auto += v; total += v;
    } else {
      const v = Number(m[x.key]);
      if (m[x.key] === undefined || m[x.key] === null || m[x.key] === "" || !isFinite(v)) gradedAll = false;
      else total += Math.max(0, Math.min(x.max, v));
    }
  });
  return { auto, total, max: items.reduce((a, x) => a + x.max, 0), gradedAll };
}
