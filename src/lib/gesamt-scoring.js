// src/lib/gesamt-scoring.js
//
// Gewichtetes Gesamtergebnis über alle 5 Prüfungsbereiche (§20 VfAusbV,
// Fachkraft für Veranstaltungstechnik). Reine Anzeige-Kennzahl – Bestehen und
// MEP bleiben Sache der schriftlichen Logik (src/lib/schriftlich-scoring.js).

// Gewichte der Gesamtprüfung. Summe = 1.
const GEWICHTE = {
  fachgespraech: 0.5, // "Realisieren eines veranstaltungstechnischen Projekts"
  planung: 0.15,
  durchfuehrung: 0.15,
  energie: 0.1,
  wiso: 0.1,
};

// bereiche: { wiso, planung, durchfuehrung, energie, fachgespraech } (0–100).
// Fehlende/null-Werte zählen als 0. Rückgabe: gerundete Gesamtpunktzahl 0–100.
function berechneGesamtAlles(bereiche) {
  let summe = 0;
  for (const [key, gewicht] of Object.entries(GEWICHTE)) {
    const wert = Number(bereiche && bereiche[key]) || 0;
    summe += wert * gewicht;
  }
  return Math.round(summe);
}

module.exports = { berechneGesamtAlles, GEWICHTE };
