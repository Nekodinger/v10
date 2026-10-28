/* ============================================================
   app.js - logika utama Emergent
   ------------------------------------------------------------
   Perubahan utama dari V7:
   - Tidak ada lagi API key pengguna. Semua panggilan AI lewat server
     (/api/ai, model cepat untuk tutor, model besar untuk
     simulasi) dengan token akses yang diberikan server setelah siswa
     lolos gerbang (kode sesi kelas / kode mandiri / kode eksplorasi).
   - Backend /api/backend (Vercel + PostgreSQL Supabase) menggantikan
     Google Apps Script; semua jawaban terekam untuk Panel Guru.
   - Tab Materi memakai penampil slide; tab Eksperimen memakai LKPD.
   ============================================================ */

const STORAGE_KEY_TOKEN = "physicsSandbox.accessToken";
const STORAGE_KEY_ACCESS_KIND = "physicsSandbox.accessKind"; // class | self | explore
const STORAGE_KEY_PROGRESS = "physicsSandbox.progress";
const STORAGE_KEY_UNLOCK_ALL = "physicsSandbox.unlockAll";
const STORAGE_KEY_ROLE = "physicsSandbox.userRole"; // "student" | "guest"
const STORAGE_KEY_STUDENT_NAME = "physicsSandbox.studentName";
const STORAGE_KEY_STUDENT_CLASS = "physicsSandbox.studentClass";
// Menandai topik mana yang tabel data Eksperimen-nya SUDAH pernah disimpan
// ke spreadsheet minimal sekali (lihat wireEksperimenDataTable) - dipakai
// untuk mewajibkan siswa mengisi & menyimpan tabel dulu sebelum tombol
// "Lanjut ke Latihan Soal" boleh membuka pertanyaan konfirmasi Eksperimen.
const STORAGE_KEY_EKSDATA_SAVED = "physicsSandbox.eksperimenDataSaved";
// Varian "virtual" eksperimen (tab Eksperimen) - lihat renderVirtualLabHTML()
// dkk di bawah. Hanya B "sungguhan" (seed randomisasi apparatus virtual) yang
// disimpan lokal di sini; data hasil percobaan siswa sendiri dikirim ke
// backend seperti varian sederhana/laboratorium (lihat wireVirtualLab()).
const STORAGE_KEY_VLAB_TRUEB = "physicsSandbox.virtualLabTrueB";
let currentTopic = null;
let lastGeneratedHTML = "";
let editCount = 0;
const MAX_FOLLOWUP_EDITS = (typeof MAX_FOLLOWUP_EDITS_PER_SIM === "number") ? MAX_FOLLOWUP_EDITS_PER_SIM : 5;

/* ============================================================
   Navigasi bertahap (sesuai sintaks PjBL - Project based Learning)
   ------------------------------------------------------------
   Diganti dari sintaks Inquiry Learning ke sintaks PjBL (2026-09-19)
   karena tiap topik sekarang berjalan sebagai SATU PROYEK
   berkelanjutan yang bisa memakan 2-3 pertemuan, bukan lagi harus
   selesai dalam satu sesi duduk:
     1) Penentuan Pertanyaan Mendasar & Perencanaan  -> tab Materi
     2) Mendesain Perencanaan Proyek & Menyusun Jadwal (data)
                                                       -> tab Eksperimen
     3) Memonitor Peserta Didik & Kemajuan Proyek     -> KONFIRMASI GURU
        (checkpoint di Eksperimen & di Lab Simulasi, lihat GATE_STAGES
        di bawah)
     4) Menguji Hasil                                 -> tab Latihan Soal
        & hasil simulasi di tab Lab
     5) Mengevaluasi Pengalaman                       -> refleksi di
        tab Lab Simulasi sebelum konfirmasi akhir guru

   Kuncinya PER TOPIK, bukan antar-topik: siswa boleh mulai dari
   topik mana saja (mis. langsung ke Magnetic Fields tanpa perlu
   menyelesaikan Kinematics dulu), tapi begitu masuk ke sebuah topik
   "ready", tab di dalamnya (Materi -> Eksperimen -> Latihan Soal ->
   Lab Simulasi Virtual) tetap harus dibuka BERURUTAN. Guru bisa
   membagikan Kode Eksplorasi (env EXPLORE_CODE di server) untuk siswa yang
   perlu menjelajah bebas tanpa urutan sama sekali.

   YANG BARU (2026-09-19): pindah ke tab berikutnya sekarang perlu
   menjawab pertanyaan konfirmasi pemahaman di SETIAP tab/aktivitas,
   TAPI hanya dua checkpoint yang juga butuh persetujuan eksplisit
   dari guru (lihat GATE_STAGES): Eksperimen (sebelum Latihan Soal
   & Lab Simulasi terbuka) dan Lab Simulasi (sebelum topik ditandai
   selesai). Materi dan Latihan Soal dinilai otomatis di klien saja,
   TANPA menunggu guru. Lihat blok "Konfirmasi Pemahaman & Gate Guru"
   di bawah untuk detail implementasinya.
   ============================================================ */
const TAB_ORDER = ["materi", "eksperimen", "latihan", "lab"];
const TAB_LABELS = { materi: t("tab.materi"), eksperimen: t("tab.eksperimen"), latihan: t("tab.latihan"), lab: t("tab.lab") };
// Tahap PjBL yang ditampilkan sebagai subjudul kecil di atas tiap panel tab
// (murni label/framing, tidak memengaruhi logika gate).
const PJBL_STAGE_LABELS = {
  materi: "pjbl.stage.materi",
  eksperimen: "pjbl.stage.eksperimen",
  latihan: "pjbl.stage.latihan",
  lab: "pjbl.stage.lab"
};

function isUnlockAll() {
  return localStorage.getItem(STORAGE_KEY_UNLOCK_ALL) === "true";
}
function getProgress() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_PROGRESS) || "{}"); }
  catch (e) { return {}; }
}
function saveProgress(p) {
  localStorage.setItem(STORAGE_KEY_PROGRESS, JSON.stringify(p));
}
// Progres dari server (perangkat lain) digabung: indeks tab tidak pernah mundur.
function mergeServerProgress(serverProgress) {
  if (!serverProgress || typeof serverProgress !== "object") return false;
  const p = getProgress();
  let changed = false;
  Object.keys(serverProgress).forEach(k => {
    const v = parseInt(serverProgress[k], 10);
    if (!isNaN(v) && (p[k] === undefined || v > p[k])) { p[k] = v; changed = true; }
  });
  if (changed) saveProgress(p);
  return changed;
}
const STORAGE_KEY_ACCOUNT = "emergent.account";
// Akun siswa (dibuat guru): { studentId, name, className, groupId, groupName, leaderId, leaderName, isLeader, members }
function getAccount() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_ACCOUNT) || "null"); } catch (e) { return null; }
}
function setAccount(acc) {
  if (!acc) { localStorage.removeItem(STORAGE_KEY_ACCOUNT); return; }
  const prev = getAccount();
  localStorage.setItem(STORAGE_KEY_ACCOUNT, JSON.stringify(acc));
  localStorage.setItem(STORAGE_KEY_STUDENT_NAME, acc.name || "");
  localStorage.setItem(STORAGE_KEY_STUDENT_CLASS, acc.className || "");
  // Ketua kelompok diganti guru saat siswa sedang di Eksperimen/Makerspace
  if (prev && (prev.isLeader !== acc.isLeader || prev.groupId !== acc.groupId) && typeof enterGroupSection === "function") {
    const tab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (GROUP_TABS.includes(tab) && currentTopic) enterGroupSection(tab, true);
  }
}
function inGroup() { const a = getAccount(); return getUserRole() === "student" && !!(a && a.groupId); }
function isGroupLeader() { const a = getAccount(); return !inGroup() || !!(a && a.isLeader); }
function getAccessToken() { return localStorage.getItem(STORAGE_KEY_TOKEN) || ""; }
function getAccessKind() { return localStorage.getItem(STORAGE_KEY_ACCESS_KIND) || ""; }
function setAccess(kind, token) {
  if (token) localStorage.setItem(STORAGE_KEY_TOKEN, token);
  if (kind) localStorage.setItem(STORAGE_KEY_ACCESS_KIND, kind);
  refreshUserChip();
}
// Catat jawaban/aktivitas siswa ke server untuk Panel Guru (tidak memblokir UI).
function recordEvent(kind, item, payload, score) {
  if (getUserRole() !== "student") return; // tamu/validator tidak direkam
  apiCall("record_event", {
    studentId: getStudentId(), topicId: currentTopic ? currentTopic.id : null,
    kind, item: item || null, payload: payload === undefined ? null : payload,
    score: typeof score === "number" ? score : undefined
  }).catch(() => {});
}
function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// Acak urutan soal DAN urutan opsi (indeks jawaban benar ikut dipetakan ulang).
// Bug V7: soal konfirmasi Materi selalu muncul dalam urutan dan posisi opsi yang sama.
function shuffledQuestions(questions) {
  return shuffleArray(questions).map(q => {
    const order = shuffleArray(q.options.map((_, i) => i));
    return Object.assign({}, q, { options: order.map(i => q.options[i]), correct: order.indexOf(q.correct), _origin: q, _order: order });
  });
}
function getReadyTopicsOrder() {
  return TOPICS.filter(tp => tp.status === "ready").sort((a, b) => a.number - b.number).map(tp => tp.id);
}
// Mengembalikan index tab tertinggi (di TAB_ORDER) yang boleh dibuka untuk
// sebuah topik. Setiap topik "ready" SELALU boleh dimulai (index 0 = tab
// Materi), tidak bergantung pada progres topik lain sama sekali.
function getUnlockedTabIndex(topicId) {
  if (isUnlockAll()) return TAB_ORDER.length - 1;
  const progress = getProgress();
  return progress[topicId] !== undefined ? progress[topicId] : 0;
}
function isTabLocked(topicId, tabName) {
  const topic = TOPICS.find(tp => tp.id === topicId);
  if (!topic || topic.status !== "ready") return false;
  // Sesi kelas aktif (dari guru) membatasi TOPIK - siswa hanya boleh berada
  // di topik yang sedang dipilih guru. (Diubah 2026-09-24, lanjutan lagi
  // lagi: sebelumnya sesi kelas JUGA memaksa TAB persis sama dengan yang
  // ditentukan guru, mengalahkan progres gate individual siswa. Sekarang
  // akses TAB di dalam topik itu murni mengikuti progres gate individual
  // siswa sendiri - persis seperti di luar sesi kelas - supaya siswa yang
  // sudah lulus checkpoint-nya sendiri (mis. high achiever) bisa lanjut ke
  // tab berikutnya, bahkan ke Makerspace, tanpa menunggu guru mengubah
  // aktivitas kelas, sementara siswa yang belum lulus tetap terkunci di tab
  // yang sudah dicapainya, default-nya Materi.)
  if (isInClassSession() && topicId !== classSession.topicId) return true;
  const unlocked = getUnlockedTabIndex(topicId);
  return TAB_ORDER.indexOf(tabName) > unlocked;
}
function advanceProgress(topicId, tabIndexReached) {
  const progress = getProgress();
  const current = progress[topicId] !== undefined ? progress[topicId] : -1;
  progress[topicId] = Math.max(current, Math.min(tabIndexReached, TAB_ORDER.length - 1));
  saveProgress(progress);
  // laporkan kemajuan ke Panel Guru segera (tidak menunggu siklus sinkron berikutnya)
  if (typeof syncClassSession === "function") setTimeout(syncClassSession, 300);
}
function nextReadyTopicId(topicId) {
  const order = getReadyTopicsOrder();
  const idx = order.indexOf(topicId);
  if (idx < 0 || idx >= order.length - 1) return null;
  return order[idx + 1];
}

/* ============================================================
   Konfirmasi Pemahaman & Gate Guru (checkpoint PjBL)
   ------------------------------------------------------------
   Ditambahkan 2026-09-19 atas permintaan user: siswa cuma boleh
   pindah tab kalau bisa menjawab pertanyaan konfirmasi pemahaman
   untuk aktivitas itu. Materi & Latihan Soal dinilai OTOMATIS di
   klien saja (langsung lanjut kalau benar). Eksperimen & Lab
   Simulasi Virtual TAMBAHAN butuh persetujuan eksplisit guru lewat
   Panel Guru sebelum siswa dianggap boleh lanjut/selesai - dikirim
   ke backend (mode "gate_submit"/"gate_status") sebagai permintaan
   "pending" yang disetujui/ditolak lewat mode "teacher_gate_decide".
   Status terakhir di-cache di localStorage supaya UI tidak kosong
   sebelum polling pertama selesai / saat offline.
   ============================================================ */
const GATE_POLL_MS = 10000;
const STORAGE_KEY_GATE_CACHE = "physicsSandbox.gateCache";

let gatePollTimer = null;
let gatePollStage = null;
let gatePollTopicId = null;

function getGateCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_GATE_CACHE) || "{}"); }
  catch (e) { return {}; }
}
function setGateCacheEntry(topicId, stage, data) {
  const cache = getGateCache();
  cache[topicId] = cache[topicId] || {};
  cache[topicId][stage] = data;
  localStorage.setItem(STORAGE_KEY_GATE_CACHE, JSON.stringify(cache));
}
function getGateCacheEntry(topicId, stage) {
  const cache = getGateCache();
  return (cache[topicId] && cache[topicId][stage]) || null;
}

/* ---- Modal generik pertanyaan konfirmasi (dibuat sekali, dipakai ulang) ---- */
let confirmModalEl = null;
function ensureConfirmModal() {
  if (confirmModalEl) return confirmModalEl;
  const el = document.createElement("div");
  el.className = "modal";
  el.id = "confirm-modal";
  el.hidden = true;
  el.innerHTML = `
    <div class="modal-box">
      <div class="modal-head">
        <h3 id="confirm-modal-title"></h3>
        <button type="button" id="confirm-modal-close-btn" class="icon-btn" aria-label="Tutup">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
        </button>
      </div>
      <p class="muted small" id="confirm-modal-desc"></p>
      <div id="confirm-modal-body"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-primary" id="confirm-modal-submit-btn"></button>
      </div>
      <p class="teacher-note" id="confirm-modal-status"></p>
    </div>`;
  document.body.appendChild(el);
  el.querySelector("#confirm-modal-close-btn").addEventListener("click", () => { el.hidden = true; });
  confirmModalEl = el;
  return el;
}
function renderConfirmQuestions(questions) {
  return questions.map((q, qi) => `
    <div class="question-card" data-qidx="${qi}">
      <div class="q-title">${t("question.label", { n: qi + 1 })}</div>
      <div>${trContent(q.question)}</div>
      <div class="options-input">
        ${q.options.map((opt, oi) => `
          <label class="option-radio">
            <input type="radio" name="cq-${qi}" value="${oi}">
            ${String.fromCharCode(65 + oi)}. ${trContent(opt)}
          </label>`).join("")}
      </div>
      <p class="confirm-feedback muted small" hidden></p>
    </div>`).join("");
}
// Ambang skor minimum (dalam %) supaya siswa dianggap "lulus" konfirmasi
// pemahaman Materi - TIDAK harus benar 100% seperti gate lain (Eksperimen/
// fallback generik tetap butuh benar semua, threshold default 100 di bawah).
// Kalau skor < ambang ini, modal TIDAK menutup/lanjut - siswa diminta
// mempelajari kembali Materi Belajar dulu baru mencoba lagi (lihat
// openConfirmModal() & startMateriGate()).
const PASS_THRESHOLD_MATERI = 80;

// opts: { title, desc, questions (array|null), fallbackLabel, submitLabel,
//         passThreshold (0-100, default 100 = harus benar semua), onPass }
// questions null -> tampil sebagai satu checkbox konfirmasi generik (fallback
// untuk topik yang belum diisi soal konfirmasi terstruktur).
function openConfirmModal(opts) {
  const el = ensureConfirmModal();
  document.getElementById("confirm-modal-title").textContent = opts.title;
  document.getElementById("confirm-modal-desc").textContent = opts.desc || "";
  const body = document.getElementById("confirm-modal-body");
  const statusEl = document.getElementById("confirm-modal-status");
  statusEl.textContent = "";
  statusEl.className = "teacher-note";
  let submitBtn = document.getElementById("confirm-modal-submit-btn");
  submitBtn.textContent = opts.submitLabel || t("confirm.checkbtn");
  // Ganti tombol dengan clone supaya listener lama (dari pemanggilan
  // sebelumnya) tidak menumpuk.
  const newBtn = submitBtn.cloneNode(true);
  submitBtn.parentNode.replaceChild(newBtn, submitBtn);
  submitBtn = newBtn;

  if (opts.questions && opts.questions.length) {
    body.innerHTML = renderConfirmQuestions(opts.questions);
    const threshold = opts.passThreshold != null ? opts.passThreshold : 100;
    submitBtn.addEventListener("click", () => {
      const cards = body.querySelectorAll(".question-card");
      let answeredAll = true;
      let correctCount = 0;
      cards.forEach((card, qi) => {
        const checked = card.querySelector(`input[name="cq-${qi}"]:checked`);
        const feedback = card.querySelector(".confirm-feedback");
        const q = opts.questions[qi];
        if (!checked) {
          answeredAll = false;
          feedback.hidden = false;
          feedback.textContent = t("confirm.pickanswer");
          feedback.className = "confirm-feedback small warn";
          return;
        }
        const isRight = parseInt(checked.value, 10) === q.correct;
        if (isRight) correctCount++;
        feedback.hidden = false;
        feedback.textContent = isRight ? t("confirm.correct") : (trContent(q.explanation) || t("confirm.wrong"));
        feedback.className = "confirm-feedback small " + (isRight ? "ok" : "warn");
      });
      if (!answeredAll) {
        statusEl.className = "teacher-note";
        statusEl.textContent = t("confirm.tryagain");
        return;
      }
      const total = opts.questions.length;
      const scorePct = Math.round((correctCount / total) * 100);
      if (opts.onResult) {
        const answers = Array.from(cards).map((card, qi) => {
          const checked = card.querySelector(`input[name="cq-${qi}"]:checked`);
          const q = opts.questions[qi];
          const picked = checked ? parseInt(checked.value, 10) : null;
          return { q: trContent(q.question).replace(/<[^>]+>/g, "").slice(0, 300), picked: picked === null ? null : trContent(q.options[picked]).replace(/<[^>]+>/g, "").slice(0, 200), correct: picked === q.correct };
        });
        opts.onResult(scorePct, answers);
      }
      if (scorePct >= threshold) {
        if (opts.showScoreOnPass) showToast(t("confirm.scorepass", { score: scorePct }));
        el.hidden = true;
        opts.onPass();
      } else {
        // Skor belum cukup - modal TETAP TERBUKA (tidak lanjut), siswa harus
        // menutup, mempelajari ulang materi di atas, lalu klik Next lagi
        // untuk membuka modal ini dari awal (state soal ke-reset otomatis
        // karena body.innerHTML dirender ulang tiap openConfirmModal()).
        statusEl.className = "teacher-note gate-score-fail";
        statusEl.textContent = t("confirm.scorefail", { score: scorePct, correct: correctCount, total, min: threshold });
      }
    });
  } else {
    body.innerHTML = `<label class="option-radio"><input type="checkbox" id="confirm-generic-check"> ${opts.fallbackLabel || t("confirm.generic.label")}</label>`;
    submitBtn.addEventListener("click", () => {
      if (!document.getElementById("confirm-generic-check").checked) {
        statusEl.textContent = t("confirm.generic.needcheck");
        return;
      }
      el.hidden = true;
      opts.onPass();
    });
  }
  el.hidden = false;
}

