// src/lib/schriftlich-scoring.js
//
// Reine Rechenfunktionen für die schriftliche Prüfung. Ohne DB-Abhängigkeit,
// damit sie direkt gegen die Excel-Sollwerte testbar sind.

const { TEILGEBIET_BY_KEY } = require('./schriftlich-struktur');

// Wert eines Feldes als Zahl; null/undefined -> 0.
function zahl(eintrag) {
  if (!eintrag || eintrag.punkte === null || eintrag.punkte === undefined) return 0;
  const n = Number(eintrag.punkte);
  return Number.isFinite(n) ? n : 0;
}

// Ermittelt für WISO das gestrichene Feld:
// - das explizit markierte Feld, falls vorhanden
// - sonst automatisch das letzte Feld (u6)
function ermittleStreichung(teilgebiet, felderMap) {
  for (const feld of teilgebiet.felder) {
    const e = felderMap.get(feld);
    if (e && e.gestrichen) return feld;
  }
  return teilgebiet.felder[teilgebiet.felder.length - 1];
}

// Berechnet Summe und Endpunkte eines Teilgebiets.
// felderMap: Map<feldKey, { punkte, gestrichen }>
function berechneTeilgebiet(key, felderMap) {
  const tg = TEILGEBIET_BY_KEY.get(key);
  if (!tg) throw new Error(`Unbekanntes Teilgebiet: ${key}`);

  let gestrichenesFeld = null;
  if (tg.streichung) {
    gestrichenesFeld = ermittleStreichung(tg, felderMap);
  }

  let summe = 0;
  for (const feld of tg.felder) {
    if (feld === gestrichenesFeld) continue;
    summe += zahl(felderMap.get(feld));
  }

  let punkte;
  if (tg.gebunden) {
    // WISO: Gebunden-Teil und Unterpunkt-Teil getrennt runden und addieren.
    const gebundenRoh = zahl(felderMap.get('gebunden'));
    const gebundenTeilpunkte = Math.round(gebundenRoh / tg.gebundenDivisor);
    const uTeilpunkte = Math.round(summe * tg.uFaktor);
    punkte = gebundenTeilpunkte + uTeilpunkte;
  } else if (tg.divisor) {
    punkte = Math.round(summe / tg.divisor);
  } else {
    punkte = Math.round(summe * (tg.faktor ?? 1));
  }

  return { summe, punkte, gestrichenesFeld };
}

// Berechnet alle vier Teilgebiete eines Prüflings und die (informative) Summe.
// punkteProTeilgebiet: { [key]: Map<feld, {punkte,gestrichen}> }
function berechneSchriftlich(punkteProTeilgebiet) {
  const teilgebiete = {};
  let gesamt = 0;
  for (const [key, felderMap] of Object.entries(punkteProTeilgebiet)) {
    const erg = berechneTeilgebiet(key, felderMap || new Map());
    teilgebiete[key] = erg;
    gesamt += erg.punkte;
  }
  return { teilgebiete, gesamt };
}

module.exports = { berechneTeilgebiet, berechneSchriftlich };
