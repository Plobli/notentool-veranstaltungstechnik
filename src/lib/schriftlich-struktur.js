// src/lib/schriftlich-struktur.js
//
// Feste Struktur der schriftlichen Prüfung (Auswertungsbogen).
// Diese Struktur ist bewusst im Code verankert, nicht in der Datenbank:
// Sie ist für jede Prüfung identisch, nur die Prüflinge ändern sich.
//
// Die Rechenformeln entsprechen 1:1 der Excel-Vorlage
// (Dokumente/Auswertungsbogen Schriftliche Prüfung.xlsx), an deren Sollwerten
// die Logik in tests/schriftlich-scoring.test.js verifiziert ist.

// Hilfsfunktion: erzeugt Feld-Keys u1..uN
function uFelder(n) {
  return Array.from({ length: n }, (_, i) => `u${i + 1}`);
}

const TEILGEBIETE = [
  {
    key: 'wiso',
    name: 'WISO',
    // Zusätzliches gebundenes Feld vor den Unterpunkten.
    gebunden: true,
    // Wertebereich des gebundenen Rohwerts.
    gebundenMax: 40,
    felder: uFelder(6),
    // Genau eine der sechs Aufgaben wird gestrichen.
    streichung: true,
    // Rechnung: round(gebunden / gebundenDivisor) + round(summe(behalten) * uFaktor)
    gebundenDivisor: 0.375,
    uFaktor: 1.2,
  },
  {
    key: 'planung',
    name: 'Veranstaltungsplanung',
    gebunden: false,
    felder: uFelder(10),
    streichung: false,
    // Rechnung: round(summe) -- Faktor 1
    faktor: 1,
  },
  {
    key: 'durchfuehrung',
    name: 'Veranstaltungsdurchführung',
    gebunden: false,
    felder: uFelder(11),
    streichung: false,
    // Rechnung: round(summe / divisor)
    divisor: 1.1,
  },
  {
    key: 'energie',
    name: 'Energieversorgung',
    gebunden: false,
    felder: uFelder(5),
    streichung: false,
    divisor: 0.5,
  },
];

const TEILGEBIET_BY_KEY = new Map(TEILGEBIETE.map((t) => [t.key, t]));

// Höchstpunktzahl je Unterpunkt (Rohwert).
const MAX_PUNKTE_PRO_FELD = 10;

module.exports = {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  MAX_PUNKTE_PRO_FELD,
};
