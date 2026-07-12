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
  uFelder,
} = require('../lib/schriftlich-struktur');
const {
  berechneTeilgebiet,
  berechneSchriftlichGesamt,
} = require('../lib/schriftlich-scoring');

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
    bereiche: gesamtInfo.bereiche,
  };
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

// Speichert nur die Fragenanzahl eines Bereichs (eigener Speichern-Button je
// Teilgebiet bzw. Enter). Danach Reload, damit die U-Zeilen neu gerendert werden.
router.post('/schriftlich/anzahl', requireAuth, (req, res) => {
  const db = getDb();
  const termin = aktiverTermin(db);
  if (!termin) return res.redirect('/schriftlich');
  speichereAnzahl(db, termin.id, req.body);
  res.redirect('/schriftlich');
});

// Auto-Save eines einzelnen Feldes (JSON). Speichert entweder einen Punktewert
// oder verschiebt die WISO-Streichung und liefert die neu berechneten
// Teilgebiet-Punkte + Gesamt des betroffenen Prüflings zurück.
router.post('/schriftlich/feld', requireAuth, express.json(), (req, res) => {
  const db = getDb();
  const termin = aktiverTermin(db);
  if (!termin) return res.status(400).json({ error: 'Kein aktiver Termin.' });

  const { prueflingId, teilgebiet, feld, punkte } = req.body || {};
  const pId = Number(prueflingId);

  const pruefling = db
    .prepare('SELECT id FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(pId, termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });
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
    if (!tg.streichung || !erlaubteFelder.has(feld)) {
      return res.status(400).json({ error: 'Streichung nicht möglich.' });
    }
    // Alle vorhandenen Felder dieses Teilgebiets auf gestrichen=0 setzen,
    // dann das gewählte Feld (Eintrag anlegen, falls nötig) auf gestrichen=1.
    const clearAlle = db.prepare(
      'UPDATE schriftlich_punkt SET gestrichen = 0 WHERE pruefling_id = ? AND teilgebiet = ?'
    );
    const setStrich = db.prepare(
      `INSERT INTO schriftlich_punkt (pruefling_id, teilgebiet, feld, punkte, gestrichen)
       VALUES (?, ?, ?, NULL, 1)
       ON CONFLICT(pruefling_id, teilgebiet, feld) DO UPDATE SET gestrichen = 1`
    );
    const tx = db.transaction(() => {
      clearAlle.run(pId, teilgebiet);
      setStrich.run(pId, teilgebiet, feld);
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
    speichereFelder(db, [
      { prueflingId: pId, teilgebiet, feld, punkte: wert, gestrichen: 0 },
    ]);
  }

  // Neu berechnen und zurückgeben.
  const { byPruefling } = ladeBogen(db, termin.id);
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

module.exports = router;
