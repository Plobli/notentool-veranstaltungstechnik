// src/routes/fachgespraech.routes.js
//
// Fachgespräch-Bewertung. Übersicht (Prüflingsliste) und ein Bogen je Prüfling.
// Die fünf Kriterien sind fest im Code (src/lib/fachgespraech-struktur.js);
// Protokoll und Punkte werden per Auto-Save (POST /fachgespraech/:id/feld, JSON)
// einzeln gespeichert. Der Server berechnet Ergebnisse/Gesamt/Bestehen und
// liefert sie zurück.
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_KRITERIUM_BY_KEY,
  FACHGESPRAECH_MAX_PUNKTE,
} = require('../lib/fachgespraech-struktur');
const { berechneFachgespraech } = require('../lib/fachgespraech-scoring');

const router = express.Router();

function aktiverTermin(db) {
  return db
    .prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 1 ORDER BY id DESC LIMIT 1')
    .get();
}

// Lädt Protokoll + Punkte je Kriterium für einen Prüfling.
// Rückgabe: Map<kriterium_key, { protokoll, punkte }>
function ladeBewertung(db, prueflingId) {
  const rows = db
    .prepare('SELECT * FROM fachgespraech_bewertung WHERE pruefling_id = ?')
    .all(prueflingId);
  const map = new Map();
  for (const r of rows) {
    map.set(r.kriterium_key, { protokoll: r.protokoll, punkte: r.punkte });
  }
  return map;
}

// Baut das { [key]: punkte }-Objekt für die Berechnung.
function punkteObjekt(bewertungMap) {
  const obj = {};
  for (const k of FACHGESPRAECH_KRITERIEN) {
    const b = bewertungMap.get(k.key);
    obj[k.key] = b && b.punkte !== null && b.punkte !== undefined ? b.punkte : null;
  }
  return obj;
}

// --- Übersicht: Prüflingsliste ---

router.get('/fachgespraech', requireAuth, (req, res) => {
  const db = getDb();
  const termin = aktiverTermin(db);
  const pruefliche = termin
    ? db
        .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
        .all(termin.id)
    : [];

  // Gesamtpunkte je Prüfling für die Übersicht mitberechnen.
  const uebersicht = pruefliche.map((p) => {
    const erg = berechneFachgespraech(punkteObjekt(ladeBewertung(db, p.id)));
    return { pruefling: p, gesamtpunkte: erg.gesamtpunkte, bestanden: erg.bestanden };
  });

  res.render('fachgespraech/uebersicht', {
    title: 'Fachgespräch',
    user: req.user,
    termin,
    uebersicht,
  });
});

// --- Bogen je Prüfling ---

router.get('/fachgespraech/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT * FROM pruefling WHERE id = ?')
    .get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const geschwister = db
    .prepare('SELECT id, name FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(pruefling.pruefungstermin_id);

  const bewertung = ladeBewertung(db, pruefling.id);
  const ergebnis = berechneFachgespraech(punkteObjekt(bewertung));

  res.render('fachgespraech/bogen', {
    title: `Fachgespräch – ${pruefling.name}`,
    user: req.user,
    pruefling,
    geschwister,
    kriterien: FACHGESPRAECH_KRITERIEN,
    bewertung,
    ergebnis,
  });
});

// --- Auto-Save eines Feldes (Punkte oder Protokoll) ---

router.post('/fachgespraech/:prueflingId/feld', requireAuth, express.json(), (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id FROM pruefling WHERE id = ?')
    .get(req.params.prueflingId);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });

  const { kriterium, feld, wert } = req.body || {};
  if (!FACHGESPRAECH_KRITERIUM_BY_KEY.has(kriterium)) {
    return res.status(400).json({ error: 'Unbekanntes Kriterium.' });
  }
  if (feld !== 'punkte' && feld !== 'protokoll') {
    return res.status(400).json({ error: 'Unbekanntes Feld.' });
  }

  // Bestehenden Eintrag lesen (Upsert braucht beide Spalten).
  const vorhanden = db
    .prepare(
      'SELECT protokoll, punkte FROM fachgespraech_bewertung WHERE pruefling_id = ? AND kriterium_key = ?'
    )
    .get(pruefling.id, kriterium);

  let protokoll = vorhanden ? vorhanden.protokoll : null;
  let punkte = vorhanden ? vorhanden.punkte : null;

  if (feld === 'protokoll') {
    protokoll = typeof wert === 'string' ? wert : '';
  } else {
    // Punkte hart auf 0..MAX klemmen; leer -> null.
    if (wert === '' || wert === null || wert === undefined) {
      punkte = null;
    } else {
      const n = Number(wert);
      punkte = Number.isFinite(n)
        ? Math.max(0, Math.min(FACHGESPRAECH_MAX_PUNKTE, n))
        : null;
    }
  }

  db.prepare(
    `INSERT INTO fachgespraech_bewertung (pruefling_id, kriterium_key, protokoll, punkte)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(pruefling_id, kriterium_key)
     DO UPDATE SET protokoll = excluded.protokoll, punkte = excluded.punkte`
  ).run(pruefling.id, kriterium, protokoll, punkte);

  // Neu berechnen und zurückgeben.
  const ergebnis = berechneFachgespraech(punkteObjekt(ladeBewertung(db, pruefling.id)));
  res.json({
    kriterien: Object.fromEntries(
      ergebnis.kriterien.map((k) => [k.key, { ergebnis: k.ergebnis }])
    ),
    gesamtpunkte: ergebnis.gesamtpunkte,
    bestanden: ergebnis.bestanden,
    note: ergebnis.note,
  });
});

module.exports = router;
