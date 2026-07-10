// src/routes/schriftlichbogen.routes.js
//
// Feste Auswertungsbogen-Ansicht der schriftlichen Prüfung.
// Zwei Ansichten auf denselben Daten: Matrix (alle Prüflinge nebeneinander)
// und Pro Prüfling (eine Seite je Prüfling). Beide schreiben in
// schriftlich_punkt.
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { TEILGEBIETE, TEILGEBIET_BY_KEY } = require('../lib/schriftlich-struktur');
const { berechneTeilgebiet } = require('../lib/schriftlich-scoring');

const router = express.Router();

// Liefert den aktiven Prüfungstermin oder null.
function aktiverTermin(db) {
  return db
    .prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 1 ORDER BY id DESC LIMIT 1')
    .get();
}

// Lädt alle gespeicherten Punkte eines Termins und baut je Prüfling eine
// Struktur { [teilgebiet]: Map<feld, {punkte, gestrichen}> } auf.
function ladeBogen(db, terminId) {
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(terminId);

  const prueflingIds = pruefliche.map((p) => p.id);
  const punkte = prueflingIds.length
    ? db
        .prepare(
          `SELECT * FROM schriftlich_punkt
           WHERE pruefling_id IN (${prueflingIds.map(() => '?').join(',')})`
        )
        .all(...prueflingIds)
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

// Berechnet für einen Prüfling alle Teilgebiete + Gesamt.
function ergebnisFuer(teilgebietMaps) {
  const teilgebiete = {};
  let gesamt = 0;
  for (const t of TEILGEBIETE) {
    const erg = berechneTeilgebiet(t.key, teilgebietMaps[t.key] || new Map());
    teilgebiete[t.key] = erg;
    gesamt += erg.punkte;
  }
  return { teilgebiete, gesamt };
}

// Speichert die übermittelten Felder. `felder` ist ein Array von
// { prueflingId, teilgebiet, feld, punkte, gestrichen }.
function speichereFelder(db, felder) {
  const upsert = db.prepare(
    `INSERT INTO schriftlich_punkt (pruefling_id, teilgebiet, feld, punkte, gestrichen)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(pruefling_id, teilgebiet, feld)
     DO UPDATE SET punkte = excluded.punkte, gestrichen = excluded.gestrichen`
  );
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      upsert.run(
        r.prueflingId,
        r.teilgebiet,
        r.feld,
        r.punkte === '' || r.punkte === null || r.punkte === undefined
          ? null
          : Number(r.punkte),
        r.gestrichen ? 1 : 0
      );
    }
  });
  tx(felder);
}

// --- Matrix-Ansicht ---

router.get('/schriftlich', requireAuth, (req, res) => {
  const db = getDb();
  const termin = aktiverTermin(db);
  if (!termin) {
    return res.render('schriftlichbogen/matrix', {
      title: 'Schriftliche Prüfung',
      user: req.user,
      termin: null,
      teilgebiete: TEILGEBIETE,
      pruefliche: [],
      daten: new Map(),
      ergebnisse: new Map(),
    });
  }

  const { pruefliche, byPruefling } = ladeBogen(db, termin.id);
  const ergebnisse = new Map();
  for (const p of pruefliche) {
    ergebnisse.set(p.id, ergebnisFuer(byPruefling.get(p.id)));
  }

  res.render('schriftlichbogen/matrix', {
    title: 'Schriftliche Prüfung',
    user: req.user,
    termin,
    teilgebiete: TEILGEBIETE,
    pruefliche,
    daten: byPruefling,
    ergebnisse,
  });
});

router.post('/schriftlich', requireAuth, (req, res) => {
  const db = getDb();
  const termin = aktiverTermin(db);
  if (!termin) return res.redirect('/schriftlich');

  const prueflingIds = new Set(
    db
      .prepare('SELECT id FROM pruefling WHERE pruefungstermin_id = ?')
      .all(termin.id)
      .map((r) => r.id)
  );

  const felder = parseMatrixBody(req.body, prueflingIds);
  speichereFelder(db, felder);
  res.redirect('/schriftlich');
});

// --- Pro-Prüfling-Ansicht ---

router.get('/schriftlich/pruefling/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT * FROM pruefling WHERE id = ?')
    .get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const geschwister = db
    .prepare('SELECT id, name FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(pruefling.pruefungstermin_id);

  const { byPruefling } = ladeBogen(db, pruefling.pruefungstermin_id);
  const teilgebietMaps = byPruefling.get(pruefling.id);
  const ergebnis = ergebnisFuer(teilgebietMaps);

  res.render('schriftlichbogen/pruefling', {
    title: `Schriftlich – ${pruefling.name}`,
    user: req.user,
    pruefling,
    geschwister,
    teilgebiete: TEILGEBIETE,
    daten: teilgebietMaps,
    ergebnis,
  });
});

router.post('/schriftlich/pruefling/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT * FROM pruefling WHERE id = ?')
    .get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const felder = parseEinzelBody(req.body, pruefling.id);
  speichereFelder(db, felder);
  res.redirect(`/schriftlich/pruefling/${pruefling.id}`);
});

// --- Body-Parser ---

// Matrix-Feldnamen: p<prueflingId>_<teilgebiet>_<feld>
//                   strich_p<prueflingId>_wiso = <feldKey>
function parseMatrixBody(body, gueltigePrueflingIds) {
  const felder = [];
  // Streichungen je Prüfling einsammeln.
  const strich = new Map(); // `${prueflingId}` -> feldKey
  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^strich_p(\d+)_wiso$/);
    if (m) strich.set(Number(m[1]), value);
  }

  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^p(\d+)_([a-z]+)_([a-z0-9]+)$/);
    if (!m) continue;
    const prueflingId = Number(m[1]);
    const teilgebiet = m[2];
    const feld = m[3];
    if (!gueltigePrueflingIds.has(prueflingId)) continue;
    if (!TEILGEBIET_BY_KEY.has(teilgebiet)) continue;
    const gestrichen =
      teilgebiet === 'wiso' && strich.get(prueflingId) === feld ? 1 : 0;
    felder.push({ prueflingId, teilgebiet, feld, punkte: value, gestrichen });
  }
  return felder;
}

// Einzel-Feldnamen: <teilgebiet>_<feld>, strich_wiso = <feldKey>
function parseEinzelBody(body, prueflingId) {
  const felder = [];
  const strichWiso = body.strich_wiso;
  for (const [key, value] of Object.entries(body)) {
    const m = key.match(/^([a-z]+)_([a-z0-9]+)$/);
    if (!m) continue;
    const teilgebiet = m[1];
    const feld = m[2];
    if (!TEILGEBIET_BY_KEY.has(teilgebiet)) continue;
    const gestrichen =
      teilgebiet === 'wiso' && strichWiso === feld ? 1 : 0;
    felder.push({ prueflingId, teilgebiet, feld, punkte: value, gestrichen });
  }
  return felder;
}

module.exports = router;
