// src/lib/fachgespraech-scoring.js
//
// Rechenfunktion für das Fachgespräch. Je Bereich (Kriterium) ergibt sich die
// Bereichspunktzahl aus den Protokoll-Zeilen (Summe der Skalenwerte × 10 /
// Anzahl bewerteter Zeilen). Das gewichtete Gesamt nutzt die Kriterien-Faktoren;
// bestanden ab FACHGESPRAECH_BESTEHENSGRENZE.

const {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_BESTEHENSGRENZE,
} = require('./fachgespraech-struktur');
const { bereichPunkte } = require('./fachgespraech-protokoll');

// IHK-Notentext zu einer Punktzahl (0–100) nach offizieller Notentabelle
// (Fachkraft für Veranstaltungstechnik).
function note(punkte) {
  if (punkte >= 92) return 'sehr gut';
  if (punkte >= 81) return 'gut';
  if (punkte >= 67) return 'befriedigend';
  if (punkte >= 50) return 'ausreichend';
  if (punkte >= 30) return 'mangelhaft';
  return 'ungenügend';
}

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