function startMateriGate(onPass) {
  openConfirmModal({
    title: t("gate.materi.title"),
    desc: t("gate.materi.desc"),
    questions: (currentTopic.materiCheck && currentTopic.materiCheck.length) ? shuffledQuestions(currentTopic.materiCheck) : null,
    fallbackLabel: t("gate.materi.fallback"),
    passThreshold: PASS_THRESHOLD_MATERI,
    showScoreOnPass: true,
    onResult: (score, answers) => recordEvent("materi_check", "attempt", { answers }, score),
    onPass
  });
}
function startEksperimenGate() {
  openConfirmModal({
    title: t("gate.eksperimen.title"),
    desc: t("gate.eksperimen.desc"),
    questions: currentTopic.eksperimenCheck ? shuffledQuestions(currentTopic.eksperimenCheck) : null,
    fallbackLabel: t("gate.eksperimen.fallback"),
    submitLabel: t("gate.eksperimen.submitbtn"),
    onResult: (score, answers) => recordEvent("eksperimen_check", "attempt", { answers }, score),
    onPass: () => submitGateForApproval("eksperimen", t("gate.eksperimen.autosummary") + (window.LKPD && LKPD.has(currentTopic) ? " " + LKPD.summaryText(currentTopic) : ""))
  });
}
function startLabReflectionGate() {
  const input = document.getElementById("lab-reflection-input");
  const text = (input ? input.value : "").trim();
  const statusEl = document.getElementById("lab-reflection-status");
  if (text.length < 15) {
    if (statusEl) statusEl.textContent = t("gate.lab.reflection.tooShort");
    return;
  }
  submitGateForApproval("lab", text);
}

async function submitGateForApproval(stage, summary) {
  if (!currentTopic) return;
  const topicId = currentTopic.id;
  const studentId = getStudentId();
  setGateCacheEntry(topicId, stage, { status: "pending", submittedAt: Date.now() });
  renderGateBanner(stage);
  showToast(t("gate.submitted.toast"));
  try {
    const data = await apiCall("gate_submit", { topicId, studentId, stage, summary: summary || "" });
    if (data.error) showToast(data.error);
  } catch (e) { /* akan tersinkron lagi lewat polling di bawah */ }
  startGatePolling(topicId, stage);
}
function startGatePolling(topicId, stage) {
  stopGatePolling();
  gatePollTopicId = topicId;
  gatePollStage = stage;
  pollGateStatus();
  gatePollTimer = setInterval(pollGateStatus, GATE_POLL_MS);
}
function stopGatePolling() {
  if (gatePollTimer) { clearInterval(gatePollTimer); gatePollTimer = null; }
  gatePollStage = null;
  gatePollTopicId = null;
}
async function pollGateStatus() {
  if (!gatePollTopicId) return;
  const topicId = gatePollTopicId, stage = gatePollStage;
  try {
    const data = await apiCall("gate_status", { topicId, studentId: getStudentId() });
    const st = data[stage];
    if (!st || !st.status) return;
    setGateCacheEntry(topicId, stage, st);
    if (st.status !== "pending") {
      stopGatePolling();
      handleGateDecision(topicId, stage, st);
    } else if (currentTopic && currentTopic.id === topicId) {
      renderGateBanner(stage);
    }
  } catch (e) { /* jaringan sesekali gagal - coba lagi di polling berikutnya */ }
}
function handleGateDecision(topicId, stage, st) {
  if (st.status === "approved") {
    if (stage === "eksperimen") {
      // Menyetujui Eksperimen membuka Latihan Soal DAN Lab Simulasi
      // sekaligus (index 3 = tab terakhir), sesuai permintaan: guru cukup
      // konfirmasi sekali di sini, dua tab berikutnya langsung terbuka.
      if (getUnlockedTabIndex(topicId) >= 1) advanceProgress(topicId, TAB_ORDER.length - 1);
      showToast(t("gate.eksperimen.approved.toast"));
    } else {
      showToast(t("gate.lab.approved.toast"));
    }
  } else {
    showToast(stage === "eksperimen" ? t("gate.eksperimen.rejected.toast") : t("gate.lab.rejected.toast"));
  }
  if (currentTopic && currentTopic.id === topicId) {
    renderNav();
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (activeTab) updateTopicProgressUI(activeTab);
    renderGateBanner(stage);
  }
}
function gateBannerContainerId(stage) {
  return stage === "eksperimen" ? "eksperimen-gate-banner" : "lab-gate-banner";
}
function renderGateBanner(stage) {
  if (!currentTopic) return;
  const el = document.getElementById(gateBannerContainerId(stage));
  if (!el) return;
  const cached = getGateCacheEntry(currentTopic.id, stage);
  if (!cached || !cached.status) { el.innerHTML = ""; el.hidden = true; return; }
  el.hidden = false;
  if (cached.status === "pending") {
    el.className = "gate-banner gate-pending";
    el.innerHTML = `<span class="gate-banner-icon">&#9203;</span> ${t("gate.banner.pending." + stage)}`;
  } else if (cached.status === "approved") {
    el.className = "gate-banner gate-approved";
    el.innerHTML = `<span class="gate-banner-icon">&#10003;</span> ${t("gate.banner.approved." + stage)}`;
  } else if (cached.status === "rejected") {
    el.className = "gate-banner gate-rejected";
    const note = cached.note ? `<br><em>${t("gate.banner.notefromteacher")}: ${escapeAttr(cached.note)}</em>` : "";
    const retryId = stage + "-gate-retry-btn";
    const canRetry = isGroupLeader();
    el.innerHTML = `<span class="gate-banner-icon">&#10007;</span> ${t("gate.banner.rejected." + stage)}${note}` +
      (canRetry ? `<br><button type="button" class="btn btn-secondary btn-small gate-retry-btn" id="${retryId}">${t("gate.banner.retrybtn")}</button>` : "");
    const retryBtn = document.getElementById(retryId);
    if (retryBtn) retryBtn.addEventListener("click", () => {
      if (stage === "eksperimen") startEksperimenGate();
      else startLabReflectionGate();
    });
  }
  // Form refleksi Lab dinonaktifkan selagi menunggu/​sudah disetujui guru -
  // ditolak tetap bisa diedit & dikirim ulang lewat tombol retry di atas.
  if (stage === "lab") {
    const input = document.getElementById("lab-reflection-input");
    const submitBtn = document.getElementById("lab-reflection-submit-btn");
    const locked = cached.status === "pending" || cached.status === "approved";
    if (input) input.disabled = locked;
    if (submitBtn) submitBtn.hidden = locked;
  }
}
// Dipanggil sekali setiap topik dibuka (selectTopic) supaya keputusan guru
// yang terjadi SAAT siswa offline/pindah perangkat tetap tersinkron, dan
// supaya polling yang terputus (mis. reload halaman saat masih pending)
// otomatis dilanjutkan lagi.
async function checkGateOnTopicOpen(topicId) {
  try {
    const data = await apiCall("gate_status", { topicId, studentId: getStudentId() });
    ["eksperimen", "lab"].forEach(stage => {
      if (!data[stage]) return;
      const prev = getGateCacheEntry(topicId, stage);
      setGateCacheEntry(topicId, stage, data[stage]);
      // Persetujuan Eksperimen KELOMPOK tidak melewati Materi: anggota yang
      // belum lulus konfirmasi Materi-nya sendiri tetap mulai dari Materi.
      if (data[stage].status === "approved" && stage === "eksperimen" && getUnlockedTabIndex(topicId) >= 1 && (!prev || prev.status !== "approved" || getUnlockedTabIndex(topicId) < TAB_ORDER.length - 1)) {
        advanceProgress(topicId, TAB_ORDER.length - 1);
      }
      if (data[stage].status === "pending" && gatePollTopicId !== topicId) {
        startGatePolling(topicId, stage);
      }
    });
  } catch (e) { /* offline - tetap tampilkan cache lokal terakhir di bawah */ }
  if (currentTopic && currentTopic.id === topicId) {
    renderNav();
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (activeTab) updateTopicProgressUI(activeTab);
    renderGateBanner("eksperimen");
    renderGateBanner("lab");
  }
}
// Section PjBL kecil yang ditampilkan di atas tiap panel tab (framing saja,
// tidak memengaruhi logika).
function pjblStageHTML(tabName) {
  const key = PJBL_STAGE_LABELS[tabName];
  return key ? `<p class="pjbl-stage-label">${t(key)}</p>` : "";
}

/* ============================================================
   Sesi Kelas (real-time, dari Panel Guru)
   ------------------------------------------------------------
   Kalau guru sedang menjalankan sesi kelas dan siswa sudah gabung
   (memasukkan kode lewat Pengaturan), browser siswa polling
   backend tiap ~12 detik: melaporkan aktivitas mereka saat ini
   (buat panel guru) DAN mengambil aktivitas yang sedang WAJIB
   dikerjakan bareng. Selama tergabung & sesi aktif, ini
   MENGALAHKAN semua gembok lain (isTabLocked di atas sudah
   menangani ini) - topik lain juga disembunyikan/dikunci di
   renderNav supaya siswa benar-benar fokus ke satu aktivitas.
   ============================================================ */
const STORAGE_KEY_STUDENT_ID = "physicsSandbox.studentId";
const STORAGE_KEY_CLASS_CODE = "physicsSandbox.classSessionCode";
const CLASS_SYNC_INTERVAL_MS = 12000;

let classSession = null; // {active, code, topicId, tabIndex, updatedAt} dari server terakhir
let classSyncTimer = null;
let lastClassActivityKey = null; // untuk deteksi kapan guru GANTI aktivitas

function getUserRole() {
  return localStorage.getItem(STORAGE_KEY_ROLE) || "";
}
function getStudentName() {
  return (localStorage.getItem(STORAGE_KEY_STUDENT_NAME) || "").trim();
}
function getStudentClass() {
  return (localStorage.getItem(STORAGE_KEY_STUDENT_CLASS) || "").trim();
}
// Kalau siswa sudah isi nama+kelas manual (langkah wajib di gate), pakai itu
// sebagai identitas di roster Panel Guru (bukan ID anonim lagi) - supaya guru
// benar-benar tahu itu progres siapa. Fallback ID anonim tetap ada untuk
// kasus lain (mis. peran "bukan siswa" yang kebetulan ikut sebuah sesi kelas).
function getStudentId() {
  const name = getStudentName();
  if (name) {
    const cls = getStudentClass();
    return cls ? `${name} (${cls})` : name;
  }
  let id = localStorage.getItem(STORAGE_KEY_STUDENT_ID);
  if (!id) {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    id = (getUserRole() === "guest" ? "Tamu-" : "Siswa-") + suffix;
    localStorage.setItem(STORAGE_KEY_STUDENT_ID, id);
  }
  return id;
}
function getJoinedSessionCode() {
  return (localStorage.getItem(STORAGE_KEY_CLASS_CODE) || "").trim();
}
function isInClassSession() {
  return !!(classSession && classSession.active && getJoinedSessionCode() &&
    classSession.code && classSession.code.toUpperCase() === getJoinedSessionCode().toUpperCase());
}
// Bug V7: saat sesi kelas berakhir siswa dilempar kembali ke gerbang dan
// harus minta kode baru. Sekarang siswa tetap masuk (token akses masih
// berlaku) dan otomatis lanjut dalam mode belajar mandiri.
function leaveClassSession(message) {
  const wasIn = !!getJoinedSessionCode();
  localStorage.removeItem(STORAGE_KEY_CLASS_CODE);
  classSession = null;
  lastClassActivityKey = null;
  if (getAccessKind() === "class") localStorage.setItem(STORAGE_KEY_ACCESS_KIND, "self");
  renderNav();
  if (currentTopic) {
    const activeTab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (activeTab) updateTopicProgressUI(activeTab);
  }
  refreshClassSessionUI();
  updateClassSessionBanner();
  updateQuizUI(null);
  if (window.SumatifStudent) SumatifStudent.update(null);
  refreshUserChip();
  startClassSync(); // tetap kirim kehadiran & progres (mode mandiri)
  if (message && wasIn) showToast(message);
}
// Gabung ke sesi kelas dengan kode 6 huruf (dipakai Pengaturan). Memakai
// verify_access sehingga sekaligus memperbarui token akses.
async function attemptJoinClassSession(code) {
  const trimmed = (code || "").trim();
  if (!trimmed) return { ok: false, error: t("gate.student.code.needcode") };
  try {
    const data = await apiCall("verify_access", { code: trimmed, studentId: getStudentId(), progress: getProgress() });
    if (data.error) return { ok: false, error: data.error };
    if (data.kind !== "class") return { ok: false, error: t("classsession.wrongcode") };
    setAccess("class", data.token);
    localStorage.setItem(STORAGE_KEY_CLASS_CODE, data.session.code);
    classSession = data.session;
    lastClassActivityKey = null;
    mergeServerProgress(data.progress);
    startClassSync();
    refreshUserChip();
    renderNav();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: t("classsession.connectfailed", { err: err.message }) };
  }
}
function stopClassSync() {
  if (classSyncTimer) { clearInterval(classSyncTimer); classSyncTimer = null; }
}
const SELF_SYNC_INTERVAL_MS = 30000;
function startClassSync() {
  stopClassSync();
  syncClassSession();
  classSyncTimer = setInterval(syncClassSession, getJoinedSessionCode() ? CLASS_SYNC_INTERVAL_MS : SELF_SYNC_INTERVAL_MS);
}
// Satu panggilan berkala untuk semua siswa: lapor kehadiran, topik/tab, dan
// progres (Panel Guru), serta ambil status sesi kelas & kuis aktif.
async function syncClassSession() {
  if (getUserRole() !== "student") return;
  const code = getJoinedSessionCode();
  try {
    const activeTabName = document.querySelector(".tab-btn.active")?.dataset.tab;
    const data = await apiCall("session_sync", {
      code: code || null,
      studentId: getStudentId(),
      topicId: currentTopic ? currentTopic.id : null,
      tabIndex: activeTabName ? TAB_ORDER.indexOf(activeTabName) : null,
      progress: getProgress()
    });
    if (data.error) return;
    if (data.account) setAccount(data.account);
    if (mergeServerProgress(data.progress) && currentTopic) {
      renderNav();
      const tab = document.querySelector(".tab-btn.active")?.dataset.tab;
      if (tab) updateTopicProgressUI(tab);
    }
    if (!code) return;
    if (!data.inSession) {
      leaveClassSession(t("settings.classsession.left2"));
      return;
    }
    classSession = data;
    refreshUserChip();
    const activityKey = data.topicId + "|" + data.tabIndex;
    const changed = activityKey !== lastClassActivityKey;
    lastClassActivityKey = activityKey;
    renderNav();
    updateClassSessionBanner();
    updateQuizUI(data.activeQuiz);
    if (window.SumatifStudent) SumatifStudent.update(data.activeTest);
    if (currentTopic) {
      const tabName = document.querySelector(".tab-btn.active")?.dataset.tab;
      if (tabName) updateTopicProgressUI(tabName);
    }
    if (changed) goToClassSessionActivity();
  } catch (err) {
    // jaringan sesekali gagal: coba lagi di siklus berikutnya
  }
}
function goToClassSessionActivity() {
  if (!isInClassSession() || !classSession.topicId) return;
  // Yang dipaksa sesi kelas hanyalah TOPIK-nya. Tab tujuan sepenuhnya
  // mengikuti progres gate individual siswa sendiri di topik itu - bisa
  // lebih maju dari tab yang sedang disorot guru (high achiever), bisa
  // juga masih di Materi kalau memang belum lulus checkpoint-nya sendiri.
  const targetTab = TAB_ORDER[Math.min(getUnlockedTabIndex(classSession.topicId), TAB_ORDER.length - 1)] || "materi";
  if (!currentTopic || currentTopic.id !== classSession.topicId) {
    selectTopic(classSession.topicId); // aman: id di sini SAMA dengan topik yang diizinkan sesi
  }
  if (document.querySelector(".tab-btn.active")?.dataset.tab !== targetTab) {
    switchTab(targetTab);
  }
  updateClassSessionBanner();
}
function updateClassSessionBanner() {
  const banner = document.getElementById("class-session-banner");
  const textEl = document.getElementById("class-session-text");
  if (!isInClassSession() || !classSession.topicId) { banner.hidden = true; return; }
  const topic = TOPICS.find(tp => tp.id === classSession.topicId);
  // Hanya topik yang dipaksa sesi kelas sekarang, jadi banner cuma relevan
  // kalau siswa sedang berada di topik LAIN dari pilihan guru - bukan lagi
  // soal tab, supaya siswa yang sudah maju lebih jauh dari progresnya
  // sendiri (yang sah) tidak terus-terusan disodori banner "pindah ke sana".
  const onTarget = currentTopic && currentTopic.id === classSession.topicId;
  if (onTarget) { banner.hidden = true; return; }
  textEl.textContent = t("classsession.bannertext", { topic: topic ? trContent(topic.title) : "" });
  banner.hidden = false;
}
document.getElementById("class-session-go-btn").addEventListener("click", goToClassSessionActivity);

function refreshClassSessionUI() {
  const statusText = document.getElementById("class-session-status-text");
  const joinRow = document.getElementById("class-session-join-row");
  const leaveBtn = document.getElementById("class-session-leave-btn");
  if (!statusText) return;
  if (isInClassSession()) {
    statusText.textContent = t("settings.classsession.joined2", { code: classSession.code });
    statusText.classList.add("ok");
    joinRow.hidden = true;
    leaveBtn.hidden = false;
  } else {
    statusText.textContent = t("settings.classsession.notjoined");
    statusText.classList.remove("ok");
    joinRow.hidden = false;
    leaveBtn.hidden = true;
  }
}
document.getElementById("class-session-join-btn").addEventListener("click", async () => {
  const input = document.getElementById("class-session-code-input");
  const statusText = document.getElementById("class-session-status-text");
  const val = input.value.trim();
  if (!val) return;
  statusText.textContent = t("gate.student.code.connecting");
  statusText.classList.remove("ok");
  const result = await attemptJoinClassSession(val);
  if (result.ok) {
    input.value = "";
    showToast(t("settings.classsession.joined.toast"));
    goToClassSessionActivity();
  } else {
    showToast(result.error);
  }
  refreshClassSessionUI();
});
document.getElementById("class-session-leave-btn").addEventListener("click", () => {
  leaveClassSession(t("settings.classsession.left2"));
});

/* ============================================================
   Kuis dari Guru (Kuis Topik, Panel Guru) - muncul sebagai tombol
   mengambang begitu guru mempublikasikan kuis ke sesi kelas yang
   sedang diikuti siswa. Lihat format data & alur lengkap di
   apps-script/Code.gs (bagian "Kuis Topik") dan js/teacher.js.
   ============================================================ */
let activeQuizData = null; // versi publik (tanpa jawaban benar) dari server

