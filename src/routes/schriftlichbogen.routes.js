// src/routes/schriftlichbogen.routes.js
//
// Feste Auswertungsbogen-Ansicht der schriftlichen Prüfung (Matrix, alle
// Prüflinge nebeneinander). Punkte und Streichung werden per Auto-Save einzeln
// gespeichert (POST /schriftlich/feld, JSON); die Fragenanzahl je Bereich per
// eigenem Button (POST /schriftlich/anzahl). Alles schreibt in schriftlich_punkt
// bzw. schriftlich_config.
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  KONFIGURIERBARE_TEILGEBIETE,
  DEFAULT_ANZAHL,
  BESTEHENSGRENZE,
  UNGENUEGEND_GRENZE,
  uFelder,
} = require('../lib/schriftlich-struktur');
const {
  berechneTeilgebiet,
  berechneSchriftlichGesamt,
} = require('../lib/schriftlich-scoring');

const { terminBySlug, bereicheFuer } = require('../lib/pruefung');

const router = express.Router();

// Lädt den Prüfungstermin per Slug (req.termin), 404 sonst. Die schriftliche
// Prüfung ist derzeit nur für die Abschlussprüfung umgesetzt; bei der
// Zwischenprüfung wird eine Platzhalterseite angezeigt.
function ladeTermin(req, res, next) {
  const db = getDb();
  const termin = terminBySlug(db, req.params.slug);
  if (!termin) return res.status(404).send('Prüfung nicht gefunden.');
  if (termin.art !== 'abschluss') {
    return res.render('pruefung/platzhalter', {
      title: 'Schriftliche Prüfung',
      user: req.user,
      termin,
      bereichName: 'Schriftliche Prüfung',
      bereiche: bereicheFuer(termin.art),
      aktiverBereich: 'schriftlich',
    });
  }
  req.termin = termin;
  next();
}

// Liefert die effektive Fragenanzahl je konfigurierbarem Teilgebiet für einen
// Termin: gespeicherter Wert aus schriftlich_config oder Default.
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

// Effektive Feldliste je Teilgebiet: konfigurierbare bekommen u1..u<anzahl>,
// WISO behält seine feste Feldliste.
function ladeFelderMap(anzahlMap) {
  const felder = {};
  for (const t of TEILGEBIETE) {
    felder[t.key] = KONFIGURIERBARE_TEILGEBIETE.includes(t.key)
      ? uFelder(anzahlMap[t.key])
      : t.felder;
  }
  return felder;
}

// Lädt den Bogen EINES Prüfers (prueferId gesetzt) oder den finalen Bogen
// (prueferId = null) für einen Termin und baut je Prüfling eine Struktur
// { [teilgebiet]: Map<feld, {punkte, gestrichen}> } auf.
function ladeBogen(db, terminId, prueferId = null) {
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(terminId);

  const prueflingIds = pruefliche.map((p) => p.id);
  const platzhalter = prueflingIds.map(() => '?').join(',');
  const prueferBedingung = prueferId === null ? 'pruefer_id IS NULL' : 'pruefer_id = ?';
  const args = prueferId === null ? prueflingIds : [...prueflingIds, prueferId];
  const punkte = prueflingIds.length
    ? db
        .prepare(
          `SELECT * FROM schriftlich_punkt
           WHERE pruefling_id IN (${platzhalter}) AND ${prueferBedingung}`
        )
        .all(...args)
    : [];

  // pruefling_id -> teilgebiet -> feld -> {punkte, gestrichen}
  const byPruefling = new Map();
  for (const p of pruefliche) {
    const tg = {};
    for (const t of TEILGEBIETE) tg[t.key] = new Map();
    byPruefling.set(p.id, tg);
  }
  for (const row of punkte) {
    const tg = byPruefling.get(row.pruefling_id);
    if (!tg || !tg[row.teilgebiet]) continue;
    tg[row.teilgebiet].set(row.feld, {
      punkte: row.punkte,
      gestrichen: row.gestrichen,
    });
  }

  return { pruefliche, byPruefling };
}

