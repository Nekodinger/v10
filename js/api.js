/* ============================================================
   api.js - klien backend V9 (dipakai situs siswa & Panel Guru)
   ------------------------------------------------------------
   apiCall(mode, body)  -> POST /api/backend, mengembalikan JSON
                           (field `error` bila gagal; tidak melempar
                           kecuali jaringan putus).
   aiStream(body, handlers) -> POST /api/ai (Server-Sent Events):
       handlers.onDelta(text), onPhase(phase), onDone(info),
       onTimeout(), onError(message). Mengembalikan { abort() }.
   Content-Type "text/plain" dipakai supaya permintaan lintas-origin
   (mis. dari GitHub Pages) tidak memicu preflight CORS.
   ============================================================ */
function apiUrl(path) {
  const base = (typeof API_BASE === "string" ? API_BASE : "").replace(/\/$/, "");
  return base + path;
}

// ID perangkat acak (per browser) untuk kunci "satu perangkat" kerja kelompok.
function getDeviceId() {
  const K = "emergent.deviceId";
  let id = "";
  try { id = localStorage.getItem(K) || ""; } catch (e) { /* abaikan */ }
  if (!id) {
    id = "d_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join("");
    try { localStorage.setItem(K, id); } catch (e) { /* abaikan */ }
  }
  return id;
}
// Token akun siswa & ID perangkat ikut terkirim otomatis di setiap permintaan siswa.
function authFields() {
  const out = { deviceId: getDeviceId() };
  if (typeof getAccessToken === "function" && getAccessToken()) out.token = getAccessToken();
  try { const sc = localStorage.getItem("physicsSandbox.classSessionCode"); if (sc) out.sessionCode = sc; } catch (e) { /* abaikan */ }
  return out;
}
function notifyApiCode(data) {
  if (!data || !data.code || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("emergent-api-code", { detail: data }));
}

async function apiCall(mode, body) {
  const payload = Object.assign({ lang: typeof getLang === "function" ? getLang() : "id" }, authFields(), body || {}, { mode });
  let resp;
  try {
    resp = await fetch(apiUrl("/api/backend"), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (e) {
    const err = new Error(typeof t === "function" ? t("api.network") : "Network error");
    err.network = true;
    throw err;
  }
  let data;
  try { data = await resp.json(); } catch (e) { data = { error: "HTTP " + resp.status }; }
  if (!resp.ok && !data.error) data.error = "HTTP " + resp.status;
  data._status = resp.status;
  notifyApiCode(data);
  return data;
}

function aiStream(body, h) {
  h = h || {};
  const controller = new AbortController();
  const payload = Object.assign({ lang: typeof getLang === "function" ? getLang() : "id" }, authFields(), body || {});
  (async () => {
    let resp;
    try {
      resp = await fetch(apiUrl("/api/ai"), {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch (e) {
      if (controller.signal.aborted) return h.onAbort && h.onAbort();
      return h.onError && h.onError(typeof t === "function" ? t("api.network") : "Network error");
    }
    const ct = resp.headers.get("content-type") || "";
    if (!ct.includes("text/event-stream")) {
      let msg = "HTTP " + resp.status;
      let code = null;
      try { const d = await resp.json(); if (d.error) msg = d.error; code = d.code || null; notifyApiCode(d); } catch (e) { /* abaikan */ }
      return h.onError && h.onError(msg, resp.status, code);
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "", finished = false;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = raw.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("");
          if (!line) continue;
          let ev;
          try { ev = JSON.parse(line); } catch (e) { continue; }
          if (ev.t === "delta") h.onDelta && h.onDelta(ev.text);
          else if (ev.t === "phase") h.onPhase && h.onPhase(ev.phase);
          else if (ev.t === "start") h.onStart && h.onStart(ev);
          else if (ev.t === "done") { finished = true; h.onDone && h.onDone(ev); }
          else if (ev.t === "timeout") { finished = true; h.onTimeout && h.onTimeout(); }
          else if (ev.t === "error") { finished = true; h.onError && h.onError(ev.error); }
        }
      }
      // Stream berhenti tanpa event "done"/"timeout": koneksi terputus di tengah jalan.
      if (!finished) h.onTimeout && h.onTimeout({ network: true });
    } catch (e) {
      if (controller.signal.aborted) return h.onAbort && h.onAbort();
      h.onTimeout && h.onTimeout({ network: true });
    }
  })();
  return { abort: () => controller.abort() };
}