function updateQuizUI(quiz) {
  const newId = (quiz && quiz.id) ? quiz.id : null;
  const modal = document.getElementById("quiz-modal");
  const modalWasShowingThis = !modal.hidden && activeQuizData && activeQuizData.id === newId;
  const quizDisappearedOrChanged = !modal.hidden && activeQuizData && activeQuizData.id !== newId;
  activeQuizData = newId ? quiz : null;

  const btn = document.getElementById("quiz-toggle-btn");
  if (!isInClassSession() || !activeQuizData) {
    btn.hidden = true;
  } else {
    btn.hidden = false;
    btn.classList.toggle("done", !!activeQuizData.submitted);
    document.getElementById("quiz-toggle-label").textContent = activeQuizData.submitted ? t("quiz.banner.done") : t("quiz.toggle.label");
  }
  if (quizDisappearedOrChanged) {
    closeQuizModal();
    showToast(t("quiz.ended.notice"));
  } else if (modalWasShowingThis) {
    // Kuis yang sama masih aktif - render ulang cuma kalau status "sudah
    // dijawab" berubah (mis. submit baru saja berhasil dari tab lain),
    // supaya siswa yang sedang mengetik jawaban tidak terganggu.
  }
}

function escapeHtmlQ(str) {
  return String(str == null ? "" : str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById("quiz-toggle-btn").addEventListener("click", () => {
  if (activeQuizData) openQuizModal();
});
function openQuizModal() {
  if (!activeQuizData) return;
  renderQuizModal();
  document.getElementById("quiz-modal").hidden = false;
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([document.getElementById("quiz-modal-body")]).catch(() => {});
  }
}
function closeQuizModal() {
  document.getElementById("quiz-modal").hidden = true;
}
document.getElementById("quiz-modal-close-btn").addEventListener("click", closeQuizModal);
document.getElementById("quiz-modal-close-x").addEventListener("click", closeQuizModal);

function renderQuizModal() {
  const body = document.getElementById("quiz-modal-body");
  const submitBtn = document.getElementById("quiz-modal-submit-btn");
  const statusEl = document.getElementById("quiz-modal-status");
  statusEl.textContent = "";
  const questions = activeQuizData.questions || [];
  body.innerHTML = questions.map((q, i) => {
    let inputHtml = "";
    if (q.type === "mcq") {
      inputHtml = `<ul class="options">${(q.options || []).map((opt, oi) => `
        <li><label><input type="radio" name="quiz-answer-${escapeHtmlQ(q.id)}" value="${oi}"> ${String.fromCharCode(65 + oi)}. ${escapeHtmlQ(opt)}</label></li>
      `).join("")}</ul>`;
    } else {
      const placeholder = q.type === "essay" ? t("quiz.modal.essay.placeholder") : t("quiz.modal.short.placeholder");
      inputHtml = `<textarea data-qid="${escapeHtmlQ(q.id)}" placeholder="${escapeHtmlQ(placeholder)}"></textarea>`;
    }
    return `
      <div class="quiz-modal-question">
        <div class="q-title">${t("quiz.modal.question.label", { n: i + 1 })}</div>
        <div>${escapeHtmlQ(q.question)}</div>
        ${inputHtml}
      </div>`;
  }).join("");
  submitBtn.disabled = !!activeQuizData.submitted;
  if (activeQuizData.submitted) statusEl.textContent = t("quiz.modal.submitted");
}

document.getElementById("quiz-modal-submit-btn").addEventListener("click", async () => {
  if (!activeQuizData) return;
  const statusEl = document.getElementById("quiz-modal-status");
  const submitBtn = document.getElementById("quiz-modal-submit-btn");
  const answers = {};
  (activeQuizData.questions || []).forEach(q => {
    if (q.type === "mcq") {
      const checked = document.querySelector(`input[name="quiz-answer-${CSS.escape(q.id)}"]:checked`);
      if (checked) answers[q.id] = parseInt(checked.value, 10);
    } else {
      const ta = document.querySelector(`textarea[data-qid="${CSS.escape(q.id)}"]`);
      if (ta && ta.value.trim()) answers[q.id] = ta.value.trim();
    }
  });
  submitBtn.disabled = true;
  statusEl.textContent = t("quiz.modal.submitting");
  try {
    const data = await apiCall("quiz_submit", {
      code: getJoinedSessionCode(),
      studentId: getStudentId(),
      quizId: activeQuizData.id,
      answers: answers
    });
    if (data.error) {
      statusEl.textContent = t("quiz.modal.error.generic", { err: data.error });
      submitBtn.disabled = false;
      return;
    }
    activeQuizData.submitted = true;
    statusEl.textContent = t("quiz.modal.submitted");
    const btn = document.getElementById("quiz-toggle-btn");
    btn.classList.add("done");
    document.getElementById("quiz-toggle-label").textContent = t("quiz.banner.done");
  } catch (err) {
    statusEl.textContent = t("quiz.modal.error.generic", { err: err.message });
    submitBtn.disabled = false;
  }
});

let toastTimer = null;
function showToast(message) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

/* ---------------- Identitas di header ---------------- */
// AI (Tutor Fisika, Makerspace, cek data AI) hanya saat belajar di kelas.
// Validator (kode eksplorasi) tetap bisa mencoba semuanya.
function aiAvailable() {
  const role = getUserRole();
  if (role === "guest" || getAccessKind() === "explore") return true;
  return isInClassSession();
}
function applyAiAvailability() {
  const on = aiAvailable();
  document.body.classList.toggle("ai-off", !on);
  const lab = document.getElementById("panel-lab");
  if (lab) lab.classList.toggle("ai-off", !on);
  const note = document.getElementById("lab-class-only");
  if (note) note.hidden = on;
  if (!on) {
    const panel = document.getElementById("chatbot-panel");
    if (panel) panel.hidden = true;
    if (groupSec && groupSec.lab && groupSec.lab.mode) leaveGroupSection("lab");
  } else {
    const tab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (tab === "lab" && currentTopic && groupSec && groupSec.lab && !groupSec.lab.mode) enterGroupSection("lab", true);
  }
}
function refreshUserChip() {
  try { applyAiAvailability(); } catch (e) { /* abaikan */ }
  const nameEl = document.getElementById("user-chip-name");
  const modeEl = document.getElementById("user-chip-mode");
  if (!nameEl || !modeEl) return;
  const role = getUserRole();
  nameEl.textContent = role === "student" ? (getStudentName() + (getStudentClass() ? " · " + getStudentClass() : "")) : t("header.chip.guest");
  let kind = role === "guest" ? "explore" : (isInClassSession() ? "class" : (getAccessKind() === "explore" ? "explore" : "self"));
  modeEl.className = "chip-mode " + kind;
  modeEl.textContent = kind === "class" ? t("header.chip.class", { code: classSession.code }) : t("header.chip." + kind);
  // Menu geser: avatar inisial, kelas & kelompok; label mode kecil di header
  const nm = role === "student" ? getStudentName() : t("header.chip.guest");
  nameEl.textContent = nm;
  const av = document.getElementById("user-chip-avatar");
  if (av) av.textContent = (nm || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  const sub = document.getElementById("user-chip-sub");
  if (sub) {
    const acc = (typeof getAccount === "function") ? getAccount() : null;
    sub.textContent = role === "student"
      ? [getStudentClass(), acc && acc.groupName ? acc.groupName + (acc.isLeader ? " · " + t("teacher.rec.leader") : "") : ""].filter(Boolean).join(" · ")
      : t("header.chip.explore");
  }
  const hm = document.getElementById("header-mode");
  if (hm) { hm.className = "header-mode " + kind; hm.textContent = modeEl.textContent; }
}

/* ---------------- Menu geser (burger) ---------------- */
const menuDrawer = document.getElementById("menu-drawer");
const drawerBackdrop = document.getElementById("drawer-backdrop");
const menuBtn = document.getElementById("menu-btn");
let drawerReturnFocus = null;
function openMenu() {
  drawerReturnFocus = document.activeElement;
  menuDrawer.hidden = false; drawerBackdrop.hidden = false;
  requestAnimationFrame(() => { menuDrawer.classList.add("open"); drawerBackdrop.classList.add("open"); });
  document.body.classList.add("drawer-open");
  menuBtn.setAttribute("aria-expanded", "true");
  const first = menuDrawer.querySelector(".nav-item.active") || document.getElementById("menu-close-btn");
  setTimeout(() => first && first.focus({ preventScroll: true }), 60);
}
function closeMenu() {
  if (menuDrawer.hidden) return;
  menuDrawer.classList.remove("open"); drawerBackdrop.classList.remove("open");
  document.body.classList.remove("drawer-open");
  menuBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => { if (!menuDrawer.classList.contains("open")) { menuDrawer.hidden = true; drawerBackdrop.hidden = true; } }, 260);
  if (drawerReturnFocus && drawerReturnFocus.focus) drawerReturnFocus.focus({ preventScroll: true });
}
menuBtn.addEventListener("click", () => (menuDrawer.hidden ? openMenu() : closeMenu()));
document.getElementById("menu-close-btn").addEventListener("click", closeMenu);
drawerBackdrop.addEventListener("click", closeMenu);
document.addEventListener("keydown", e => {
  if (menuDrawer.hidden) return;
  if (e.key === "Escape") { e.preventDefault(); closeMenu(); return; }
  if (e.key === "Tab") { // fokus tetap di dalam menu
    const f = [...menuDrawer.querySelectorAll("button:not([disabled]), a[href]")].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});
// Item yang membuka sesuatu menutup menu dulu supaya tidak saling menutupi
menuDrawer.addEventListener("click", e => {
  if (e.target.closest(".nav-item, #settings-btn, #user-chip, #menu-chat-btn, #menu-home-btn")) closeMenu();
});
document.getElementById("menu-home-btn").addEventListener("click", () => document.getElementById("brand-home").click());
document.getElementById("menu-chat-btn").addEventListener("click", () => {
  document.getElementById("chatbot-panel").hidden = false;
  if (window.Chatbot) Chatbot.onOpen();
});
document.getElementById("menu-logout-btn").addEventListener("click", () => {
  closeMenu();
  document.getElementById("settings-reset-onboarding-btn").click();
});
// Header transparan di atas, kaca buram tipis setelah halaman digulir
function syncHeaderScrolled() { document.getElementById("site-header").classList.toggle("scrolled", window.scrollY > 8); }
window.addEventListener("scroll", syncHeaderScrolled, { passive: true });
syncHeaderScrolled();

/* ---------------- Header height (untuk offset sticky) ---------------- */
function syncHeaderHeight() {
  const header = document.querySelector(".site-header");
  if (header) {
    document.documentElement.style.setProperty("--header-h", header.offsetHeight + "px");
  }
}
window.addEventListener("resize", syncHeaderHeight);
// Header fixed: tinggi berubah saat banner sesi kelas muncul -> konten ikut turun, tidak tertutup
if (typeof ResizeObserver === "function") new ResizeObserver(syncHeaderHeight).observe(document.querySelector(".site-header"));


/* ---------------- Navigasi Topik ---------------- */
function isTopicVisibleInNav(topic) {
  // Mode validasi ahli (lihat js/config.js, VISIBLE_TOPIC_IDS): array
  // kosong berarti tidak ada pembatasan, semua topik tampil seperti biasa.
  if (typeof VISIBLE_TOPIC_IDS === "undefined" || !VISIBLE_TOPIC_IDS.length) return true;
  return VISIBLE_TOPIC_IDS.includes(topic.id);
}

function renderNav() {
  const nav = document.getElementById("topic-nav");
  nav.innerHTML = "";
  ["AS", "A2"].forEach(level => {
    const levelTopics = TOPICS.filter(tp => tp.level === level && isTopicVisibleInNav(tp));
    if (!levelTopics.length) return; // sembunyikan header grup kalau tidak ada topik yang ditampilkan

    const groupTitle = document.createElement("div");
    groupTitle.className = "nav-group-title";
    groupTitle.textContent = level === "AS" ? t("nav.group.as") : t("nav.group.a2");
    nav.appendChild(groupTitle);

    levelTopics.forEach(topic => {
      const btn = document.createElement("button");
      const blocked = isInClassSession() && topic.id !== classSession.topicId;
      const isSessionFocus = isInClassSession() && topic.id === classSession.topicId;
      btn.className = "nav-item" + (blocked ? " session-locked" : "") + (isSessionFocus ? " session-active" : "");
      btn.dataset.id = topic.id;
      btn.innerHTML =
        `<span class="dot ${topic.status === 'ready' ? 'dot-ready' : 'dot-soon'}"></span>` +
        `<span class="num">${topic.number}.</span>` +
        `<span class="label">${trContent(topic.title)}</span>` +
        (isSessionFocus ? `<span class="session-dot" title="${t("nav.sessiondot.title")}"></span>` : "");
      btn.addEventListener("click", () => {
        selectTopic(topic.id);
        btn.blur();
      });
      nav.appendChild(btn);
    });
  });
}

function selectTopic(id) {
  if (isInClassSession() && id !== classSession.topicId) {
    showToast(t("toast.classlocked"));
    return;
  }
  currentTopic = TOPICS.find(tp => tp.id === id);
  if (!currentTopic) return;

  document.querySelectorAll(".nav-item").forEach(el => {
    el.classList.toggle("active", el.dataset.id === id);
  });
  document.getElementById("welcome-panel").hidden = true;
  document.getElementById("topic-view").hidden = false;

  // Sidebar otomatis menyempit begitu sebuah topik aktif, supaya konten
  // punya lebih banyak ruang - tetap bisa dibuka lagi lewat hover/tombol pin.
  collapseSidebar();

  document.getElementById("topic-badge").textContent =
    `${currentTopic.level === "AS" ? "AS Level" : "A Level"} · ${t("topic.syllabusno", { n: currentTopic.number })} · ${currentTopic.status === "ready" ? t("badge.ready") : t("badge.soon")}`;
  document.getElementById("topic-title").textContent = trContent(currentTopic.title);
  document.getElementById("topic-desc").textContent = trContent(currentTopic.desc);

  renderMateri();
  renderEksperimen();
  renderLatihan();
  setupLabForTopic();
  if (currentTopic.status === "ready") checkGateOnTopicOpen(currentTopic.id);

  if (window.Chatbot) Chatbot.setTopic(currentTopic.id);

  // selalu kembali ke tab pertama saat pindah topik
  switchTab("materi");
  document.getElementById("content-area").scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("welcome-start-btn").addEventListener("click", () => {
  const first = TOPICS.filter(tp => tp.status === "ready" && isTopicVisibleInNav(tp)).sort((a, b) => a.number - b.number)[0];
  if (first) selectTopic(first.id);
});
["welcome-chat-btn", "footer-chat-btn"].forEach(id => document.getElementById(id).addEventListener("click", () => {
  document.getElementById("chatbot-panel").hidden = false;
  if (window.Chatbot) Chatbot.onOpen();
}));
document.getElementById("brand-home").addEventListener("click", () => {
  document.getElementById("topic-view").hidden = true;
  document.getElementById("welcome-panel").hidden = false;
  document.querySelectorAll(".nav-item").forEach(el => el.classList.remove("active"));
  expandSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

/* ---------------- Menu topik ----------------
   V9: daftar topik pindah ke menu geser (burger), jadi tidak ada lagi
   sidebar yang bisa menutupi konten. Fungsi lama dibiarkan sebagai no-op. */
function collapseSidebar() { /* no-op */ }
function expandSidebar() { /* no-op */ }

/* ---------------- Tabs ---------------- */
// Kalau sebuah tab terkunci karena SESI KELAS aktif (guru menentukan aktivitas
// tertentu untuk semua siswa), pesan toast HARUS bilang itu secara eksplisit -
// bukan pesan generik "selesaikan tab sebelumnya dulu", yang menyiratkan siswa
// belum lulus konfirmasi pemahaman padahal sebenarnya progres individunya
// sudah benar dan sekadar dikalahkan oleh kunci ketat sesi kelas. Tanpa ini,
// siswa/guru yang lupa masih tergabung di sesi kelas lama gampang mengira ini
// bug (tab "tidak mau kebuka" padahal sudah jawab benar), padahal cukup keluar
// dari sesi kelas atau minta guru memindahkan aktivitas ke tab yang dituju.
function tabLockToastMessage(topicId) {
  // Sejak tab dalam topik yang sama tidak lagi dikunci sesi kelas (lihat
  // isTabLocked), satu-satunya alasan sesi kelas masih relevan di sini
  // adalah kalau topicId-nya sendiri bukan topik yang dipilih guru.
  if (isInClassSession() && topicId !== classSession.topicId) return t("toast.classlocked");
  return t("toast.tablocked");
}
function switchTab(tabName) {
  if (currentTopic && isTabLocked(currentTopic.id, tabName)) {
    showToast(tabLockToastMessage(currentTopic.id));
    return;
  }
  const prevTab = document.querySelector(".tab-btn.active")?.dataset.tab;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tabName));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.toggle("active", p.id === "panel-" + tabName));
  if (prevTab && prevTab !== tabName && GROUP_TABS.includes(prevTab)) leaveGroupSection(prevTab);
  if (GROUP_TABS.includes(tabName) && (tabName !== "lab" || aiAvailable())) enterGroupSection(tabName);
  if (currentTopic) {
    updateTopicProgressUI(tabName);
    renderNav(); // status gembok topik lain di sidebar bisa berubah (mis. topik ini baru selesai)
    document.querySelectorAll(".nav-item").forEach(el => el.classList.toggle("active", currentTopic && el.dataset.id === currentTopic.id));
  }
}
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (currentTopic && isTabLocked(currentTopic.id, btn.dataset.tab)) {
      showToast(tabLockToastMessage(currentTopic.id));
      return;
    }
    switchTab(btn.dataset.tab);
  });
});

