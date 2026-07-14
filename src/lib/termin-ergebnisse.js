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
  BESTEHENSGRENZE,
} = require('./schriftlich-struktur');
const {
  berechneTeilgebiet,
  berechneSchriftlichGesamt,
  berechneMep,
  bestehensGruende,
} = require('./schriftlich-scoring');
const { berechneFachgespraech, normOverride } = require('./fachgespraech-scoring');
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

// pruefling_id -> { [kriterium_key]: zeilen[] }, Overrides je Kriterium und ob
// überhaupt eine Bewertung da ist (Zeilen ODER manueller Punkte-Override).
function ladeFachgespraech(db, prueflingIds) {
  const byPruefling = new Map();
  for (const id of prueflingIds) byPruefling.set(id, { zeilen: {}, override: {}, hat: false });
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
    const override = normOverride(row.punkte);
    eintrag.override[row.kriterium_key] = override;
    if (zeilen.length || override !== null) eintrag.hat = true;
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

// Finale schriftliche Bereichspunkte + Fachgespräch eines Prüflings (aus dem
// finalen Bogen bzw. den Fachgespräch-Zeilen). Für Wiederholer, die aus einem
// Vortermin übernommene Teile referenzieren. Rückgabe:
//   { wiso, planung, durchfuehrung, energie, fachgespraech } – je Wert die
//   berechneten Punkte oder null (keine Eingabe).
function finaleTeilpunkteVon(db, prueflingId) {
  const anzahlMap = ladeAnzahlMap(
    db,
    db.prepare('SELECT pruefungstermin_id FROM pruefling WHERE id = ?').get(prueflingId)
      ?.pruefungstermin_id
  );
  const s = ladeSchriftlich(db, [prueflingId]).get(prueflingId);
  const f = ladeFachgespraech(db, [prueflingId]).get(prueflingId);
  const out = {};
  for (const t of TEILGEBIETE) {
    out[t.key] = s.hat[t.key]
      ? berechneTeilgebiet(t.key, s.tg[t.key], anzahlMap[t.key]).punkte
      : null;
  }
  out.fachgespraech = f.hat ? berechneFachgespraech(f.zeilen, f.override).gesamtpunkte : null;
  return out;
}

// Baut je Prüfling die vollständige Ergebniszeile für das Dashboard.
function ladeTerminErgebnisse(db, terminId) {
  const pruefliche = db
    .prepare('SELECT id, name, betrieb, wiederholt_von FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
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

    // Wiederholer: übernommene Teile aus dem Vortermin referenzieren (nicht
    // kopiert). Genutzt, wo im neuen Termin keine eigene Eingabe existiert.
    const uebernommen = p.wiederholt_von ? finaleTeilpunkteVon(db, p.wiederholt_von) : null;

    // Schriftliche Teilgebiete berechnen; fehlende (übernommene) Bereiche eines
    // Wiederholers kommen aus dem Vortermin, damit das §20-Gesamt vollständig ist.
    const punkteJeBereich = {};
    const uebernommeneBereiche = {}; // key -> true, wenn aus Vortermin referenziert
    for (const t of TEILGEBIETE) {
      if (s.hat[t.key]) {
        punkteJeBereich[t.key] = berechneTeilgebiet(t.key, s.tg[t.key], anzahlMap[t.key]).punkte;
      } else if (uebernommen && uebernommen[t.key] !== null) {
        punkteJeBereich[t.key] = uebernommen[t.key];
        uebernommeneBereiche[t.key] = true;
      } else {
        punkteJeBereich[t.key] = 0;
      }
    }
    const gesamtInfo = berechneSchriftlichGesamt(punkteJeBereich);

    // Fachgespräch berechnen; für Wiederholer ggf. aus dem Vortermin übernehmen.
    const fgErg = berechneFachgespraech(f.zeilen, f.override);
    let fgPunkte = fgErg.gesamtpunkte;
    let fgUebernommen = false;
    if (!f.hat && uebernommen && uebernommen.fachgespraech !== null) {
      fgPunkte = uebernommen.fachgespraech;
      fgUebernommen = true;
    }

    // Bereichswerte: null, wenn keinerlei Eingabe; sonst berechneter Wert.
    const bereiche = {
      wiso: (s.hat.wiso || uebernommeneBereiche.wiso) ? punkteJeBereich.wiso : null,
      planung: (s.hat.planung || uebernommeneBereiche.planung) ? punkteJeBereich.planung : null,
      durchfuehrung: (s.hat.durchfuehrung || uebernommeneBereiche.durchfuehrung) ? punkteJeBereich.durchfuehrung : null,
      energie: (s.hat.energie || uebernommeneBereiche.energie) ? punkteJeBereich.energie : null,
      fachgespraech: (f.hat || fgUebernommen) ? fgPunkte : null,
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

    // Gründe fürs Nicht-Bestehen (maßgeblicher Stand: nach MEP, falls wirksam).
    // Nur sinnvoll, wenn überhaupt schriftliche Eingaben existieren.
    const hatSchriftlich = s.hat.wiso || s.hat.planung || s.hat.durchfuehrung || s.hat.energie
      || (uebernommen && Object.keys(uebernommeneBereiche).length > 0);
    const massgeblich = mepInfo.wirksam ? mepInfo.punkteNachMep : punkteJeBereich;
    const gruende = hatSchriftlich ? bestehensGruende(massgeblich) : [];

    // Gesamt-Bestehen der Abschlussprüfung: schriftlich (nach §20/MEp) bestanden
    // UND Fachgespräch >= 50. Solange ein Pflichtteil noch nicht erfasst ist,
    // gilt der Status als "offen" (nicht voreilig "nicht bestanden").
    const schriftlichBestanden = mepInfo.wirksam ? mepInfo.bestanden : gesamtInfo.bestanden;
    const fgErfasst = f.hat || fgUebernommen;
    const fgBestanden = fgErfasst && fgPunkte >= BESTEHENSGRENZE;
    let gesamtStatus; // 'bestanden' | 'nicht_bestanden' | 'offen'
    if (!hatSchriftlich || !fgErfasst) {
      gesamtStatus = 'offen';
    } else if (schriftlichBestanden && fgBestanden) {
      gesamtStatus = 'bestanden';
    } else {
      gesamtStatus = 'nicht_bestanden';
    }
    // Grund fürs Nicht-Bestehen um das Fachgespräch ergänzen.
    const gesamtGruende = [...gruende];
    if (gesamtStatus === 'nicht_bestanden' && fgErfasst && !fgBestanden) {
      gesamtGruende.push(`Fachgespräch unter 50 (${fgPunkte})`);
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
        gruende,
      },
      // Gesamt-Status der Abschlussprüfung (schriftlich + Fachgespräch).
      gesamt: {
        status: gesamtStatus,
        fachgespraechBestanden: fgBestanden,
        gruende: gesamtGruende,
      },
      mep: mepBlock,
      gesamtAlles,
      // Wiederholer-Info: welche Teile aus dem Vortermin übernommen wurden.
      wiederholer: p.wiederholt_von
        ? {
            von: p.wiederholt_von,
            uebernommeneBereiche: Object.keys(uebernommeneBereiche),
            fachgespraechUebernommen: fgUebernommen,
          }
        : null,
    };
  });
}

