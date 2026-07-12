// src/lib/fachgespraech-scoring.js
//
// Rechenfunktion für das Fachgespräch. Je Bereich (Kriterium) ergibt sich die
// Bereichspunktzahl aus den Protokoll-Zeilen (Summe der Skalenwerte × 10 /
// Anzahl bewerteter Zeilen). Das gewichtete Gesamt nutzt die Kriterien-Faktoren;
// bestanden ab FACHGESPRAECH_BESTEHENSGRENZE.

const { note } = require('./scoring');
const {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_BESTEHENSGRENZE,
} = require('./fachgespraech-struktur');
const { bereichPunkte } = require('./fachgespraech-protokoll');

// zeilenJeKriterium: { [key]: [{ thema, begruendung, skala }] }
// Rückgabe:
//   kriterien:    [{ key, punkte, ergebnis }]  (punkte = Bereichspunkte 0–100,
//                 ergebnis = punkte × faktor)
//   gesamtpunkte: gerundete Summe der gewichteten Ergebnisse (0–100)
//   bestanden:    gesamtpunkte >= Bestehensgrenze
//   note:         Notentext nach IHK-Tabelle
function berechneFachgespraech(zeilenJeKriterium) {
  const kriterien = FACHGESPRAECH_KRITERIEN.map((k) => {
    const zeilen = zeilenJeKriterium ? zeilenJeKriterium[k.key] : null;
    const punkte = bereichPunkte(zeilen || []);
    return {
      key: k.key,
      punkte,
      ergebnis: Math.round(punkte * k.faktor * 100) / 100,
    };
  });

  const gesamtpunkte = Math.round(
    kriterien.reduce((sum, k) => sum + k.ergebnis, 0)
  );

  return {
    kriterien,
    gesamtpunkte,
    bestanden: gesamtpunkte >= FACHGESPRAECH_BESTEHENSGRENZE,
    note: note(gesamtpunkte),
  };
}

module.exports = { berechneFachgespraech };
