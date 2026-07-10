// src/public/schriftlich-calc.js
// Live-Neuberechnung des Auswertungsbogens beim Tippen. Spiegelt die
// serverseitige Logik aus src/lib/schriftlich-scoring.js. Verbindlich bleibt
// die Berechnung beim Speichern.
(function () {
  const form = document.getElementById('bogen-form');
  if (!form) return;
  const modus = form.dataset.modus; // 'matrix' | 'einzel'

  // Feste Struktur (muss mit src/lib/schriftlich-struktur.js übereinstimmen).
  const TEILGEBIETE = {
    wiso: { gebunden: true, gebundenDivisor: 0.375, uFaktor: 1.2, streichung: true,
            felder: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'] },
    planung: { faktor: 1, felder: ['u1','u2','u3','u4','u5','u6','u7','u8','u9','u10'] },
    durchfuehrung: { divisor: 1.1,
            felder: ['u1','u2','u3','u4','u5','u6','u7','u8','u9','u10','u11'] },
    energie: { divisor: 0.5, felder: ['u1','u2','u3','u4','u5'] },
  };

  function feldWert(scope, tgKey, feld, pruefling) {
    const sel = pruefling
      ? `.feld-input[data-tg="${tgKey}"][data-feld="${feld}"][name^="p${pruefling}_"]`
      : `.feld-input[data-tg="${tgKey}"][data-feld="${feld}"]`;
    const input = scope.querySelector(sel);
    if (!input) return 0;
    const n = parseFloat(input.value);
    return Number.isFinite(n) ? n : 0;
  }

  // Ermittelt das gestrichene WISO-Feld: markiertes Radio oder automatisch das
  // letzte Feld.
  function gestrichenesFeld(scope, pruefling) {
    const name = pruefling ? `strich_p${pruefling}_wiso` : 'strich_wiso';
    const checked = scope.querySelector(`input[name="${name}"]:checked`);
    if (checked) return checked.value;
    const felder = TEILGEBIETE.wiso.felder;
    return felder[felder.length - 1];
  }

  function berechneTeilgebiet(scope, tgKey, pruefling) {
    const tg = TEILGEBIETE[tgKey];
    let strich = null;
    if (tg.streichung) strich = gestrichenesFeld(scope, pruefling);

    let summe = 0;
    for (const feld of tg.felder) {
      if (feld === strich) continue;
      summe += feldWert(scope, tgKey, feld, pruefling);
    }

    if (tg.gebunden) {
      const geb = feldWert(scope, tgKey, 'gebunden', pruefling);
      return Math.round(geb / tg.gebundenDivisor) + Math.round(summe * tg.uFaktor);
    }
    if (tg.divisor) return Math.round(summe / tg.divisor);
    return Math.round(summe * (tg.faktor || 1));
  }

  function neuBerechnen() {
    if (modus === 'matrix') {
      // Je Prüflingsspalte: aus den Namen p<id>_... die IDs ableiten.
      const ids = new Set();
      form.querySelectorAll('.feld-input').forEach((inp) => {
        const m = inp.name.match(/^p(\d+)_/);
        if (m) ids.add(m[1]);
      });
      ids.forEach((id) => {
        let gesamt = 0;
        for (const tgKey of Object.keys(TEILGEBIETE)) {
          const punkte = berechneTeilgebiet(form, tgKey, id);
          gesamt += punkte;
          const cell = form.querySelector(
            `.tg-ergebnis[data-tg="${tgKey}"][data-pruefling="${id}"]`
          );
          if (cell) cell.textContent = punkte;
        }
        const g = form.querySelector(`.gesamt-ergebnis[data-pruefling="${id}"]`);
        if (g) g.textContent = gesamt;
      });
    } else {
      let gesamt = 0;
      for (const tgKey of Object.keys(TEILGEBIETE)) {
        const punkte = berechneTeilgebiet(form, tgKey, null);
        gesamt += punkte;
        const cell = form.querySelector(`.tg-ergebnis[data-tg="${tgKey}"]`);
        if (cell) cell.textContent = punkte;
      }
      const g = form.querySelector('.gesamt-ergebnis');
      if (g) g.textContent = gesamt;
    }
  }

  form.addEventListener('input', neuBerechnen);
  form.addEventListener('change', neuBerechnen);
})();