/* ---------------- Progress bar bertahap ---------------- */
function updateTopicProgressUI(activeTab) {
  const bar = document.getElementById("topic-progress");
  const stepsEl = document.getElementById("progress-steps");
  const nextBtn = document.getElementById("progress-next-btn");
  const finishBtn = document.getElementById("progress-finish-btn");
  if (!currentTopic || currentTopic.status !== "ready") {
    bar.hidden = true;
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("locked"));
    return;
  }

  const unlocked = isUnlockAll() ? TAB_ORDER.length - 1 : getUnlockedTabIndex(currentTopic.id);
  const activeIdx = TAB_ORDER.indexOf(activeTab);
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("locked", isTabLocked(currentTopic.id, b.dataset.tab));
  });
  bar.hidden = false;
  stepsEl.innerHTML = TAB_ORDER.map((tab, i) => {
    let state;
    if (i === activeIdx) state = "current";
    else if (i < activeIdx) state = "done";
    else state = (i <= unlocked) ? "unlocked" : "locked";
    return `<span class="progress-step ${state}"><span class="progress-step-dot"></span>${TAB_LABELS[tab]}</span>`;
  }).join(`<span class="progress-step-line"></span>`);

  const isLastTab = activeIdx === TAB_ORDER.length - 1;
  const nextTopicId = nextReadyTopicId(currentTopic.id);
  if (isLastTab) {
    nextBtn.hidden = true;
    finishBtn.hidden = !nextTopicId || isUnlockAll();
  } else if (activeIdx <= unlocked) {
    // "<=" (bukan cuma "===") supaya Next tetap ada di tab yang sudah pernah
    // dilewati juga - perlu karena persetujuan guru di Eksperimen membuka
    // Latihan+Lab SEKALIGUS (unlocked "melompat" 2 tab), jadi begitu siswa
    // ada di tab Latihan, tab itu sendiri sudah "di belakang" unlocked tapi
    // tetap harus punya tombol Next ke Lab.
    finishBtn.hidden = true;
    // Selama permintaan konfirmasi Eksperimen masih "pending" di guru,
    // sembunyikan tombol Next - siswa tinggal menunggu (lihat gate-banner)
    // sampai disetujui/ditolak, tidak perlu (dan tidak boleh) submit ulang.
    const eksGate = activeTab === "eksperimen" ? getGateCacheEntry(currentTopic.id, "eksperimen") : null;
    if (eksGate && eksGate.status === "pending") {
      nextBtn.hidden = true;
    } else {
      nextBtn.hidden = false;
      document.getElementById("progress-next-label").textContent = TAB_LABELS[TAB_ORDER[activeIdx + 1]];
    }
  } else {
    nextBtn.hidden = true;
    finishBtn.hidden = true;
  }
}
document.getElementById("progress-next-btn").addEventListener("click", () => {
  if (!currentTopic) return;
  const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
  const activeIdx = TAB_ORDER.indexOf(activeTab);
  const unlocked = isUnlockAll() ? TAB_ORDER.length - 1 : getUnlockedTabIndex(currentTopic.id);
  // Kalau tab ini sudah PERNAH dilewati sebelumnya (mis. Eksperimen yang
  // sudah disetujui guru - yang otomatis membuka Latihan+Lab sekaligus
  // sehingga unlocked "melompat" duluan - atau Materi yang dibuka ulang),
  // tidak perlu tanya ulang pertanyaan konfirmasinya, langsung next saja.
  const alreadyPassed = activeIdx < unlocked;

  // Materi: siswa harus jawab benar pertanyaan konfirmasi dulu (dinilai
  // otomatis di klien) baru boleh lanjut ke Eksperimen - tanpa guru.
  if (activeTab === "materi" && !alreadyPassed) {
    startMateriGate(() => {
      advanceProgress(currentTopic.id, activeIdx + 1);
      // Eksperimen kelompok sudah disetujui guru sebelumnya -> langsung buka Latihan & Makerspace juga
      const eg = getGateCacheEntry(currentTopic.id, "eksperimen");
      if (eg && eg.status === "approved") advanceProgress(currentTopic.id, TAB_ORDER.length - 1);
      switchTab(TAB_ORDER[activeIdx + 1]);
    });
    return;
  }
  // Eksperimen: jawab pertanyaan hubungan antar variabel & pengelolaan data
  // dulu (dinilai otomatis), lalu dikirim ke guru untuk konfirmasi. Progress
  // BELUM maju di sini - baru maju lewat handleGateDecision() begitu guru
  // menyetujui (yang otomatis membuka Latihan Soal + Lab sekaligus).
  if (activeTab === "eksperimen" && !alreadyPassed && inGroup() && !isGroupLeader()) {
    showToast(t("group.member.eksnext", { leader: (getAccount() || {}).leaderName || "-" }));
    checkGateOnTopicOpen(currentTopic.id);
    return;
  }
  if (activeTab === "eksperimen" && !alreadyPassed) {
    // Kalau topik ini punya tabel data interaktif, siswa WAJIB mengisi &
    // menyimpannya minimal sekali dulu sebelum pertanyaan konfirmasi
    // Eksperimen boleh dibuka - lihat wireEksperimenDataTable(). Topik dengan
    // 3 varian pilihan (lihat currentTopic.eksperimen.variants) juga wajib -
    // menyimpan SALAH SATU varian saja sudah cukup (lihat setEksperimenDataSavedFlag,
    // yang per-topik, bukan per-varian).
    const needsData = currentTopic.eksperimen && (currentTopic.eksperimen.dataTable || currentTopic.eksperimen.variants);
    if (needsData && !getEksperimenDataSavedFlag(currentTopic.id)) {
      showToast(t("toast.eksdata.required"));
      return;
    }
    startEksperimenGate();
    return;
  }
  // Latihan Soal -> Lab Simulasi (langsung next tanpa pertanyaan konfirmasi
  // maupun persetujuan guru, sesuai permintaan user), atau tab manapun yang
  // sudah pernah dilewati sebelumnya: next langsung.
  advanceProgress(currentTopic.id, activeIdx + 1);
  switchTab(TAB_ORDER[activeIdx + 1]);
});
document.getElementById("progress-finish-btn").addEventListener("click", () => {
  const nextId = currentTopic ? nextReadyTopicId(currentTopic.id) : null;
  if (nextId) selectTopic(nextId);
});

/* ---------------- Panel: Materi ---------------- */
// Materi V9: penampil slide (js/slides.js + js/materi-slides.js) bila topik
// punya deck; materi teks lama tetap tersedia di bagian "Versi teks".
let slidesReportedMax = 0;
function renderMateri() {
  const panel = document.getElementById("panel-materi");
  const deck = (window.MATERI_DECKS || {})[currentTopic.id];
  if (currentTopic.status === "ready" && deck && window.SlideViewer) {
    panel.innerHTML = pjblStageHTML("materi") + `<div id="materi-slides"></div>` +
      (currentTopic.materiHTML ? `<details class="materi-text-version"><summary>${t("materi.text.summary")} <span class="muted">${t("materi.text.hint")}</span></summary><div class="prose">${trContent(currentTopic.materiHTML)}</div></details>` : "");
    slidesReportedMax = 0;
    SlideViewer.mount(document.getElementById("materi-slides"), deck, {
      topicId: currentTopic.id,
      onProgress: (p) => {
        if (p.seen > slidesReportedMax) { slidesReportedMax = p.seen; recordEvent("slides_progress", "seen", p, Math.round(p.seen / p.total * 100)); }
      },
      onEnd: () => showToast(t("materi.deck.end"))
    });
    const details = panel.querySelector(".materi-text-version");
    if (details) details.addEventListener("toggle", () => { if (details.open && window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([details]).catch(() => {}); }, { once: true });
    return;
  }
  if (currentTopic.status === "ready" && currentTopic.materiHTML) {
    panel.innerHTML = pjblStageHTML("materi") + `<div class="prose">${trContent(currentTopic.materiHTML)}</div>`;
  } else {
    panel.innerHTML = comingSoonHTML("materi");
  }
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([panel]);
  }
}

/* ---------------- Panel: Eksperimen ---------------- */
// Sebagian topik (mis. Magnetic Fields) punya 3 PILIHAN eksperimen sekaligus
// (Virtual/Sederhana/Laboratorium - lihat currentTopic.eksperimen.variants di
// js/content.js) supaya sekolah bisa memilih sesuai alat yang tersedia,
// ditampilkan lewat sub-tab pilihan (pill switcher). Topik lain (Kinematics,
// Temperature, Ideal Gases, Thermodynamics) TIDAK punya .variants sama sekali
// dan tetap memakai jalur lama (satu eksperimen langsung) TANPA PERUBAHAN.
let currentEksVariantKey = null;

function renderEksperimen() {
  const panel = document.getElementById("panel-eksperimen");
  if (currentTopic.status === "ready" && currentTopic.eksperimen) {
    const ex = currentTopic.eksperimen;
    if (ex.variants) {
      currentEksVariantKey = getSavedEksVariant(ex);
      panel.innerHTML = pjblStageHTML("eksperimen") +
        `<div id="eksperimen-gate-banner" class="gate-banner" hidden></div>` +
        renderEksVariantSwitcherHTML(ex) +
        `<div id="eks-variant-content"></div>`;
      renderGateBanner("eksperimen");
      wireEksVariantSwitcher(ex);
      renderEksVariantContent(ex, currentEksVariantKey);
    } else {
      panel.innerHTML = pjblStageHTML("eksperimen") +
        `<div id="eksperimen-gate-banner" class="gate-banner" hidden></div>` +
        `<h3>${trContent(ex.title)}</h3>${trContent(ex.intro)}` +
        (ex.simHTML ? `<div class="sim-embed"><iframe sandbox="allow-scripts" srcdoc="${escapeAttr(ex.simHTML)}"></iframe></div>` : "") +
        (ex.dataTable ? renderEksperimenDataTableHTML(ex.dataTable) : "");
      renderGateBanner("eksperimen");
      if (ex.dataTable) wireEksperimenDataTable(ex.dataTable);
    }
  } else {
    panel.innerHTML = comingSoonHTML("eksperimen");
  }
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([panel]);
  }
}

// Sub-tab pilihan (pill switcher) untuk memilih varian eksperimen. Hanya
// SATU varian yang pernah ada di DOM sekaligus (isi #eks-variant-content
// diganti total tiap klik pill), jadi elemen di dalamnya (tabel data,
// tombol simpan, dst.) aman memakai ID yang sama persis di ketiga varian
// tanpa tabrakan.
const STORAGE_KEY_EKS_VARIANT = "physicsSandbox.eksVariant";
function renderEksVariantSwitcherHTML(ex) {
  const btns = ex.variantOrder.map((key, i) =>
    `<button type="button" class="eks-variant-btn" data-variant="${key}"><span class="v-num">${t("eksvariant.option", { n: i + 1 })}</span><span class="v-name">${t("eksvariant." + key + ".label")}</span><span class="v-desc">${t("eksvariant." + key + ".desc")}</span></button>`
  ).join("");
  return `<div class="eks-variant-switcher" role="tablist">${btns}</div>`;
}
function getSavedEksVariant(ex) {
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE_KEY_EKS_VARIANT) || "{}");
    if (m[currentTopic.id] && ex.variants[m[currentTopic.id]]) return m[currentTopic.id];
  } catch (e) { /* abaikan */ }
  return ex.defaultVariant || ex.variantOrder[0];
}
function saveEksVariant(key) {
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE_KEY_EKS_VARIANT) || "{}");
    m[currentTopic.id] = key;
    localStorage.setItem(STORAGE_KEY_EKS_VARIANT, JSON.stringify(m));
  } catch (e) { /* abaikan */ }
}

function wireEksVariantSwitcher(ex) {
  const panel = document.getElementById("panel-eksperimen");
  const switcher = panel.querySelector(".eks-variant-switcher");
  if (!switcher) return;
  const buttons = Array.from(switcher.querySelectorAll(".eks-variant-btn"));
  const setActive = (key) => buttons.forEach(b => b.classList.toggle("active", b.dataset.variant === key));
  setActive(currentEksVariantKey);
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.variant;
      if (key === currentEksVariantKey) return;
      if (groupSec.eksperimen.mode === "member" || groupSec.eksperimen.mode === "blocked") { showToast(t("group.member.readonly")); return; }
      if (window.LKPD) LKPD.flush();
      currentEksVariantKey = key;
      saveEksVariant(key);
      setActive(key);
      renderEksVariantContent(ex, key);
      const content = document.getElementById("eks-variant-content");
      if (window.MathJax && window.MathJax.typesetPromise && content) {
        window.MathJax.typesetPromise([content]);
      }
    });
  });
}

// Render konten satu varian terpilih: varian interaktif (virtual, ditandai
// variant.interactive === true) memakai UI kaya (tabel+grafik+self-check
// dari renderVirtualLabHTML/wireVirtualLab); varian lain (sederhana,
// laboratorium) memakai tabel input manual biasa seperti jalur lama.
function renderEksVariantContent(ex, key) {
  const container = document.getElementById("eks-variant-content");
  if (!container) return;
  const variant = ex.variants[key];
  if (!variant) return;
  if (window.LKPD && ex.lkpd && ex.lkpd.modes[key]) {
    LKPD.render(container, currentTopic, key);
    return;
  }
  if (variant.interactive) {
    container.innerHTML = renderVirtualLabHTML(variant);
    wireVirtualLab(currentTopic, variant);
  } else {
    container.innerHTML = `<h3>${trContent(variant.title)}</h3>${trContent(variant.intro)}` +
      (variant.dataTable ? renderEksperimenDataTableHTML(variant.dataTable) : "");
    if (variant.dataTable) wireEksperimenDataTable(variant.dataTable);
  }
}

/* ---------------- Tabel Data Eksperimen (interaktif) ---------------- */
// Ditambahkan supaya siswa mengisi data pengamatan LANGSUNG di browser
// (bukan lagi di kertas terpisah seperti tabel contoh statis di atas).
// Klik "Simpan Data" mem-POST ke backend (mode "eksperimen_data_save"):
// data ditulis ke spreadsheet bersama (satu sheet per siswa) DAN, kalau
// AI di server memeriksa kewajaran datanya dan memberi
// umpan balik singkat - baik status simpan maupun umpan balik ditampilkan
// lokal tepat di bawah tombol (bukan ke #generate-status yang jauh),
// mengikuti pola status-lokal yang sudah dipakai "Edit Simulasi Ini" di
// tab Lab supaya pesannya tidak pernah terlewat siswa.
function renderEksperimenDataTableHTML(dt) {
  const rowsHTML = dt.independentValues.map((iVal, ri) => {
    const repCells = Array.from({ length: dt.replicateCount }, (_, ci) =>
      `<td><input type="number" step="any" class="eks-dt-input" data-row="${ri}" data-col="${ci}" aria-label="${dt.replicateLabel} #${ci + 1}"></td>`
    ).join("");
    return `<tr data-row="${ri}" data-i="${iVal}">` +
      `<td class="eks-dt-i">${String(iVal).replace(".", ",")}</td>` +
      repCells +
      `<td class="eks-dt-avg" data-row="${ri}">-</td>` +
      `<td class="eks-dt-f" data-row="${ri}">-</td>` +
      `</tr>`;
  }).join("");
  const repHeaders = Array.from({ length: dt.replicateCount }, (_, ci) =>
    `<th>${dt.replicateLabel}<sub>${ci + 1}</sub></th>`
  ).join("");
  return `
    <div class="eks-datatable-section">
      <h4>${t("eksdata.title")}</h4>
      <p class="muted">${t("eksdata.desc")}</p>
      <table class="eks-datatable">
        <thead><tr><th>${dt.independentLabel}</th>${repHeaders}<th>${dt.replicateLabel} ${t("eksdata.mean")}</th><th>${dt.derivedLabel}</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      <button type="button" id="eks-dt-save-btn" class="btn btn-primary btn-small">${t("eksdata.savebtn")}</button>
      <p id="eks-dt-status" class="eks-dt-status"></p>
    </div>`;
}
function recalcEksperimenRow(tr, replicateCount) {
  const row = tr.dataset.row;
  const inputs = tr.querySelectorAll(".eks-dt-input");
  const nums = Array.from(inputs).map(i => parseFloat(i.value)).filter(n => !isNaN(n));
  const avgCell = tr.querySelector(".eks-dt-avg");
  const fCell = tr.querySelector(".eks-dt-f");
  if (nums.length) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const F = (avg / 1000) * 9.81;
    avgCell.textContent = avg.toFixed(3);
    fCell.textContent = F.toFixed(4);
  } else {
    avgCell.textContent = "-";
    fCell.textContent = "-";
  }
}
function wireEksperimenDataTable(dt) {
  const panel = document.getElementById("panel-eksperimen");
  const table = panel.querySelector(".eks-datatable");
  const saveBtn = document.getElementById("eks-dt-save-btn");
  const statusEl = document.getElementById("eks-dt-status");
  if (!table || !saveBtn) return;

  table.addEventListener("input", (e) => {
    if (!e.target.classList.contains("eks-dt-input")) return;
    recalcEksperimenRow(e.target.closest("tr"), dt.replicateCount);
  });

  saveBtn.addEventListener("click", async () => {
    const rows = Array.from(table.querySelectorAll("tbody tr")).map(tr => {
      const values = Array.from(tr.querySelectorAll(".eks-dt-input")).map(i => i.value.trim());
      return { I: parseFloat(tr.dataset.i), values };
    });
    const filledRows = rows.filter(r => r.values.some(v => v !== ""));
    if (!filledRows.length) {
      statusEl.className = "eks-dt-status eks-dt-status-warn";
      statusEl.textContent = t("eksdata.empty");
      return;
    }
    saveBtn.disabled = true;
    statusEl.className = "eks-dt-status";
    statusEl.textContent = t("eksdata.saving");
    try {
      const data = await apiCall("eksperimen_data_save", {
        topicId: currentTopic.id,
        studentId: getStudentId(),
        variant: currentEksVariantKey || "default",
        context: dt.context,
        meta: { independentLabel: dt.independentLabel, replicateLabel: dt.replicateLabel, derivedLabel: dt.derivedLabel, replicateCount: dt.replicateCount, derivedFactor: 9.81 / 1000 },
        rows: rows.map(r => ({ I: r.I, values: r.values.map(v => v === "" ? null : parseFloat(v)) }))
      });
      if (data.error) {
        statusEl.className = "eks-dt-status eks-dt-status-warn";
        statusEl.textContent = data.error;
      } else {
        setEksperimenDataSavedFlag(currentTopic.id, true);
        statusEl.className = "eks-dt-status " + (data.flagged ? "eks-dt-status-warn" : "eks-dt-status-ok");
        statusEl.textContent = t("eksdata.saved") + " " + (data.feedback || "");
      }
    } catch (e) {
      statusEl.className = "eks-dt-status eks-dt-status-warn";
      statusEl.textContent = t("eksdata.networkerror");
    }
    saveBtn.disabled = false;
  });
}
function getEksperimenDataSavedFlag(topicId) {
  try {
    const map = JSON.parse(localStorage.getItem(STORAGE_KEY_EKSDATA_SAVED) || "{}");
    return !!map[topicId];
  } catch (e) { return false; }
}
function setEksperimenDataSavedFlag(topicId, val) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(STORAGE_KEY_EKSDATA_SAVED) || "{}"); } catch (e) { /* abaikan */ }
  map[topicId] = val;
  localStorage.setItem(STORAGE_KEY_EKSDATA_SAVED, JSON.stringify(map));
}

/* ---------------- Panel: Latihan Soal ---------------- */
function renderLatihan() {
  const panel = document.getElementById("panel-latihan");
  if (currentTopic.status === "ready" && currentTopic.latihan && currentTopic.latihan.length) {
    panel.innerHTML = pjblStageHTML("latihan") + currentTopic.latihan.map((q, i) => {
      if (q.type === "mcq") {
        const optionsHTML = `<ul class="options latihan-options" data-q="${i}">${q.options.map((opt, oi) =>
          `<li data-o="${oi}"><label><input type="radio" name="lat-q${i}" value="${oi}"> ${String.fromCharCode(65 + oi)}. ${trContent(opt)}</label></li>`
        ).join("")}</ul>`;
        return `
          <div class="question-card">
            <div class="q-title">${t("question.label", { n: i + 1 })}</div>
            <div>${trContent(q.question)}</div>
            ${optionsHTML}
            <button type="button" class="reveal-btn" data-latihan-check="${i}">${t("latihan.checkbtn")}</button>
            <p class="confirm-feedback small latihan-fb" data-fb="${i}" hidden></p>
            <div class="solution" data-sol="${i}"><strong>${t("question.solution")}</strong><br>${trContent(q.solution)}</div>
          </div>`;
      }
      return `
        <div class="question-card">
          <div class="q-title">${t("question.label", { n: i + 1 })}</div>
          <div>${trContent(q.question)}</div>
          <button type="button" class="reveal-btn" data-latihan-reveal="${i}">${t("question.reveal")}</button>
          <div class="solution"><strong>${t("question.solution")}</strong><br>${trContent(q.solution)}</div>
        </div>`;
    }).join("");
    wireLatihanChecks(panel, currentTopic.latihan);
  } else {
    panel.innerHTML = comingSoonHTML("latihan");
  }
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([panel]);
  }
}

