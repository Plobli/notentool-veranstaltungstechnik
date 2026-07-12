// src/public/fachgespraech-calc.js
// Auto-Save des Fachgespräch-Bogens: Punkte und Protokoll werden beim Verlassen
// des Feldes (bzw. Enter im Punktefeld) gespeichert. Der Server berechnet die
// Einzelergebnisse, das Gesamt, den Bestehens-Status und die Note und liefert
// sie zurück; damit werden die entsprechenden Zellen verbindlich aktualisiert.
(function () {
  const root = document.getElementById('fg-form');
  if (!root) return;
  const prueflingId = root.dataset.pruefling;
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

  function formatDe(n) {
    return Number(n).toLocaleString('de-DE');
  }

  function ergebnisseAnwenden(data) {
    for (const [key, k] of Object.entries(data.kriterien)) {
      const cell = root.querySelector(`.fg-ergebnis[data-kriterium="${key}"]`);
      if (cell) cell.textContent = formatDe(k.ergebnis);
    }
    const gesamt = root.querySelector('.fg-gesamt');
    if (gesamt) {
      gesamt.textContent = data.gesamtpunkte;
      gesamt.classList.toggle('bestanden', data.bestanden);
      gesamt.classList.toggle('durchgefallen', !data.bestanden);
    }
    const status = root.querySelector('.fg-status');
    if (status) {
      status.classList.toggle('bestanden', data.bestanden);
      status.classList.toggle('durchgefallen', !data.bestanden);
      const txt = status.querySelector('.fg-status-text');
      if (txt) txt.textContent = data.bestanden ? 'bestanden' : 'nicht bestanden';
      const note = status.querySelector('.fg-note');
      if (note) note.textContent = 'Note: ' + data.note;
    }
  }

  async function speichere(kriterium, feld, wert) {
    zeigeStatus('Speichern …');
    try {
      const res = await fetch(`/fachgespraech/${prueflingId}/feld`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kriterium, feld, wert }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      ergebnisseAnwenden(data);
      zeigeStatus('Gespeichert.');
    } catch (err) {
      zeigeStatus('Nicht gespeichert – bitte erneut versuchen.', true);
    }
  }

  // Punkte hart auf 0..100 klemmen beim Tippen.
  root.addEventListener('input', (ev) => {
    const inp = ev.target;
    if (!inp.classList || !inp.classList.contains('fg-punkte')) return;
    if (inp.value === '') return;
    const n = parseFloat(inp.value);
    if (!Number.isFinite(n)) return;
    if (n > 100) inp.value = '100';
    else if (n < 0) inp.value = '0';
  });

  // Speichern beim Verlassen (change deckt blur + Enter-Wertänderung ab).
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('fg-punkte')) {
      speichere(el.dataset.kriterium, 'punkte', el.value);
    } else if (el.classList && el.classList.contains('fg-protokoll')) {
      speichere(el.dataset.kriterium, 'protokoll', el.value);
    }
  });

  // Enter im Punktefeld: speichern und Zeilenumbruch verhindern.
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter') return;
    if (!el.classList || !el.classList.contains('fg-punkte')) return;
    ev.preventDefault();
    el.blur();
  });
})();
