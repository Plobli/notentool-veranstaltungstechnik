// src/routes/schriftlich.routes.js
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { berechneFachPunkte } = require('../lib/scoring');

const router = express.Router();

function ladeBloeckeMitEintraegen(db, fachId, korrektureintragId) {
  const bloecke = db
    .prepare('SELECT * FROM aufgabenblock WHERE fach_id = ? ORDER BY sortierung')
    .all(fachId);
  return bloecke.map((block) => {
    const unteraufgaben = db
      .prepare('SELECT * FROM unteraufgabe WHERE aufgabenblock_id = ? ORDER BY sortierung')
      .all(block.id);
    const punkteEintraege = korrektureintragId
      ? db
          .prepare(
            `SELECT * FROM korrekturpunkt
             WHERE korrektureintrag_id = ?
             AND unteraufgabe_id IN (${unteraufgaben.map(() => '?').join(',') || 'NULL'})`
          )
          .all(korrektureintragId, ...unteraufgaben.map((u) => u.id))
      : [];
    return { ...block, unteraufgaben, punkteEintraege };
  });
}

router.get('/schriftlich/:fachId/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const fach = db.prepare('SELECT * FROM fach WHERE id = ?').get(req.params.fachId);
  const pruefling = db.prepare('SELECT * FROM pruefling WHERE id = ?').get(req.params.prueflingId);
  if (!fach || !pruefling) return res.status(404).send('Nicht gefunden.');

  let eintrag = db
    .prepare(
      'SELECT * FROM korrektureintrag WHERE fach_id = ? AND pruefling_id = ? AND pruefer_id = ?'
    )
    .get(fach.id, pruefling.id, req.user.id);

  const bloecke = ladeBloeckeMitEintraegen(db, fach.id, eintrag ? eintrag.id : null);
  const ergebnis = berechneFachPunkte(
    bloecke.map((b) => ({
      ziel_anteil: b.ziel_anteil,
      unteraufgaben: b.unteraufgaben,
      punkteEintraege: b.punkteEintraege,
    }))
  );

  res.render('schriftlich/eingabe', {
    title: `${fach.name} – ${pruefling.name}`,
    user: req.user,
    fach,
    pruefling,
    eintrag,
    bloecke,
    ergebnis,
  });
});

router.post('/schriftlich/:fachId/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const { fachId, prueflingId } = req.params;
  const abschliessen = req.body.abschliessen === '1';

  let eintrag = db
    .prepare(
      'SELECT * FROM korrektureintrag WHERE fach_id = ? AND pruefling_id = ? AND pruefer_id = ?'
    )
    .get(fachId, prueflingId, req.user.id);

  if (!eintrag) {
    const info = db
      .prepare(
        'INSERT INTO korrektureintrag (pruefling_id, fach_id, pruefer_id, status) VALUES (?, ?, ?, ?)'
      )
      .run(prueflingId, fachId, req.user.id, 'entwurf');
    eintrag = { id: info.lastInsertRowid };
  }

  const upsert = db.prepare(
    `INSERT INTO korrekturpunkt (korrektureintrag_id, unteraufgabe_id, punkte, entfaellt)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(korrektureintrag_id, unteraufgabe_id)
     DO UPDATE SET punkte = excluded.punkte, entfaellt = excluded.entfaellt`
  );

  for (const [key, value] of Object.entries(req.body)) {
    const match = key.match(/^punkte_(\d+)$/);
    if (match) {
      const unteraufgabeId = Number(match[1]);
      const entfaellt = req.body[`entfaellt_${unteraufgabeId}`] === '1' ? 1 : 0;
      upsert.run(eintrag.id, unteraufgabeId, value === '' ? null : Number(value), entfaellt);
    }
  }

  db.prepare('UPDATE korrektureintrag SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(
    abschliessen ? 'abgeschlossen' : 'entwurf',
    eintrag.id
  );

  res.redirect(`/schriftlich/${fachId}/${prueflingId}`);
});

router.get('/schriftlich/:fachId/:prueflingId/vergleich', requireAuth, (req, res) => {
  const db = getDb();
  const fach = db.prepare('SELECT * FROM fach WHERE id = ?').get(req.params.fachId);
  const pruefling = db.prepare('SELECT * FROM pruefling WHERE id = ?').get(req.params.prueflingId);

  const eintraege = db
    .prepare(
      `SELECT k.*, u.name as pruefer_name FROM korrektureintrag k
       JOIN user u ON u.id = k.pruefer_id
       WHERE k.fach_id = ? AND k.pruefling_id = ? AND k.status = 'abgeschlossen'`
    )
    .all(fach.id, pruefling.id);

  const ergebnisse = eintraege.map((eintrag) => {
    const bloecke = ladeBloeckeMitEintraegen(db, fach.id, eintrag.id);
    const ergebnis = berechneFachPunkte(
      bloecke.map((b) => ({
        ziel_anteil: b.ziel_anteil,
        unteraufgaben: b.unteraufgaben,
        punkteEintraege: b.punkteEintraege,
      }))
    );
    return { pruefer_name: eintrag.pruefer_name, punkte: ergebnis.punkte };
  });

  const durchschnitt = ergebnisse.length
    ? Math.round(ergebnisse.reduce((s, e) => s + e.punkte, 0) / ergebnisse.length)
    : null;

  res.render('schriftlich/vergleich', {
    title: `Vergleich: ${fach.name} – ${pruefling.name}`,
    user: req.user,
    fach,
    pruefling,
    ergebnisse,
    durchschnitt,
  });
});

module.exports = router;
