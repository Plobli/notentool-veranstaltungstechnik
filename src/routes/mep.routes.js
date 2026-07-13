// src/routes/mep.routes.js
//
// Mündliche Ergänzungsprüfung (§20 Abs. 3 VfAusbV). Auf Antrag des Prüflings
// kann GENAU EIN schriftlicher Prüfungsbereich mündlich ergänzt werden, wenn
//   1. der Bereich schlechter als "ausreichend" bewertet wurde und
//   2. die MEP für das Bestehen den Ausschlag geben KANN.
// Beide Bedingungen liefert die schriftliche Auswertung bereits als
// `mepBereiche` (siehe schriftlich-scoring.js). Die Bewertung erfolgt – wie
// beim Fachgespräch – über eine Liste von Protokoll-Zeilen; die mündlichen
// Punkte gehen mit dem schriftlichen Ergebnis im Verhältnis 2:1 in einen neuen
// Bereichswert ein.
//
// Übersicht (Prüflingsliste) + ein Bogen je Prüfling. Pro Prüfling ist nur eine
// MEP möglich (UNIQUE(pruefling_id) in mep_bewertung).
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { terminBySlug, bereicheFuer } = require('../lib/pruefung');
const { TEILGEBIET_BY_KEY } = require('../lib/schriftlich-struktur');
const { berechneMep } = require('../lib/schriftlich-scoring');
const { FACHGESPRAECH_SKALA } = require('../lib/fachgespraech-struktur');
const {
  ladeZeilenListe,
  serialisiereZeilen,
  bereichPunkte,
} = require('../lib/fachgespraech-protokoll');
const { ladeTerminErgebnisse } = require('../lib/termin-ergebnisse');

const router = express.Router();

// Lädt den Prüfungstermin per Slug (req.termin), 404 sonst.
function ladeTermin(req, res, next) {
  const db = getDb();
  const termin = terminBySlug(db, req.params.slug);
  if (!termin) return res.status(404).send('Prüfung nicht gefunden.');
  req.termin = termin;
  next();
}

// Die gespeicherte MEP eines Prüflings (Zeile aus mep_bewertung) oder null.
function ladeMepZeile(db, prueflingId) {
  return db
    .prepare('SELECT * FROM mep_bewertung WHERE pruefling_id = ?')
    .get(prueflingId);
}

// Menschlicher Bereichsname eines Teilgebiet-Keys.
function bereichName(key) {
  const tg = TEILGEBIET_BY_KEY.get(key);
  return tg ? tg.name : key;
}

// --- Übersicht: Prüflingsliste mit MEP-Status ---

router.get('/pruefung/:slug/mep', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  // Schriftliche Auswertung je Prüfling liefert mepBereiche (nur die Bereiche,
  // in denen eine MEP den Ausschlag geben kann) und den Stand nach MEP.
  const zeilen = ladeTerminErgebnisse(db, termin.id);

  const uebersicht = zeilen.map((z) => {
    const mepZeile = ladeMepZeile(db, z.pruefling.id);
    return {
      pruefling: z.pruefling,
      mepMoeglich: z.schriftlich.mepMoeglich,
      mepBereiche: z.schriftlich.mepBereiche.map((k) => ({ key: k, name: bereichName(k) })),
      // Bereits bewertete/durchgeführte MEP?
      mep: z.mep,
      hatEingabe: Boolean(mepZeile),
    };
  });

  res.render('mep/uebersicht', {
    title: 'Mündliche Ergänzungsprüfung',
    user: req.user,
    termin,
    uebersicht,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'mep',
  });
});

// --- Bogen je Prüfling ---

