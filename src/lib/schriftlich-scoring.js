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

// Liefert die konkreten Gründe, warum ein Punktebild NICHT besteht – als kurze,
// im Dashboard anzeigbare Texte. Leeres Array = alle Bedingungen erfüllt.
// Spiegelt exakt die Regeln aus pruefeBestehen() wider.
function bestehensGruende(teilgebietePunkte) {
  const { gewichtet } = pruefeBestehen(teilgebietePunkte);
  const gruende = [];

  const mangelhaft = []; // Note 5 (30..49), ohne Sperrfach (das wird separat genannt)
  for (const tg of TEILGEBIETE) {
    const punkte = Number(teilgebietePunkte[tg.key]) || 0;
    // Sperrfach hat Vorrang: es wird immer als "Sperrfach unter 50" genannt und
    // nicht zusätzlich als mangelhaft/ungenügend gezählt (ein Grund je Bereich).
    if (tg.sperrfach && punkte < BESTEHENSGRENZE) {
      const wie = punkte < UNGENUEGEND_GRENZE ? 'ungenügend' : 'unter 50';
      gruende.push(`${tg.name} ${wie}`);
      continue;
    }
    if (punkte < UNGENUEGEND_GRENZE) {
      gruende.push(`${tg.name} ungenügend (unter 30)`);
    } else if (punkte < BESTEHENSGRENZE) {
      mangelhaft.push(tg.name);
    }
  }

  // Mehr als ein "mangelhaft" (Note 5) ist nicht ausgleichbar.
  if (mangelhaft.length > 1) {
    gruende.push(`${mangelhaft.length} Bereiche mangelhaft (${mangelhaft.join(', ')})`);
  }
  if (gewichtet < BESTEHENSGRENZE) {
    gruende.push(`Gesamt unter 50 (${gewichtet})`);
  }
  return gruende;
}

// Bereichswert nach mündlicher Ergänzungsprüfung (§20 Abs. 3): bisheriges
// (schriftliches) Ergebnis und mündliches Ergebnis im Verhältnis 2:1.
function nachMep(schriftlich, muendlich) {
  return Math.round((2 * schriftlich + muendlich) / 3);
}

// Bestmöglicher Bereichswert (beste mündliche Leistung = 100).
function maxNachMep(schriftlich) {
  return nachMep(schriftlich, 100);
}

// Kleinste mündliche Punktzahl (0..100), mit der eine MEP im Bereich `key` die
// Gesamtprüfung bestehen lässt. null, wenn selbst 100 nicht reicht.
function noetigeMepPunkte(key, teilgebietePunkte) {
  const schriftlich = Number(teilgebietePunkte[key]) || 0;
  for (let m = 0; m <= 100; m++) {
    const hyp = { ...teilgebietePunkte, [key]: nachMep(schriftlich, m) };
    if (pruefeBestehen(hyp).bestanden) return m;
  }
  return null;
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
//   mepDetails:  [{ key, noetigeMuendlich }] – nötige mündliche Punkte je Bereich
//   bereiche:   { [key]: { punkte, bestanden, sperrfach, mepMoeglich,
//                          noetigeMuendlich? } }
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
  const mepDetails = []; // { key, noetigeMuendlich } je möglichem MEP-Bereich
  if (!bestanden) {
    // Für jeden schriftlichen Bereich < 50 prüfen, ob eine bestmögliche MEP in
    // GENAU diesem Bereich (alle anderen unverändert) zum Bestehen führt.
    for (const tg of TEILGEBIETE) {
      const punkte = Number(teilgebietePunkte[tg.key]) || 0;
      if (punkte >= BESTEHENSGRENZE) continue;
      const hypothetisch = { ...teilgebietePunkte, [tg.key]: maxNachMep(punkte) };
      if (pruefeBestehen(hypothetisch).bestanden) {
        const noetigeMuendlich = noetigeMepPunkte(tg.key, teilgebietePunkte);
        mepMoeglich = true;
        mepBereiche.push(tg.key);
        mepDetails.push({ key: tg.key, noetigeMuendlich });
        bereiche[tg.key].mepMoeglich = true;
        bereiche[tg.key].noetigeMuendlich = noetigeMuendlich;
      }
    }
  }

  return { gewichtet, bestanden, mepMoeglich, mepBereiche, mepDetails, bereiche };
}

// Rechnet eine tatsächlich durchgeführte mündliche Ergänzungsprüfung (MEP) ein.
//
// teilgebietePunkte: { [key]: number } – die schriftlichen Bereichspunkte.
// mepTeilgebiet:     Key des ergänzten Bereichs (oder null/undefined = keine MEP).
// mepPunkte:         mündliche Punkte 0–100 (oder null = noch nicht bewertet).
//
// Der ergänzte Bereich wird nach §20 Abs. 3 im Verhältnis 2:1 (schriftlich :
// mündlich) neu gewichtet; anschließend werden Gesamtwert und Bestehen mit
// diesem angehobenen Wert bestimmt. Ist keine (gültige) MEP vorhanden, ist das
// Ergebnis identisch zum reinen schriftlichen Stand.
//
// Rückgabe:
//   teilgebiet:      der ergänzte Bereich (null, wenn keiner)
//   schriftlich:     bisheriger Bereichswert (vor MEP)
//   muendlich:       eingesetzter mündlicher Wert (null, wenn keine Bewertung)
//   bereichNachMep:  neuer Bereichswert (2:1) bzw. der schriftliche, wenn keine MEP
//   punkteNachMep:   { [key]: number } mit ersetztem Bereichswert
//   gewichtet:       gewichtetes Gesamt nach MEP
//   bestanden:       Bestehen nach MEP
//   wirksam:         true, wenn eine MEP mit bewerteten Punkten eingerechnet wurde
function berechneMep(teilgebietePunkte, mepTeilgebiet, mepPunkte) {
  const gueltigerBereich =
    mepTeilgebiet && TEILGEBIET_BY_KEY.has(mepTeilgebiet);
  const schriftlich = gueltigerBereich
    ? Number(teilgebietePunkte[mepTeilgebiet]) || 0
    : null;
  const muendlich =
    mepPunkte === null || mepPunkte === undefined || !Number.isFinite(Number(mepPunkte))
      ? null
      : Number(mepPunkte);
  const wirksam = Boolean(gueltigerBereich) && muendlich !== null;

  const bereichNachMep = wirksam ? nachMep(schriftlich, muendlich) : schriftlich;
  const punkteNachMep = { ...teilgebietePunkte };
  if (wirksam) punkteNachMep[mepTeilgebiet] = bereichNachMep;

  const { gewichtet, bestanden } = pruefeBestehen(punkteNachMep);

  return {
    teilgebiet: gueltigerBereich ? mepTeilgebiet : null,
    schriftlich,
    muendlich,
    bereichNachMep,
    punkteNachMep,
    gewichtet,
    bestanden,
    wirksam,
  };
}

module.exports = {
  berechneTeilgebiet,
  berechneSchriftlich,
  berechneSchriftlichGesamt,
  berechneMep,
  nachMep,
  bestehensGruende,
};
