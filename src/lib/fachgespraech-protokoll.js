// src/lib/fachgespraech-protokoll.js
//
// Das Protokoll je Kriterium ist eine Liste von Einträgen (zitierte
// Gesprächspunkte) mit je einem Text und einer Bewertung. Gespeichert wird die
// Liste als JSON in der Spalte fachgespraech_bewertung.protokoll.

const BEWERTUNGEN = ['', 'korrekt', 'falsch'];

// Normalisiert einen einzelnen Eintrag auf { text, bewertung }.
function normEintrag(e) {
  const text = e && typeof e.text === 'string' ? e.text : '';
  const bewertung =
    e && BEWERTUNGEN.includes(e.bewertung) ? e.bewertung : '';
  return { text, bewertung };
}

// Nimmt beliebige Eingabe (Array oder Alt-Text) und liefert eine saubere
// Eintragsliste. Leere Einträge (kein Text und keine Bewertung) werden entfernt.
function normProtokollListe(eingabe) {
  let liste;
  if (Array.isArray(eingabe)) {
    liste = eingabe.map(normEintrag);
  } else if (typeof eingabe === 'string' && eingabe.trim() !== '') {
    // Alt-Format: reiner Text -> ein Eintrag.
    liste = [{ text: eingabe, bewertung: '' }];
  } else {
    liste = [];
  }
  return liste.filter((e) => e.text.trim() !== '' || e.bewertung !== '');
}

// Liest den in der DB gespeicherten Protokoll-Wert (JSON-String, Alt-Text oder
// null) und gibt immer eine Eintragsliste zurück.
function ladeProtokollListe(gespeichert) {
  if (gespeichert === null || gespeichert === undefined || gespeichert === '') {
    return [];
  }
  let parsed = gespeichert;
  if (typeof gespeichert === 'string') {
    try {
      parsed = JSON.parse(gespeichert);
    } catch {
      // Kein JSON -> als Alt-Text behandeln.
      parsed = gespeichert;
    }
  }
  return normProtokollListe(parsed);
}

// Serialisiert eine Eintragsliste für die Speicherung (JSON oder null, wenn leer).
function serialisiereProtokoll(eingabe) {
  const liste = normProtokollListe(eingabe);
  return liste.length ? JSON.stringify(liste) : null;
}

module.exports = {
  BEWERTUNGEN,
  normProtokollListe,
  ladeProtokollListe,
  serialisiereProtokoll,
};
