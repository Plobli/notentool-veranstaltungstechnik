// src/lib/termin-ergebnisse.js
//
// Stellt je Prüfling eines Termins die Punkte in allen 5 Prüfungsbereichen
// zusammen: 4 schriftliche Teilgebiete (aus schriftlich_punkt) + Fachgespräch
// (aus fachgespraech_bewertung). Liefert außerdem die bestehende schriftliche
// Gesamt-/MEP-/Bestehens-Info und das gewichtete 5-Bereiche-Gesamt.
//
// Ein Bereich ist `null`, wenn dafür KEINE Eingabe existiert (Anzeige "–");
// in die Berechnungen geht er wie bisher als 0 ein.

const {
  TEILGEBIETE,
  DEFAULT_ANZAHL,
  KONFIGURIERBARE_TEILGEBIETE,
} = require('./schriftlich-struktur');
const {
  berechneTeilgebiet,
  berechneSchriftlichGesamt,
  berechneMep,
} = require('./schriftlich-scoring');
const { berechneFachgespraech } = require('./fachgespraech-scoring');
const { ladeZeilenListe, bereichPunkte } = require('./fachgespraech-protokoll');
const { berechneGesamtAlles } = require('./gesamt-scoring');

// Effektive Fragenanzahl je konfigurierbarem Teilgebiet (gespeichert oder Default).
function ladeAnzahlMap(db, terminId) {
  const map = { ...DEFAULT_ANZAHL };
  if (!terminId) return map;
  const rows = db
    .prepare('SELECT teilgebiet, anzahl_fragen FROM schriftlich_config WHERE pruefungstermin_id = ?')
    .all(terminId);
  for (const r of rows) {
    if (KONFIGURIERBARE_TEILGEBIETE.includes(r.teilgebiet)) {
      map[r.teilgebiet] = r.anzahl_fragen;
    }
  }
  return map;
}

// pruefling_id -> teilgebiet -> Map<feld, {punkte, gestrichen}>; plus Merker,
// welche Teilgebiete überhaupt eine Zeile haben (für die "–"-Unterscheidung).
function ladeSchriftlich(db, prueflingIds) {
  const byPruefling = new Map();
  for (const id of prueflingIds) {
    const tg = {};
    const hat = {};
    for (const t of TEILGEBIETE) {
      tg[t.key] = new Map();
      hat[t.key] = false;
    }
    byPruefling.set(id, { tg, hat });
  }
  if (!prueflingIds.length) return byPruefling;
  // Nur der finale Bogen (pruefer_id IS NULL) ist maßgeblich für Dashboard/§20.
  const rows = db
    .prepare(
      `SELECT * FROM schriftlich_punkt
       WHERE pruefling_id IN (${prueflingIds.map(() => '?').join(',')})
         AND pruefer_id IS NULL`
    )
    .all(...prueflingIds);
  for (const row of rows) {
    const eintrag = byPruefling.get(row.pruefling_id);
    if (!eintrag || !eintrag.tg[row.teilgebiet]) continue;
    eintrag.tg[row.teilgebiet].set(row.feld, { punkte: row.punkte, gestrichen: row.gestrichen });
    eintrag.hat[row.teilgebiet] = true;
  }
  return byPruefling;
}

// pruefling_id -> { [kriterium_key]: zeilen[] }; plus, ob überhaupt Zeilen da sind.
function ladeFachgespraech(db, prueflingIds) {
  const byPruefling = new Map();
  for (const id of prueflingIds) byPruefling.set(id, { zeilen: {}, hat: false });
  if (!prueflingIds.length) return byPruefling;
  const rows = db
    .prepare(
      `SELECT * FROM fachgespraech_bewertung
       WHERE pruefling_id IN (${prueflingIds.map(() => '?').join(',')})`
    )
    .all(...prueflingIds);
  for (const row of rows) {
    const eintrag = byPruefling.get(row.pruefling_id);
    if (!eintrag) continue;
    const zeilen = ladeZeilenListe(row.protokoll);
    eintrag.zeilen[row.kriterium_key] = zeilen;
    if (zeilen.length) eintrag.hat = true;
  }
  return byPruefling;
}

