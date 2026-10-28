/* tools/build-slides.mjs
   Mengubah sumber deck (materi/<topicId>/deck.json + slides/*.html, format
   Claude Slides 1920x1080) menjadi js/materi-slides.js yang dibaca penampil
   slide di tab Materi. Jalankan ulang setiap kali slide diedit:
       node tools/build-slides.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SECTION_LABELS = {
  s1: { id: "Pertemuan 1", en: "Meeting 1" },
  s2: { id: "Pertemuan 2", en: "Meeting 2" },
  s3: { id: "Pertemuan 3", en: "Meeting 3" },
  s4: { id: "Latihan & Ringkasan", en: "Practice & Summary" }
};
const out = {};
for (const topicId of fs.readdirSync(path.join(ROOT, "materi"))) {
  const dir = path.join(ROOT, "materi", topicId);
  if (!fs.existsSync(path.join(dir, "deck.json"))) continue;
  const deck = JSON.parse(fs.readFileSync(path.join(dir, "deck.json"), "utf8"));
  const slides = deck.order.map(id => {
    let html = fs.readFileSync(path.join(dir, "slides", id + ".html"), "utf8").trim();
    const m = /<aside>([\s\S]*?)<\/aside>/.exec(html);
    const notes = m ? m[1].trim() : "";
    html = html.replace(/<aside>[\s\S]*?<\/aside>/, "");
    const titleMatch = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/.exec(html);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : id;
    return { id, title, notes, html };
  });
  const sections = Object.entries(deck.sections || {}).map(([key, s]) => ({
    key, start: s.start, description: s.description, label: SECTION_LABELS[key] || { id: key, en: key }
  }));
  out[topicId] = { title: deck.title, fonts: Object.values(deck.faces || {}).map(f => f.href).filter(Boolean), sections, slides };
}
const banner = "/* AUTO-GENERATED oleh tools/build-slides.mjs dari folder materi/. Jangan edit manual. */\n";
fs.writeFileSync(path.join(ROOT, "js", "materi-slides.js"), banner + "window.MATERI_DECKS = " + JSON.stringify(out) + ";\n");
console.log("materi-slides.js:", Object.keys(out).map(k => `${k} (${out[k].slides.length} slides)`).join(", "));
