// src/routes/projekt.routes.js
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { berechneProjektErgebnis } = require('../lib/scoring');

const router = express.Router();

router.get('/projekt/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db.prepare('SELECT * FROM pruefling WHERE id = ?').get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const kriterien = db
    .prepare('SELECT * FROM projekt_kriterium WHERE pruefungstermin_id = ? ORDER BY sortierung')
    .all(pruefling.pruefungstermin_id);

  const bewertungen = db
    .prepare('SELECT * FROM projekt_bewertung WHERE pruefling_id = ?')
    .all(pruefling.id);

  const zeilen = kriterien.map((k) => {
    const bewertung = bewertungen.find((b) => b.projekt_kriterium_id === k.id);
    return {
      kriterium: k,
      protokoll: bewertung ? bewertung.protokoll : '',
      punkte: bewertung ? bewertung.punkte : null,
      final: bewertung ? Boolean(bewertung.final) : false,
    };
  });

  const vollstaendig = zeilen.every((z) => z.punkte !== null);
  const ergebnis = vollstaendig
    ? berechneProjektErgebnis(zeilen.map((z) => ({ punkte: z.punkte, faktor: z.kriterium.faktor })))
    : null;

  res.render('projekt/bogen', {
    title: `Projekt-Bewertung – ${pruefling.name}`,
    user: req.user,
    pruefling,
    zeilen,
    ergebnis,
  });
});

router.post('/projekt/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db.prepare('SELECT * FROM pruefling WHERE id = ?').get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');
  const kriterien = db
    .prepare('SELECT * FROM projekt_kriterium WHERE pruefungstermin_id = ?')
    .all(pruefling.pruefungstermin_id);

  const upsert = db.prepare(
    `INSERT INTO projekt_bewertung (pruefling_id, projekt_kriterium_id, protokoll, punkte, final)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(pruefling_id, projekt_kriterium_id)
     DO UPDATE SET protokoll = excluded.protokoll, punkte = excluded.punkte, final = excluded.final`
  );

  for (const k of kriterien) {
    const protokoll = req.body[`protokoll_${k.id}`] || '';
    const punkteRoh = req.body[`punkte_${k.id}`];
    const punkte = punkteRoh === '' || punkteRoh === undefined ? null : Number(punkteRoh);
    const final = req.body.final === '1' ? 1 : 0;
    upsert.run(pruefling.id, k.id, protokoll, punkte, final);
  }

  res.redirect(`/projekt/${pruefling.id}`);
});

module.exports = router;
