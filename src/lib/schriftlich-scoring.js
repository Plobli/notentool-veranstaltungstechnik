// src/lib/schriftlich-scoring.js
//
// Reine Rechenfunktionen für die schriftliche Prüfung. Ohne DB-Abhängigkeit,
// damit sie direkt gegen die Excel-Sollwerte testbar sind.

const {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  KONFIGURIERBARE_TEILGEBIETE,
  BESTEHENSGRENZE,
  uFelder,
} = require('./schriftlich-struktur');

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
// anzahl: optionale Fragenanzahl für konfigurierbare Teilgebiete
//         (Planung/Durchführung/Energie). Ohne Angabe gilt die Default-Struktur.
function berechneTeilgebiet(key, felderMap, anzahl) {
  const tg = TEILGEBIET_BY_KEY.get(key);
  if (!tg) throw new Error(`Unbekanntes Teilgebiet: ${key}`);

  const konfigurierbar =
    KONFIGURIERBARE_TEILGEBIETE.includes(key) &&
    Number.isFinite(anzahl) &&
    anzahl >= 1;
  const felder = konfigurierbar ? uFelder(anzahl) : tg.felder;

  let gestrichenesFeld = null;
  if (tg.streichung) {
    gestrichenesFeld = ermittleStreichung({ ...tg, felder }, felderMap);
  }

  let summe = 0;
  for (const feld of felder) {
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
  } else if (konfigurierbar) {
    // Normierung auf 100: divisor = anzahl * 10 / 100.
    const divisor = (anzahl * 10) / 100;
    punkte = Math.round(summe / divisor);
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

// Berechnet aus den bereits ermittelten Teilgebiet-Punkten das gewichtete
// schriftliche Gesamt (0–100) nach §20 VfAusbV sowie die Bestehens-Stati.
//
// teilgebietePunkte: { [key]: number }  (Punkte je Teilgebiet, 0–100)
//
// Rückgabe:
//   gewichtet:  gewichteter Gesamtwert 0–100 (Math.round)
//   bestanden:  true, wenn gewichtet >= BESTEHENSGRENZE UND alle Sperrfächer
//               (Energie) >= BESTEHENSGRENZE
//   bereiche:   { [key]: { punkte, bestanden, sperrfach } }
function berechneSchriftlichGesamt(teilgebietePunkte) {
  let summeGewichtet = 0;
  let summeGewichte = 0;
  const bereiche = {};
  let sperrfachErfuellt = true;

  for (const tg of TEILGEBIETE) {
    const punkte = Number(teilgebietePunkte[tg.key]) || 0;
    const gewicht = tg.gewicht || 0;
    summeGewichtet += punkte * gewicht;
    summeGewichte += gewicht;
    const bestanden = punkte >= BESTEHENSGRENZE;
    if (tg.sperrfach && !bestanden) sperrfachErfuellt = false;
    bereiche[tg.key] = { punkte, bestanden, sperrfach: Boolean(tg.sperrfach) };
  }

  const gewichtet = summeGewichte
    ? Math.round(summeGewichtet / summeGewichte)
    : 0;
  const bestanden = gewichtet >= BESTEHENSGRENZE && sperrfachErfuellt;

  return { gewichtet, bestanden, bereiche };
}

module.exports = {
  berechneTeilgebiet,
  berechneSchriftlich,
  berechneSchriftlichGesamt,
};
