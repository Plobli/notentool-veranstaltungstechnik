// src/public/hinweise-toggle.js
// Schalter im Footer: blendet alle erklärenden .hinweis-Texte aus/ein.
// Einstellung wird in localStorage gemerkt und gilt seitenübergreifend.
(function () {
  const KEY = 'hinweiseAus';
  const checkbox = document.getElementById('hinweise-schalter');
  if (!checkbox) return;

  function anwenden(aus) {
    document.documentElement.classList.toggle('hinweise-aus', aus);
    checkbox.checked = !aus;
  }

  anwenden(localStorage.getItem(KEY) === '1');

  checkbox.addEventListener('change', () => {
    const aus = !checkbox.checked;
    localStorage.setItem(KEY, aus ? '1' : '0');
    anwenden(aus);
  });
})();
