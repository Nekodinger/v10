/* ============================================================
   ui-v11.js - perilaku kecil tampilan yang dipakai semua halaman
   (siswa, Panel Guru, Panel Admin).
   - Judul modal + tombol tutup menempel di atas kotak (CSS sticky);
     di sini hanya menambah garis bayangan tipis begitu isi kotak
     digulir, supaya judul terlihat terpisah dari isi di bawahnya.
   ============================================================ */
(function () {
  function sync(box) {
    const head = box.querySelector(":scope > .modal-head");
    if (head) head.classList.toggle("stuck", box.scrollTop > 2);
  }
  document.addEventListener("scroll", e => {
    const box = e.target;
    if (box && box.classList && box.classList.contains("modal-box")) sync(box);
  }, true);
})();