// Soal pilihan ganda: tandai benar/salah + tampilkan pembahasan HANYA
// setelah siswa memilih jawaban dan menekan "Cek Jawaban" (sebelumnya
// tanda "(jawaban benar)" ikut tercetak di render awal, jadi siswa bisa
// membaca kunci jawaban tanpa mencoba dulu - lihat catatan debug repo).
function wireLatihanChecks(panel, latihan) {
  panel.querySelectorAll("[data-latihan-reveal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const sol = btn.nextElementSibling;
      sol.classList.toggle("show");
      if (sol.classList.contains("show")) recordEvent("latihan", "q" + (parseInt(btn.dataset.latihanReveal, 10) + 1), { revealed: true });
    });
  });
  panel.querySelectorAll("[data-latihan-check]").forEach(btn => {
    const idx = parseInt(btn.dataset.latihanCheck, 10);
    const q = latihan[idx];
    btn.addEventListener("click", () => {
      const card = btn.closest(".question-card");
      const fb = card.querySelector(`.latihan-fb[data-fb="${idx}"]`);
      const sol = card.querySelector(`.solution[data-sol="${idx}"]`);
      const picked = card.querySelector(`input[name="lat-q${idx}"]:checked`);
      if (!picked) {
        fb.hidden = false;
        fb.className = "confirm-feedback small warn latihan-fb";
        fb.textContent = t("latihan.pickfirst");
        return;
      }
      const pv = parseInt(picked.value, 10);
      const ok = pv === q.correct;
      card.querySelectorAll(".latihan-options li").forEach((li, oi) => {
        li.classList.remove("opt-correct", "opt-wrong");
        const old = li.querySelector(".opt-correct-tag");
        if (old) old.remove();
        if (oi === q.correct) {
          li.classList.add("opt-correct");
          (li.querySelector("label") || li).insertAdjacentHTML("beforeend", ` <span class="muted opt-correct-tag">${t("answer.correct")}</span>`);
        } else if (oi === pv) {
          li.classList.add("opt-wrong");
        }
      });
      fb.hidden = false;
      fb.className = "confirm-feedback small " + (ok ? "ok" : "warn") + " latihan-fb";
      fb.textContent = ok ? t("latihan.correct") : t("latihan.wrong", { letter: String.fromCharCode(65 + q.correct) });
      recordEvent("latihan", "q" + (idx + 1), { picked: String.fromCharCode(65 + pv), correct: ok }, ok ? 100 : 0);
      sol.classList.add("show");
      if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([card]).catch(() => {});
    });
  });
}