// Fortschritts-Kennzahlen eines Termins fürs Dashboard – aggregiert, ohne
// Prüflingsnamen. Rückgabe:
//   anzahl:          Prüflingszahl
//   schriftlichFinal:# finalisierte schriftliche Bögen
//   fachgespraech:   # Prüflinge mit Fachgespräch-Bewertung
//   mep:             # Prüflinge mit erfasster MEp
//   bestanden/nichtBestanden/offen: Status-Aggregat (offen = schriftlich noch
//                    nicht finalisiert)
//   prozent:         Gesamtfortschritt 0–100 (Anteil finalisierter Bögen)
function ladeTerminFortschritt(db, terminId) {
  const pruefliche = db
    .prepare('SELECT id, schriftlich_finalisiert FROM pruefling WHERE pruefungstermin_id = ?')
    .all(terminId);
  const anzahl = pruefliche.length;
  const zeilen = ladeTerminErgebnisse(db, terminId);
  const ergById = new Map(zeilen.map((z) => [z.pruefling.id, z]));

  let schriftlichFinal = 0, fachgespraech = 0, mepCount = 0;
  let bestanden = 0, nichtBestanden = 0, offen = 0;
  for (const p of pruefliche) {
    const z = ergById.get(p.id);
    if (p.schriftlich_finalisiert) schriftlichFinal += 1;
    // Gesamt-Status der Abschlussprüfung (schriftlich + Fachgespräch).
    const status = z ? z.gesamt.status : 'offen';
    if (status === 'bestanden') bestanden += 1;
    else if (status === 'nicht_bestanden') nichtBestanden += 1;
    else offen += 1;
    if (z && z.bereiche.fachgespraech !== null) fachgespraech += 1;
    if (z && z.mep) mepCount += 1;
  }
  const prozent = anzahl ? Math.round((schriftlichFinal / anzahl) * 100) : 0;

  return {
    anzahl,
    schriftlichFinal,
    fachgespraech,
    mep: mepCount,
    bestanden,
    nichtBestanden,
    offen,
    prozent,
  };
}

module.exports = { ladeAnzahlMap, ladeTerminErgebnisse, ladeMep, ladeTerminFortschritt };
