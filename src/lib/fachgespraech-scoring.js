// src/lib/fachgespraech-scoring.js
//
// Reine Rechenfunktion für das Fachgespräch. Ohne DB-Abhängigkeit, damit sie
// direkt testbar ist. Ergebnis je Kriterium = Punkte × Faktor; Gesamtpunkte =
// gerundete Summe der Ergebnisse. Bestanden ab FACHGESPRAECH_BESTEHENSGRENZE.

const { note } = require('./scoring');
const {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_BESTEHENSGRENZE,
} = require('./fachgespraech-struktur');

// punkteJeKriterium: { [key]: number|null }
// Rückgabe:
//   kriterien:    [{ key, punkte, ergebnis }]  (ergebnis = punkte × faktor)
//   gesamtpunkte: gerundete Summe der Ergebnisse (0–100)
//   bestanden:    gesamtpunkte >= Bestehensgrenze
//   note:         Notentext nach IHK-Tabelle
function berechneFachgespraech(punkteJeKriterium) {
  const kriterien = FACHGESPRAECH_KRITERIEN.map((k) => {
    const roh = punkteJeKriterium ? punkteJeKriterium[k.key] : null;
    const punkte = roh === null || roh === undefined || roh === '' ? 0 : Number(roh);
    const gueltig = Number.isFinite(punkte) ? punkte : 0;
    return {
      key: k.key,
      punkte: gueltig,
      // Auf 2 Nachkommastellen runden (wie berechneProjektErgebnis).
      ergebnis: Math.round(gueltig * k.faktor * 100) / 100,
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
