// src/public/fachgespraech-calc.js
// Fachgespräch-Bogen nach IHK-Protokollierbogen: je Bereich eine Tabelle mit
// Bewertungszeilen (Thema, Begründung, Skalenwert). Auto-Save der Zeilenliste je
// Bereich; der Server berechnet Bereichspunkte, Gesamt, Status und Note zurück.
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

  // Textarea an Inhalt anpassen (Auto-Grow).
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  // Ergebnisse aus der Server-Antwort anwenden.
  function ergebnisseAnwenden(data) {
    for (const [key, k] of Object.entries(data.kriterien)) {
      const wert = root.querySelector(`.fg-bereich-punkte[data-kriterium="${key}"] .fg-ergebnis-wert`);
      if (wert) wert.textContent = k.punkte;
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

  // Liest die Zeilenliste eines Bereichs.
  function leseZeilen(bereich) {
    const zeilen = [];
    bereich.querySelectorAll('.fg-zeile').forEach((row) => {
      const thema = row.querySelector('.fg-thema');
      const begr = row.querySelector('.fg-begruendung');
      zeilen.push({
        thema: thema ? thema.value : '',
        begruendung: begr ? begr.value : '',
        skala: row.dataset.skala || '',
      });
    });
    return zeilen;
  }

  // Zeilennummern nach Änderungen neu setzen.
  function nummeriere(bereich) {
    bereich.querySelectorAll('.fg-zeile .fg-zeile-nr').forEach((td, i) => {
      td.textContent = i + 1;
    });
  }

  async function speichere(bereich) {
    zeigeStatus('Speichern …');
    try {
      const res = await fetch(`/fachgespraech/${prueflingId}/feld`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kriterium: bereich.dataset.kriterium, zeilen: leseZeilen(bereich) }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ergebnisseAnwenden(await res.json());
      zeigeStatus('Gespeichert.');
    } catch (err) {
      zeigeStatus('Nicht gespeichert – bitte erneut versuchen.', true);
    }
  }

  // Neues Zeilen-Element (entspricht dem Server-Markup).
  function neueZeile(bereich) {
    const tr = document.createElement('tr');
    tr.className = 'fg-zeile';
    tr.dataset.skala = '';
    const skalaButtons = Array.from(bereich.querySelectorAll('.fg-zeile:first-child .fg-skala-btn'))
      .map((b) => `<button type="button" class="fg-skala-btn" data-skala="${b.dataset.skala}" title="${b.title}">${b.textContent}</button>`)
      .join('');
    tr.innerHTML =
      '<td class="fg-zeile-nr"></td>' +
      '<td class="fg-zelle"><textarea class="fg-thema" rows="1"></textarea></td>' +
      '<td class="fg-zelle"><textarea class="fg-begruendung" rows="1"></textarea></td>' +
      '<td class="fg-skala-zelle"><div class="fg-skala-wahl" role="group" aria-label="Bewertung">' + skalaButtons + '</div></td>';
    return tr;
  }

  function fuegeZeileHinzu(bereich, fokus) {
    const koerper = bereich.querySelector('.fg-zeilen');
    const tr = neueZeile(bereich);
    koerper.appendChild(tr);
    nummeriere(bereich);
    const ta = tr.querySelector('.fg-thema');
    autoGrow(ta);
    if (fokus && ta) ta.focus();
    return tr;
  }

  // Initiales Auto-Grow.
  root.querySelectorAll('.fg-thema, .fg-begruendung').forEach(autoGrow);

  // Tippen: Textarea mitwachsen.
  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.classList && (el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) {
      autoGrow(el);
    }
  });

  // Verlassen eines Textfeldes: Bereich speichern.
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.classList && (el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) {
      const bereich = el.closest('.fg-bereich');
      if (bereich) speichere(bereich);
    }
  });

  // Enter im Thema/Begründung: neue Zeile (kein Zeilenumbruch); Shift+Enter = Umbruch.
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    if (!el.classList || !(el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) return;
    ev.preventDefault();
    const bereich = el.closest('.fg-bereich');
    speichere(bereich);
    fuegeZeileHinzu(bereich, true);
  });

  // Klicks: Info-Button, +Zeile und Skala-Buttons.
  root.addEventListener('click', (ev) => {
    const info = ev.target.closest('.fg-info');
    if (info) {
      const header = info.closest('.fg-bereich-header');
      const beschreibung = header && header.querySelector('.fg-beschreibung');
      if (beschreibung) {
        const sichtbar = !beschreibung.hasAttribute('hidden');
        if (sichtbar) beschreibung.setAttribute('hidden', '');
        else beschreibung.removeAttribute('hidden');
        info.setAttribute('aria-expanded', String(!sichtbar));
      }
      return;
    }
    const add = ev.target.closest('.fg-zeile-add');
    if (add) {
      fuegeZeileHinzu(add.closest('.fg-bereich'), true);
      return;
    }
    const skalaBtn = ev.target.closest('.fg-skala-btn');
    if (skalaBtn) {
      const row = skalaBtn.closest('.fg-zeile');
      const wert = skalaBtn.dataset.skala;
      // Toggle: erneuter Klick auf denselben Wert setzt zurück.
      row.dataset.skala = row.dataset.skala === wert ? '' : wert;
      const bereich = row.closest('.fg-bereich');
      if (bereich) speichere(bereich);
    }
  });
})();