function comingSoonHTML(section) {
  return `<p class="muted">${t("content.comingsoon", { section: t("content.section." + section) })}</p>`;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/* ---------------- Panel: Lab Simulasi Virtual ---------------- */
function setupLabForTopic() {
  const select = document.getElementById("pf-concept");
  const concepts = (currentTopic.labConcepts && currentTopic.labConcepts.length)
    ? currentTopic.labConcepts : DEFAULT_LAB_CONCEPTS;
  select.innerHTML = concepts.map(c => {
    const label = trContent(c);
    return `<option value="${escapeAttr(label)}">${label}</option>`;
  }).join("");

  // Reset SELURUH form generator prompt setiap ganti topik - termasuk
  // variabel/tujuan/instruksi tambahan yang diketik manual - supaya teks
  // dari topik/konsep sebelumnya tidak pernah tercampur/ketinggalan dan
  // secara diam-diam mengubah hasil generate topik yang baru dipilih.
  document.getElementById("pf-variables").value = "";
  document.getElementById("pf-goal").value = "";
  document.getElementById("pf-extra").value = "";
  document.getElementById("pf-vistype").selectedIndex = 0;
  document.getElementById("pf-level").selectedIndex = 1;
  document.getElementById("final-prompt").value = "";
  document.getElementById("pf-build-status").textContent = "";

  // Lembar rumus topik ditampilkan di samping generator (dulu hanya
  // ditempelkan diam-diam ke prompt tersembunyi, siswa tidak pernah
  // melihatnya) - supaya siswa mengacu ke konsep yang tepat SEBELUM
  // menulis prompt, bukan menebak dari ingatan yang mungkin keliru.
  const formulaBox = document.getElementById("lab-formula-ref-box");
  const formulaContent = document.getElementById("lab-formula-ref-content");
  if (currentTopic.formulaSheet) {
    formulaBox.hidden = false;
    formulaContent.innerHTML = trContent(currentTopic.formulaSheet);
    if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([formulaContent]).catch(() => {});
  } else {
    formulaBox.hidden = true;
    formulaContent.innerHTML = "";
  }
  document.getElementById("preview-frame").removeAttribute("srcdoc");
  document.getElementById("preview-frame").hidden = false;
  document.getElementById("code-editor").value = "";
  document.getElementById("code-editor").hidden = true;
  document.getElementById("toggle-code-label").textContent = t("lab.togglecode.view");
  document.getElementById("generate-status").textContent = "";
  document.getElementById("mode-banner").hidden = true;
  ["rerun-btn", "toggle-code-btn", "download-btn"].forEach(id => document.getElementById(id).disabled = true);
  document.getElementById("lab-edit-followup").hidden = true;
  document.getElementById("edit-followup-input").value = "";
  document.getElementById("edit-followup-status").textContent = "";
  resetEditCount();
  resetGenUI();

  // Refleksi/validasi Lab (checkpoint kedua guru) - hanya relevan untuk
  // topik "ready" yang memang punya alur progres bertahap; topik "segera
  // hadir" belum punya penilaian bertahap jadi bagian ini disembunyikan.
  const isReady = currentTopic.status === "ready";
  const reflectionSection = document.getElementById("lab-reflection-section");
  const reflectionInput = document.getElementById("lab-reflection-input");
  const reflectionStatus = document.getElementById("lab-reflection-status");
  if (reflectionSection) reflectionSection.hidden = !isReady;
  if (reflectionInput) { reflectionInput.value = ""; reflectionInput.disabled = false; }
  if (reflectionStatus) reflectionStatus.textContent = "";
  const reflectionSubmitBtn = document.getElementById("lab-reflection-submit-btn");
  if (reflectionSubmitBtn) reflectionSubmitBtn.hidden = false;
  if (isReady) {
    renderGateBanner("lab");
  } else {
    const banner = document.getElementById("lab-gate-banner");
    if (banner) { banner.hidden = true; banner.innerHTML = ""; }
  }

}

/* ---------------- Praktikum Virtual (varian "virtual" tab Eksperimen) ----------------
   Salah satu dari 3 varian pilihan eksperimen (lihat currentTopic.eksperimen.variants
   di js/content.js) - opsi bagi sekolah yang belum punya alat sederhana maupun alat
   lab untuk praktikum terkait. Arus & pembacaan neraca disimulasikan dengan JS biasa
   di klien; data hasil percobaan (bukan simulasinya sendiri) dikirim ke backend lewat
   mode eksperimen_data_save yang sama seperti varian sederhana/laboratorium, supaya
   guru bisa memantau ketiga varian secara konsisten. */

// B "sungguhan" alat virtual dirandom SEKALI per siswa per topik, lalu
// disimpan supaya tidak berubah-ubah tiap kali siswa buka ulang topiknya
// (persis seperti satu set magnet Magnadur sungguhan yang nilainya tetap).
function getVirtualLabTrueB(topic) {
  let map = {};
  try { map = JSON.parse(localStorage.getItem(STORAGE_KEY_VLAB_TRUEB) || "{}"); } catch (e) { /* abaikan */ }
  if (typeof map[topic.id] === "number" && !isNaN(map[topic.id])) return map[topic.id];
  const { bTrueMin, bTrueMax } = topic.eksperimen.variants.virtual.apparatus;
  const b = bTrueMin + Math.random() * (bTrueMax - bTrueMin);
  map[topic.id] = b;
  localStorage.setItem(STORAGE_KEY_VLAB_TRUEB, JSON.stringify(map));
  return b;
}

// Simulasi pembacaan neraca (gram): F = B x I x L sungguhan, ditambah noise
// multiplikatif+aditif kecil supaya tiap pembacaan sedikit berbeda-beda
// (meniru fluktuasi neraca elektronik sungguhan), lalu dibulatkan ke 0,01 g
// mengikuti ketelitian neraca timbang elektronik pada eksperimen nyata.
function computeVirtualReadingGrams(topic, I) {
  const { lengthM, noiseFrac, noiseAbsG } = topic.eksperimen.variants.virtual.apparatus;
  const B = getVirtualLabTrueB(topic);
  const trueF = B * I * lengthM;
  const trueGrams = (trueF / 9.81) * 1000;
  const noisy = trueGrams * (1 + (Math.random() - 0.5) * 2 * noiseFrac) + (Math.random() - 0.5) * 2 * noiseAbsG;
  return Math.max(0, noisy);
}

// Skema alat virtual (statis, tidak bergantung topik/bahasa) - kawat berarus
// dari catu daya+amperemeter di kiri, melewati celah sepasang magnet Magnadur
// pada yoke besi lunak, magnet bertumpu di atas neraca timbang elektronik di
// kanan. Digambar sebagai SVG inline (bukan gambar statis) supaya bisa
// dianimasikan lewat CSS (arus mengalir di kawat) dan JS (jarum amperemeter +
// angka neraca) - lihat updateVlabAmmeter()/animateBalanceReading() di bawah.
// Urutan elemen SENGAJA wire dulu baru magnet supaya blok magnet menutupi
// kawat di bagian yang "masuk" ke dalam magnet, hanya terlihat di celahnya.
function renderVlabApparatusSVG() {
  return `
    <svg class="vlab-diagram" viewBox="0 0 415 240" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeAttr(t("vlab.diagram.alt"))}">
      <!-- Kawat sirkuit netral: catu daya -> amperemeter -> klem kiri, dan
           klem kanan -> kembali ke catu daya. Digambar dulu supaya nanti
           tertutup badan amperemeter & kotak catu daya di ujung-ujungnya. -->
      <g class="vlab-part" data-part="leads"><path class="vlab-wire-flow" d="M26,178 L26,105 L41,105 M89,105 L125,105 M340,105 L365,105 L365,150 L66,150 L66,178"
        fill="none" stroke="var(--muted)" stroke-width="2.5" stroke-linejoin="round"/></g>

      <!-- Kawat uji (dijepit crocodile clip di kedua ujung, melewati celah
           magnet) - digambar SEBELUM magnet supaya bagian yang "masuk" ke
           dalam blok magnet otomatis tertutup, hanya terlihat di celahnya. -->
      <g class="vlab-part" data-part="wire"><path class="vlab-wire-flow" d="M125,105 L340,105" fill="none" stroke="#cc3333" stroke-width="3.5" stroke-linecap="round"/></g>

      <g class="vlab-part" data-part="magnets">
      <!-- Magnet Magnadur (N kiri, S kanan) di atas yoke besi lunak -->
      <rect x="188" y="83" width="26" height="45" rx="3" fill="#b23b3b"/>
      <text x="201" y="109" font-size="10" fill="#ffffff" text-anchor="middle" font-weight="700">N</text>
      <rect x="250" y="83" width="26" height="45" rx="3" fill="#3b6bb2"/>
      <text x="263" y="109" font-size="10" fill="#ffffff" text-anchor="middle" font-weight="700">S</text>
      <rect x="178" y="128" width="108" height="8" fill="var(--muted)"/>

      </g>

      <g class="vlab-part" data-part="balance">
      <!-- Neraca timbang elektronik (top-pan balance) berbentuk piringan bundar -->
      <ellipse cx="232" cy="136" rx="88" ry="9" fill="var(--panel)" stroke="var(--border)" stroke-width="1.3"/>
      <rect x="157" y="142" width="150" height="55" rx="8" fill="var(--panel-light)" stroke="var(--border)" stroke-width="1.5"/>
      <rect x="197" y="157" width="66" height="26" rx="3" fill="#0d1f16"/>
      <text id="vlab-balance-display" x="230" y="175" font-family="'Courier New', monospace" font-size="14" fill="#3ee879" text-anchor="middle">0,00 g</text>
      <text x="232" y="212" font-size="8.5" fill="var(--muted)" text-anchor="middle">${t("vlab.diagram.balance")}</text>

      </g>

      <g class="vlab-part" data-part="wire">
      <!-- Klem (clamp) kiri berdiri di meja, memegang kawat lewat crocodile clip -->
      <line x1="125" y1="105" x2="125" y2="175" stroke="var(--muted)" stroke-width="3" stroke-linecap="round"/>
      <rect x="117" y="175" width="16" height="6" rx="2" fill="var(--muted)"/>
      <path d="M117,98 L125,105 L117,112" stroke="var(--text)" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M133,98 L125,105 L133,112" stroke="var(--text)" stroke-width="2" fill="none" stroke-linecap="round"/>
      <text x="125" y="76" font-size="6.5" fill="var(--muted)" text-anchor="middle">${t("vlab.diagram.crocclip")}</text>
      <text x="125" y="193" font-size="6.5" fill="var(--muted)" text-anchor="middle">${t("vlab.diagram.clamp")}</text>

      <!-- Klem kanan (simetris) -->
      <line x1="340" y1="105" x2="340" y2="175" stroke="var(--muted)" stroke-width="3" stroke-linecap="round"/>
      <rect x="332" y="175" width="16" height="6" rx="2" fill="var(--muted)"/>
      <path d="M332,98 L340,105 L332,112" stroke="var(--text)" stroke-width="2" fill="none" stroke-linecap="round"/>
      <path d="M348,98 L340,105 L348,112" stroke="var(--text)" stroke-width="2" fill="none" stroke-linecap="round"/>

      </g>

      <g class="vlab-part" data-part="ammeter">
      <!-- Amperemeter -->
      <circle cx="65" cy="105" r="24" fill="var(--panel)" stroke="var(--border)" stroke-width="2"/>
      <line x1="65" y1="89" x2="65" y2="84" stroke="var(--muted)" stroke-width="1.5"/>
      <line x1="44.2" y1="96.2" x2="40.7" y2="91.3" stroke="var(--muted)" stroke-width="1.5"/>
      <line x1="85.8" y1="96.2" x2="89.3" y2="91.3" stroke="var(--muted)" stroke-width="1.5"/>
      <line x1="37" y1="113" x2="32" y2="114.5" stroke="var(--muted)" stroke-width="1.5"/>
      <line x1="93" y1="113" x2="98" y2="114.5" stroke="var(--muted)" stroke-width="1.5"/>
      <line id="vlab-ammeter-needle" class="vlab-ammeter-needle" x1="65" y1="105" x2="65" y2="84" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/>
      <circle cx="65" cy="105" r="3" fill="var(--text)"/>
      <text x="65" y="96" font-size="8" fill="var(--muted)" text-anchor="middle">A</text>

      </g>

      <g class="vlab-part" data-part="supply">
      <!-- Catu daya (variable supply) dengan terminal +/- -->
      <rect x="12" y="178" width="68" height="40" rx="5" fill="var(--panel-light)" stroke="var(--border)" stroke-width="1.5"/>
      <line x1="20" y1="208" x2="64" y2="186" stroke="var(--accent)" stroke-width="1.8"/>
      <polygon points="64,186 57,187 61,192" fill="var(--accent)"/>
      <circle cx="26" cy="178" r="3.5" fill="var(--panel)" stroke="var(--muted)" stroke-width="1.5"/>
      <text x="26" y="171" font-size="9" fill="var(--text)" text-anchor="middle">+</text>
      <circle cx="66" cy="178" r="3.5" fill="var(--panel)" stroke="var(--muted)" stroke-width="1.5"/>
      <text x="66" y="171" font-size="9" fill="var(--text)" text-anchor="middle">-</text>
      <text x="46" y="231" font-size="8.5" fill="var(--muted)" text-anchor="middle">${t("vlab.diagram.supply")}</text>

      </g>

      <!-- Inset "plan view": posisi kutub magnet dilihat dari atas + arah medan -->
      <rect x="320" y="8" width="86" height="62" rx="6" fill="var(--panel-light)" stroke="var(--border)" stroke-width="1.3"/>
      <rect x="330" y="16" width="66" height="18" fill="#3b6bb2"/>
      <text x="363" y="28.5" font-size="10" fill="#ffffff" text-anchor="middle" font-weight="700">S</text>
      <rect x="330" y="40" width="66" height="18" fill="#b23b3b"/>
      <text x="363" y="52.5" font-size="10" fill="#ffffff" text-anchor="middle" font-weight="700">N</text>
      <line x1="326" y1="37" x2="400" y2="37" stroke="#cc3333" stroke-width="2"/>
      <polygon points="400,33 407,37 400,41" fill="#cc3333"/>
      <text x="363" y="80" font-size="7.5" fill="var(--muted)" text-anchor="middle">${t("vlab.diagram.planview")}</text>
    </svg>
  `;
}

// Jarum amperemeter mengikuti nilai arus yang dipilih siswa di dropdown -
// dipetakan linear dari rentang nilai arus yang ada di dataTable topik ini
// ke sudut -60..+60 derajat (0 derajat = jarum tegak lurus ke atas).
function updateVlabAmmeter(vl, I) {
  const needle = document.getElementById("vlab-ammeter-needle");
  if (!needle) return;
  const vals = vl.dataTable.independentValues;
  const minI = Math.min(...vals);
  const maxI = Math.max(...vals);
  const frac = maxI > minI ? (I - minI) / (maxI - minI) : 0.5;
  const angle = -60 + frac * 120;
  needle.style.transform = "rotate(" + angle.toFixed(1) + "deg)";
}

// Animasi angka neraca digital menghitung naik dari 0 ke nilai pembacaan
// (bukan langsung muncul angka jadi) supaya terasa seperti benar-benar
// menunggu alat "mengukur", meniru pengalaman membaca neraca elektronik
// sungguhan yang angkanya bergerak sebelum stabil.
function animateBalanceReading(targetGrams, onDone) {
  const disp = document.getElementById("vlab-balance-display");
  if (!disp || typeof requestAnimationFrame !== "function") {
    if (disp) disp.textContent = targetGrams.toFixed(2) + " g";
    onDone();
    return;
  }
  const duration = 550;
  const startTime = performance.now();
  function step(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const val = targetGrams * p;
    disp.textContent = val.toFixed(2) + " g";
    if (p < 1) {
      requestAnimationFrame(step);
    } else {
      disp.textContent = targetGrams.toFixed(2) + " g";
      onDone();
    }
  }
  requestAnimationFrame(step);
}

function renderVirtualLabHTML(vl) {
  const dt = vl.dataTable;
  const rowsHTML = dt.independentValues.map((iVal, ri) => {
    const repCells = Array.from({ length: dt.replicateCount }, (_, ci) =>
      `<td><input type="number" step="any" class="eks-dt-input vlab-dt-input" data-row="${ri}" data-col="${ci}" readonly aria-label="${dt.replicateLabel} #${ci + 1}"></td>`
    ).join("");
    return `<tr data-row="${ri}" data-i="${iVal}">` +
      `<td class="eks-dt-i">${String(iVal).replace(".", ",")}</td>` +
      repCells +
      `<td class="eks-dt-avg" data-row="${ri}">-</td>` +
      `<td class="eks-dt-f" data-row="${ri}">-</td>` +
      `</tr>`;
  }).join("");
  const repHeaders = Array.from({ length: dt.replicateCount }, (_, ci) =>
    `<th>${dt.replicateLabel}<sub>${ci + 1}</sub></th>`
  ).join("");
  const currentOptionsHTML = dt.independentValues.map(v =>
    `<option value="${v}">${String(v).replace(".", ",")} A</option>`
  ).join("");

  return `
    <h3>${trContent(vl.title)}</h3>
    ${trContent(vl.intro)}

    <div class="vlab-apparatus" id="vlab-apparatus-box">
      <div class="vlab-diagram-wrap">
        ${renderVlabApparatusSVG()}
      </div>
      <p><strong>${t("vlab.apparatus.length")}:</strong> $L$ = ${vl.apparatus.lengthM.toFixed(4)} m
        (${(vl.apparatus.lengthM * 100).toFixed(2)} cm)</p>
      <label>${t("vlab.current.label")}
        <select id="vlab-current-select">${currentOptionsHTML}</select>
      </label>
      <button type="button" id="vlab-read-btn" class="btn btn-secondary btn-small">${t("vlab.readbtn")}</button>
      <p id="vlab-reading-status"></p>
    </div>

    <div class="eks-datatable-section">
      <h4>${t("eksdata.title")}</h4>
      <table class="eks-datatable" id="vlab-datatable">
        <thead><tr><th>${dt.independentLabel}</th>${repHeaders}<th>${dt.replicateLabel} ${t("eksdata.mean")}</th><th>${dt.derivedLabel}</th></tr></thead>
        <tbody>${rowsHTML}</tbody>
      </table>
      <svg id="vlab-graph" class="vlab-graph" viewBox="0 0 320 220" preserveAspectRatio="xMidYMid meet"></svg>
      <div id="vlab-2pt-readout" class="vlab-2pt-readout"></div>
    </div>

    <div class="prompt-form">
      <label>${t("vlab.hypothesis.label")}
        <textarea id="vlab-hypothesis" rows="2" placeholder="${escapeAttr(t("vlab.hypothesis.placeholder"))}"></textarea>
      </label>

      <div class="vlab-calc-row">
        <label>${t("vlab.gradient.label")}
          <input type="text" id="vlab-gradient-input" inputmode="decimal">
        </label>
        <label>${t("vlab.bvalue.label")}
          <input type="text" id="vlab-b-input" inputmode="decimal">
        </label>
      </div>
      <button type="button" id="vlab-check-btn" class="btn btn-secondary btn-small">${t("vlab.checkbtn")}</button>
      <p id="vlab-check-status" class="muted small"></p>

      <label>${t("vlab.conclusion.label")}
        <textarea id="vlab-conclusion" rows="2"></textarea>
      </label>
    </div>

    <button type="button" id="vlab-save-btn" class="btn btn-primary btn-small">${t("vlab.savebtn")}</button>
    <p id="vlab-save-status" class="eks-dt-status"></p>
  `;
}

function recalcVlabRow(tr) {
  const inputs = tr.querySelectorAll(".vlab-dt-input");
  const nums = Array.from(inputs).map(i => parseFloat(i.value)).filter(n => !isNaN(n));
  const avgCell = tr.querySelector(".eks-dt-avg");
  const fCell = tr.querySelector(".eks-dt-f");
  if (nums.length) {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    const F = (avg / 1000) * 9.81;
    avgCell.textContent = avg.toFixed(3);
    fCell.textContent = F.toFixed(4);
  } else {
    avgCell.textContent = "-";
    fCell.textContent = "-";
  }
  drawVlabGraph();
}

// Regresi linear sederhana (least squares) atas titik data tabel - satu
// sumber kebenaran dipakai baik untuk menggambar garis terbaik di grafik
// maupun untuk memeriksa jawaban gradien/B yang dihitung siswa sendiri.
function vlabFit(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((a, r) => a + r.I, 0);
  const sumY = points.reduce((a, r) => a + r.F, 0);
  const sumXY = points.reduce((a, r) => a + r.I * r.F, 0);
  const sumX2 = points.reduce((a, r) => a + r.I * r.I, 0);
  const denom = n * sumX2 - sumX * sumX;
  if (Math.abs(denom) < 1e-12) return null;
  const m = (n * sumXY - sumX * sumY) / denom;
  const c = (sumY - m * sumX) / n;
  return { m, c };
}
function vlabGraphGeom(points) {
  const W = 320, H = 220, padL = 38, padB = 30, padT = 12, padR = 14;
  const maxI = Math.max(...points.map(p => p.I), 0) * 1.15 || 1;
  const maxF = Math.max(...points.map(p => p.F), 0) * 1.25 || 0.01;
  const xScale = (I) => padL + (I / maxI) * (W - padL - padR);
  const yScale = (F) => (H - padB) - (F / maxF) * (H - padB - padT);
  const xInv = (px) => ((px - padL) / (W - padL - padR)) * maxI;
  return { W, H, padL, padB, padT, padR, maxI, maxF, xScale, yScale, xInv };
}

// Dua titik yang bisa digeser siswa SEPANJANG garis terbaik ("alat bantu
// menggambar/membaca garis") - direset tiap topik baru dipilih (lihat
// wireVirtualLab) supaya tidak membawa posisi dari topik sebelumnya.
let vlabLinePts = null;

function drawVlabGraph() {
  const svg = document.getElementById("vlab-graph");
  const table = document.getElementById("vlab-datatable");
  const readout = document.getElementById("vlab-2pt-readout");
  if (!svg || !table) return;
  const rows = Array.from(table.querySelectorAll("tbody tr"));
  const points = rows.map(tr => {
    const I = parseFloat(tr.dataset.i);
    const F = parseFloat(tr.querySelector(".eks-dt-f").textContent);
    return isNaN(F) ? null : { I, F };
  }).filter(Boolean);

  const geom = vlabGraphGeom(points);
  const { W, H, padL, padB, padT, padR, xScale, yScale } = geom;
  let html = `<line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" stroke="var(--border)" stroke-width="1.5"/>` +
    `<line x1="${padL}" y1="${H - padB}" x2="${padL}" y2="${padT}" stroke="var(--border)" stroke-width="1.5"/>` +
    `<text x="${(W + padL - padR) / 2}" y="${H - 8}" font-size="10" fill="var(--muted)" text-anchor="middle">${t("vlab.graph.axis.i")}</text>` +
    `<text x="6" y="${padT + 4}" font-size="10" fill="var(--muted)">${t("vlab.graph.axis.f")}</text>`;

  const fit = points.length >= 2 ? vlabFit(points) : null;
  if (fit) {
    const dataIs = points.map(p => p.I);
    const dataMin = Math.min(...dataIs), dataMax = Math.max(...dataIs);
    if (!vlabLinePts || vlabLinePts.i1 === undefined || vlabLinePts.i2 === undefined ||
      vlabLinePts.i1 < dataMin || vlabLinePts.i1 > dataMax || vlabLinePts.i2 < dataMin || vlabLinePts.i2 > dataMax) {
      vlabLinePts = { i1: dataMin + 0.15 * (dataMax - dataMin), i2: dataMin + 0.85 * (dataMax - dataMin) };
    }
    html += `<line class="vlab-fitline" x1="${xScale(0).toFixed(1)}" y1="${yScale(fit.c).toFixed(1)}" x2="${xScale(geom.maxI).toFixed(1)}" y2="${yScale(fit.m * geom.maxI + fit.c).toFixed(1)}"/>`;
  }
  html += points.map(p =>
    `<circle cx="${xScale(p.I).toFixed(1)}" cy="${yScale(p.F).toFixed(1)}" r="4" fill="var(--accent)"/>`
  ).join("");

  if (fit) {
    const f1 = fit.m * vlabLinePts.i1 + fit.c, f2 = fit.m * vlabLinePts.i2 + fit.c;
    const x1s = xScale(vlabLinePts.i1), y1s = yScale(f1), x2s = xScale(vlabLinePts.i2), y2s = yScale(f2);
    html += `<line class="vlab-tri" x1="${x1s.toFixed(1)}" y1="${y1s.toFixed(1)}" x2="${x2s.toFixed(1)}" y2="${y1s.toFixed(1)}"/>` +
      `<line class="vlab-tri" x1="${x2s.toFixed(1)}" y1="${y1s.toFixed(1)}" x2="${x2s.toFixed(1)}" y2="${y2s.toFixed(1)}"/>` +
      `<circle class="vlab-pt-drag" data-pt="1" cx="${x1s.toFixed(1)}" cy="${y1s.toFixed(1)}" r="6"/>` +
      `<circle class="vlab-pt-drag" data-pt="2" cx="${x2s.toFixed(1)}" cy="${y2s.toFixed(1)}" r="6"/>`;
  }

  svg.innerHTML = html;
  vlabWireGraphDrag(svg);
  vlabUpdateReadout(readout, fit);
}

// Pesan di bawah grafik yang membaca I/F dari kedua titik yang bisa digeser
// siswa, dan menghitung gradiennya - supaya siswa mengisi 2c dari GRAFIK
// (baca dua titik pada garis), bukan menebak dari tabel atau rumus.
function vlabUpdateReadout(readout, fit) {
  if (!readout) return;
  if (!fit || !vlabLinePts) {
    readout.innerHTML = `<p class="muted small">${t("vlab.graph.needline")}</p>`;
    return;
  }
  const f1 = fit.m * vlabLinePts.i1 + fit.c, f2 = fit.m * vlabLinePts.i2 + fit.c;
  const grad = (f2 - f1) / (vlabLinePts.i2 - vlabLinePts.i1);
  readout.innerHTML = `<p class="muted small">${t("vlab.graph.2pt.desc")}</p>` +
    `<p class="small">${t("vlab.graph.2pt.points", { i1: vlabLinePts.i1.toFixed(3), f1: f1.toFixed(4), i2: vlabLinePts.i2.toFixed(3), f2: f2.toFixed(4) })}</p>` +
    `<p class="small"><strong>${t("vlab.graph.2pt.grad", { val: grad.toFixed(4) })}</strong></p>`;
  if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([readout]).catch(() => {});
}

// Drag horizontal-saja (F dihitung dari persamaan garis terbaik pada posisi
// I yang dipilih) - listener pindah/lepas dipasang di window (bukan di
// elemen titik yang ikut diganti tiap redraw svg.innerHTML) supaya drag
// tidak putus di tengah jalan saat drawVlabGraph() menggambar ulang.
function vlabWireGraphDrag(svg) {
  if (svg._vlabDragWired) return;
  svg._vlabDragWired = true;
  svg.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".vlab-pt-drag");
    if (!handle) return;
    e.preventDefault();
    const ptKey = handle.dataset.pt === "1" ? "i1" : "i2";
    const table = document.getElementById("vlab-datatable");
    if (!table) return;
    const points = Array.from(table.querySelectorAll("tbody tr")).map(tr => {
      const I = parseFloat(tr.dataset.i);
      const F = parseFloat(tr.querySelector(".eks-dt-f").textContent);
      return isNaN(F) ? null : { I, F };
    }).filter(Boolean);
    if (points.length < 2) return;
    const dataIs = points.map(p => p.I);
    const dataMin = Math.min(...dataIs), dataMax = Math.max(...dataIs);
    const geom = vlabGraphGeom(points);
    function move(ev) {
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (geom.W / rect.width);
      let I = geom.xInv(px);
      I = Math.max(dataMin, Math.min(dataMax, I));
      vlabLinePts = vlabLinePts || {};
      vlabLinePts[ptKey] = I;
      drawVlabGraph();
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function wireVirtualLab(topic, vl) {
  vlabLinePts = null;
  const card = document.getElementById("eks-variant-content");
  if (!card) return;
  const table = card.querySelector("#vlab-datatable");
  const select = card.querySelector("#vlab-current-select");
  const readBtn = card.querySelector("#vlab-read-btn");
  const readingStatus = card.querySelector("#vlab-reading-status");
  const checkBtn = card.querySelector("#vlab-check-btn");
  const checkStatus = card.querySelector("#vlab-check-status");
  const saveBtn = card.querySelector("#vlab-save-btn");
  const saveStatus = card.querySelector("#vlab-save-status");
  const hypInput = card.querySelector("#vlab-hypothesis");
  const gradInput = card.querySelector("#vlab-gradient-input");
  const bInput = card.querySelector("#vlab-b-input");
  const conclInput = card.querySelector("#vlab-conclusion");

  // Jarum amperemeter langsung mengikuti pilihan arus (bahkan sebelum tombol
  // Baca Neraca diklik) supaya terasa seperti alat sungguhan yang menyala -
  // diset sekali di awal render, lalu tiap kali dropdown arus diganti.
  const apparatusBox = card.querySelector("#vlab-apparatus-box");
  updateVlabAmmeter(vl, parseFloat(select.value));
  select.addEventListener("change", () => updateVlabAmmeter(vl, parseFloat(select.value)));

  readBtn.addEventListener("click", () => {
    const I = parseFloat(select.value);
    const tr = Array.from(table.querySelectorAll("tbody tr"))
      .find(row => Math.abs(parseFloat(row.dataset.i) - I) < 1e-9);
    if (!tr) return;
    const inputs = Array.from(tr.querySelectorAll(".vlab-dt-input"));
    const emptyInput = inputs.find(i => i.value.trim() === "");
    if (!emptyInput) {
      readingStatus.textContent = t("vlab.rowfull");
      return;
    }
    const grams = computeVirtualReadingGrams(topic, I);
    readBtn.disabled = true;
    readingStatus.textContent = "";
    if (apparatusBox) apparatusBox.classList.add("vlab-reading-active");
    animateBalanceReading(grams, () => {
      emptyInput.value = grams.toFixed(2);
      readingStatus.textContent = t("vlab.reading.result", { grams: grams.toFixed(2) });
      recalcVlabRow(tr);
      readBtn.disabled = false;
      if (apparatusBox) apparatusBox.classList.remove("vlab-reading-active");
    });
  });

  table.addEventListener("input", (e) => {
    if (!e.target.classList.contains("vlab-dt-input")) return;
    recalcVlabRow(e.target.closest("tr"));
  });

  checkBtn.addEventListener("click", () => {
    const rows = Array.from(table.querySelectorAll("tbody tr")).map(tr => {
      const I = parseFloat(tr.dataset.i);
      const F = parseFloat(tr.querySelector(".eks-dt-f").textContent);
      return isNaN(F) ? null : { I, F };
    }).filter(Boolean);
    if (rows.length < 3) {
      checkStatus.className = "muted small";
      checkStatus.textContent = t("vlab.checkneeddata");
      return;
    }
    const gradVal = parseFloat(String(gradInput.value).replace(",", "."));
    const bVal = parseFloat(String(bInput.value).replace(",", "."));
    if (isNaN(gradVal) || isNaN(bVal)) {
      checkStatus.className = "muted small";
      checkStatus.textContent = t("vlab.checkneedvalue");
      return;
    }
    const fit = vlabFit(rows);
    const gradient = fit ? fit.m : 0;
    const B = vl.apparatus.lengthM ? gradient / vl.apparatus.lengthM : 0;
    const tolPct = 15;
    const gradOk = gradient !== 0 && Math.abs(gradVal - gradient) / Math.abs(gradient) * 100 <= tolPct;
    const bOk = B !== 0 && Math.abs(bVal - B) / Math.abs(B) * 100 <= tolPct;
    const ok = gradOk && bOk;
    checkStatus.className = "small " + (ok ? "eks-dt-status-ok" : "eks-dt-status-warn");
    checkStatus.innerHTML = ok ? t("vlab.checkresult.correct.noval") : t(bVal > B ? "vlab.checkresult.toohigh" : "vlab.checkresult.toolow");
    if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([checkStatus]).catch(() => {});
  });

  // Sejak restrukturisasi 3-varian, data varian virtual TIDAK lagi hanya
  // disimpan lokal di browser - ikut dikirim ke backend lewat mode
  // eksperimen_data_save yang sama seperti varian sederhana/laboratorium
  // (persis meniru wireEksperimenDataTable), supaya guru bisa memantau
  // ketiga varian secara konsisten. Validasi tambahan khusus varian ini:
  // kolom hipotesis wajib diisi (di luar validasi tabel data yang umum).
  saveBtn.addEventListener("click", async () => {
    const rows = Array.from(table.querySelectorAll("tbody tr")).map(tr => ({
      I: parseFloat(tr.dataset.i),
      values: Array.from(tr.querySelectorAll(".vlab-dt-input")).map(i => i.value.trim())
    }));
    const filledRows = rows.filter(r => r.values.some(v => v !== ""));
    if (!filledRows.length) {
      saveStatus.className = "eks-dt-status eks-dt-status-warn";
      saveStatus.textContent = t("eksdata.empty");
      return;
    }
    if (!hypInput.value.trim()) {
      saveStatus.className = "eks-dt-status eks-dt-status-warn";
      saveStatus.textContent = t("vlab.empty");
      return;
    }
    saveBtn.disabled = true;
    saveStatus.className = "eks-dt-status";
    saveStatus.textContent = t("eksdata.saving");
    try {
      const data = await apiCall("eksperimen_data_save", {
        topicId: currentTopic.id,
        studentId: getStudentId(),
        variant: "virtual",
        context: vl.dataTable.context,
        rows: rows.map(r => ({ I: r.I, values: r.values.map(v => v === "" ? null : parseFloat(v)) })),
        analysis: { hypothesis: hypInput.value.trim(), gradient: gradInput.value.trim(), B: bInput.value.trim(), conclusion: conclInput.value.trim() }
      });
      if (data.error) {
        saveStatus.className = "eks-dt-status eks-dt-status-warn";
        saveStatus.textContent = data.error;
      } else {
        setEksperimenDataSavedFlag(currentTopic.id, true);
        saveStatus.className = "eks-dt-status " + (data.flagged ? "eks-dt-status-warn" : "eks-dt-status-ok");
        saveStatus.textContent = t("eksdata.saved") + " " + (data.feedback || "");
      }
    } catch (e) {
      saveStatus.className = "eks-dt-status eks-dt-status-warn";
      saveStatus.textContent = t("eksdata.networkerror");
    }
    saveBtn.disabled = false;
  });

  drawVlabGraph();
}

function resetEditCount() {
  editCount = 0;
  updateEditCounterUI();
}
function updateEditCounterUI() {
  const counter = document.getElementById("edit-followup-counter");
  const btn = document.getElementById("edit-followup-btn");
  const input = document.getElementById("edit-followup-input");
  const remaining = MAX_FOLLOWUP_EDITS - editCount;
  if (remaining > 0) {
    counter.textContent = t("lab.editfollowup.remaining", { n: remaining, max: MAX_FOLLOWUP_EDITS });
  } else {
    counter.textContent = t("lab.editfollowup.limitreached", { max: MAX_FOLLOWUP_EDITS });
  }
  btn.disabled = remaining <= 0;
  input.disabled = remaining <= 0;
}

// Ganti konsep fisika spesifik juga membersihkan variabel/tujuan/instruksi
// tambahan - field-field itu biasanya ditulis khusus untuk satu konsep, jadi
// membiarkannya menempel ke konsep lain gampang bikin prompt akhir jadi
// campur aduk (mis. tujuan pembelajaran tentang gerak melingkar tertinggal
// padahal konsep yang dipilih sekarang GLBB atau jatuh bebas).
document.getElementById("pf-concept").addEventListener("change", () => {
  document.getElementById("pf-variables").value = "";
  document.getElementById("pf-goal").value = "";
  document.getElementById("pf-extra").value = "";
});

document.getElementById("pf-build-btn").addEventListener("click", () => {
  const concept = document.getElementById("pf-concept").value;
  const vistype = document.getElementById("pf-vistype").value;
  const variables = document.getElementById("pf-variables").value.trim();
  const goal = document.getElementById("pf-goal").value.trim();
  const level = document.getElementById("pf-level").value;
  const extra = document.getElementById("pf-extra").value.trim();
  const buildStatus = document.getElementById("pf-build-status");

  // Pemahaman yang kabur -> prompt yang kabur -> hasil yang membingungkan.
  // Guardrail ringan: wajib jelaskan tujuan pembelajaran dengan kalimat
  // (bukan cuma satu-dua kata) sebelum prompt disusun, supaya siswa
  // benar-benar merumuskan pemahamannya dulu, bukan asal klik Generate.
  if (goal.length < 10) {
    buildStatus.className = "small eks-dt-status-warn";
    buildStatus.textContent = t("lab.needgoal");
    return;
  }
  buildStatus.textContent = "";

  const topicTitle = trContent(currentTopic.title);
  let prompt = t("promptgen.header", { topic: topicTitle, concept: concept });
  prompt += t("promptgen.langdirective");
  prompt += t("promptgen.mainfocus", { concept: concept });
  prompt += t("promptgen.vistype", { vistype: vistype });
  if (variables) {
    prompt += t("promptgen.variables", { variables: variables });
  }
  if (goal) {
    prompt += t("promptgen.goal", { concept: concept, goal: goal });
  }
  prompt += t("promptgen.level", { level: level });
  prompt += t("promptgen.footer");
  if (extra) {
    prompt += t("promptgen.extra", { extra: extra });
  }

  // "Grounding": tempelkan rumus/konsep topik yang sudah divalidasi guru
  // supaya AI memakai nilai & rumus yang tepat, bukan menebak dari memori umum.
  if (currentTopic.formulaSheet) {
    prompt += t("promptgen.formularef", { sheet: trContent(currentTopic.formulaSheet) });
  }

  document.getElementById("final-prompt").value = prompt;
});

/* ---------------- Generate simulasi (streaming) ----------------
   Teks kode di-stream dari server sehingga siswa melihat kemajuan nyata
   (bukan menunggu 60 detik lalu timeout seperti Apps Script di V7). Jika
   server menghentikan keluaran karena batas waktu/token, tombol "Lanjutkan"
   meminta AI meneruskan kode dari titik terakhir. */
let genJob = null;          // { handle, kind, buffer, task }
let lastGenTask = null;     // tugas terakhir untuk mode "continue"
function aiAuth() { return { token: getAccessToken(), studentId: getStudentId(), topicId: currentTopic ? currentTopic.id : null }; }
function resetGenUI() {
  if (genJob && genJob.handle) genJob.handle.abort();
  genJob = null;
  lastGenTask = null;
  const ids = ["gen-progress", "cancel-gen-btn", "continue-gen-btn"];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
}
function setGenBusy(busy) {
  document.getElementById("generate-btn").disabled = busy;
  document.getElementById("edit-followup-btn").disabled = busy || editCount >= MAX_FOLLOWUP_EDITS;
  document.getElementById("cancel-gen-btn").hidden = !busy;
  document.getElementById("gen-progress").hidden = !busy;
}
function showGenPhase(phase, chars) {
  const box = document.getElementById("gen-progress");
  box.classList.toggle("writing", phase === "writing");
  document.getElementById("gen-phase").textContent = t("lab.phase." + phase);
  document.getElementById("gen-meta").textContent = chars ? t("lab.phase.size", { kb: (chars / 1024).toFixed(1) }) : "";
}
// kind: "simulate" | "edit" | "continue"; task: payload asli; onFinish(html, status)
// autoCount: berapa kali generate ini sudah dilanjutkan otomatis karena koneksi putus.
const MAX_AUTO_RESUME = 2;
function runGeneration(kind, task, statusEl, onFinish, autoCount) {
  autoCount = autoCount || 0;
  const started = Date.now();
  let buffer = kind === "continue" ? (task.partial || "") : "";
  const base = kind === "continue" ? buffer.length : 0;
  setGenBusy(true);
  showGenPhase("connecting", 0);
  statusEl.textContent = "";
  document.getElementById("continue-gen-btn").hidden = true;
  const editor = document.getElementById("code-editor");
  const handle = aiStream(Object.assign({ mode: kind }, aiAuth(), task), {
    onPhase: ph => showGenPhase(ph, buffer.length - base),
    onDelta: d => {
      buffer += d;
      showGenPhase("writing", buffer.length - base);
      if (!editor.hidden) { editor.value = buffer; editor.scrollTop = editor.scrollHeight; }
    },
    onDone: ev => {
      setGenBusy(false); genJob = null;
      const secs = Math.round((Date.now() - started) / 1000);
      onFinish(buffer, ev.stop === "max_tokens" ? "truncated" : "ok", secs);
    },
    onTimeout: info => {
      setGenBusy(false); genJob = null;
      // Koneksi internet putus di tengah streaming (mis. Wi-Fi sekolah): lanjutkan otomatis
      // dari kode yang sudah diterima, maksimal MAX_AUTO_RESUME kali, tanpa siswa perlu klik.
      if (info && info.network && autoCount < MAX_AUTO_RESUME && lastGenTask && buffer.length - base > 200 && !/<\/html>\s*$/i.test(buffer)) {
        statusEl.textContent = t("lab.generate.autoresume");
        setGenBusy(true);
        showGenPhase("connecting", buffer.length - base);
        setTimeout(() => {
          setGenBusy(false);
          runGeneration("continue", Object.assign({}, lastGenTask, { partial: buffer }), statusEl, onFinish, autoCount + 1);
        }, 2000);
        return;
      }
      onFinish(buffer, "truncated", Math.round((Date.now() - started) / 1000));
    },
    onError: (msg, status) => {
      setGenBusy(false); genJob = null;
      statusEl.textContent = t("lab.generate.failed") + msg;
      if (status === 401) statusEl.textContent += " " + t("lab.relogin");
    },
    onAbort: () => {
      setGenBusy(false); genJob = null;
      statusEl.textContent = t("lab.generate.cancelled");
    }
  });
  genJob = { handle, kind };
}
function finishGeneratedHtml(raw, status, secs, statusEl, successKey) {
  let html = stripCodeFence((raw || "").trim());
  if (!html) { statusEl.textContent = t("check.htmltooshort"); return false; }
  const problem = checkGeneratedHtml(html);
  setPreview(html);
  if (status === "truncated" || (problem && problem === t("check.htmltruncated"))) {
    document.getElementById("continue-gen-btn").hidden = false;
    statusEl.textContent = t("lab.generate.truncated");
    return true;
  }
  statusEl.textContent = problem ? problem + t("lab.generate.retryhint") : t(successKey, { s: secs });
  return true;
}
document.getElementById("generate-btn").addEventListener("click", () => {
  const promptText = document.getElementById("final-prompt").value.trim();
  const status = document.getElementById("generate-status");
  document.getElementById("mode-banner").hidden = true;
  if (!promptText) { status.textContent = t("lab.generate.needprompt"); return; }
  if (genJob) return;
  lastGenTask = { prompt: promptText };
  runGeneration("simulate", { prompt: promptText }, status, (html, st, secs) => {
    if (finishGeneratedHtml(html, st, secs, status, "lab.generate.success2")) resetEditCount();
  });
});
document.getElementById("cancel-gen-btn").addEventListener("click", () => { if (genJob) genJob.handle.abort(); });
document.getElementById("continue-gen-btn").addEventListener("click", () => {
  if (genJob || !lastGenTask || !lastGeneratedHTML) return;
  const status = document.getElementById("generate-status");
  runGeneration("continue", Object.assign({}, lastGenTask, { partial: lastGeneratedHTML }), status, (html, st, secs) => {
    finishGeneratedHtml(html, st, secs, status, "lab.generate.continued");
  });
});

document.getElementById("demo-btn").addEventListener("click", () => {
  const promptText = document.getElementById("final-prompt").value.trim();
  const status = document.getElementById("generate-status");
  const banner = document.getElementById("mode-banner");
  status.textContent = "";
  banner.hidden = false;
  banner.textContent = t("lab.demo.active");
  const html = getDemoSimHTML(promptText);
  setPreview(html);
  resetEditCount();
});

// PENTING: pesan status untuk aksi ini SENGAJA ditampilkan di elemen lokal
// #edit-followup-status (tepat di bawah tombol ini), BUKAN di #generate-status
// / #mode-banner yang letaknya jauh di atas (dekat tombol Generate Simulasi).
// Panel "Prompt Lanjutan" ini muncul di BAWAH preview simulasi yang bisa
// cukup tinggi, jadi kalau pesan hasil klik ditulis ke elemen yang jauh di
// atas, siswa yang sedang melihat tombol ini di layar tidak akan pernah
// melihat pesannya tanpa scroll manual ke atas - dari sudut pandang siswa
// ini terlihat PERSIS seperti "tombol tidak melakukan apa-apa" walau
// sebenarnya requestnya berjalan (berhasil ATAU gagal) di baliknya. Dulu
// pernah dilaporkan bug "klik Edit Simulasi Ini, tidak terjadi apa-apa,
// sisa edit tetap 5/5" - root cause-nya persis ini (dikombinasikan dengan
// kemungkinan request yang gagal di background karena server AI sibuk,
// yang pesan error-nya juga tidak pernah terlihat karena masalah yang sama).
document.getElementById("edit-followup-btn").addEventListener("click", () => {
  const instruction = document.getElementById("edit-followup-input").value.trim();
  const status = document.getElementById("edit-followup-status");
  if (editCount >= MAX_FOLLOWUP_EDITS) { status.textContent = t("lab.editfollowup.limitreached", { max: MAX_FOLLOWUP_EDITS }); return; }
  if (!lastGeneratedHTML) { status.textContent = t("lab.editfollowup.needsim"); return; }
  if (!instruction) { status.textContent = t("lab.editfollowup.needinstruction"); return; }
  if (genJob) return;
  const task = { html: lastGeneratedHTML, instruction };
  lastGenTask = task;
  runGeneration("edit", task, status, (html, st, secs) => {
    if (finishGeneratedHtml(html, st, secs, status, "lab.editfollowup.success2")) {
      editCount += 1;
      document.getElementById("edit-followup-input").value = "";
    }
    updateEditCounterUI();
  });
  status.textContent = t("lab.editfollowup.loading", { n: editCount + 1, max: MAX_FOLLOWUP_EDITS });
});

function stripCodeFence(html) {
  return html.replace(/^```(?:html)?\s*/i, "").replace(/```\s*$/i, "");
}

// Pengecekan ringan (bukan parser lengkap) untuk menangkap kasus paling umum
// HTML hasil AI yang rusak/terpotong, supaya siswa dapat pesan yang jelas
// alih-alih preview kosong atau kode setengah jadi tanpa keterangan.
// Mengembalikan string pesan masalah, atau null kalau terlihat aman.
function checkGeneratedHtml(html) {
  if (!html || html.length < 200) {
    return t("check.htmltooshort");
  }
  if (!/<\/html>\s*$/i.test(html)) {
    return t("check.htmltruncated");
  }
  if (!/<script[\s>]/i.test(html)) {
    return t("check.noscript");
  }
  // Cek kasar keseimbangan kurung kurawal di dalam <script>: kalau sangat
  // tidak seimbang, hampir pasti ada JavaScript yang terpotong/rusak.
  const scriptContents = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join("\n");
  const openBraces = (scriptContents.match(/\{/g) || []).length;
  const closeBraces = (scriptContents.match(/\}/g) || []).length;
  if (Math.abs(openBraces - closeBraces) > 1) {
    return t("check.unbalancedbraces");
  }
  return null;
}

function setPreview(html) {
  lastGeneratedHTML = html;
  document.getElementById("preview-frame").srcdoc = html;
  document.getElementById("code-editor").value = html;
  // Setiap kali ada hasil generate/rerun baru, selalu mulai dari tampilan
  // preview (bukan kode) supaya konsisten, dan reset label tombolnya.
  document.getElementById("preview-frame").hidden = false;
  document.getElementById("code-editor").hidden = true;
  document.getElementById("toggle-code-label").textContent = t("lab.togglecode.view");
  ["rerun-btn", "toggle-code-btn", "download-btn"].forEach(id => document.getElementById(id).disabled = false);
  document.getElementById("lab-edit-followup").hidden = false;
  document.getElementById("edit-followup-status").textContent = "";
}

document.getElementById("rerun-btn").addEventListener("click", () => {
  const edited = document.getElementById("code-editor").value;
  document.getElementById("preview-frame").srcdoc = edited;
  lastGeneratedHTML = edited;
  document.getElementById("preview-frame").hidden = false;
  document.getElementById("code-editor").hidden = true;
  document.getElementById("toggle-code-label").textContent = t("lab.togglecode.view");
});

document.getElementById("toggle-code-btn").addEventListener("click", () => {
  // Tombol ini harus SALING MENUKAR tampilan preview <-> kode (bukan cuma
  // menampilkan textarea kode di bawah iframe yang tetap terlihat), supaya
  // benar-benar terasa seperti "Lihat Kode" mengganti area sandbox.
  const editor = document.getElementById("code-editor");
  const frame = document.getElementById("preview-frame");
  const label = document.getElementById("toggle-code-label");
  const showingCodeNext = editor.hidden; // true jika saat ini kode masih disembunyikan
  editor.hidden = !showingCodeNext;
  frame.hidden = showingCodeNext;
  label.textContent = showingCodeNext ? t("lab.togglecode.preview") : t("lab.togglecode.view");
});

document.getElementById("download-btn").addEventListener("click", () => {
  const blob = new Blob([lastGeneratedHTML], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `simulasi-${(currentTopic ? currentTopic.id : "fisika")}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById("lab-reflection-submit-btn").addEventListener("click", startLabReflectionGate);

/* ---------------- Pengaturan (modal) ---------------- */
const settingsModal = document.getElementById("settings-modal");
function refreshUnlockStatusUI() {
  const text = document.getElementById("unlock-status-text");
  if (!text) return;
  text.textContent = isUnlockAll() ? t("settings.unlock.on") : t("settings.unlock.off");
  text.classList.toggle("ok", isUnlockAll());
}
// Kode Eksplorasi sekarang diperiksa SERVER (env EXPLORE_CODE), bukan
// dibandingkan dengan string di js/config.js yang bisa dibaca siapa pun.
async function verifyExploreCode(code) {
  const data = await apiCall("verify_access", { code, studentId: getUserRole() === "student" ? getStudentId() : "" });
  if (data.error) return { ok: false, error: data.error };
  if (data.kind !== "explore") return { ok: false, error: t("gate.guest.code.wrong") };
  localStorage.setItem(STORAGE_KEY_UNLOCK_ALL, "true");
  // Siswa yang memasukkan kode eksplorasi tetap memakai token akunnya.
  if (getUserRole() === "student" && getAccount()) setAccess(null, null); else setAccess("explore", data.token);
  return { ok: true };
}
document.getElementById("unlock-code-btn").addEventListener("click", async () => {
  const input = document.getElementById("unlock-code-input");
  const val = input.value.trim();
  if (!val) return;
  const btn = document.getElementById("unlock-code-btn");
  btn.disabled = true;
  let r;
  try { r = await verifyExploreCode(val); } catch (e) { r = { ok: false, error: e.message }; }
  btn.disabled = false;
  if (r.ok) {
    input.value = "";
    refreshUnlockStatusUI();
    renderNav();
    if (currentTopic) updateTopicProgressUI(document.querySelector(".tab-btn.active").dataset.tab);
    showToast(t("settings.unlock.success"));
  } else {
    showToast(r.error || t("settings.unlock.wrong"));
  }
});
function renderSettingsIdentity() {
  const dl = document.getElementById("settings-identity");
  const role = getUserRole();
  const rows = [];
  if (role === "student") {
    rows.push([t("field.fullname"), getStudentName()], [t("field.class"), getStudentClass()]);
    const acc = getAccount();
    if (acc && acc.groupName) rows.push([t("settings.identity.group"), acc.groupName], [t("settings.identity.leader"), (acc.leaderName || "-") + (acc.isLeader ? " (" + t("settings.identity.you") + ")" : "")]);
  }
  const kind = isInClassSession() ? "class" : (role === "guest" ? "explore" : (getAccessKind() || "self"));
  rows.push([t("settings.identity.mode"), kind === "class" ? t("header.chip.class", { code: classSession.code }) : t("header.chip." + kind)]);
  dl.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtmlQ(k)}</dt><dd>${escapeHtmlQ(v || "-")}</dd>`).join("");
}
function openSettingsModal() {
  refreshUnlockStatusUI();
  refreshClassSessionUI();
  renderSettingsIdentity();
  const studentDetails = document.getElementById("settings-student-info-details");
  const isStudent = getUserRole() === "student";
  studentDetails.hidden = true; // nama & kelas dikelola guru di Panel Guru
  document.getElementById("class-session-join-row").parentElement.hidden = !isStudent;
  if (isStudent) {
    document.getElementById("settings-student-name-input").value = getStudentName();
    document.getElementById("settings-student-class-input").value = getStudentClass();
  }
  settingsModal.hidden = false;
}
document.getElementById("settings-btn").addEventListener("click", openSettingsModal);
document.getElementById("lab-class-only-join-btn").addEventListener("click", openSettingsModal);
document.getElementById("user-chip").addEventListener("click", openSettingsModal);
document.getElementById("settings-close-btn").addEventListener("click", () => settingsModal.hidden = true);
document.getElementById("settings-close-x").addEventListener("click", () => settingsModal.hidden = true);
document.getElementById("settings-student-info-save-btn").addEventListener("click", () => {
  const name = document.getElementById("settings-student-name-input").value.trim();
  const cls = document.getElementById("settings-student-class-input").value.trim();
  if (!name || !cls) { showToast(t("gate.student.needinfo")); return; }
  localStorage.setItem(STORAGE_KEY_STUDENT_NAME, name);
  localStorage.setItem(STORAGE_KEY_STUDENT_CLASS, cls);
  refreshUserChip();
  renderSettingsIdentity();
  syncClassSession();
  showToast(t("settings.studentinfo.saved"));
});
document.getElementById("settings-reset-onboarding-btn").addEventListener("click", () => {
  if (!confirm(t("settings.resetonboarding.confirm"))) return;
  logoutStudent();
  localStorage.removeItem(STORAGE_KEY_ROLE);
  settingsModal.hidden = true;
  location.reload();
});

/* ============================================================
   Kerja kelompok: Eksperimen & Makerspace
   ------------------------------------------------------------
   - Ketua kelompok mengerjakan dari SATU perangkat: saat membuka tab,
     perangkat meminta kunci (group_lock) lalu mengirim heartbeat tiap 30 s.
     Kalau kunci dipegang perangkat lain, tampilan jadi baca-saja dengan
     tombol "Pindahkan ke perangkat ini".
   - Anggota melihat nama ketua + pratinjau baca-saja (LKPD & simulasi
     kelompok) yang diperbarui otomatis (group_state, tiap 15 s).
   ============================================================ */
const GROUP_TABS = ["eksperimen", "lab"];
const GROUP_HEARTBEAT_MS = 30000;
const GROUP_POLL_MS = 15000;
const groupSec = { eksperimen: { mode: null, hb: null, poll: null, n: 0, simAt: null }, lab: { mode: null, hb: null, poll: null, n: 0, simAt: null } };

function storeAccountQuiet(acc) {
  if (!acc) return;
  localStorage.setItem(STORAGE_KEY_ACCOUNT, JSON.stringify(acc));
}
function stopGroupTimers(section) {
  const g = groupSec[section];
  if (g.hb) { clearInterval(g.hb); g.hb = null; }
  if (g.poll) { clearInterval(g.poll); g.poll = null; }
}
async function enterGroupSection(section, force) {
  const g = groupSec[section];
  stopGroupTimers(section);
  if (!currentTopic || currentTopic.status !== "ready" || !inGroup()) { setGroupMode(section, null); return; }
  if (section === "lab" && !aiAvailable()) { setGroupMode(section, null); return; }
  const acc = getAccount();
  if (!acc.isLeader) { setGroupMode(section, "member"); startMemberPoll(section); return; }
  let r;
  try { r = await apiCall("group_lock", { topicId: currentTopic.id, section, action: "acquire" }); }
  catch (e) { return; }
  if (r.account) storeAccountQuiet(r.account);
  if (r.ok) { setGroupMode(section, "leader"); startHeartbeat(section); }
  else if (r.notLeader) { setGroupMode(section, "member"); startMemberPoll(section); }
  else if (r.otherDevice) { setGroupMode(section, "blocked"); startMemberPoll(section); }
  else if (r.error) showToast(r.error);
}
function leaveGroupSection(section) {
  const g = groupSec[section];
  stopGroupTimers(section);
  if (g.mode === "leader" && currentTopic) apiCall("group_lock", { topicId: currentTopic.id, section, action: "release" }).catch(() => {});
  g.mode = null;
}
function leaveAllGroupSections() { GROUP_TABS.forEach(leaveGroupSection); }
function startHeartbeat(section) {
  const g = groupSec[section];
  g.hb = setInterval(async () => {
    if (!currentTopic) return;
    try {
      const r = await apiCall("group_lock", { topicId: currentTopic.id, section, action: "heartbeat" });
      if (r.ok === false && (r.otherDevice || r.notLeader)) {
        stopGroupTimers(section);
        setGroupMode(section, r.notLeader ? "member" : "blocked");
        startMemberPoll(section);
      }
    } catch (e) { /* coba lagi */ }
  }, GROUP_HEARTBEAT_MS);
}
function startMemberPoll(section) {
  const g = groupSec[section];
  g.n = 0;
  const tick = async () => {
    if (!currentTopic) return;
    g.n++;
    try {
      const d = await apiCall("group_state", { topicId: currentTopic.id });
      if (d.error) return;
      if (d.account) {
        storeAccountQuiet(d.account);
        if (d.account.isLeader && g.mode === "member") { enterGroupSection(section, true); return; }
      }
      updateMemberView(section, d);
      if (g.n % 2 === 1) checkGateOnTopicOpen(currentTopic.id);
    } catch (e) { /* coba lagi */ }
  };
  tick();
  g.poll = setInterval(tick, GROUP_POLL_MS);
}
async function takeoverGroupSection(section) {
  if (!currentTopic) return;
  let r;
  try { r = await apiCall("group_lock", { topicId: currentTopic.id, section, action: "takeover" }); } catch (e) { return; }
  if (r.ok) {
    stopGroupTimers(section);
    setGroupMode(section, "leader");
    startHeartbeat(section);
    if (section === "eksperimen" && window.LKPD) LKPD.refresh();
    showToast(t("group.takeover.ok"));
  } else if (r.error) showToast(r.error);
}
function groupBannerHTML(section, mode) {
  const acc = getAccount() || {};
  const grp = escapeHtmlQ(acc.groupName || "");
  const leader = escapeHtmlQ(acc.leaderName || "");
  const sec = t("tab." + (section === "lab" ? "lab" : "eksperimen"));
  if (mode === "leader") return `<span class="gb-ic">★</span><div>${t("group.banner.leader", { group: grp, section: sec })}</div>`;
  if (mode === "blocked") return `<span class="gb-ic">⇄</span><div>${t("group.banner.blocked", { section: sec })}<br><button type="button" class="btn btn-primary btn-small" data-group-takeover="${section}">${t("group.takeover.btn")}</button></div>`;
  if (!acc.leaderName) return `<span class="gb-ic">!</span><div>${t("group.banner.noleader", { group: grp })}</div>`;
  return `<span class="gb-ic">👥</span><div>${t("group.banner.member", { group: grp, leader, section: sec })}</div>`;
}
function ensureGroupBanner(section) {
  const panel = document.getElementById("panel-" + section);
  if (!panel) return null;
  let el = document.getElementById("group-banner-" + section);
  if (!el || !panel.contains(el)) {
    el = document.createElement("div");
    el.id = "group-banner-" + section;
    el.className = "group-banner";
    const label = panel.querySelector(".pjbl-stage-label");
    if (label && label.parentElement === panel) label.after(el); else panel.prepend(el);
  }
  return el;
}
function setGroupMode(section, mode) {
  const g = groupSec[section];
  g.mode = mode;
  const ro = mode === "member" || mode === "blocked";
  const banner = ensureGroupBanner(section);
  if (banner) {
    banner.hidden = !mode;
    banner.className = "group-banner" + (mode ? " gb-" + mode : "");
    banner.innerHTML = mode ? groupBannerHTML(section, mode) : "";
    const tk = banner.querySelector("[data-group-takeover]");
    if (tk) tk.addEventListener("click", () => takeoverGroupSection(section));
  }
  if (section === "eksperimen") {
    const panel = document.getElementById("panel-eksperimen");
    panel.classList.toggle("group-readonly", ro);
    if (window.LKPD && LKPD.isReadOnly() !== ro) {
      LKPD.setReadOnly(ro);
      const ex = currentTopic && currentTopic.eksperimen;
      if (ex && ex.variants && currentEksVariantKey) renderEksVariantContent(ex, currentEksVariantKey);
    }
  } else {
    const panel = document.getElementById("panel-lab");
    panel.classList.toggle("group-readonly", ro);
    panel.querySelectorAll(".lab-grid > .lab-card:not(.lab-preview-card)").forEach(el => { el.hidden = ro; });
    const fu = document.getElementById("lab-edit-followup");
    if (fu && ro) fu.hidden = true;
    const refl = document.getElementById("lab-reflection-section");
    if (refl) refl.hidden = ro || !(currentTopic && currentTopic.status === "ready");
    let note = document.getElementById("group-lab-note");
    if (ro) {
      if (!note) {
        note = document.createElement("p");
        note.id = "group-lab-note";
        note.className = "group-lab-note";
        const card = panel.querySelector(".lab-preview-card h3");
        if (card) card.after(note);
      }
      note.hidden = false;
      if (!note.textContent) note.textContent = t("group.lab.waiting");
    } else if (note) note.hidden = true;
  }
}
function updateMemberView(section, d) {
  const g = groupSec[section];
  if (section === "eksperimen") {
    const ex = currentTopic && currentTopic.eksperimen;
    if (ex && ex.variants && d.lastVariant && ex.variants[d.lastVariant] && d.lastVariant !== currentEksVariantKey) {
      currentEksVariantKey = d.lastVariant;
      saveEksVariant(d.lastVariant);
      document.querySelectorAll("#panel-eksperimen .eks-variant-btn").forEach(b => b.classList.toggle("active", b.dataset.variant === d.lastVariant));
      renderEksVariantContent(ex, d.lastVariant);
    } else if (window.LKPD) LKPD.refresh();
  } else {
    const note = document.getElementById("group-lab-note");
    if (d.sim && d.sim.html && d.sim.createdAt !== g.simAt) {
      g.simAt = d.sim.createdAt;
      setPreview(stripCodeFence(d.sim.html));
      document.getElementById("lab-edit-followup").hidden = true;
      if (note) note.textContent = t("group.lab.lastprompt", { time: new Date(d.sim.createdAt).toLocaleTimeString(getLang() === "en" ? "en-GB" : "id-ID", { hour: "2-digit", minute: "2-digit" }) }) + " " + (d.sim.prompt || "").slice(0, 400);
    } else if (!d.sim && note) note.textContent = t("group.lab.waiting");
  }
}
// Perangkat ketua ditutup: lepaskan kunci supaya perangkat lain bisa langsung lanjut.
window.addEventListener("pagehide", () => {
  if (!currentTopic) return;
  GROUP_TABS.forEach(section => {
    if (groupSec[section].mode !== "leader") return;
    try {
      fetch(apiUrl("/api/backend"), { method: "POST", keepalive: true, headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ mode: "group_lock", action: "release", topicId: currentTopic.id, section, lang: getLang() }, authFields())) });
    } catch (e) { /* abaikan */ }
  });
});

