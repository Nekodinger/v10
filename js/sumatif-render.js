/* ============================================================
   sumatif-render.js - tampilan "lembar tes" Tes Sumatif (V10)
   ------------------------------------------------------------
   Dipakai bersama oleh Panel Guru (pratinjau & penilaian) dan halaman
   siswa (mengerjakan). Menghasilkan HTML lembar tes bergaya kertas A4:
   kop judul, petunjuk, lalu bagian A/B/C. Teks soal boleh berisi LaTeX
   di antara $...$ (dirender MathJax setelah disisipkan).
     SumatifRender.paper(test, { mode, answers, manual, showKeys })
       mode "preview" : guru melihat lembar tes (kunci opsional)
       mode "student" : siswa mengerjakan (radio + kotak jawaban kosong
                        bertanda data-answer-key, diisi js/sumatif-student.js)
       mode "review"  : guru menilai jawaban siswa (skor per bagian)
   ============================================================ */
(function (root) {
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  // Teks multi-baris: pertahankan baris baru, LaTeX tetap utuh untuk MathJax.
  function txt(s) { return esc(s).replace(/\n/g, "<br>"); }
  function tr(key, fallback, vars) {
    if (typeof t === "function") { const v = t(key, vars); if (v && v !== key) return v; }
    return fallback;
  }
  function letter(i) { return String.fromCharCode(65 + i); }
  function marksOf(it) { return it.type === "structured" ? (it.parts || []).reduce((a, p) => a + (Number(p.marks) || 0), 0) : (Number(it.marks) || 0); }
  function totalMarks(test) { return (test.sections || []).reduce((a, S) => a + (S.items || []).reduce((x, it) => x + marksOf(it), 0), 0); }

  function inkHtml(v) {
    return v && v.ink ? `<img class="ts-ink-view" src="${esc(v.ink)}" alt="${esc(tr("ts.ink.alt", "Tulisan tangan siswa"))}">` : "";
  }
  function answerView(v) {
    if (!v || (!v.text && !v.ink)) return `<p class="ts-empty">${esc(tr("ts.review.empty", "Tidak dijawab"))}</p>`;
    return `${v.text ? `<div class="ts-answer-text">${txt(v.text)}</div>` : ""}${inkHtml(v)}`;
  }
  function scoreInput(key, max, manual) {
    const v = manual && manual[key] !== undefined && manual[key] !== null ? manual[key] : "";
    return `<label class="ts-score"><span>${esc(tr("ts.review.score", "Skor"))}</span><input type="number" min="0" max="${max}" step="0.5" data-score-key="${esc(key)}" value="${esc(v)}"><span>/ ${max}</span></label>`;
  }
  function keyBox(label, text) {
    return text ? `<div class="ts-key"><b>${esc(label)}</b> ${txt(text)}</div>` : "";
  }

  function mcq(it, o) {
    const ans = o.answers ? o.answers[it.id] : undefined;
    const opts = (it.options || []).map((op, i) => {
      if (o.mode === "student") {
        return `<li><label class="ts-opt"><input type="radio" name="ts-${esc(it.id)}" value="${i}" data-mcq="${esc(it.id)}" ${ans === i ? "checked" : ""}><span class="ts-opt-letter">${letter(i)}.</span> <span>${txt(op)}</span></label></li>`;
      }
      const isKey = (o.showKeys || o.mode === "review") && it.correct === i;
      const chosen = o.mode === "review" && ans === i;
      return `<li class="${isKey ? "is-key" : ""} ${chosen ? (isKey ? "chosen-right" : "chosen-wrong") : ""}"><span class="ts-opt-letter">${letter(i)}.</span> <span>${txt(op)}</span>${chosen ? ` <span class="pill ${isKey ? "ok" : "bad"}">${esc(tr("ts.review.chosen", "dipilih"))}</span>` : ""}</li>`;
    }).join("");
    const short = (it.options || []).every(op => String(op).replace(/\$[^$]*\$/g, "xx").length <= 34);
    let extra = "";
    if (o.mode === "review") extra = `<p class="small">${ans === undefined ? esc(tr("ts.review.empty", "Tidak dijawab")) : ""} <b>${ans === it.correct ? `+${it.marks}` : "0"}</b> / ${it.marks}</p>`;
    if ((o.showKeys || o.mode === "review") && it.explanation) extra += keyBox(tr("ts.key.expl", "Pembahasan:"), it.explanation);
    return `<ol class="ts-options ${short ? "two" : ""}">${opts}</ol>${extra}`;
  }

  function tableHtml(rows) {
    if (!rows || !rows.length) return "";
    return `<table class="ts-data"><tbody>${rows.map((r, ri) => `<tr>${r.map((c, ci) => (ci === 0 ? `<th>${txt(c)}</th>` : `<td>${txt(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table>`;
  }

  function structured(it, o) {
    let html = tableHtml(it.table);
    html += (it.parts || []).map(p => {
      const key = it.id + "." + p.id;
      let body = "";
      if (o.mode === "student") body = `<div class="ts-answer" data-answer-key="${esc(key)}"></div>`;
      else if (o.mode === "review") body = `<div class="ts-answer-review">${answerView(o.answers ? o.answers[key] : null)}</div>${keyBox(tr("ts.key.rubric", "Pedoman:"), p.key)}${scoreInput(key, p.marks, o.manual)}`;
      else if (o.showKeys) body = keyBox(tr("ts.key.rubric", "Pedoman:"), p.key);
      else body = `<div class="ts-answer-blank"></div>`;
      return `<div class="ts-part"><div class="ts-part-head"><span class="ts-part-label">${esc(p.id)}.</span> <span class="ts-part-text">${txt(p.text)}</span><span class="ts-marks">[${p.marks}]</span></div>${body}</div>`;
    }).join("");
    return html;
  }

  function open(it, o) {
    const key = it.id;
    if (o.mode === "student") return `<div class="ts-answer" data-answer-key="${esc(key)}"></div>`;
    if (o.mode === "review") return `<div class="ts-answer-review">${answerView(o.answers ? o.answers[key] : null)}</div>${keyBox(tr("ts.key.rubric", "Pedoman:"), it.key)}${scoreInput(key, it.marks, o.manual)}`;
    if (o.showKeys) return keyBox(tr("ts.key.rubric", "Pedoman:"), it.key);
    return `<div class="ts-answer-blank tall"></div>`;
  }

  function item(it, o) {
    const head = `<div class="ts-item-head"><span class="ts-no">${esc(it.id)}.</span> <div class="ts-stem">${txt(it.stem)}</div>${it.type !== "structured" ? `<span class="ts-marks">[${marksOf(it)}]</span>` : `<span class="ts-marks">[${marksOf(it)}]</span>`}</div>`;
    const body = it.type === "mcq" ? mcq(it, o) : it.type === "structured" ? structured(it, o) : open(it, o);
    return `<div class="ts-item ts-type-${esc(it.type)}" id="ts-item-${esc(it.id)}">${head}${body}</div>`;
  }

  function paper(test, opts) {
    const o = Object.assign({ mode: "preview", answers: null, manual: null, showKeys: false }, opts || {});
    if (!test) return "";
    const total = totalMarks(test);
    const head = `<header class="ts-head">
        <p class="ts-eyebrow">${esc(tr("ts.paper.eyebrow", "Asesmen sumatif"))}</p>
        <h2 class="ts-title">${esc(test.title)}</h2>
        <p class="ts-meta">${esc(tr("ts.paper.meta", "Waktu {{min}} menit · Skor maksimum {{max}}", { min: test.durationMin || 60, max: total }).replace("{{min}}", test.durationMin || 60).replace("{{max}}", total))}</p>
      </header>
      ${test.instructions ? `<div class="ts-instructions"><b>${esc(tr("ts.paper.instructions", "Petunjuk."))}</b> ${txt(test.instructions)}</div>` : ""}`;
    const secs = (test.sections || []).map(S => `<section class="ts-section" id="ts-sec-${esc(S.id)}">
        <h3 class="ts-sec-title">${esc(S.title)}</h3>${S.note ? `<p class="ts-sec-note">${txt(S.note)}</p>` : ""}
        ${(S.items || []).map(it => item(it, o)).join("")}
      </section>`).join("");
    return `<div class="ts-paper ts-mode-${esc(o.mode)}">${head}${secs}</div>`;
  }

  root.SumatifRender = { paper, totalMarks, marksOf, esc, txt };
})(typeof window !== "undefined" ? window : globalThis);
