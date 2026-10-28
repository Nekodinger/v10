/* Konfigurasi MathJax (dipisah dari HTML supaya Content-Security-Policy tidak perlu inline script). */
window.MathJax = { tex: { inlineMath: [["$", "$"], ["\\(", "\\)"]] }, svg: { fontCache: "global" } };