// Berechnet für einen Prüfling alle Teilgebiete, das gewichtete schriftliche
// Gesamt (§20 VfAusbV) und die Bestehens-Stati.
function ergebnisFuer(teilgebietMaps, anzahlMap) {
  const teilgebiete = {};
  const punkteJeBereich = {};
  for (const t of TEILGEBIETE) {
    const anzahl = anzahlMap ? anzahlMap[t.key] : undefined;
    const erg = berechneTeilgebiet(t.key, teilgebietMaps[t.key] || new Map(), anzahl);
    teilgebiete[t.key] = erg;
    punkteJeBereich[t.key] = erg.punkte;
  }
  const gesamtInfo = berechneSchriftlichGesamt(punkteJeBereich);
  return {
    teilgebiete,
    gesamt: gesamtInfo.gewichtet,
    bestanden: gesamtInfo.bestanden,
    mepMoeglich: gesamtInfo.mepMoeglich,
    mepBereiche: gesamtInfo.mepBereiche,
    mepDetails: gesamtInfo.mepDetails,
    mepText: mepTextVon(gesamtInfo.mepDetails),
    bereiche: gesamtInfo.bereiche,
  };
}

// Baut einen lesbaren Hinweis aus den MEP-Details, z. B.
// "MEP: WISO mind. 69 oder Planung mind. 53 Punkte mündlich".
function mepTextVon(mepDetails) {
  if (!mepDetails || mepDetails.length === 0) return '';
  const teile = mepDetails.map((d) => {
    const tg = TEILGEBIET_BY_KEY.get(d.key);
    const name = tg ? tg.name : d.key;
    return d.noetigeMuendlich !== null
      ? `${name} mind. ${d.noetigeMuendlich}`
      : name;
  });
  return `MEp: ${teile.join(' oder ')} Punkte mündlich`;
}

// Speichert die übermittelten Felder in den Bogen von `prueferId` (null =
// finaler Bogen). `felder` ist ein Array von
// { prueflingId, teilgebiet, feld, punkte, gestrichen }.
// Wegen der NULL-Semantik von UNIQUE (finaler Bogen) wird per Lookup entschieden,
// ob aktualisiert oder eingefügt wird, statt ON CONFLICT.
function speichereFelder(db, felder, prueferId = null) {
  const finde = db.prepare(
    prueferId === null
      ? `SELECT id FROM schriftlich_punkt
         WHERE pruefling_id = ? AND teilgebiet = ? AND feld = ? AND pruefer_id IS NULL`
      : `SELECT id FROM schriftlich_punkt
         WHERE pruefling_id = ? AND teilgebiet = ? AND feld = ? AND pruefer_id = ?`
  );
  const update = db.prepare(
    'UPDATE schriftlich_punkt SET punkte = ?, gestrichen = ? WHERE id = ?'
  );
  const insert = db.prepare(
    `INSERT INTO schriftlich_punkt (pruefling_id, pruefer_id, teilgebiet, feld, punkte, gestrichen)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const punkte =
        r.punkte === '' || r.punkte === null || r.punkte === undefined
          ? null
          : Number(r.punkte);
      const gestrichen = r.gestrichen ? 1 : 0;
      const findeArgs =
        prueferId === null
          ? [r.prueflingId, r.teilgebiet, r.feld]
          : [r.prueflingId, r.teilgebiet, r.feld, prueferId];
      const vorhanden = finde.get(...findeArgs);
      if (vorhanden) {
        update.run(punkte, gestrichen, vorhanden.id);
      } else {
        insert.run(r.prueflingId, prueferId, r.teilgebiet, r.feld, punkte, gestrichen);
      }
    }
  });
  tx(felder);
}

// --- Matrix-Ansicht ---

router.get('/pruefung/:slug/schriftlich', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const prueferId = req.user.id;

  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);
  // Eigener Bogen des eingeloggten Prüfers.
  const { pruefliche, byPruefling } = ladeBogen(db, termin.id, prueferId);
  const ergebnisse = new Map();
  for (const p of pruefliche) {
    ergebnisse.set(p.id, ergebnisFuer(byPruefling.get(p.id), anzahlMap));
  }

  // Fremde Bewertungen nur laden, wenn der Termin die Einsicht erlaubt.
  // fremdWerte: pruefling_id -> teilgebiet -> feld -> [{ prueferName, punkte }]
  const fremdWerte = termin.einsicht_fremd
    ? ladeFremdWerte(db, pruefliche.map((p) => p.id), prueferId)
    : null;

  res.render('schriftlichbogen/matrix', {
    title: 'Schriftliche Prüfung',
    user: req.user,
    termin,
    teilgebiete: TEILGEBIETE,
    anzahlMap,
    felderMap,
    pruefliche,
    daten: byPruefling,
    ergebnisse,
    fremdWerte,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'schriftlich',
  });
});

// Lädt die Bewertungen ALLER anderen Prüfer (nicht des eigenen, nicht final)
// für die Einsicht. Rückgabe: pruefling_id -> teilgebiet -> feld ->
// [{ prueferName, punkte }].
function ladeFremdWerte(db, prueflingIds, eigenerPrueferId) {
  const map = new Map();
  if (!prueflingIds.length) return map;
  const platzhalter = prueflingIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT sp.pruefling_id, sp.teilgebiet, sp.feld, sp.punkte, u.name AS pruefer_name
       FROM schriftlich_punkt sp JOIN user u ON u.id = sp.pruefer_id
       WHERE sp.pruefling_id IN (${platzhalter})
         AND sp.pruefer_id IS NOT NULL AND sp.pruefer_id != ?
         AND sp.punkte IS NOT NULL
       ORDER BY u.name`
    )
    .all(...prueflingIds, eigenerPrueferId);
  for (const r of rows) {
    if (!map.has(r.pruefling_id)) map.set(r.pruefling_id, {});
    const tgObj = map.get(r.pruefling_id);
    if (!tgObj[r.teilgebiet]) tgObj[r.teilgebiet] = {};
    if (!tgObj[r.teilgebiet][r.feld]) tgObj[r.teilgebiet][r.feld] = [];
    tgObj[r.teilgebiet][r.feld].push({ prueferName: r.pruefer_name, punkte: r.punkte });
  }
  return map;
}

