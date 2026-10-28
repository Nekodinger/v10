/* Memastikan setiap kunci t("...") / data-i18n di kode ada di kamus i18n. */
import fs from "node:fs";
global.localStorage = { getItem: () => null };
global.document = { documentElement: {}, querySelectorAll: () => [] };
const src = fs.readFileSync("js/i18n.js", "utf8") + "\n" + fs.readFileSync("js/i18n-v9.js", "utf8") + "\n" + (fs.existsSync("js/i18n-v10.js") ? fs.readFileSync("js/i18n-v10.js", "utf8") : "") + "\nglobalThis.__D = I18N_STRINGS;";
(0, eval)(src);
const D = globalThis.__D;
const files = process.argv.slice(2);
const missing = new Map();
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  const re = /\bt\(\s*"([a-zA-Z0-9_.-]+)"|data-i18n(?:-html|-placeholder|-title|-aria|-alt)?="([a-zA-Z0-9_.-]+)"|\bT\(\s*"([a-zA-Z0-9_.-]+)"/g;
  let m;
  while ((m = re.exec(s))) {
    const k = m[1] || m[2] || m[3];
    if (!D[k]) { if (!missing.has(k)) missing.set(k, new Set()); missing.get(k).add(f); }
    else if (!D[k].en || !D[k].id) { if (!missing.has(k + " (one lang)")) missing.set(k + " (one lang)", new Set([f])); }
  }
  // dynamic t("prefix." + x) not checkable
}
for (const [k, fs_] of missing) console.log(k, "<-", [...fs_].join(","));
console.log("missing:", missing.size);
