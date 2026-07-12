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

  // Punkte: speichern beim Verlassen.
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.classList && el.classList.contains('fg-punkte')) {
      speichere(el.dataset.kriterium, 'punkte', el.value);
    }
  });

  // Enter im Punktefeld: speichern und Zeilenumbruch verhindern.
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter') return;
    if (el.classList && el.classList.contains('fg-punkte')) {
      ev.preventDefault();
      el.blur();
    }
  });

  // --- Protokoll: Eintragsliste je Kriterium ---

  // Textarea an ihren Inhalt anpassen (Auto-Grow, kein Scrollbalken).
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  // Liest die aktuelle Eintragsliste eines Protokoll-Containers.
  function leseProtokoll(container) {
    const eintraege = [];
    container.querySelectorAll('.fg-eintrag').forEach((row) => {
      const ta = row.querySelector('.fg-eintrag-text');
      eintraege.push({
        text: ta ? ta.value : '',
        bewertung: row.dataset.bewertung || '',
      });
    });
    return eintraege;
  }

  function speichereProtokoll(container) {
    speichere(container.dataset.kriterium, 'protokoll', leseProtokoll(container));
  }

  // Erzeugt ein neues Eintrags-Element (wie im Server-Markup).
  function neuerEintrag() {
    const div = document.createElement('div');
    div.className = 'fg-eintrag';
    div.dataset.bewertung = '';
    div.innerHTML =
      '<textarea class="fg-eintrag-text" rows="1" placeholder="Frage / Antwort notieren …"></textarea>' +
      '<div class="fg-bewertung" role="group" aria-label="Antwort bewerten">' +
      '<button type="button" class="fg-btn-korrekt" title="Antwort korrekt">✓</button>' +
      '<button type="button" class="fg-btn-falsch" title="Antwort falsch">✗</button>' +
      '</div>';
    return div;
  }

  function fuegeEintragHinzu(container, fokus) {
    const liste = container.querySelector('.fg-eintraege');
    const el = neuerEintrag();
    liste.appendChild(el);
    const ta = el.querySelector('.fg-eintrag-text');
    autoGrow(ta);
    if (fokus && ta) ta.focus();
    return el;
  }

  // Setzt/entfernt die Bewertung eines Eintrags (Toggle, drei Zustände).
  function setzeBewertung(row, wert) {
    row.dataset.bewertung = row.dataset.bewertung === wert ? '' : wert;
    const container = row.closest('.fg-protokoll');
    if (container) speichereProtokoll(container);
  }

  // Auto-Grow initial für alle vorhandenen Textareas.
  root.querySelectorAll('.fg-eintrag-text').forEach(autoGrow);

  // Tippen: Textarea mitwachsen lassen.
  root.addEventListener('input', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('fg-eintrag-text')) {
      autoGrow(ev.target);
    }
  });

  // Verlassen eines Eintrag-Textfeldes: speichern.
  root.addEventListener('change', (ev) => {
    if (ev.target.classList && ev.target.classList.contains('fg-eintrag-text')) {
      const container = ev.target.closest('.fg-protokoll');
      if (container) speichereProtokoll(container);
    }
  });

  // Enter im Eintrag-Textfeld: neuen Eintrag anlegen (kein Zeilenumbruch).
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    if (!el.classList || !el.classList.contains('fg-eintrag-text')) return;
    ev.preventDefault();
    const container = el.closest('.fg-protokoll');
    speichereProtokoll(container);
    fuegeEintragHinzu(container, true);
  });

  // Klicks: +Eintrag und Bewertungs-Buttons.
  root.addEventListener('click', (ev) => {
    const add = ev.target.closest('.fg-eintrag-add');
    if (add) {
      fuegeEintragHinzu(add.closest('.fg-protokoll'), true);
      return;
    }
    const korrekt = ev.target.closest('.fg-btn-korrekt');
    if (korrekt) {
      setzeBewertung(korrekt.closest('.fg-eintrag'), 'korrekt');
      return;
    }
    const falsch = ev.target.closest('.fg-btn-falsch');
    if (falsch) {
      setzeBewertung(falsch.closest('.fg-eintrag'), 'falsch');
    }
  });
})();
