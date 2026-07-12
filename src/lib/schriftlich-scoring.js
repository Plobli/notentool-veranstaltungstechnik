// src/lib/schriftlich-scoring.js
//
// Reine Rechenfunktionen für die schriftliche Prüfung. Ohne DB-Abhängigkeit,
// damit sie direkt gegen die Excel-Sollwerte testbar sind.

const {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  KONFIGURIERBARE_TEILGEBIETE,
  BESTEHENSGRENZE,
  UNGENUEGEND_GRENZE,
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

// Wertet die Bestehensbedingungen für ein konkretes Punkte-Objekt aus –
// entsprechend der offiziellen IHK-Bestehenstabelle (Fachkraft für
// Veranstaltungstechnik) bzw. §20 Abs. 2 VfAusbV, auf die schriftlichen
// Bereiche übertragen (Projekt ausgeklammert):
//   1. Gesamtergebnis (gewichtet) >= BESTEHENSGRENZE
//   2. jedes Sperrfach (Energieversorgung) >= BESTEHENSGRENZE
//   3. kein Bereich "ungenügend" (Note 6, < UNGENUEGEND_GRENZE)
//   4. höchstens EIN Bereich "mangelhaft" (Note 5, UNGENUEGEND_GRENZE..49)
// Rückgabe: { gewichtet, bestanden }.
function pruefeBestehen(teilgebietePunkte) {
  let summeGewichtet = 0;
  let summeGewichte = 0;
  let sperrfachErfuellt = true;
  let anzahlSechser = 0; // Bereiche < UNGENUEGEND_GRENZE (Note 6)
  let anzahlFuenfer = 0; // Bereiche UNGENUEGEND_GRENZE..49 (Note 5)

  for (const tg of TEILGEBIETE) {
    const punkte = Number(teilgebietePunkte[tg.key]) || 0;
    const gewicht = tg.gewicht || 0;
    summeGewichtet += punkte * gewicht;
    summeGewichte += gewicht;
    if (tg.sperrfach && punkte < BESTEHENSGRENZE) sperrfachErfuellt = false;
    if (punkte < UNGENUEGEND_GRENZE) anzahlSechser += 1;
    else if (punkte < BESTEHENSGRENZE) anzahlFuenfer += 1;
  }

  const gewichtet = summeGewichte ? Math.round(summeGewichtet / summeGewichte) : 0;
  const bestanden =
    gewichtet >= BESTEHENSGRENZE &&
    sperrfachErfuellt &&
    anzahlSechser === 0 &&
    anzahlFuenfer <= 1;
  return { gewichtet, bestanden };
}

// Bestmöglicher Bereichswert nach mündlicher Ergänzungsprüfung (§20 Abs. 3):
// bisheriges (schriftliches) Ergebnis und mündliches Ergebnis im Verhältnis 2:1.
// Beste mögliche mündliche Leistung = 100.
function maxNachMep(schriftlich) {
  return Math.round((2 * schriftlich + 100) / 3);
}

// Berechnet aus den bereits ermittelten Teilgebiet-Punkten das gewichtete
// schriftliche Gesamt (0–100) und die Bestehens-Stati nach der offiziellen
// IHK-Bestehenstabelle bzw. §20 VfAusbV, angewandt auf die schriftlichen
// Bereiche (das Projekt ist hier ausgeklammert).
//
// teilgebietePunkte: { [key]: number }  (Punkte je Teilgebiet, 0–100)
//
// Bestehensregel siehe pruefeBestehen():
//   Gesamt>=50, Sperrfach(Energie)>=50, kein Bereich <30, höchstens ein 30..49.
//
// MEP (§20 Abs. 3): Ist die Prüfung nicht bestanden, wird geprüft, ob eine
// mündliche Ergänzungsprüfung in EINEM schriftlichen Bereich (der <
// BESTEHENSGRENZE liegt) den Ausschlag geben KANN – d.h. ob die bestmögliche
// mündliche Leistung (2:1-Gewichtung) diesen Bereich so anhebt, dass alle
// Bedingungen erfüllt wären.
//
// Rückgabe:
//   gewichtet:  gewichteter Gesamtwert 0–100 (Math.round)
//   bestanden:  true, wenn alle drei Bedingungen erfüllt sind
//   mepMoeglich: true, wenn nicht bestanden, aber eine MEP das Bestehen
//                erreichen kann
//   mepBereiche: Keys der Bereiche, in denen eine MEP den Ausschlag geben kann
//   bereiche:   { [key]: { punkte, bestanden, sperrfach, mepMoeglich } }
function berechneSchriftlichGesamt(teilgebietePunkte) {
  const bereiche = {};
  for (const tg of TEILGEBIETE) {
    const punkte = Number(teilgebietePunkte[tg.key]) || 0;
    bereiche[tg.key] = {
      punkte,
      bestanden: punkte >= BESTEHENSGRENZE,
      sperrfach: Boolean(tg.sperrfach),
      mepMoeglich: false,
    };
  }

  const { gewichtet, bestanden } = pruefeBestehen(teilgebietePunkte);

  let mepMoeglich = false;
  const mepBereiche = [];
  if (!bestanden) {
    // Für jeden schriftlichen Bereich < 50 prüfen, ob eine bestmögliche MEP in
    // GENAU diesem Bereich (alle anderen unverändert) zum Bestehen führt.
    for (const tg of TEILGEBIETE) {
      const punkte = Number(teilgebietePunkte[tg.key]) || 0;
      if (punkte >= BESTEHENSGRENZE) continue;
      const hypothetisch = { ...teilgebietePunkte, [tg.key]: maxNachMep(punkte) };
      if (pruefeBestehen(hypothetisch).bestanden) {
        mepMoeglich = true;
        mepBereiche.push(tg.key);
        bereiche[tg.key].mepMoeglich = true;
      }
    }
  }

  return { gewichtet, bestanden, mepMoeglich, mepBereiche, bereiche };
}

module.exports = {
  berechneTeilgebiet,
  berechneSchriftlich,
  berechneSchriftlichGesamt,
};