// Speichert nur die Fragenanzahl eines Bereichs (eigener Speichern-Button je
// Teilgebiet bzw. Enter). Danach Reload, damit die U-Zeilen neu gerendert werden.
router.post('/pruefung/:slug/schriftlich/anzahl', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  speichereAnzahl(db, termin.id, req.body);
  res.redirect(`/pruefung/${termin.slug}/schriftlich`);
});

// Auto-Save eines einzelnen Feldes (JSON). Speichert entweder einen Punktewert
// oder verschiebt die WISO-Streichung und liefert die neu berechneten
// Teilgebiet-Punkte + Gesamt des betroffenen Prüflings zurück.
router.post('/pruefung/:slug/schriftlich/feld', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const prueferId = req.user.id;

  const { prueflingId, teilgebiet, feld, punkte } = req.body || {};
  const pId = Number(prueflingId);

  const pruefling = db
    .prepare('SELECT id, schriftlich_finalisiert FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(pId, termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });
  // Nach der Finalisierung sind die Einzelbögen gesperrt.
  if (pruefling.schriftlich_finalisiert) {
    return res.status(409).json({ error: 'Prüfling ist finalisiert – Einzelbewertung gesperrt.' });
  }
  if (!TEILGEBIET_BY_KEY.has(teilgebiet)) {
    return res.status(400).json({ error: 'Unbekanntes Teilgebiet.' });
  }

  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);
  const erlaubteFelder = new Set(felderMap[teilgebiet]);
  const tg = TEILGEBIET_BY_KEY.get(teilgebiet);
  if (tg.gebunden) erlaubteFelder.add('gebunden');

  if (req.body.streichung) {
    // WISO: übergebenes Feld wird das gestrichene; alle anderen zurücksetzen.
    // Immer nur im eigenen Bogen des Prüfers.
    if (!tg.streichung || !erlaubteFelder.has(feld)) {
      return res.status(400).json({ error: 'Streichung nicht möglich.' });
    }
    const clearAlle = db.prepare(
      'UPDATE schriftlich_punkt SET gestrichen = 0 WHERE pruefling_id = ? AND teilgebiet = ? AND pruefer_id = ?'
    );
    const findeStrich = db.prepare(
      'SELECT id FROM schriftlich_punkt WHERE pruefling_id = ? AND teilgebiet = ? AND feld = ? AND pruefer_id = ?'
    );
    const setStrichUpd = db.prepare('UPDATE schriftlich_punkt SET gestrichen = 1 WHERE id = ?');
    const setStrichIns = db.prepare(
      `INSERT INTO schriftlich_punkt (pruefling_id, pruefer_id, teilgebiet, feld, punkte, gestrichen)
       VALUES (?, ?, ?, ?, NULL, 1)`
    );
    const tx = db.transaction(() => {
      clearAlle.run(pId, teilgebiet, prueferId);
      const vorhanden = findeStrich.get(pId, teilgebiet, feld, prueferId);
      if (vorhanden) setStrichUpd.run(vorhanden.id);
      else setStrichIns.run(pId, prueferId, teilgebiet, feld);
    });
    tx();
  } else {
    if (!erlaubteFelder.has(feld)) {
      return res.status(400).json({ error: 'Unbekanntes Feld.' });
    }
    // Punktewert hart auf den erlaubten Bereich klemmen: U-Felder 0–10,
    // Gebunden 0–gebundenMax. Leerwert bleibt leer (null).
    const max = feld === 'gebunden' ? tg.gebundenMax : 10;
    let wert = punkte;
    if (wert !== '' && wert !== null && wert !== undefined) {
      const n = Number(wert);
      if (Number.isFinite(n)) wert = Math.max(0, Math.min(max, n));
    }
    speichereFelder(
      db,
      [{ prueflingId: pId, teilgebiet, feld, punkte: wert, gestrichen: 0 }],
      prueferId
    );
  }

  // Neu berechnen und zurückgeben – auf Basis des eigenen Bogens.
  const { byPruefling } = ladeBogen(db, termin.id, prueferId);
  const ergebnis = ergebnisFuer(byPruefling.get(pId), anzahlMap);
  res.json({
    teilgebiete: Object.fromEntries(
      Object.entries(ergebnis.teilgebiete).map(([k, v]) => [
        k,
        {
          punkte: v.punkte,
          gestrichenesFeld: v.gestrichenesFeld,
          bestanden: ergebnis.bereiche[k].bestanden,
        },
      ])
    ),
    gesamt: ergebnis.gesamt,
    bestanden: ergebnis.bestanden,
    mepMoeglich: ergebnis.mepMoeglich,
    mepBereiche: ergebnis.mepBereiche,
    mepText: ergebnis.mepText,
  });
});