/* ============================================================
   Gerbang masuk (wajib)
   ------------------------------------------------------------
   Siswa: peran -> login akun (nama + PIN dari guru) -> pilih "Belajar di
   kelas" (kode sesi 6 huruf) atau "Belajar mandiri" (langsung masuk).
   Guru -> Panel Guru. Validator -> Kode Eksplorasi.
   Akun & kelompok dibuat guru di Panel Guru; server memberi token akun
   30 hari yang berisi identitas siswa.
   ============================================================ */
const GATE_STEPS = ["role", "student-login", "student-mode", "student-code", "guest-code"];
let gateStudentMode = null; // "class" | "self" (pilihan di langkah 3)

function computeGateStep() {
  const role = getUserRole();
  if (role === "student") {
    if (!getAccessToken() || !getAccount()) return "student-login";
    if (getAccessKind() === "pending") return gateStudentMode === "class" ? "student-code" : "student-mode";
    return null;
  }
  if (role === "guest") {
    if (!isUnlockAll() || !getAccessToken()) return "guest-code";
    return null;
  }
  return "role";
}
function showGateStep(step) {
  GATE_STEPS.forEach(s => {
    const el = document.getElementById("gate-step-" + s);
    if (el) el.hidden = (s !== step);
  });
  if (step === "student-code") applyStudentCodeMode();
  const focusEl = document.querySelector("#gate-step-" + step + " input");
  // Fokus otomatis hanya bila pengguna belum mengetik di kolom lain (jangan mencuri fokus).
  if (focusEl) setTimeout(() => { const a = document.activeElement; if (!a || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) focusEl.focus(); }, 30);
}
function applyGate() {
  const step = computeGateStep();
  const gate = document.getElementById("onboarding-gate");
  const shell = document.getElementById("site-shell");
  if (step) {
    gate.hidden = false;
    shell.hidden = true;
    showGateStep(step);
  } else {
    gate.hidden = true;
    shell.hidden = false;
    syncHeaderHeight();
    refreshUserChip();
    if (getUserRole() === "student" && !classSyncTimer) startClassSync();
    if (isInClassSession()) goToClassSessionActivity();
  }
}
async function initGate() {
  // Perangkat yang pernah gabung sesi kelas: sambung ulang diam-diam supaya
  // reload di tengah sesi langsung kembali ke aktivitas kelas.
  if (getUserRole() === "student" && getJoinedSessionCode() && getAccessToken()) {
    try {
      const data = await apiCall("session_sync", { code: getJoinedSessionCode(), progress: getProgress() });
      if (!data.error && data.account) setAccount(data.account);
      if (!data.error && data.inSession) { classSession = data; mergeServerProgress(data.progress); updateQuizUI(data.activeQuiz); if (window.SumatifStudent) SumatifStudent.update(data.activeTest); }
      else if (!data.error) { localStorage.removeItem(STORAGE_KEY_CLASS_CODE); if (getAccessKind() === "class") localStorage.setItem(STORAGE_KEY_ACCESS_KIND, "self"); }
    } catch (e) { /* offline: lanjut */ }
  }
  applyGate();
}

