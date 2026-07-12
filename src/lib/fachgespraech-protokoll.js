// src/lib/fachgespraech-protokoll.js
//
// Die Bewertung je Bereich (Kriterium) ist eine Liste von Protokoll-Zeilen nach
// dem IHK-Protokollierbogen: jede Zeile hat ein Thema (Stichpunkte), eine
// Begründung der Punktevergabe und einen Skalenwert (Entscheidungshilfe).
// Gespeichert wird die Liste als JSON in fachgespraech_bewertung.protokoll.

const { FACHGESPRAECH_SKALA_BY_KEY } = require('./fachgespraech-struktur');

// Normalisiert eine einzelne Zeile auf { thema, begruendung, skala }.
// skala ist ein gültiger Skala-Key oder '' (noch nicht bewertet).
function normZeile(z) {
  const thema = z && typeof z.thema === 'string' ? z.thema : '';
  const begruendung =
    z && typeof z.begruendung === 'string' ? z.begruendung : '';
  const skala =
    z && FACHGESPRAECH_SKALA_BY_KEY.has(z.skala) ? z.skala : '';
  return { thema, begruendung, skala };
}

// Eine Zeile gilt als leer, wenn sie weder Text noch Bewertung enthält.
function istLeer(z) {
  return z.thema.trim() === '' && z.begruendung.trim() === '' && z.skala === '';
}

// Nimmt beliebige Eingabe (Array oder Alt-Wert) und liefert eine saubere
// Zeilenliste ohne leere Zeilen.
function normZeilenListe(eingabe) {
  let liste;
  if (Array.isArray(eingabe)) {
    liste = eingabe.map(normZeile);
  } else {
    liste = [];
  }
  return liste.filter((z) => !istLeer(z));
}

// Liest den in der DB gespeicherten Wert (JSON-String oder null) und gibt immer
// eine Zeilenliste zurück.
function ladeZeilenListe(gespeichert) {
  if (gespeichert === null || gespeichert === undefined || gespeichert === '') {
    return [];
  }
  let parsed = gespeichert;
  if (typeof gespeichert === 'string') {
    try {
      parsed = JSON.parse(gespeichert);
    } catch {
      parsed = [];
    }
  }
  return normZeilenListe(parsed);
}

// Serialisiert eine Zeilenliste für die Speicherung (JSON oder null, wenn leer).
function serialisiereZeilen(eingabe) {
  const liste = normZeilenListe(eingabe);
  return liste.length ? JSON.stringify(liste) : null;
}

// Bereichspunkte aus den Zeilen: Ergebnis = Summe der Skalenwerte × 10 / Anzahl
// (bewerteter) Zeilen. Nur Zeilen mit gesetztem Skalenwert zählen. Ohne
// bewertete Zeile -> 0. Ergebnis 0–100, auf ganze Punkte gerundet.
function bereichPunkte(zeilen) {
  const bewertet = (zeilen || []).filter((z) => z.skala !== '');
  if (bewertet.length === 0) return 0;
  const summe = bewertet.reduce(
    (s, z) => s + (FACHGESPRAECH_SKALA_BY_KEY.get(z.skala)?.wert ?? 0),
    0
  );
  const roh = (summe * 10) / bewertet.length;
  return Math.round(Math.max(0, Math.min(100, roh)));
}

module.exports = {
  normZeilenListe,
  ladeZeilenListe,
  serialisiereZeilen,
  bereichPunkte,
};
