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
    // Gewicht innerhalb der schriftlichen Prüfung (§20 VfAusbV: WISO 10% des
    // Gesamten = 20% der schriftlichen 50%). Summe aller vier ergibt 100.
    gewicht: 20,
  },
  {
    key: 'planung',
    name: 'Veranstaltungsplanung',
    gebunden: false,
    felder: uFelder(10),
    streichung: false,
    // Rechnung: round(summe) -- Faktor 1
    faktor: 1,
    // §20: Planung 15% des Gesamten = 30% der schriftlichen.
    gewicht: 30,
  },
  {
    key: 'durchfuehrung',
    name: 'Veranstaltungsdurchführung',
    gebunden: false,
    felder: uFelder(11),
    streichung: false,
    // Rechnung: round(summe / divisor)
    divisor: 1.1,
    // §20: Durchführung 15% des Gesamten = 30% der schriftlichen.
    gewicht: 30,
  },
  {
    key: 'energie',
    name: 'Energieversorgung',
    gebunden: false,
    felder: uFelder(5),
    streichung: false,
    divisor: 0.5,
    // §20: Energieversorgung 10% des Gesamten = 20% der schriftlichen.
    // Zugleich Sperrfach (muss mind. ausreichend sein).
    gewicht: 20,
    sperrfach: true,
  },
];

// Punktegrenze für "mindestens ausreichend" (bestanden) je Bereich und für das
// gewichtete schriftliche Gesamt, auf der 100-Punkte-Skala.
const BESTEHENSGRENZE = 50;

const TEILGEBIET_BY_KEY = new Map(TEILGEBIETE.map((t) => [t.key, t]));

// Höchstpunktzahl je Unterpunkt (Rohwert).
const MAX_PUNKTE_PRO_FELD = 10;

// Teilgebiete mit frei konfigurierbarer Fragenanzahl (WISO ausgenommen).
const KONFIGURIERBARE_TEILGEBIETE = ['planung', 'durchfuehrung', 'energie'];

// Default-Fragenanzahl je konfigurierbarem Teilgebiet (entspricht der Excel-Vorlage).
const DEFAULT_ANZAHL = { planung: 10, durchfuehrung: 11, energie: 5 };

module.exports = {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  MAX_PUNKTE_PRO_FELD,
  KONFIGURIERBARE_TEILGEBIETE,
  DEFAULT_ANZAHL,
  BESTEHENSGRENZE,
  uFelder,
};
