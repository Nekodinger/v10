/* ============================================================
   teacher-export.js - ekspor rekap & jawaban siswa (Panel Guru)
   ------------------------------------------------------------
   xlsx(data, summaries, name): workbook Excel berisi lembar
     Rekap, Konfirmasi, LKPD, Data Eksperimen, Latihan, Kuis,
     Makerspace, Checkpoint. Dibuat di browser (SheetJS, vendor/).
   pdf(data, summaries, name): laporan PDF A4 (jsPDF + AutoTable):
     halaman rekap kelas lalu satu bagian per siswa.
   `data` = hasil mode teacher_export / teacher_student_detail.
   ============================================================ */
window.TeacherExport = (function () {
  const loc = () => (getLang() === "en" ? "en-GB" : "id-ID");
  const ts = ms => (ms ? new Date(ms).toLocaleString(loc(), { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
  const strip = h => { const d = document.createElement("div"); d.innerHTML = h || ""; return (d.textContent || "").replace(/\s+/g, " ").trim(); };
  const pctv = v => (v == null ? "" : Math.round(v));
  const tab = i => (i >= 0 ? [t("tab.materi"), t("tab.eksperimen"), t("tab.latihan"), t("tab.lab")][Math.min(i, 3)] : "-");
  const sname = st => (st && st.student ? st.student.name : "") || "";
  const sclass = st => (st && st.student ? st.student.className : "") || "";
  const sid = st => (st && st.student ? st.student.studentId : "") || "";
  const fileStamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const safeName = n => String(n).replace(/[^\w\-]+/g, "_").slice(0, 60);

  function recapRows(summaries) {
    return summaries.map(s => ({
      [t("teacher.rec.student")]: s.name, [t("teacher.rec.class")]: s.className,
      [t("teacher.rec.group")]: (s.groupName || "") + (s.isLeader ? " (" + t("teacher.rec.leader") + ")" : ""),
      [t("teacher.rec.stage")]: tab(s.stageIndex),
      [t("teacher.rec.slides") + " (%)"]: pctv(s.slidesPct),
      [t("teacher.rec.materi") + " (%)"]: pctv(s.materiBest), [t("teacher.xl.materitries")]: s.materiTries,
      [t("teacher.xl.ekscheck") + " (%)"]: pctv(s.eksBest),
      [t("teacher.xl.lkpdmode")]: s.lkpd ? modeName("magnetic-fields", s.lkpd.mode) : "",
      [t("teacher.xl.lkpdprogress") + " (%)"]: s.lkpd ? pctv(s.lkpd.progress) : "",
      [t("teacher.xl.lkpdscore") + " (%)"]: s.lkpd ? pctv(s.lkpd.score) : "",
      [t("teacher.xl.lkpdstatus")]: s.lkpd ? (s.lkpd.status === "submitted" ? t("teacher.rec.submitted") : t("teacher.xl.draft")) : "",
      [t("teacher.xl.latihanfirst")]: s.latihan.total ? `${s.latihan.right}/${s.latihan.total}` : "",
      [t("teacher.xl.quizavg") + " (%)"]: s.quizCount ? pctv(s.quizAvg) : "", [t("teacher.xl.quizcount")]: s.quizCount,
      [t("teacher.xl.sims")]: s.simCount, [t("teacher.xl.edits")]: s.editCount,
      [t("teacher.xl.gateeks")]: s.gateEks ? t("teacher.gatestatus." + s.gateEks) : "",
      [t("teacher.xl.gatelab")]: s.gateLab ? t("teacher.gatestatus." + s.gateLab) : "",
      [t("teacher.rec.last")]: ts(s.lastSeen)
    }));
  }

  function collect(data) {
    const out = { checks: [], lkpd: [], exp: [], lat: [], quiz: [], lab: [], gates: [] };
    data.students.forEach(st => {
      const base = { [t("teacher.rec.student")]: sname(st), [t("teacher.rec.class")]: sclass(st) };
      st.events.forEach(e => {
        if (e.kind === "materi_check" || e.kind === "eksperimen_check") {
          (e.payload && e.payload.answers || []).forEach((a, i) => out.checks.push({ ...base, [t("teacher.xl.kind")]: e.kind === "materi_check" ? t("teacher.detail.materi") : t("teacher.detail.eksperimen"), [t("teacher.xl.time")]: ts(e.createdAt), [t("teacher.xl.score") + " (%)"]: pctv(e.score), "No": i + 1, [t("teacher.xl.question")]: a.q, [t("teacher.xl.answer")]: a.picked || "", [t("teacher.xl.correct")]: a.correct ? 1 : 0 }));
        } else if (e.kind === "latihan") {
          out.lat.push({ ...base, [t("teacher.xl.item")]: latihanLabel(e.item), [t("teacher.xl.time")]: ts(e.createdAt), [t("teacher.xl.answer")]: e.payload && e.payload.revealed ? t("teacher.detail.revealed") : (e.payload ? e.payload.picked : ""), [t("teacher.xl.correct")]: e.score == null ? "" : (e.score >= 100 ? 1 : 0) });
        } else if (e.kind === "lab_generate" || e.kind === "lab_edit") {
          out.lab.push({ ...base, [t("teacher.xl.time")]: ts(e.createdAt), [t("teacher.xl.kind")]: e.kind === "lab_edit" ? t("teacher.detail.edit") : t("teacher.detail.generate"), [t("teacher.xl.prompt")]: ((e.payload && (e.payload.instruction || e.payload.prompt)) || "").slice(0, 32000), [t("teacher.xl.htmlkb")]: e.payload && e.payload.html ? Math.round(e.payload.html.length / 102.4) / 10 : "" });
        }
      });
      st.lkpd.forEach(l => {
        lkpdAnswerRows(l.topicId, l).forEach(r => out.lkpd.push({ ...base, [t("teacher.xl.lkpdmode")]: modeName(l.topicId, l.mode), [t("teacher.xl.lkpdprogress") + " (%)"]: pctv(l.progress), [t("teacher.xl.lkpdscore") + " (%)"]: pctv(l.score), [t("teacher.xl.lkpdstatus")]: l.status === "submitted" ? t("teacher.rec.submitted") + " " + ts(l.submittedAt) : t("teacher.xl.draft"), [t("teacher.xl.item")]: r.item, [t("teacher.xl.question")]: r.question, [t("teacher.xl.answer")]: r.answer, [t("teacher.xl.correct")]: r.correct == null ? "" : (r.correct ? 1 : 0), [t("teacher.xl.firsttry")]: r.first === undefined ? "" : r.first, [t("teacher.xl.tries")]: r.tries || "" }));
      });
      st.experiments.forEach(x => {
        const an = x.analysis || {};
        (x.rows || []).forEach(r => {
          const vals = (r.values || []).filter(v => v != null);
          const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          out.exp.push({ ...base, [t("teacher.xl.lkpdmode")]: modeName(x.topicId, x.variant), "I (A)": r.I, "Δm1 (g)": (r.values || [])[0] ?? "", "Δm2 (g)": (r.values || [])[1] ?? "", "Δm3 (g)": (r.values || [])[2] ?? "", [t("teacher.xl.mean") + " (g)"]: mean == null ? "" : Number(mean.toFixed(3)), "F (N)": mean == null ? "" : Number((mean * 9.81 / 1000).toPrecision(4)), [t("lkpd.fit.gradient")]: an.gradient != null ? Number(Number(an.gradient).toPrecision(4)) : "", [t("teacher.xl.bstudent")]: studentB(x, st.lkpd), [t("teacher.xl.bfit")]: an.B_fromFit != null ? Number(Number(an.B_fromFit).toPrecision(4)) : "", [t("teacher.detail.aifeedback")]: x.feedback || "", [t("teacher.xl.time")]: ts(x.updatedAt) });
        });
      });
      st.quizzes.forEach(z => (z.questions || []).forEach((q, i) => {
        const v = (z.answers || {})[q.id];
        out.quiz.push({ ...base, [t("teacher.xl.time")]: ts(z.submittedAt), [t("teacher.xl.score") + " (%)"]: pctv(z.score), "No": i + 1, [t("teacher.xl.question")]: q.question, [t("teacher.xl.answer")]: v == null || v === "" ? "" : (q.type === "mcq" ? String.fromCharCode(65 + v) + ". " + (q.options[v] || "") : v), [t("teacher.xl.correct")]: q.type === "mcq" ? (v === q.correct ? 1 : 0) : "", [t("teacher.xl.modelanswer")]: q.modelAnswer || "" });
      }));
      st.gates.forEach(g => out.gates.push({ ...base, [t("teacher.gate.th.stage")]: g.stage === "eksperimen" ? t("teacher.gate.stage.eksperimen") : t("teacher.gate.stage.lab"), Status: t("teacher.gatestatus." + g.status), [t("teacher.gate.th.summary")]: g.summary || "", [t("teacher.xl.note")]: g.note || "", [t("teacher.gate.th.submitted")]: ts(g.submittedAt), [t("teacher.xl.decided")]: ts(g.decidedAt) }));
    });
    return out;
  }

  function sheet(rows, emptyLabel) {
    const ws = rows.length ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([[emptyLabel]]);
    if (rows.length) {
      const keys = Object.keys(rows[0]);
      ws["!cols"] = keys.map(k => ({ wch: Math.min(60, Math.max(k.length + 2, ...rows.slice(0, 200).map(r => String(r[k] == null ? "" : r[k]).length + 1))) }));
      ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: keys.length - 1 } }) };
    }
    return ws;
  }

  function xlsx(data, summaries, name) {
    if (!window.XLSX) { alert("XLSX library not loaded"); return; }
    const c = collect(data);
    const wb = XLSX.utils.book_new();
    const none = t("teacher.detail.none");
    XLSX.utils.book_append_sheet(wb, sheet(recapRows(summaries), none), t("teacher.xl.sheet.recap"));
    XLSX.utils.book_append_sheet(wb, sheet(c.checks, none), t("teacher.xl.sheet.checks"));
    XLSX.utils.book_append_sheet(wb, sheet(c.lkpd, none), "LKPD");
    XLSX.utils.book_append_sheet(wb, sheet(c.exp, none), t("teacher.xl.sheet.exp"));
    XLSX.utils.book_append_sheet(wb, sheet(c.lat, none), t("teacher.xl.sheet.latihan"));
    XLSX.utils.book_append_sheet(wb, sheet(c.quiz, none), t("teacher.xl.sheet.quiz"));
    XLSX.utils.book_append_sheet(wb, sheet(c.lab, none), "Makerspace");
    XLSX.utils.book_append_sheet(wb, sheet(c.gates, none), t("teacher.xl.sheet.gates"));
    wb.Props = { Title: "Emergent - " + t("teacher.xl.sheet.recap"), Author: "Emergent", CreatedDate: new Date() };
    XLSX.writeFile(wb, `${safeName(name)}-${fileStamp()}.xlsx`);
  }

  /* ---------- PDF ---------- */
  // Font standar PDF (Helvetica) hanya mendukung Latin-1, jadi simbol & LaTeX
  // diubah ke bentuk yang terbaca (mis. "Δm" -> "delta m", "$F = BIL$" -> "F = BIL").
  function pdfText(s) {
    let x = String(s == null ? "" : s);
    x = x.replace(/\\dfrac\{([^}]*)\}\{([^}]*)\}|\\frac\{([^}]*)\}\{([^}]*)\}/g, (m, a, b, c, d) => `(${a || c})/(${b || d})`)
      .replace(/\\text\{([^}]*)\}/g, "$1").replace(/\\mathrm\{([^}]*)\}/g, "$1")
      .replace(/\\(times|cdot)/g, "x").replace(/\\propto/g, " proportional to ").replace(/\\Delta\s*/g, "delta ").replace(/\\theta/g, "theta").replace(/\\mu_?0?/g, "mu0").replace(/\\pi/g, "pi").replace(/\\sin/g, "sin").replace(/\\cos/g, "cos").replace(/\\(qquad|quad|,|;|!)/g, " ").replace(/\\to/g, "->").replace(/\\le(q)?/g, "<=").replace(/\\ge(q)?/g, ">=").replace(/\\approx/g, "~").replace(/\\/g, "")
      .replace(/\$/g, "").replace(/[{}]/g, "");
    const map = { "Δ": "delta ", "θ": "theta", "μ": "mu", "π": "pi", "λ": "lambda", "ω": "omega", "→": "->", "⟹": "=>", "∝": " prop. ", "≈": "~", "×": "x", "−": "-", "–": "-", "—": "-", "²": "^2", "³": "^3", "⁻": "^-", "¹": "1", "₀": "0", "₁": "1", "₂": "2", "₃": "3", "⊙": "(.)", "⊗": "(x)", "√": "sqrt", "±": "+/-", "≤": "<=", "≥": ">=", "‘": "'", "’": "'", "“": '"', "”": '"', "…": "...", "·": "-", "Ω": "ohm" };
    x = x.replace(/[^\x00-\xFF]/g, ch => (map[ch] !== undefined ? map[ch] : "?"));
    return x.replace(/\s+/g, " ").trim();
  }
  function pdf(data, summaries, name) {
    if (!window.jspdf || !window.jspdf.jsPDF) { alert("PDF library not loaded"); return; }
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const W = doc.internal.pageSize.getWidth();
    const ink = [29, 29, 27], verm = [184, 57, 31], muted = [111, 108, 100], stone = [237, 234, 227];
    const header = (title, sub) => {
      doc.setFillColor(30, 31, 28); doc.rect(0, 0, W, 54, "F");
      doc.setTextColor(241, 238, 230); doc.setFont("times", "normal"); doc.setFontSize(18); doc.text("Emergent", 36, 33);
      doc.setFont("courier", "normal"); doc.setFontSize(8.5); doc.setTextColor(189, 184, 172); doc.text(pdfText(t("teacher.brandsub").toUpperCase() + "  -  " + ts(data.exportedAt || Date.now())), W - 36, 33, { align: "right" });
      doc.setTextColor(...ink); doc.setFont("times", "normal"); doc.setFontSize(20); doc.text(pdfText(title), 36, 88);
      if (sub) { doc.setFont("helvetica", "normal"); doc.setFontSize(9.5); doc.setTextColor(...muted); doc.text(pdfText(sub), 36, 104); }
    };
    const tableOpts = (startY, head, body, colStyles) => ({
      startY, head: [head.map(pdfText)], body: body.map(r => r.map(pdfText)), theme: "grid", margin: { left: 36, right: 36 },
      styles: { font: "helvetica", fontSize: 8.2, cellPadding: 4, textColor: ink, lineColor: [189, 184, 172], lineWidth: 0.4, overflow: "linebreak" },
      headStyles: { fillColor: stone, textColor: ink, fontStyle: "bold" }, columnStyles: colStyles || {},
      didDrawPage: () => { doc.setFont("courier", "normal"); doc.setFontSize(8); doc.setTextColor(...muted); doc.text(String(doc.internal.getNumberOfPages()), W - 36, doc.internal.pageSize.getHeight() - 18, { align: "right" }); }
    });
    // Halaman rekap
    if (summaries.length) {
      header(t("teacher.pdf.recap"), t("teacher.pdf.recap.sub", { n: summaries.length }));
      const rows = recapRows(summaries);
      const keys = Object.keys(rows[0]).filter(k => k !== t("teacher.xl.materitries") && k !== t("teacher.xl.quizcount") && k !== t("teacher.xl.edits"));
      doc.autoTable(tableOpts(118, keys, rows.map(r => keys.map(k => r[k] == null ? "" : String(r[k])))));
    }
    // Per siswa
    data.students.forEach(st => {
      const c = collect({ students: [st] });
      doc.addPage();
      const nm = sname(st) || sid(st);
      header(nm, `${t("teacher.rec.class")}: ${sclass(st) || "-"}   ${t("teacher.rec.last")}: ${ts(st.student && st.student.lastSeen)}`);
      let y = 118;
      const mine = arr => arr;
      const block = (title, rows, keys, widths) => {
        if (!rows.length) return;
        if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = 60; }
        doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.setTextColor(...verm); doc.text(pdfText(title), 36, y); y += 6;
        doc.autoTable(tableOpts(y, keys, rows.map(r => keys.map(k => r[k] == null ? "" : String(r[k]))), widths));
        y = doc.lastAutoTable.finalY + 22;
      };
      const K = k => t(k);
      block(t("teacher.xl.sheet.checks"), mine(c.checks), [K("teacher.xl.kind"), K("teacher.xl.time"), K("teacher.xl.score") + " (%)", "No", K("teacher.xl.question"), K("teacher.xl.answer"), K("teacher.xl.correct")], { 4: { cellWidth: 300 } });
      block("LKPD", mine(c.lkpd), [K("teacher.xl.lkpdmode"), K("teacher.xl.item"), K("teacher.xl.question"), K("teacher.xl.answer"), K("teacher.xl.correct"), K("teacher.xl.tries")], { 2: { cellWidth: 260 }, 3: { cellWidth: 220 } });
      block(t("teacher.xl.sheet.exp"), mine(c.exp), [K("teacher.xl.lkpdmode"), "I (A)", "Δm1 (g)", "Δm2 (g)", "Δm3 (g)", K("teacher.xl.mean") + " (g)", "F (N)", K("lkpd.fit.gradient"), K("teacher.xl.bstudent"), K("teacher.detail.aifeedback")], { 9: { cellWidth: 220 } });
      block(t("teacher.xl.sheet.latihan"), mine(c.lat), [K("teacher.xl.item"), K("teacher.xl.time"), K("teacher.xl.answer"), K("teacher.xl.correct")]);
      block(t("teacher.xl.sheet.quiz"), mine(c.quiz), [K("teacher.xl.time"), "No", K("teacher.xl.question"), K("teacher.xl.answer"), K("teacher.xl.correct")], { 2: { cellWidth: 320 }, 3: { cellWidth: 220 } });
      block("Makerspace", mine(c.lab), [K("teacher.xl.time"), K("teacher.xl.kind"), K("teacher.xl.prompt"), K("teacher.xl.htmlkb")], { 2: { cellWidth: 480 } });
      block(t("teacher.xl.sheet.gates"), mine(c.gates), [K("teacher.gate.th.stage"), "Status", K("teacher.gate.th.summary"), K("teacher.xl.note"), K("teacher.gate.th.submitted")], { 2: { cellWidth: 340 } });
    });
    doc.save(`${safeName(name)}-${fileStamp()}.pdf`);
  }
  return { xlsx, pdf, pdfText };
})();
