const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { ART_LABEL, bereicheFuer, terminBySlug } = require('../lib/pruefung');
const { ladeTerminErgebnisse } = require('../lib/termin-ergebnisse');
const { TEILGEBIETE } = require('../lib/schriftlich-struktur');

const router = express.Router();

// Lädt den Prüfungstermin per Slug und hängt ihn an req.termin. 404 sonst.
function ladeTermin(req, res, next) {
  const db = getDb();
  const termin = terminBySlug(db, req.params.slug);
  if (!termin) return res.status(404).send('Prüfung nicht gefunden.');
  req.termin = termin;
  next();
}

// Übersicht einer Prüfung: Ergebnistabelle + Bereichs-Links je nach Art.
router.get('/pruefung/:slug', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const termin = req.termin;
  res.render('pruefung/uebersicht', {
    title: termin.name,
    user: req.user,
    termin,
    artLabel: ART_LABEL[termin.art] || termin.art,
    bereiche: bereicheFuer(termin.art),
    zeilen: ladeTerminErgebnisse(db, termin.id),
    teilgebiete: TEILGEBIETE,
  });
});

// Platzhalter für strukturell vorbereitete, aber noch nicht umgesetzte Bereiche
// (MEP; Zwischenprüfung Schriftlich/Mündlich).
function platzhalter(bereichName) {
  return (req, res) => {
    res.render('pruefung/platzhalter', {
      title: bereichName,
      user: req.user,
      termin: req.termin,
      bereichName,
    });
  };
}

router.get('/pruefung/:slug/mep', requireAuth, ladeTermin, platzhalter('Mündliche Ergänzungsprüfung'));
router.get('/pruefung/:slug/muendlich', requireAuth, ladeTermin, platzhalter('Mündliche Prüfung'));

// Einstellung: dürfen Prüfer fremde Einzelbewertungen (schriftlich) sehen?
router.post('/pruefung/:slug/einstellungen/einsicht', requireAuth, ladeTermin, (req, res) => {
  const db = getDb();
  const wert = req.body.einsicht_fremd === '1' ? 1 : 0;
  db.prepare('UPDATE pruefungstermin SET einsicht_fremd = ? WHERE id = ?').run(wert, req.termin.id);
  res.redirect(`/pruefung/${req.termin.slug}`);
});

module.exports = router;
module.exports.ladeTermin = ladeTermin;
