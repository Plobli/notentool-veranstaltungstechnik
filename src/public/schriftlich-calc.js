// src/public/schriftlich-calc.js
// Auto-Save des Auswertungsbogens (Matrix): Punkte werden beim Verlassen eines
// Feldes bzw. bei Enter gespeichert, Streichungen beim Anklicken. Der Server
// berechnet die Teilgebiet- und Gesamtpunkte und liefert sie zurück; damit
// werden die Ergebniszeilen verbindlich aktualisiert. Die Fragenanzahl je
// Bereich wird separat über ihr eigenes kleines Formular gespeichert.
(function () {
  const root = document.getElementById('bogen-form');
  if (!root) return;
  const statusEl = document.getElementById('autosave-status');

  let statusTimer = null;
  function zeigeStatus(text, fehler) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('autosave-fehler', Boolean(fehler));
    if (statusTimer) clearTimeout(statusTimer);
    if (!fehler) {
      statusTimer = setTimeout(() => {
        statusEl.textContent = 'Eingaben werden automatisch gespeichert.';
      }, 2000);
    }
  }

  // Setzt die Bestanden-/Durchgefallen-Klassen einer Ergebniszelle.
  function statusKlassen(el, bestanden) {
    if (!el) return;
    el.classList.toggle('bestanden', Boolean(bestanden));
    el.classList.toggle('durchgefallen', !bestanden);
  }

  // Aktualisiert die Ergebniszeilen eines Prüflings aus der Server-Antwort.
  function ergebnisseAnwenden(prueflingId, data) {
    for (const [tgKey, erg] of Object.entries(data.teilgebiete)) {
      const cell = root.querySelector(
        `.tg-ergebnis[data-tg="${tgKey}"][data-pruefling="${prueflingId}"]`
      );
      if (cell) {
        cell.textContent = erg.punkte;
        statusKlassen(cell, erg.bestanden);
      }
      // WISO-Durchstreichung an die Server-Wahrheit angleichen.
      if (erg.gestrichenesFeld !== undefined && erg.gestrichenesFeld !== null) {
        aktualisiereStreichungAnzeige(prueflingId, tgKey, erg.gestrichenesFeld);
      }
    }
    const g = root.querySelector(`.gesamt-ergebnis[data-pruefling="${prueflingId}"]`);
    if (g) {
      g.textContent = data.gesamt;
      statusKlassen(g, data.bestanden);
    }
    const statusZelle = root.querySelector(
      `.gesamt-status[data-pruefling="${prueflingId}"]`
    );
    if (statusZelle) {
      statusZelle.classList.remove('bestanden', 'durchgefallen', 'mep');
      const textEl = statusZelle.querySelector('.gesamt-status-text');
      const mepEl = statusZelle.querySelector('.mep-hinweis');
      let statusText;
      if (data.bestanden) {
        statusText = 'bestanden';
        statusZelle.classList.add('bestanden');
      } else if (data.mepMoeglich) {
        statusText = 'nicht bestanden · MEP möglich';
        statusZelle.classList.add('mep');
      } else {
        statusText = 'nicht bestanden';
        statusZelle.classList.add('durchgefallen');
      }
      if (textEl) textEl.textContent = statusText;
      else statusZelle.textContent = statusText;
      if (mepEl) mepEl.textContent = data.mepMoeglich ? (data.mepText || '') : '';
    }
  }

  // Setzt die Durchstreich-Optik der Zellen eines Teilgebiets/Prüflings.
  function aktualisiereStreichungAnzeige(prueflingId, tgKey, gestrichenesFeld) {
    const inputs = root.querySelectorAll(
      `.feld-input[data-tg="${tgKey}"][data-pruefling="${prueflingId}"]`
    );
    inputs.forEach((inp) => {
      if (inp.dataset.feld === 'gebunden') return;
      const td = inp.closest('td');
      if (!td) return;
      td.classList.toggle('zelle-gestrichen', inp.dataset.feld === gestrichenesFeld);
      const radio = td.querySelector('.strich-input');
      const label = td.querySelector('.strich-btn');
      const aktiv = inp.dataset.feld === gestrichenesFeld;
      if (radio) radio.checked = aktiv;
      if (label) label.classList.toggle('aktiv', aktiv);
    });
  }

  async function speichere(payload) {
    zeigeStatus('Speichern …');
    try {
      const res = await fetch('/schriftlich/feld', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      ergebnisseAnwenden(payload.prueflingId, data);
      zeigeStatus('Gespeichert.');
    } catch (err) {
      zeigeStatus('Nicht gespeichert – bitte erneut versuchen.', true);
    }
  }

  // Harte Wertbegrenzung beim Tippen: nie über max (10 bzw. gebundenMax) und
  // nie unter min (0). Werte außerhalb werden sofort auf die Grenze gesetzt.
  root.addEventListener('input', (ev) => {
    const inp = ev.target;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    if (inp.value === '') return;
    const n = parseFloat(inp.value);
    if (!Number.isFinite(n)) return;
    const max = inp.max !== '' ? Number(inp.max) : Infinity;
    const min = inp.min !== '' ? Number(inp.min) : -Infinity;
    if (n > max) inp.value = String(max);
    else if (n < min) inp.value = String(min);
  });

  // Punktefeld: speichern beim Verlassen (change deckt blur+Enter-Wertänderung ab).
  root.addEventListener('change', (ev) => {
    const inp = ev.target;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    speichere({
      prueflingId: Number(inp.dataset.pruefling),
      teilgebiet: inp.dataset.tg,
      feld: inp.dataset.feld,
      punkte: inp.value,
    });
  });

  // Enter im Punktefeld: Speichern auslösen und Reload verhindern.
  root.addEventListener('keydown', (ev) => {
    const inp = ev.target;
    if (ev.key !== 'Enter') return;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    ev.preventDefault();
    inp.blur();
  });

  // Streichung: Radio-Klick speichert sofort.
  root.addEventListener('change', (ev) => {
    const radio = ev.target;
    if (!radio.classList || !radio.classList.contains('strich-input')) return;
    speichere({
      prueflingId: Number(radio.dataset.pruefling),
      teilgebiet: 'wiso',
      feld: radio.value,
      streichung: true,
    });
  });
})();