// pruefling_id -> { teilgebiet, muendlich } | null. muendlich = aus den
// Protokoll-Zeilen berechnete mündliche Punkte (0–100), null ohne bewertete Zeile.
function ladeMep(db, prueflingIds) {
  const byPruefling = new Map();
  for (const id of prueflingIds) byPruefling.set(id, null);
  if (!prueflingIds.length) return byPruefling;
  const rows = db
    .prepare(
      `SELECT * FROM mep_bewertung
       WHERE pruefling_id IN (${prueflingIds.map(() => '?').join(',')})`
    )
    .all(...prueflingIds);
  for (const row of rows) {
    const zeilen = ladeZeilenListe(row.protokoll);
    const bewertet = zeilen.some((z) => z.skala !== '');
    byPruefling.set(row.pruefling_id, {
      teilgebiet: row.teilgebiet,
      muendlich: bewertet ? bereichPunkte(zeilen) : null,
    });
  }
  return byPruefling;
}

// Baut je Prüfling die vollständige Ergebniszeile für das Dashboard.
function ladeTerminErgebnisse(db, terminId) {
  const pruefliche = db
    .prepare('SELECT id, name, betrieb FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(terminId);
  const ids = pruefliche.map((p) => p.id);
  const anzahlMap = ladeAnzahlMap(db, terminId);
  const schriftlich = ladeSchriftlich(db, ids);
  const fachgespraech = ladeFachgespraech(db, ids);
  const mep = ladeMep(db, ids);

  return pruefliche.map((p) => {
    const s = schriftlich.get(p.id);
    const f = fachgespraech.get(p.id);
    const m = mep.get(p.id);

    // Schriftliche Teilgebiete berechnen.
    const punkteJeBereich = {};
    for (const t of TEILGEBIETE) {
      const erg = berechneTeilgebiet(t.key, s.tg[t.key], anzahlMap[t.key]);
      punkteJeBereich[t.key] = erg.punkte;
    }
    const gesamtInfo = berechneSchriftlichGesamt(punkteJeBereich);

    // Fachgespräch berechnen.
    const fgErg = berechneFachgespraech(f.zeilen);
    const fgPunkte = fgErg.gesamtpunkte;

    // Bereichswerte: null, wenn keinerlei Eingabe; sonst berechneter Wert.
    const bereiche = {
      wiso: s.hat.wiso ? punkteJeBereich.wiso : null,
      planung: s.hat.planung ? punkteJeBereich.planung : null,
      durchfuehrung: s.hat.durchfuehrung ? punkteJeBereich.durchfuehrung : null,
      energie: s.hat.energie ? punkteJeBereich.energie : null,
      fachgespraech: f.hat ? fgPunkte : null,
    };

    const gesamtAlles = berechneGesamtAlles({
      wiso: punkteJeBereich.wiso,
      planung: punkteJeBereich.planung,
      durchfuehrung: punkteJeBereich.durchfuehrung,
      energie: punkteJeBereich.energie,
      fachgespraech: fgPunkte,
    });

    // Mündliche Ergänzungsprüfung einrechnen (§20 Abs. 3, 2:1). Der schriftliche
    // Stand oben bleibt unangetastet; hier entsteht der Stand NACH MEP.
    const mepInfo = berechneMep(
      punkteJeBereich,
      m && m.teilgebiet,
      m && m.muendlich
    );
    let mepBlock = null;
    if (mepInfo.wirksam) {
      const gesamtAllesNachMep = berechneGesamtAlles({
        ...mepInfo.punkteNachMep,
        fachgespraech: fgPunkte,
      });
      mepBlock = {
        teilgebiet: mepInfo.teilgebiet,
        schriftlich: mepInfo.schriftlich,
        muendlich: mepInfo.muendlich,
        bereichNachMep: mepInfo.bereichNachMep,
        gesamt: mepInfo.gewichtet,
        bestanden: mepInfo.bestanden,
        gesamtAlles: gesamtAllesNachMep,
      };
    }

    return {
      pruefling: p,
      bereiche,
      schriftlich: {
        gesamt: gesamtInfo.gewichtet,
        bestanden: gesamtInfo.bestanden,
        mepMoeglich: gesamtInfo.mepMoeglich,
        mepBereiche: gesamtInfo.mepBereiche,
        mepDetails: gesamtInfo.mepDetails,
        bereiche: gesamtInfo.bereiche,
      },
      mep: mepBlock,
      gesamtAlles,
    };
  });
}

module.exports = { ladeAnzahlMap, ladeTerminErgebnisse, ladeMep };