// Liest Felder anzahl_<teilgebiet> aus dem Body und speichert sie je Termin.
// Gültige Teilgebiete: KONFIGURIERBARE_TEILGEBIETE. Wert wird auf [1,20] geklemmt.
function speichereAnzahl(db, terminId, body) {
  const upsert = db.prepare(
    `INSERT INTO schriftlich_config (pruefungstermin_id, teilgebiet, anzahl_fragen)
     VALUES (?, ?, ?)
     ON CONFLICT(pruefungstermin_id, teilgebiet)
     DO UPDATE SET anzahl_fragen = excluded.anzahl_fragen`
  );
  const tx = db.transaction(() => {
    for (const key of KONFIGURIERBARE_TEILGEBIETE) {
      const raw = body[`anzahl_${key}`];
      if (raw === undefined || raw === '') continue;
      let n = Number(raw);
      if (!Number.isFinite(n)) continue;
      n = Math.max(1, Math.min(20, Math.round(n)));
      upsert.run(terminId, key, n);
    }
  });
  tx();
}

// --- Finalisierung: Einzelbewertungen zusammenführen ---

// Prüfer, die für einen Prüfling überhaupt etwas eingetragen haben.
function ladePrueferMitBewertung(db, prueflingId) {
  return db
    .prepare(
      `SELECT DISTINCT u.id, u.name
       FROM schriftlich_punkt sp JOIN user u ON u.id = sp.pruefer_id
       WHERE sp.pruefling_id = ? AND sp.pruefer_id IS NOT NULL
       ORDER BY u.name`
    )
    .all(prueflingId);
}

