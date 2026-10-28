/* hero-slides.js - slideshow maskot di beranda (V10).
   Gambar berganti setiap 5,5 detik dengan crossfade halus, sambil zoom/geser
   pelan (efek Ken Burns). Berhenti saat tab tidak terlihat; tanpa animasi
   bila pengguna memilih "kurangi gerakan". */
(function () {
  const box = document.getElementById("hero-slides");
  if (!box) return;
  const slides = Array.from(box.querySelectorAll(".hero-slide"));
  const dots = Array.from(box.querySelectorAll(".hero-dots span"));
  if (slides.length < 2) return;
  const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pans = ["pan-l", "pan-r", ""];
  let i = 0, timer = null;
  function show(n) {
    slides[i].classList.remove("is-on", "pan-l", "pan-r");
    dots[i] && dots[i].classList.remove("on");
    i = n % slides.length;
    const s = slides[i];
    if (!reduce && pans[i]) s.classList.add(pans[i]);
    s.classList.add("is-on");
    dots[i] && dots[i].classList.add("on");
  }
  function start() { stop(); timer = setInterval(() => show(i + 1), 5500); }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  // muat gambar berikutnya lebih awal supaya transisi tidak berkedip
  slides.forEach(s => { s.loading = "eager"; });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  start();
})();
