// src/public/schriftlich-calc.js
// Live-Neuberechnung des Auswertungsbogens (Matrix) beim Tippen. Spiegelt die
// serverseitige Logik aus src/lib/schriftlich-scoring.js. Verbindlich bleibt die
// Berechnung beim Speichern. Die Fragenanzahl je Teilgebiet ergibt sich aus den
// tatsächlich gerenderten Feldern; sie wirkt erst nach dem Speichern auf die
// Zeilenanzahl.
(function () {
  const form = document.getElementById('bogen-form');
  if (!form) return;

  // WISO-Parameter fest (siehe src/lib/schriftlich-struktur.js).
  const WISO = { gebundenDivisor: 0.375, uFaktor: 1.2 };

  function feldWert(tgKey, feld, pruefling) {
    const input = form.querySelector(
      `.feld-input[data-tg="${tgKey}"][data-feld="${feld}"][name^="p${pruefling}_"]`
    );
    if (!input) return 0;
    const n = parseFloat(input.value);
    return Number.isFinite(n) ? n : 0;
  }

  // Ermittelt je (Prüfling, Teilgebiet) die tatsächlich vorhandenen U-Felder.
  function uFelderVon(tgKey, pruefling) {
    const inputs = form.querySelectorAll(
      `.feld-input[data-tg="${tgKey}"][name^="p${pruefling}_"]`
    );
    const felder = [];
    inputs.forEach((inp) => {
      const feld = inp.dataset.feld;
      if (feld && feld !== 'gebunden') felder.push(feld);
    });
    return felder;
  }

  // Gestrichenes WISO-Feld: markiertes Radio oder automatisch das letzte Feld.
  function gestrichenesFeld(tgKey, pruefling) {
    const checked = form.querySelector(
      `input[name="strich_p${pruefling}_wiso"]:checked`
    );
    if (checked) return checked.value;
    const felder = uFelderVon(tgKey, pruefling);
    return felder[felder.length - 1] || null;
  }

  function berechneTeilgebiet(tgKey, pruefling) {
    const felder = uFelderVon(tgKey, pruefling);
    const istWiso = tgKey === 'wiso';
    const strich = istWiso ? gestrichenesFeld(tgKey, pruefling) : null;

    let summe = 0;
    for (const feld of felder) {
      if (feld === strich) continue;
      summe += feldWert(tgKey, feld, pruefling);
    }

    if (istWiso) {
      const geb = feldWert(tgKey, 'gebunden', pruefling);
      return Math.round(geb / WISO.gebundenDivisor) + Math.round(summe * WISO.uFaktor);
    }
    // Konfigurierbare Teilgebiete: Normierung auf 100 -> divisor = anzahl*10/100.
    const anzahl = felder.length || 1;
    const divisor = (anzahl * 10) / 100;
    return Math.round(summe / divisor);
  }

  // Aktualisiert die Durchstreich-Darstellung der WISO-Zellen einer Spalte.
  function aktualisiereStreichung(pruefling) {
    const strich = gestrichenesFeld('wiso', pruefling);
    const inputs = form.querySelectorAll(
      `.feld-input[data-tg="wiso"][name^="p${pruefling}_"]`
    );
    inputs.forEach((inp) => {
      if (inp.dataset.feld === 'gebunden') return;
      const td = inp.closest('td');
      if (!td) return;
      const gestrichen = inp.dataset.feld === strich;
      td.classList.toggle('zelle-gestrichen', gestrichen);
      const label = td.querySelector('.strich-btn');
      if (label) {
        label.classList.toggle('aktiv', gestrichen);
        const text = label.querySelector('.strich-text');
        if (text) text.textContent = gestrichen ? '✗ gestrichen' : '✗ streichen';
      }
    });
  }

  function tgKeys() {
    const keys = new Set();
    form.querySelectorAll('.feld-input').forEach((inp) => {
      if (inp.dataset.tg) keys.add(inp.dataset.tg);
    });
    return keys;
  }

  function neuBerechnen() {
    const ids = new Set();
    form.querySelectorAll('.feld-input').forEach((inp) => {
      const m = inp.name.match(/^p(\d+)_/);
      if (m) ids.add(m[1]);
    });
    ids.forEach((id) => {
      aktualisiereStreichung(id);
      let gesamt = 0;
      tgKeys().forEach((tgKey) => {
        const punkte = berechneTeilgebiet(tgKey, id);
        gesamt += punkte;
        const cell = form.querySelector(
          `.tg-ergebnis[data-tg="${tgKey}"][data-pruefling="${id}"]`
        );
        if (cell) cell.textContent = punkte;
      });
      const g = form.querySelector(`.gesamt-ergebnis[data-pruefling="${id}"]`);
      if (g) g.textContent = gesamt;
    });
  }

  form.addEventListener('input', neuBerechnen);
  form.addEventListener('change', neuBerechnen);
})();