// Baut je Prüfer (inkl. final) die Ergebnis-Struktur eines Prüflings.
// Rückgabe: [{ prueferId|null, name, ergebnis, roh }] – final zuerst.
// `roh` ist die teilgebiet -> Map<feld,{punkte,gestrichen}>-Struktur, damit die
// View die eingetragenen Einzelwerte je Feld anzeigen kann.
function boegenFuerPruefling(db, termin, prueflingId, prueferListe, anzahlMap) {
  const eintraege = [];
  const baue = (prueferId, name) => {
    const { byPruefling } = ladeBogenEinerPruefling(db, prueflingId, prueferId);
    eintraege.push({
      prueferId,
      name,
      ergebnis: ergebnisFuer(byPruefling, anzahlMap),
      roh: byPruefling,
    });
  };
  baue(null, 'Final');
  for (const p of prueferListe) baue(p.id, p.name);
  return eintraege;
}

// Vorschlagswerte je (teilgebiet, feld): kaufmännischer Durchschnitt über alle
// PRÜFER-Bögen (nicht der finale), die für das Feld einen Zahlenwert haben.
// Felder ohne einen einzigen Prüfer-Wert erscheinen nicht.
// Rückgabe: { [tgKey]: { [feld]: gerundeterDurchschnitt } }.
function mittelwerteJeFeld(boegen) {
  const prueferBoegen = boegen.filter((b) => b.prueferId !== null);
  const summe = {}; // tg -> feld -> { s, n }
  for (const b of prueferBoegen) {
    for (const [tgKey, map] of Object.entries(b.roh)) {
      for (const [feld, eintrag] of map.entries()) {
        const wert = eintrag && eintrag.punkte;
        if (wert === null || wert === undefined || !Number.isFinite(Number(wert))) continue;
        if (!summe[tgKey]) summe[tgKey] = {};
        if (!summe[tgKey][feld]) summe[tgKey][feld] = { s: 0, n: 0 };
        summe[tgKey][feld].s += Number(wert);
        summe[tgKey][feld].n += 1;
      }
    }
  }
  const out = {};
  for (const [tgKey, felder] of Object.entries(summe)) {
    out[tgKey] = {};
    for (const [feld, { s, n }] of Object.entries(felder)) {
      out[tgKey][feld] = Math.round(s / n);
    }
  }
  return out;
}

// Wie ladeBogen, aber nur für einen Prüfling und einen Bogen (Prüfer/final).
function ladeBogenEinerPruefling(db, prueflingId, prueferId) {
  const bedingung = prueferId === null ? 'pruefer_id IS NULL' : 'pruefer_id = ?';
  const args = prueferId === null ? [prueflingId] : [prueflingId, prueferId];
  const rows = db
    .prepare(`SELECT * FROM schriftlich_punkt WHERE pruefling_id = ? AND ${bedingung}`)
    .all(...args);
  const tg = {};
  for (const t of TEILGEBIETE) tg[t.key] = new Map();
  for (const row of rows) {
    if (!tg[row.teilgebiet]) continue;
    tg[row.teilgebiet].set(row.feld, { punkte: row.punkte, gestrichen: row.gestrichen });
  }
  return { byPruefling: tg };
}

