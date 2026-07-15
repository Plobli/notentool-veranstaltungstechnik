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
const { berechneFachgespraech, normOverride } = require('../lib/fachgespraech-scoring');
const {
  ladeZeilenListe,
  serialisiereZeilen,
} = require('../lib/fachgespraech-protokoll');
const { finaleTeilpunkteVon } = require('../lib/termin-ergebnisse');
const { BESTEHENSGRENZE } = require('../lib/schriftlich-struktur');

const { terminBySlug, bereicheFuer } = require('../lib/pruefung');

const router = express.Router();

// Wiederholer: im Vortermin bestandenes Fachgespräch (>= Bestehensgrenze)?
// Rückgabe: übernommene Punkte oder null (kein Wiederholer / nicht bestanden).
function fachgespraechUebernommen(db, pruefling) {
  if (!pruefling.wiederholt_von) return null;
  const vor = finaleTeilpunkteVon(db, pruefling.wiederholt_von);
  if (vor.fachgespraech !== null && vor.fachgespraech >= BESTEHENSGRENZE) {
    return vor.fachgespraech;
  }
  return null;
}

// Lädt den Prüfungstermin per Slug (req.termin), 404 sonst.
function ladeTermin(req, res, next) {
  const db = getDb();
  const termin = terminBySlug(db, req.params.slug);
  if (!termin) return res.status(404).send('Prüfung nicht gefunden.');
  req.termin = termin;
  next();
}

// Lädt die Protokoll-Zeilen und den Punkte-Override je Bereich für einen
// Prüfling.
// Rückgabe: {
//   zeilen:    Map<kriterium_key, [{ thema, begruendung, skala }]>,
//   override:  Map<kriterium_key, zahl|null>  (manuell gesetzte Bereichspunkte)
// }
function ladeZeilen(db, prueflingId) {
  const rows = db
    .prepare('SELECT * FROM fachgespraech_bewertung WHERE pruefling_id = ?')
    .all(prueflingId);
  const zeilen = new Map();
  const override = new Map();
  for (const r of rows) {
    zeilen.set(r.kriterium_key, ladeZeilenListe(r.protokoll));
    override.set(r.kriterium_key, normOverride(r.punkte));
  }
  return { zeilen, override };
}

// Baut das { [key]: zeilen[] }-Objekt für die Berechnung.
function zeilenObjekt(daten) {
  const obj = {};
  for (const k of FACHGESPRAECH_KRITERIEN) {
    obj[k.key] = daten.zeilen.get(k.key) || [];
  }
  return obj;
}

// Baut das { [key]: override|null }-Objekt für die Berechnung.
function overrideObjekt(daten) {
  const obj = {};
  for (const k of FACHGESPRAECH_KRITERIEN) {
    obj[k.key] = daten.override.get(k.key) ?? null;
  }
  return obj;
}

// Berechnet das Fachgespräch-Ergebnis aus geladenen Daten (Zeilen + Overrides).
function ergebnisAus(daten) {
  return berechneFachgespraech(zeilenObjekt(daten), overrideObjekt(daten));
}

// --- Übersicht: Prüflingsliste ---

router.get('/pruefung/:slug/fachgespraech', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id);

  const uebersicht = pruefliche.map((p) => {
    const uebernommen = fachgespraechUebernommen(db, p);
    if (uebernommen !== null) {
      return { pruefling: p, gesamtpunkte: uebernommen, bestanden: true, uebernommen: true };
    }
    const erg = ergebnisAus(ladeZeilen(db, p.id));
    return { pruefling: p, gesamtpunkte: erg.gesamtpunkte, bestanden: erg.bestanden, uebernommen: false };
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

  const daten = ladeZeilen(db, pruefling.id);
  const ergebnis = ergebnisAus(daten);
  const uebernommen = fachgespraechUebernommen(db, pruefling);

  res.render('fachgespraech/bogen', {
    title: `Fachgespräch – ${pruefling.name}`,
    user: req.user,
    termin,
    pruefling,
    geschwister,
    kriterien: FACHGESPRAECH_KRITERIEN,
    skala: FACHGESPRAECH_SKALA,
    zeilen: daten.zeilen,
    ergebnis,
    uebernommen,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'fachgespraech',
  });
});

// --- Auto-Save der Zeilenliste eines Bereichs ---

router.post('/pruefung/:slug/fachgespraech/:prueflingId/feld', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id, wiederholt_von FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, req.termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });
  if (fachgespraechUebernommen(db, pruefling) !== null) {
    return res.status(409).json({ error: 'Fachgespräch aus dem Vortermin übernommen – gesperrt.' });
  }

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

  res.json(antwort(ergebnisAus(ladeZeilen(db, pruefling.id))));
});

// --- Manueller Punkte-Override eines Bereichs (überschreibt die errechneten
//     Bereichspunkte; leerer/ungültiger Wert setzt zurück auf errechnet). ---

router.post('/pruefung/:slug/fachgespraech/:prueflingId/punkte', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id, wiederholt_von FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, req.termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });
  if (fachgespraechUebernommen(db, pruefling) !== null) {
    return res.status(409).json({ error: 'Fachgespräch aus dem Vortermin übernommen – gesperrt.' });
  }

  const { kriterium, punkte } = req.body || {};
  if (!FACHGESPRAECH_KRITERIUM_BY_KEY.has(kriterium)) {
    return res.status(400).json({ error: 'Unbekanntes Kriterium.' });
  }

  const override = normOverride(punkte); // null = zurück auf errechnet
  db.prepare(
    `INSERT INTO fachgespraech_bewertung (pruefling_id, kriterium_key, punkte)
     VALUES (?, ?, ?)
     ON CONFLICT(pruefling_id, kriterium_key)
     DO UPDATE SET punkte = excluded.punkte`
  ).run(pruefling.id, kriterium, override);

  res.json(antwort(ergebnisAus(ladeZeilen(db, pruefling.id))));
});

// Serialisiert ein Berechnungsergebnis für die Auto-Save-Antwort.
function antwort(ergebnis) {
  return {
    kriterien: Object.fromEntries(
      ergebnis.kriterien.map((k) => [
        k.key,
        { punkte: k.punkte, ergebnis: k.ergebnis, errechnet: k.errechnet, override: k.override },
      ])
    ),
    gesamtpunkte: ergebnis.gesamtpunkte,
    bestanden: ergebnis.bestanden,
    note: ergebnis.note,
  };
}

module.exports = router;
