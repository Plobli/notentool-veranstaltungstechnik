// src/routes/schriftlichbogen.routes.js
//
// Feste Auswertungsbogen-Ansicht der schriftlichen Prüfung.
// Zwei Ansichten auf denselben Daten: Matrix (alle Prüflinge nebeneinander)
// und Pro Prüfling (eine Seite je Prüfling). Beide schreiben in
// schriftlich_punkt.
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const {
  TEILGEBIETE,
  TEILGEBIET_BY_KEY,
  KONFIGURIERBARE_TEILGEBIETE,
  DEFAULT_ANZAHL,
  uFelder,
} = require('../lib/schriftlich-struktur');
const { berechneTeilgebiet } = require('../lib/schriftlich-scoring');

const router = express.Router();

// Liefert den aktiven Prüfungstermin oder null.
function aktiverTermin(db) {
  return db
    .prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 1 ORDER BY id DESC LIMIT 1')
    .get();
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
function ergebnisFuer(teilgebietMaps, anzahlMap) {
  const teilgebiete = {};
  let gesamt = 0;
  for (const t of TEILGEBIETE) {
    const anzahl = anzahlMap ? anzahlMap[t.key] : undefined;
    const erg = berechneTeilgebiet(t.key, teilgebietMaps[t.key] || new Map(), anzahl);
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
      anzahlMap: { ...DEFAULT_ANZAHL },
      felderMap: ladeFelderMap({ ...DEFAULT_ANZAHL }),
      pruefliche: [],
      daten: new Map(),
      ergebnisse: new Map(),
    });
  }

  const anzahlMap = ladeAnzahlMap(db, termin.id);
  const felderMap = ladeFelderMap(anzahlMap);
  const { pruefliche, byPruefling } = ladeBogen(db, termin.id);
  const ergebnisse = new Map();
  for (const p of pruefliche) {
    ergebnisse.set(p.id, ergebnisFuer(byPruefling.get(p.id), anzahlMap));
  }

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

  speichereAnzahl(db, termin.id, req.body);

  const felder = parseMatrixBody(req.body, prueflingIds);
  speichereFelder(db, felder);
  res.redirect('/schriftlich');
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

module.exports = router;