// Übersicht: Prüfling wählen, Bewertungen aller Prüfer nebeneinander, finalen
// Bogen bearbeiten.
router.get('/pruefung/:slug/schriftlich/final', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);

  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id);

  // Gewählter Prüfling (Query ?p=…) oder der erste.
  const gewaehltId = Number(req.query.p) || (pruefliche[0] && pruefliche[0].id);
  const gewaehlt = pruefliche.find((p) => p.id === gewaehltId) || null;

  let prueferListe = [];
  let boegen = [];
  let finalDaten = null;
  let vorschlaege = {};
  if (gewaehlt) {
    prueferListe = ladePrueferMitBewertung(db, gewaehlt.id);
    boegen = boegenFuerPruefling(db, termin, gewaehlt.id, prueferListe, anzahlMap);
    finalDaten = ladeBogenEinerPruefling(db, gewaehlt.id, null).byPruefling;
    // Vorschlag je Feld = kaufmännischer Durchschnitt der Prüfer-Werte (nur die
    // Prüfer, die für das Feld einen Wert haben). Dient als Vorbelegung leerer
    // finaler Felder; wird NICHT gespeichert, bis der Prüfer bestätigt.
    vorschlaege = mittelwerteJeFeld(boegen);
  }

  // Struktur-Konstanten für die clientseitige Live-Berechnung (final-calc.js).
  // Die effektive Feldliste je Teilgebiet stammt aus felderMap (konfigurierbare
  // Anzahl); WISO trägt zusätzlich 'gebunden' vorn.
  const struktur = {
    bestehen: BESTEHENSGRENZE,
    ungenuegend: UNGENUEGEND_GRENZE,
    teilgebiete: TEILGEBIETE.map((t) => ({
      key: t.key,
      gewicht: t.gewicht,
      sperrfach: Boolean(t.sperrfach),
      streichung: Boolean(t.streichung),
      gebunden: Boolean(t.gebunden),
      gebundenDivisor: t.gebundenDivisor,
      gebundenMax: t.gebundenMax,
      uFaktor: t.uFaktor,
      divisor: t.divisor,
      faktor: t.faktor,
      felder: felderMap[t.key],
    })),
  };

  res.render('schriftlichbogen/finalisierung', {
    title: 'Finalisierung – Schriftliche Prüfung',
    user: req.user,
    termin,
    teilgebiete: TEILGEBIETE,
    anzahlMap,
    felderMap,
    pruefliche,
    gewaehlt,
    prueferListe,
    boegen,
    finalDaten,
    vorschlaege,
    struktur,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'schriftlich-final',
  });
});

// Auto-Save eines finalen Feldwerts (JSON). Schreibt in den finalen Bogen.
router.post('/pruefung/:slug/schriftlich/final/feld', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const { prueflingId, teilgebiet, feld, punkte } = req.body || {};
  const pId = Number(prueflingId);

  const pruefling = db
    .prepare('SELECT id, schriftlich_finalisiert FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(pId, termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });
  // Nach dem Finalisieren ist auch der finale Bogen gesperrt (erst entsperren).
  if (pruefling.schriftlich_finalisiert) {
    return res.status(409).json({ error: 'Prüfling ist finalisiert – finaler Bogen gesperrt.' });
  }
  if (!TEILGEBIET_BY_KEY.has(teilgebiet)) {
    return res.status(400).json({ error: 'Unbekanntes Teilgebiet.' });
  }
  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);
  const erlaubteFelder = new Set(felderMap[teilgebiet]);
  const tg = TEILGEBIET_BY_KEY.get(teilgebiet);
  if (tg.gebunden) erlaubteFelder.add('gebunden');

  if (req.body.streichung) {
    if (!tg.streichung || !erlaubteFelder.has(feld)) {
      return res.status(400).json({ error: 'Streichung nicht möglich.' });
    }
    const clearAlle = db.prepare(
      'UPDATE schriftlich_punkt SET gestrichen = 0 WHERE pruefling_id = ? AND teilgebiet = ? AND pruefer_id IS NULL'
    );
    const findeStrich = db.prepare(
      'SELECT id FROM schriftlich_punkt WHERE pruefling_id = ? AND teilgebiet = ? AND feld = ? AND pruefer_id IS NULL'
    );
    const setUpd = db.prepare('UPDATE schriftlich_punkt SET gestrichen = 1 WHERE id = ?');
    const setIns = db.prepare(
      `INSERT INTO schriftlich_punkt (pruefling_id, pruefer_id, teilgebiet, feld, punkte, gestrichen)
       VALUES (?, NULL, ?, ?, NULL, 1)`
    );
    const tx = db.transaction(() => {
      clearAlle.run(pId, teilgebiet);
      const v = findeStrich.get(pId, teilgebiet, feld);
      if (v) setUpd.run(v.id);
      else setIns.run(pId, teilgebiet, feld);
    });
    tx();
  } else {
    if (!erlaubteFelder.has(feld)) {
      return res.status(400).json({ error: 'Unbekanntes Feld.' });
    }
    const max = feld === 'gebunden' ? tg.gebundenMax : 10;
    let wert = punkte;
    if (wert !== '' && wert !== null && wert !== undefined) {
      const n = Number(wert);
      if (Number.isFinite(n)) wert = Math.max(0, Math.min(max, n));
    }
    speichereFelder(db, [{ prueflingId: pId, teilgebiet, feld, punkte: wert, gestrichen: 0 }], null);
  }

  const ergebnis = ergebnisFuer(ladeBogenEinerPruefling(db, pId, null).byPruefling, anzahlMap);
  res.json({
    teilgebiete: Object.fromEntries(
      Object.entries(ergebnis.teilgebiete).map(([k, v]) => [
        k,
        { punkte: v.punkte, gestrichenesFeld: v.gestrichenesFeld, bestanden: ergebnis.bereiche[k].bestanden },
      ])
    ),
    gesamt: ergebnis.gesamt,
    bestanden: ergebnis.bestanden,
    mepMoeglich: ergebnis.mepMoeglich,
    mepBereiche: ergebnis.mepBereiche,
    mepText: ergebnis.mepText,
  });
});