// Keluar dari akun: hapus token, identitas, progres lokal, cache gate.
function logoutStudent(message) {
  [STORAGE_KEY_TOKEN, STORAGE_KEY_ACCESS_KIND, STORAGE_KEY_CLASS_CODE, STORAGE_KEY_ACCOUNT, STORAGE_KEY_STUDENT_NAME, STORAGE_KEY_STUDENT_CLASS,
   STORAGE_KEY_PROGRESS, STORAGE_KEY_GATE_CACHE, STORAGE_KEY_EKSDATA_SAVED, STORAGE_KEY_UNLOCK_ALL].forEach(k => localStorage.removeItem(k));
  classSession = null;
  gateStudentMode = null;
  stopClassSync();
  leaveAllGroupSections();
  if (message) showToast(message);
}

document.getElementById("gate-role-student-btn").addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEY_ROLE, "student");
  applyGate();
});
document.getElementById("gate-login-back-btn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY_ROLE);
  applyGate();
});
document.getElementById("gate-login-btn").addEventListener("click", async () => {
  const nameEl = document.getElementById("gate-login-name-input"), pinEl = document.getElementById("gate-login-pin-input");
  const status = document.getElementById("gate-login-status"), btn = document.getElementById("gate-login-btn");
  const name = nameEl.value.trim().replace(/\s+/g, " "), pin = pinEl.value.replace(/\D/g, "");
  if (!name || pin.length !== 6) { status.textContent = t("gate.login.needboth"); return; }
  status.textContent = t("gate.student.code.connecting");
  btn.disabled = true;
  let data;
  try { data = await apiCall("student_login", { name, pin }); }
  catch (e) { data = { error: e.message }; }
  btn.disabled = false;
  if (data.error) { status.textContent = data.error; return; }
  // Perangkat bersama: progres lokal milik akun lain tidak boleh terbawa.
  const prev = getAccount();
  if (!prev || prev.studentId !== data.account.studentId) {
    [STORAGE_KEY_PROGRESS, STORAGE_KEY_GATE_CACHE, STORAGE_KEY_EKSDATA_SAVED, STORAGE_KEY_UNLOCK_ALL, STORAGE_KEY_CLASS_CODE].forEach(k => localStorage.removeItem(k));
  }
  setAccount(data.account);
  setAccess("pending", data.token);
  mergeServerProgress(data.progress);
  nameEl.value = ""; pinEl.value = "";
  status.textContent = "";
  gateStudentMode = null;
  applyGate();
});
["gate-login-name-input", "gate-login-pin-input"].forEach(id => document.getElementById(id).addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("gate-login-btn").click();
}));

// Teks langkah kode mengikuti pilihan "Belajar di kelas".
function applyStudentCodeMode() {
  const title = document.getElementById("gate-code-title"), desc = document.getElementById("gate-code-desc"), input = document.getElementById("gate-student-code-input");
  title.textContent = t("gate.code.class.title");
  desc.textContent = t("gate.code.class.desc");
  input.placeholder = t("gate.code.class.placeholder");
  input.maxLength = 12;
  document.getElementById("gate-student-code-status").textContent = "";
}
document.getElementById("gate-mode-class-btn").addEventListener("click", () => { gateStudentMode = "class"; applyGate(); });
document.getElementById("gate-mode-self-btn").addEventListener("click", () => {
  gateStudentMode = "self";
  setAccess("self");
  applyGate();
  showToast(t("gate.welcome.self", { name: getStudentName() }));
});
document.getElementById("gate-student-mode-back-btn").addEventListener("click", () => {
  logoutStudent();
  localStorage.setItem(STORAGE_KEY_ROLE, "student");
  applyGate();
});
document.getElementById("gate-role-guest-btn").addEventListener("click", () => {
  localStorage.setItem(STORAGE_KEY_ROLE, "guest");
  applyGate();
});

document.getElementById("gate-student-code-btn").addEventListener("click", async () => {
  const input = document.getElementById("gate-student-code-input");
  const status = document.getElementById("gate-student-code-status");
  const btn = document.getElementById("gate-student-code-btn");
  const code = input.value.trim();
  if (!code) { status.textContent = t("gate.student.code.needcode"); status.classList.remove("ok"); return; }
  status.textContent = t("gate.student.code.connecting");
  status.classList.remove("ok");
  btn.disabled = true;
  let data;
  try { data = await apiCall("verify_access", { code, progress: getProgress() }); }
  catch (e) { data = { error: e.message }; }
  btn.disabled = false;
  if (data.error) { status.textContent = data.error; return; }
  if (data.kind !== "class") { status.textContent = t("gate.code.notclass2"); return; }
  setAccess("class");
  mergeServerProgress(data.progress);
  localStorage.setItem(STORAGE_KEY_CLASS_CODE, data.session.code);
  classSession = data.session;
  input.value = "";
  status.textContent = "";
  applyGate();
  showToast(t("gate.welcome.class", { name: getStudentName() }));
});
document.getElementById("gate-student-code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("gate-student-code-btn").click();
});
document.getElementById("gate-student-code-back-btn").addEventListener("click", () => {
  gateStudentMode = null;
  showGateStep("student-mode");
});

document.getElementById("gate-guest-code-btn").addEventListener("click", async () => {
  const input = document.getElementById("gate-guest-code-input");
  const status = document.getElementById("gate-guest-code-status");
  const code = input.value.trim();
  if (!code) { status.textContent = t("gate.guest.code.needcode"); status.classList.remove("ok"); return; }
  status.textContent = t("gate.student.code.connecting");
  let r;
  try { r = await verifyExploreCode(code); } catch (e) { r = { ok: false, error: e.message }; }
  if (r.ok) { input.value = ""; status.textContent = ""; applyGate(); }
  else { status.textContent = r.error; status.classList.remove("ok"); }
});
document.getElementById("gate-guest-code-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") document.getElementById("gate-guest-code-btn").click();
});
document.getElementById("gate-guest-code-back-btn").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY_ROLE);
  applyGate();
});

// Token tidak berlaku lagi (PIN direset / akun dinonaktifkan): kembali ke login.
window.addEventListener("emergent-api-code", (e) => {
  const d = e.detail || {};
  if (d.code === "AUTH" && getUserRole() === "student" && getAccessToken()) {
    logoutStudent(d.error);
    localStorage.setItem(STORAGE_KEY_ROLE, "student");
    applyGate();
  } else if (d.code === "CLASS_ONLY" && getUserRole() === "student") {
    // Sesi kelas sudah berakhir di server: kembali ke mode mandiri.
    if (getJoinedSessionCode()) leaveClassSession(); else applyAiAvailability();
    showToast(t("classonly.toast"));
  } else if ((d.code === "LOCKED" || d.code === "NOT_LEADER") && getUserRole() === "student") {
    const tab = document.querySelector(".tab-btn.active")?.dataset.tab;
    if (GROUP_TABS.includes(tab)) enterGroupSection(tab, true);
  }
});

/* ---------------- Chatbot toggle ---------------- */
const chatbotPanel = document.getElementById("chatbot-panel");
document.getElementById("chatbot-toggle-btn").addEventListener("click", () => {
  chatbotPanel.hidden = !chatbotPanel.hidden;
  if (!chatbotPanel.hidden && window.Chatbot) Chatbot.onOpen();
});
document.getElementById("chatbot-close-btn").addEventListener("click", () => { chatbotPanel.hidden = true; });

/* ---------------- Simpan saat halaman ditutup ---------------- */
window.addEventListener("pagehide", () => { if (window.LKPD) LKPD.flushBeacon(); });
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && window.LKPD) LKPD.flushBeacon(); });

/* ---------------- Init ---------------- */
applyStaticI18n();
initLangSwitch();
renderNav();
refreshUnlockStatusUI();
syncHeaderHeight();
if (window.Chatbot) Chatbot.init();
// Kalau reload ini dipicu oleh ganti bahasa (lihat setLang() di i18n.js),
// kembalikan siswa ke topik/tab yang sedang dibuka sebelumnya alih-alih
// diam di Beranda - ditunggu (.then) sampai SETELAH initGate() selesai
// memutuskan step gate mana yang tampil (initGate itu sendiri async karena
// bisa menyambung ulang sesi kelas lebih dulu ke backend).
initGate().then(restoreLangSwitchState);