router.get('/pruefung/:slug/mep/:prueflingId', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  const pruefling = db
    .prepare('SELECT * FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, termin.id);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const geschwister = db
    .prepare('SELECT id, name FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(pruefling.pruefungstermin_id);

  // Schriftliche Auswertung dieses Prüflings (für mepBereiche + Bereichspunkte).
  const alle = ladeTerminErgebnisse(db, termin.id);
  const eintrag = alle.find((z) => z.pruefling.id === pruefling.id);
  const schriftlich = eintrag.schriftlich;

  // Nur die Bereiche anbieten, in denen die MEP den Ausschlag geben kann.
  const auswahl = schriftlich.mepBereiche.map((key) => ({
    key,
    name: bereichName(key),
    schriftlich: schriftlich.bereiche[key].punkte,
    noetigeMuendlich: schriftlich.bereiche[key].noetigeMuendlich,
  }));

  // Gespeicherte MEP laden.
  const mepZeile = ladeMepZeile(db, pruefling.id);
  const gewaehltesTeilgebiet = mepZeile ? mepZeile.teilgebiet : (auswahl[0] ? auswahl[0].key : null);
  const zeilen = mepZeile ? ladeZeilenListe(mepZeile.protokoll) : [];

  // Ergebnis nach MEP (live berechenbar, hier für die Erstanzeige).
  const punkteJeBereich = {};
  for (const key of Object.keys(schriftlich.bereiche)) {
    punkteJeBereich[key] = schriftlich.bereiche[key].punkte;
  }
  const bewertet = zeilen.some((z) => z.skala !== '');
  const muendlich = bewertet ? bereichPunkte(zeilen) : null;
  const mepInfo = berechneMep(punkteJeBereich, gewaehltesTeilgebiet, muendlich);

  res.render('mep/bogen', {
    title: `Mündliche Ergänzungsprüfung – ${pruefling.name}`,
    user: req.user,
    termin,
    pruefling,
    geschwister,
    schriftlich,
    auswahl,
    gewaehltesTeilgebiet,
    zeilen,
    muendlich,
    mepInfo,
    skala: FACHGESPRAECH_SKALA,
    bereiche: bereicheFuer(termin.art),
    aktiverBereich: 'mep',
  });
});

// --- Auto-Save: Bereichswahl + Protokoll-Zeilen ---

router.post('/pruefung/:slug/mep/:prueflingId/feld', requireAuth, ladeTermin, express.json(), (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, req.termin.id);
  if (!pruefling) return res.status(404).json({ error: 'Prüfling nicht gefunden.' });

  const { teilgebiet, zeilen } = req.body || {};

  // Nur ausschlaggebende Bereiche zulassen (§20 Abs. 3).
  const alle = ladeTerminErgebnisse(db, req.termin.id);
  const eintrag = alle.find((z) => z.pruefling.id === pruefling.id);
  const erlaubt = new Set(eintrag.schriftlich.mepBereiche);
  if (!erlaubt.has(teilgebiet)) {
    return res.status(400).json({ error: 'In diesem Bereich ist keine MEP zulässig.' });
  }

  const protokoll = serialisiereZeilen(zeilen);
  // Genau eine MEP je Prüfling: Bereichswechsel überschreibt den Datensatz.
  db.prepare(
    `INSERT INTO mep_bewertung (pruefling_id, teilgebiet, protokoll)
     VALUES (?, ?, ?)
     ON CONFLICT(pruefling_id)
     DO UPDATE SET teilgebiet = excluded.teilgebiet, protokoll = excluded.protokoll`
  ).run(pruefling.id, teilgebiet, protokoll);

  // Ergebnis nach MEP zurückliefern.
  const punkteJeBereich = {};
  for (const key of Object.keys(eintrag.schriftlich.bereiche)) {
    punkteJeBereich[key] = eintrag.schriftlich.bereiche[key].punkte;
  }
  const geladen = ladeZeilenListe(protokoll);
  const bewertet = geladen.some((z) => z.skala !== '');
  const muendlich = bewertet ? bereichPunkte(geladen) : null;
  const mepInfo = berechneMep(punkteJeBereich, teilgebiet, muendlich);

  res.json({
    muendlich,
    schriftlich: mepInfo.schriftlich,
    bereichNachMep: mepInfo.bereichNachMep,
    gesamt: mepInfo.gewichtet,
    bestanden: mepInfo.bestanden,
    wirksam: mepInfo.wirksam,
  });
});

module.exports = router;
