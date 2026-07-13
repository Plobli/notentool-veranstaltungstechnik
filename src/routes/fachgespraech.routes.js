// src/routes/fachgespraech.routes.js
//
// Fachgespräch-Bewertung nach IHK-Protokollierbogen. Übersicht (Prüflingsliste)
// und ein Bogen je Prüfling mit einer eigenen Tabelle je Bereich. Die fünf
// Bereiche sind fest im Code (src/lib/fachgespraech-struktur.js); je Bereich wird
// eine Liste von Protokoll-Zeilen (Thema, Begründung, Skalenwert) per Auto-Save
// gespeichert. Die Bereichspunkte ergeben sich aus den Zeilen; der Server
// berechnet Ergebnisse/Gesamt/Bestehen und liefert sie zurück.
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_KRITERIUM_BY_KEY,
  FACHGESPRAECH_SKALA,
} = require('../lib/fachgespraech-struktur');
const { berechneFachgespraech } = require('../lib/fachgespraech-scoring');
const {
  ladeZeilenListe,
  serialisiereZeilen,
} = require('../lib/fachgespraech-protokoll');

const { terminBySlug, bereicheFuer } = require('../lib/pruefung');

const router = express.Router();

// Lädt den Prüfungstermin per Slug (req.termin), 404 sonst.
function ladeTermin(req, res, next) {
  const db = getDb();
  const termin = terminBySlug(db, req.params.slug);
  if (!termin) return res.status(404).send('Prüfung nicht gefunden.');
  req.termin = termin;
  next();
}

// Lädt die Protokoll-Zeilen je Bereich für einen Prüfling.
// Rückgabe: Map<kriterium_key, [{ thema, begruendung, skala }]>
function ladeZeilen(db, prueflingId) {
  const rows = db
    .prepare('SELECT * FROM fachgespraech_bewertung WHERE pruefling_id = ?')
    .all(prueflingId);
  const map = new Map();
  for (const r of rows) {
    map.set(r.kriterium_key, ladeZeilenListe(r.protokoll));
  }
  return map;
}

// Baut das { [key]: zeilen[] }-Objekt für die Berechnung.
function zeilenObjekt(zeilenMap) {
  const obj = {};
  for (const k of FACHGESPRAECH_KRITERIEN) {
    obj[k.key] = zeilenMap.get(k.key) || [];
  }
  return obj;
}

// --- Übersicht: Prüflingsliste ---

router.get('/pruefung/:slug/fachgespraech', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id);

  const uebersicht = pruefliche.map((p) => {
    const erg = berechneFachgespraech(zeilenObjekt(ladeZeilen(db, p.id)));
    return { pruefling: p, gesamtpunkte: erg.gesamtpunkte, bestanden: erg.bestanden };
  });

  res.render('fachgespraech/uebersicht', {
    title: 'Fachgespräch',
    user: req.user,
    termin,
    uebersicht,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'fachgespraech',
  });
});

// --- Bogen je Prüfling ---

router.get('/pruefung/:slug/fachgespraech/:prueflingId', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const pruefling = db
    .prepare('SELECT * FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, termin.id);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const geschwister = db
    .prepare('SELECT id, name FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(pruefling.pruefungstermin_id);

  const zeilenMap = ladeZeilen(db, pruefling.id);
  const ergebnis = berechneFachgespraech(zeilenObjekt(zeilenMap));

  res.render('fachgespraech/bogen', {
    title: `Fachgespräch – ${pruefling.name}`,
    user: req.user,
    termin,
    pruefling,
    geschwister,
    kriterien: FACHGESPRAECH_KRITERIEN,
    skala: FACHGESPRAECH_SKALA,
    zeilen: zeilenMap,
    ergebnis,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'fachgespraech',
  });
});

// --- Auto-Save der Zeilenliste eines Bereichs ---

router.post('/pruefung/:slug/fachgespraech/:prueflingId/feld', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, req.termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });

  const { kriterium, zeilen } = req.body || {};
  if (!FACHGESPRAECH_KRITERIUM_BY_KEY.has(kriterium)) {
    return res.status(400).json({ error: 'Unbekanntes Kriterium.' });
  }

  const protokoll = serialisiereZeilen(zeilen);
  db.prepare(
    `INSERT INTO fachgespraech_bewertung (pruefling_id, kriterium_key, protokoll)
     VALUES (?, ?, ?)
     ON CONFLICT(pruefling_id, kriterium_key)
     DO UPDATE SET protokoll = excluded.protokoll`
  ).run(pruefling.id, kriterium, protokoll);

  const ergebnis = berechneFachgespraech(zeilenObjekt(ladeZeilen(db, pruefling.id)));
  res.json({
    kriterien: Object.fromEntries(
      ergebnis.kriterien.map((k) => [k.key, { punkte: k.punkte, ergebnis: k.ergebnis }])
    ),
    gesamtpunkte: ergebnis.gesamtpunkte,
    bestanden: ergebnis.bestanden,
    note: ergebnis.note,
  });
});

module.exports = router;
