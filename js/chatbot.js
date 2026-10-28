/* ============================================================
   chatbot.js - Tutor Fisika (gaya Socratic)
   ------------------------------------------------------------
   V9: setiap pesan dikirim ke /api/ai (mode "chat") dan dijawab AI
   secara streaming (teks muncul bertahap). API key berada di
   server; siswa cukup punya token akses dari gerbang masuk. Bahan dari
   js/chatbot-data.js + lembar rumus topik dikirim sebagai acuan, dan soal
   latihan/kuis aktif dikirim sebagai "soal terlindungi" supaya tutor
   tidak membocorkan jawabannya.
   Jika AI tidak tersedia (server belum dikonfigurasi / offline), dipakai
   skrip tanya-jawab lokal berbasis kata kunci sebagai cadangan.
   ============================================================ */

window.Chatbot = (function () {
  let topicId = null;
  let pendingConcept = null; // dipakai skrip lokal (fallback)
  let history = []; // riwayat obrolan giliran-AI: [{role:"user"|"model", text}]
  let initialized = false;
  let aiUnavailable = false; // true setelah server menjawab AI belum dikonfigurasi
  let sending = false;
  // Naik setiap kali topik berganti. Balasan tutor yang datang TERLAMBAT (dari
  // topik sebelumnya) dibuang berdasarkan nomor ini, supaya tidak muncul di
  // obrolan topik yang baru.
  let epoch = 0;

  function currentKB() {
    return (topicId && CHATBOT_KB[topicId]) ? CHATBOT_KB[topicId] : CHATBOT_KB.general;
  }

  function currentTopicTitle() {
    const topic = (typeof TOPICS !== "undefined" ? TOPICS : []).find(tp => tp.id === topicId);
    return topic ? trContent(topic.title) : t("chatbot.generaltopic");
  }

  function buildKbContext(kb) {
    const parts = [];
    if (kb && Array.isArray(kb.concepts)) parts.push(kb.concepts.map(c => "- " + c.explain).join("\n"));
    // Topik yang belum punya bahan khusus di chatbot-data.js (mis. Temperature,
    // Ideal Gases, Thermodynamics) tetap dibekali lembar rumus topiknya dari
    // content.js supaya tutor tidak menjawab "secara umum" saja.
    if (!(topicId && CHATBOT_KB[topicId])) {
      const topic = (typeof TOPICS !== "undefined" ? TOPICS : []).find(tp => tp.id === topicId);
      if (topic && topic.formulaSheet) parts.push(trContent(topic.formulaSheet));
    }
    return parts.filter(Boolean).join("\n\n");
  }
  function currentLevelForTutor() {
    return (typeof getStudentLevel === "function") ? getStudentLevel(topicId) : "menengah";
  }

  function stripHtml(html) {
    const div = document.createElement("div");
    div.innerHTML = html || "";
    return (div.textContent || div.innerText || "").trim();
  }

  // Teks soal Latihan Soal topik ini + soal Kuis dari guru yang sedang aktif
  // (kalau ada) - dikirim ke tutor AI supaya tutor tahu soal MANA yang tidak
  // boleh langsung dijawab (lihat aturan "SOAL ASESMEN TERLINDUNGI" di system
  // prompt, apps-script/Code.gs) - siswa tetap boleh berdiskusi/menghitung
  // untuk soal fisika lain di luar daftar ini.
  function buildRestrictedQuestions() {
    const qs = [];
    const topic = (typeof TOPICS !== "undefined" ? TOPICS : []).find(tp => tp.id === topicId);
    if (topic && Array.isArray(topic.latihan)) {
      topic.latihan.forEach(q => {
        const txt = stripHtml(trContent(q.question));
        if (txt) qs.push(txt);
      });
    }
    if (typeof activeQuizData !== "undefined" && activeQuizData && Array.isArray(activeQuizData.questions)) {
      activeQuizData.questions.forEach(q => {
        if (q && q.question) qs.push(stripHtml(String(q.question)));
      });
    }
    return qs;
  }

  function normalize(text) {
    return (text || "").toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, " ");
  }

  // Cocokkan pesan siswa ke concept dengan skor keyword terbanyak yang cocok
  // (substring sederhana, bukan NLP). Mengembalikan concept terbaik atau null.
  // Dipakai HANYA di jalur fallback lokal (tanpa API key).
  function matchConcept(message) {
    const text = normalize(message);
    const kb = currentKB();
    let best = null;
    let bestScore = 0;
    kb.concepts.forEach(c => {
      let score = 0;
      c.keywords.forEach(kw => {
        if (text.includes(normalize(kw))) score += normalize(kw).split(" ").length; // frasa lebih panjang -> skor lebih tinggi
      });
      if (score > bestScore) { bestScore = score; best = c; }
    });
    return bestScore > 0 ? best : null;
  }

  function appendMessage(role, html) {
    const wrap = document.getElementById("chatbot-messages");
    const msg = document.createElement("div");
    msg.className = "chatbot-msg " + (role === "bot" ? "bot" : "user");
    msg.innerHTML = html;
    wrap.appendChild(msg);
    wrap.scrollTop = wrap.scrollHeight;
    if (role === "bot" && window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([msg]);
    }
    return msg;
  }

  function setSending(state) {
    sending = state;
    const input = document.getElementById("chatbot-input");
    const btn = document.querySelector("#chatbot-form button[type=submit]");
    if (input) input.disabled = state;
    if (btn) btn.disabled = state;
  }

  async function handleUserMessage(text) {
    text = (text || "").trim();
    if (!text || sending) return;
    appendMessage("user", escapeHTML(text));
    const token = (typeof getAccessToken === "function") ? getAccessToken() : "";
    if (!token || aiUnavailable) { handleLocalFallback(text); return; }
    askTutor(text, token);
  }

  function renderReply(el, text) {
    el.innerHTML = escapeHTML(text).replace(/\n/g, "<br>");
    const wrap = document.getElementById("chatbot-messages");
    wrap.scrollTop = wrap.scrollHeight;
  }

  function askTutor(message, token) {
    setSending(true);
    const myEpoch = epoch;
    const el = appendMessage("bot", "<em>" + t("chatbot.typing") + "</em>");
    el.classList.add("streaming");
    let reply = "";
    const finish = () => {
      el.classList.remove("streaming");
      setSending(false);
      const input = document.getElementById("chatbot-input");
      if (input && !document.getElementById("chatbot-panel").hidden) input.focus();
    };
    aiStream({
      mode: "chat",
      token,
      studentId: (typeof getStudentId === "function") ? getStudentId() : "",
      topicId: topicId,
      topic: currentTopicTitle(),
      level: currentLevelForTutor(),
      kbContext: buildKbContext(currentKB()),
      restrictedQuestions: buildRestrictedQuestions(),
      history: history,
      message: message
    }, {
      onDelta: (d) => { if (myEpoch !== epoch) return; reply += d; renderReply(el, reply); },
      onDone: (ev) => {
        if (myEpoch !== epoch) return finish();
        if (!reply.trim()) { el.innerHTML = t("chatbot.emptyreply"); return finish(); }
        if (ev.stop === "max_tokens") reply += "\n\n" + t("chatbot.truncated");
        renderReply(el, reply);
        if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise([el]).catch(() => {});
        history.push({ role: "user", text: message });
        history.push({ role: "model", text: reply });
        if (history.length > 24) history = history.slice(-24);
        finish();
      },
      onTimeout: () => { if (reply) renderReply(el, reply + "\n\n" + t("chatbot.truncated")); else el.innerHTML = t("chatbot.emptyreply"); finish(); },
      onError: (msg, status) => {
        if (myEpoch !== epoch) return finish();
        if (status === 503) aiUnavailable = true;
        el.innerHTML = escapeHTML(msg);
        finish();
        if (status === 503) handleLocalFallback(message);
      }
    });
  }

  // ---- Jalur cadangan (tanpa API key): skrip Socratic 2-giliran lokal ----
  function handleLocalFallback(text) {
    const matched = matchConcept(text);

    if (matched && (!pendingConcept || pendingConcept.id !== matched.id)) {
      // Konsep baru terdeteksi -> tanya balik dulu (gaya Socratic).
      pendingConcept = matched;
      appendMessage("bot", escapeHTML(matched.ask));
      return;
    }

    if (pendingConcept) {
      // Siswa sudah membalas pertanyaan balik -> ungkap penjelasan + lanjutan.
      appendMessage("bot", escapeHTML(pendingConcept.explain) + "<br><br><em>" + escapeHTML(pendingConcept.followUp) + "</em>");
      pendingConcept = null;
      return;
    }

    // Tidak ada konsep yang cocok sama sekali.
    appendMessage("bot", t("chatbot.fallback.nomatch"));
  }

  function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  return {
    init() {
      if (initialized) return;
      initialized = true;
      document.getElementById("chatbot-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("chatbot-input");
        const text = input.value;
        input.value = "";
        handleUserMessage(text);
      });
    },

    setTopic(id) {
      topicId = id;
      epoch += 1;
      pendingConcept = null;
      history = [];
      const label = document.getElementById("chatbot-topic-label");
      const kb = currentKB();
      const topic = (typeof TOPICS !== "undefined" ? TOPICS : []).find(tp => tp.id === id);
      label.textContent = (topic && (CHATBOT_KB[id] || topic.formulaSheet))
        ? t("chatbot.topiclabel.context", { title: trContent(topic.title) })
        : t("chatbot.topiclabel.nocontext");
      // SELALU mulai percakapan baru untuk topik ini, juga saat panel sedang
      // tertutup (dulu obrolan topik lama tetap terlihat begitu panel dibuka
      // lagi padahal riwayat/konteks tutor sudah untuk topik baru).
      document.getElementById("chatbot-messages").innerHTML = "";
      setSending(false);
      if (!document.getElementById("chatbot-panel").hidden) {
        appendMessage("bot", escapeHTML(trContent(kb.greeting)));
      }
    },

    // Membuka panel (kalau tertutup) lalu mengirim pesan atas nama siswa -
    // dipakai tombol "Minta Tutor..." di panduan tingkat belajar.
    ask(text) {
      const panel = document.getElementById("chatbot-panel");
      if (panel.hidden) { panel.hidden = false; this.onOpen(); }
      handleUserMessage(text);
    },

    onOpen() {
      const wrap = document.getElementById("chatbot-messages");
      if (wrap.children.length === 0) {
        appendMessage("bot", escapeHTML(trContent(currentKB().greeting)));
      }
    }
  };
})();
