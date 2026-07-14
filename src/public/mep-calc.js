// src/public/mep-calc.js
// Mündliche Ergänzungsprüfung (§20 Abs. 3): Auswahl EINES schriftlichen Bereichs
// (der schlechter als "ausreichend" ist und den Ausschlag geben kann) plus eine
// Liste von Protokoll-Zeilen (Thema, Begründung, Skalenwert) wie beim
// Fachgespräch. Auto-Save von Bereichswahl + Zeilen; der Server rechnet das
// Bereichsergebnis 2:1 (schriftlich:mündlich) und das Bestehen zurück.
(function () {
  const root = document.getElementById('mep-form');
  if (!root) return;
  const prueflingId = root.dataset.pruefling;
  const terminSlug = root.dataset.terminSlug;
  const feldUrl = `/pruefung/${terminSlug}/mep/${prueflingId}/feld`;
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

  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function gewaehltesTeilgebiet() {
    const gewaehlt = root.querySelector('input[name="mep-teilgebiet"]:checked');
    return gewaehlt ? gewaehlt.value : null;
  }

  // Server-Antwort (Ergebnis nach MEP) anwenden.
  function ergebnisseAnwenden(data) {
    const muendlich = root.querySelector('.mep-muendlich-wert');
    if (muendlich) muendlich.textContent = data.muendlich === null ? '–' : data.muendlich;

    const schr = root.querySelector('.mep-schriftlich-wert');
    if (schr) schr.textContent = data.schriftlich === null ? '–' : data.schriftlich;

    const bereich = root.querySelector('.mep-bereich-nach');
    if (bereich) {
      bereich.textContent = data.wirksam ? data.bereichNachMep : '–';
      const bestanden = data.wirksam && data.bereichNachMep >= 50;
      bereich.classList.toggle('bestanden', bestanden);
      bereich.classList.toggle('durchgefallen', data.wirksam && !bestanden);
    }

    const status = root.querySelector('.mep-status');
    if (status) {
      status.classList.toggle('bestanden', data.wirksam && data.bestanden);
      status.classList.toggle('durchgefallen', data.wirksam && !data.bestanden);
      const txt = status.querySelector('.mep-status-text');
      if (txt) {
        txt.textContent = !data.wirksam
          ? '–'
          : data.bestanden ? 'bestanden' : 'nicht bestanden';
      }
    }
  }

  function leseZeilen() {
    const zeilen = [];
    root.querySelectorAll('.fg-zeile').forEach((row) => {
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

  function nummeriere() {
    root.querySelectorAll('.fg-zeile .fg-zeile-nr .fg-nr').forEach((el, i) => {
      el.textContent = i + 1;
    });
  }

  async function speichere() {
    const teilgebiet = gewaehltesTeilgebiet();
    if (!teilgebiet) return;
    zeigeStatus('Speichern …');
    try {
      const res = await fetch(feldUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teilgebiet, zeilen: leseZeilen() }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      ergebnisseAnwenden(await res.json());
      zeigeStatus('Gespeichert.');
    } catch (err) {
      zeigeStatus('Nicht gespeichert – bitte erneut versuchen.', true);
    }
  }

  // Neues Zeilen-Element (entspricht dem Server-Markup).
  function neueZeile() {
    const tr = document.createElement('tr');
    tr.className = 'fg-zeile';
    tr.dataset.skala = '';
    const skalaButtons = Array.from(root.querySelectorAll('.fg-zeile:first-child .fg-skala-btn'))
      .map((b) => `<button type="button" class="fg-skala-btn" data-skala="${b.dataset.skala}" title="${b.title}">${b.textContent}</button>`)
      .join('');
    tr.innerHTML =
      '<td class="fg-zeile-nr"><span class="fg-nr"></span>' +
        '<button type="button" class="fg-zeile-del" title="Zeile löschen" aria-label="Zeile löschen">✕</button></td>' +
      '<td class="fg-zelle"><textarea class="fg-thema" rows="1"></textarea></td>' +
      '<td class="fg-zelle"><textarea class="fg-begruendung" rows="1"></textarea></td>' +
      '<td class="fg-skala-zelle"><div class="fg-skala-wahl" role="group" aria-label="Bewertung">' + skalaButtons + '</div></td>';
    return tr;
  }

  function fuegeZeileHinzu(fokus) {
    const koerper = root.querySelector('.fg-zeilen');
    const tr = neueZeile();
    koerper.appendChild(tr);
    nummeriere();
    const ta = tr.querySelector('.fg-thema');
    autoGrow(ta);
    if (fokus && ta) ta.focus();
    return tr;
  }

  // Initiales Auto-Grow.
  root.querySelectorAll('.fg-thema, .fg-begruendung').forEach(autoGrow);

  root.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.classList && (el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) {
      autoGrow(el);
    }
  });

  // Verlassen eines Textfeldes: speichern.
  root.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.classList && (el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) {
      speichere();
    }
    // Bereichswechsel: sofort speichern (überschreibt den Bereich).
    if (el.name === 'mep-teilgebiet') {
      speichere();
    }
  });

  // Enter im Thema/Begründung: neue Zeile (Shift+Enter = Umbruch).
  root.addEventListener('keydown', (ev) => {
    const el = ev.target;
    if (ev.key !== 'Enter' || ev.shiftKey) return;
    if (!el.classList || !(el.classList.contains('fg-thema') || el.classList.contains('fg-begruendung'))) return;
    ev.preventDefault();
    speichere();
    fuegeZeileHinzu(true);
  });

  // Klicks: +Zeile und Skala-Buttons.
  root.addEventListener('click', (ev) => {
    const add = ev.target.closest('.fg-zeile-add');
    if (add) {
      fuegeZeileHinzu(true);
      return;
    }
    const del = ev.target.closest('.fg-zeile-del');
    if (del) {
      const row = del.closest('.fg-zeile');
      const koerper = row.closest('.fg-zeilen');
      if (koerper.querySelectorAll('.fg-zeile').length <= 1) {
        row.querySelectorAll('textarea').forEach((t) => { t.value = ''; autoGrow(t); });
        row.dataset.skala = '';
      } else {
        row.remove();
      }
      nummeriere();
      speichere();
      return;
    }
    const skalaBtn = ev.target.closest('.fg-skala-btn');
    if (skalaBtn) {
      const row = skalaBtn.closest('.fg-zeile');
      const wert = skalaBtn.dataset.skala;
      row.dataset.skala = row.dataset.skala === wert ? '' : wert;
      speichere();
    }
  });
})();
