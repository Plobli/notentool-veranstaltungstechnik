// src/public/final-calc.js
// Finalisierungs-Ansicht der schriftlichen Prüfung. Übernimmt:
//  - Auto-Save der finalen Feldwerte (POST an data-feld-url),
//  - Live-Berechnung der Teilgebiet- und Gesamtpunkte über die AKTUELL
//    sichtbaren Feldwerte (inkl. noch unbestätigter Durchschnitts-Vorschläge),
//  - Vorschlags-Handling: ein vorbelegtes Feld (data-vorschlag) ist farblich
//    abgesetzt; sobald es fokussiert/geändert und gespeichert wird, gilt es als
//    bewusst gesetzter finaler Wert (normale Optik).
//
// Die Rechenformeln entsprechen 1:1 src/lib/schriftlich-scoring.js; die dafür
// nötigen Konstanten kommen als JSON aus der View (#final-struktur), damit hier
// keine abweichende zweite Wahrheit entsteht.
(function () {
  const root = document.getElementById('final-form');
  if (!root) return;
  const statusEl = document.getElementById('autosave-status');
  const feldUrl = root.dataset.feldUrl;
  const prueflingId = Number(root.dataset.pruefling);

  const strukturEl = document.getElementById('final-struktur');
  if (!strukturEl) return;
  const S = JSON.parse(strukturEl.textContent);
  // S = { teilgebiete: [{key,gebunden,gebundenDivisor,gebundenMax,uFaktor,
  //        divisor,faktor,gewicht,sperrfach,streichung,felder:[...]}],
  //        bestehen: 50, ungenuegend: 30 }
  const tgByKey = {};
  S.teilgebiete.forEach((t) => (tgByKey[t.key] = t));

  let statusTimer = null;
  function zeigeStatus(text, fehler) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle('autosave-fehler', Boolean(fehler));
    if (statusTimer) clearTimeout(statusTimer);
    if (!fehler) {
      statusTimer = setTimeout(() => {
        statusEl.textContent = 'Änderungen am finalen Bogen werden automatisch gespeichert.';
      }, 2000);
    }
  }

  // --- Live-Berechnung über die sichtbaren finalen Feldwerte ---

  // Aktueller Zahlenwert eines finalen Feldes (leer -> 0).
  function feldWert(tgKey, feld) {
    const inp = root.querySelector(
      `.feld-input[data-tg="${tgKey}"][data-feld="${feld}"]`
    );
    if (!inp || inp.value === '') return 0;
    const n = Number(inp.value);
    return Number.isFinite(n) ? n : 0;
  }

  // Aktuell gestrichenes WISO-Feld (markiertes Radio, sonst letztes Feld).
  function gestrichenesFeld(tg) {
    if (!tg.streichung) return null;
    const radio = root.querySelector(
      `.strich-input:checked`
    );
    // Streichung gilt nur innerhalb von WISO; die Radios teilen sich den Namen.
    if (radio && radio.value) return radio.value;
    return tg.felder[tg.felder.length - 1];
  }

  // Aus dem Vortermin übernommene Bereiche (key -> Punkte) oder {}.
  const uebernommen = S.uebernommen || {};

  // Teilgebiet-Punkte nach den Server-Formeln.
  function teilgebietPunkte(tg) {
    // Übernommener Bereich: fester Wert aus dem Vortermin, nicht neu berechnet.
    if (uebernommen[tg.key] !== undefined) return uebernommen[tg.key];
    const streich = gestrichenesFeld(tg);
    let summe = 0;
    for (const feld of tg.felder) {
      if (feld === streich) continue;
      summe += feldWert(tg.key, feld);
    }
    if (tg.gebunden) {
      const gebundenTeil = Math.round(feldWert(tg.key, 'gebunden') / tg.gebundenDivisor);
      const uTeil = Math.round(summe * tg.uFaktor);
      return gebundenTeil + uTeil;
    }
    if (tg.divisor) return Math.round(summe / tg.divisor);
    return Math.round(summe * (tg.faktor != null ? tg.faktor : 1));
  }

  // Gewichtetes Gesamt + Bestehen (wie pruefeBestehen()).
  function gesamtRechnen(punkteJeTg) {
    let sumGew = 0, sumG = 0, sperr = true, sechser = 0, fuenfer = 0;
    for (const tg of S.teilgebiete) {
      const p = punkteJeTg[tg.key] || 0;
      sumGew += p * (tg.gewicht || 0);
      sumG += tg.gewicht || 0;
      if (tg.sperrfach && p < S.bestehen) sperr = false;
      if (p < S.ungenuegend) sechser += 1;
      else if (p < S.bestehen) fuenfer += 1;
    }
    const gewichtet = sumG ? Math.round(sumGew / sumG) : 0;
    const bestanden = gewichtet >= S.bestehen && sperr && sechser === 0 && fuenfer <= 1;
    return { gewichtet, bestanden };
  }

  function statusKlassen(el, bestanden) {
    if (!el) return;
    el.classList.toggle('bestanden', Boolean(bestanden));
    el.classList.toggle('durchgefallen', !bestanden);
  }

  // Gleicht die Durchstreich-Optik eines Teilgebiets an das aktuell gestrichene
  // Feld an: nur dessen Zelle ist durchgestrichen, nur dessen Radio/Label aktiv.
  function streichungAnzeigen(tg) {
    if (!tg.streichung) return;
    const streich = gestrichenesFeld(tg);
    const inputs = root.querySelectorAll(
      `.feld-input[data-tg="${tg.key}"][data-pruefling="${prueflingId}"]`
    );
    inputs.forEach((inp) => {
      if (inp.dataset.feld === 'gebunden') return;
      const td = inp.closest('td');
      if (!td) return;
      const aktiv = inp.dataset.feld === streich;
      td.classList.toggle('zelle-gestrichen', aktiv);
      const radio = td.querySelector('.strich-input');
      const label = td.querySelector('.strich-btn');
      if (radio) radio.checked = aktiv;
      if (label) label.classList.toggle('aktiv', aktiv);
    });
  }

  // Aktualisiert die finale Ergebnis-Spalte (Punkte je Teilgebiet + Gesamt).
  function liveAktualisieren() {
    const punkteJeTg = {};
    for (const tg of S.teilgebiete) {
      streichungAnzeigen(tg);
      const p = teilgebietPunkte(tg);
      punkteJeTg[tg.key] = p;
      // Übernommene Bereiche behalten ihre „W"-Zelle unverändert.
      if (uebernommen[tg.key] !== undefined) continue;
      const cell = root.querySelector(
        `.tg-ergebnis[data-tg="${tg.key}"][data-pruefling="${prueflingId}"]`
      );
      if (cell) {
        cell.textContent = p;
        statusKlassen(cell, p >= S.bestehen);
      }
    }
    const { gewichtet, bestanden } = gesamtRechnen(punkteJeTg);
    const g = root.querySelector(`.gesamt-ergebnis[data-pruefling="${prueflingId}"]`);
    if (g) { g.textContent = gewichtet; statusKlassen(g, bestanden); }
    // Nur Gesamtpunkte/Bestehen sind clientseitig sicher rechenbar. Die
    // MEP-Möglichkeit (komplexe §20-Logik) bleibt dem Server überlassen: die
    // MEP-Anzeige wird hier NICHT überschrieben, sondern erst durch die Antwort
    // des nächsten Speicherns (mepAnwenden) aktualisiert. Ist der Bogen sicher
    // bestanden, kann keine MEP mehr nötig sein – dann räumen wir sie weg.
    const st = root.querySelector(`.gesamt-status[data-pruefling="${prueflingId}"]`);
    if (st) {
      const txt = st.querySelector('.gesamt-status-text');
      const mep = st.querySelector('.mep-hinweis');
      if (bestanden) {
        st.classList.remove('durchgefallen', 'mep');
        st.classList.add('bestanden');
        if (txt) txt.textContent = 'bestanden';
        if (mep) mep.textContent = '';
      } else {
        // Nicht bestanden: Bestanden-Optik entfernen, aber eine bestehende
        // MEP-Kennzeichnung (Klasse + Hinweis) unangetastet lassen.
        st.classList.remove('bestanden');
        const mepAktiv = st.classList.contains('mep');
        if (!mepAktiv) st.classList.add('durchgefallen');
        if (txt) txt.textContent = mepAktiv ? 'nicht bestanden · MEp möglich' : 'nicht bestanden';
      }
    }
  }

  // Wendet die MEP-Info aus einer Server-Antwort auf die finale Status-Zelle an.
  function mepAnwenden(data) {
    const st = root.querySelector(`.gesamt-status[data-pruefling="${prueflingId}"]`);
    if (!st) return;
    const txt = st.querySelector('.gesamt-status-text');
    const mep = st.querySelector('.mep-hinweis');
    if (data.bestanden) {
      st.classList.remove('durchgefallen', 'mep');
      st.classList.add('bestanden');
      if (txt) txt.textContent = 'bestanden';
      if (mep) mep.textContent = '';
    } else if (data.mepMoeglich) {
      st.classList.remove('bestanden', 'durchgefallen');
      st.classList.add('mep');
      if (txt) txt.textContent = 'nicht bestanden · MEp möglich';
      if (mep) mep.textContent = data.mepText || '';
    } else {
      st.classList.remove('bestanden', 'mep');
      st.classList.add('durchgefallen');
      if (txt) txt.textContent = 'nicht bestanden';
      if (mep) mep.textContent = '';
    }
  }

  // --- Speichern ---

  async function speichere(payload) {
    zeigeStatus('Speichern …');
    try {
      const res = await fetch(feldUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // Server liefert die maßgebliche MEP-/Bestehens-Info zurück; damit die
      // finale Status-Zelle inkl. MEP-Möglichkeit auf den Server-Stand bringen.
      mepAnwenden(await res.json());
      zeigeStatus('Gespeichert.');
    } catch (err) {
      zeigeStatus('Nicht gespeichert – bitte erneut versuchen.', true);
    }
  }

  // Ein Vorschlag-Feld wird zum echten finalen Wert: Optik zurücksetzen.
  function bestaetige(inp) {
    inp.classList.remove('feld-vorschlag');
    inp.removeAttribute('data-vorschlag');
  }

  // --- Ereignisse ---

  // Klick irgendwo in die Punkt-Zelle fokussiert das Eingabefeld – außer der
  // Klick galt dem Streich-Button (✗).
  root.addEventListener('click', (ev) => {
    if (ev.target.closest('.strich-btn')) return;
    const zelle = ev.target.closest('td.feld-zelle');
    if (!zelle) return;
    const inp = zelle.querySelector('.feld-input');
    if (inp && !inp.disabled && ev.target !== inp) inp.focus();
  });

  // Werte-Clamping beim Tippen + Live-Neuberechnung.
  root.addEventListener('input', (ev) => {
    const inp = ev.target;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    if (inp.value !== '') {
      const n = parseFloat(inp.value);
      if (Number.isFinite(n)) {
        const max = inp.max !== '' ? Number(inp.max) : Infinity;
        const min = inp.min !== '' ? Number(inp.min) : -Infinity;
        if (n > max) inp.value = String(max);
        else if (n < min) inp.value = String(min);
      }
    }
    // Sobald der Nutzer tippt, ist es kein bloßer Vorschlag mehr.
    bestaetige(inp);
    liveAktualisieren();
  });

  // Fokus auf ein Vorschlag-Feld: Optik bleibt bis zur Änderung; beim Speichern
  // (change) wird der (ggf. unveränderte) Vorschlag als finaler Wert übernommen.
  root.addEventListener('change', (ev) => {
    const inp = ev.target;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    bestaetige(inp);
    speichere({
      prueflingId,
      teilgebiet: inp.dataset.tg,
      feld: inp.dataset.feld,
      punkte: inp.value,
    });
    liveAktualisieren();
  });

  root.addEventListener('keydown', (ev) => {
    const inp = ev.target;
    if (ev.key !== 'Enter') return;
    if (!inp.classList || !inp.classList.contains('feld-input')) return;
    ev.preventDefault();
    inp.blur();
  });

  // Streichung (WISO): speichern + live neu rechnen.
  root.addEventListener('change', (ev) => {
    const radio = ev.target;
    if (!radio.classList || !radio.classList.contains('strich-input')) return;
    speichere({ prueflingId, teilgebiet: 'wiso', feld: radio.value, streichung: true });
    liveAktualisieren();
  });

  // Erststand berechnen (inkl. Vorschläge).
  liveAktualisieren();
})();