// Übernimmt beim Finalisieren die noch offenen Vorschläge: Jedes finale Feld
// ohne eigenen Wert wird mit dem Prüfer-Durchschnitt gefüllt ("keine Änderung =
// akzeptiert"). Bereits gesetzte finale Werte bleiben unangetastet.
function uebernehmeVorschlaege(db, termin, prueflingId) {
  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);
  const prueferListe = ladePrueferMitBewertung(db, prueflingId);
  const boegen = boegenFuerPruefling(db, termin, prueflingId, prueferListe, anzahlMap);
  const vorschlaege = mittelwerteJeFeld(boegen);
  const finalDaten = ladeBogenEinerPruefling(db, prueflingId, null).byPruefling;

  const zuSchreiben = [];
  for (const tg of TEILGEBIETE) {
    const felder = [];
    if (tg.gebunden) felder.push('gebunden');
    for (const f of felderMap[tg.key]) felder.push(f);
    for (const feld of felder) {
      const fe = finalDaten[tg.key] && finalDaten[tg.key].get(feld);
      const hatFinal = fe && fe.punkte !== null && fe.punkte !== undefined;
      const vorschlag = (vorschlaege[tg.key] || {})[feld];
      if (!hatFinal && vorschlag !== undefined) {
        zuSchreiben.push({ prueflingId, teilgebiet: tg.key, feld, punkte: vorschlag, gestrichen: 0 });
      }
    }
  }
  if (zuSchreiben.length) speichereFelder(db, zuSchreiben, null);
}

// Finalisieren/Entsperren eines Prüflings (sperrt die Einzelbögen). Beim
// Finalisieren werden offene Durchschnitts-Vorschläge in den finalen Bogen
// übernommen (leere Felder = akzeptierter Durchschnitt).
router.post('/pruefung/:slug/schriftlich/final/status', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const pId = Number(req.body.prueflingId);
  const finalisiert = req.body.finalisiert === '1' ? 1 : 0;
  db.transaction(() => {
    if (finalisiert) uebernehmeVorschlaege(db, termin, pId);
    db.prepare('UPDATE pruefling SET schriftlich_finalisiert = ? WHERE id = ? AND pruefungstermin_id = ?')
      .run(finalisiert, pId, termin.id);
  })();
  res.redirect(`/pruefung/${termin.slug}/schriftlich/final?p=${pId}`);
});

module.exports = router;
