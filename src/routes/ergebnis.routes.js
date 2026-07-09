// src/routes/ergebnis.routes.js
const express = require('express');
const { getDb } = require('../db');
const { requireAuth } = require('../middleware');
const { berechneFachPunkte, berechneProjektErgebnis, berechneGesamtergebnis } = require('../lib/scoring');
const { zuCsv } = require('../lib/csv');

const router = express.Router();

function berechnePrueflingsErgebnis(db, pruefling) {
  const faecher = db
    .prepare('SELECT * FROM fach WHERE pruefungstermin_id = ? ORDER BY sortierung')
    .all(pruefling.pruefungstermin_id);

  const bereiche = [];

  for (const fach of faecher) {
    const eintraege = db
      .prepare(
        "SELECT * FROM korrektureintrag WHERE fach_id = ? AND pruefling_id = ? AND status = 'abgeschlossen'"
      )
      .all(fach.id, pruefling.id);

    if (eintraege.length === 0) continue;

    const punkteJeEintrag = eintraege.map((eintrag) => {
      const bloecke = db
        .prepare('SELECT * FROM aufgabenblock WHERE fach_id = ? ORDER BY sortierung')
        .all(fach.id)
        .map((block) => {
          const unteraufgaben = db
            .prepare('SELECT * FROM unteraufgabe WHERE aufgabenblock_id = ? ORDER BY sortierung')
            .all(block.id);
          const punkteEintraege = db
            .prepare('SELECT * FROM korrekturpunkt WHERE korrektureintrag_id = ?')
            .all(eintrag.id);
          return { ziel_anteil: block.ziel_anteil, unteraufgaben, punkteEintraege };
        });
      return berechneFachPunkte(bloecke).punkte;
    });

    const durchschnitt = Math.round(
      punkteJeEintrag.reduce((s, p) => s + p, 0) / punkteJeEintrag.length
    );

    bereiche.push({
      name: fach.name,
      punkte: durchschnitt,
      gewichtung_prozent: fach.gewichtung_prozent,
      ist_sperrfach: Boolean(fach.ist_sperrfach),
    });
  }

  const projektKriterien = db
    .prepare('SELECT * FROM projekt_kriterium WHERE pruefungstermin_id = ?')
    .all(pruefling.pruefungstermin_id);
  const projektBewertungen = db
    .prepare('SELECT * FROM projekt_bewertung WHERE pruefling_id = ? AND final = 1')
    .all(pruefling.id);

  if (projektBewertungen.length === projektKriterien.length && projektKriterien.length > 0) {
    const zeilen = projektKriterien.map((k) => {
      const b = projektBewertungen.find((x) => x.projekt_kriterium_id === k.id);
      return { punkte: b.punkte, faktor: k.faktor };
    });
    const projektErgebnis = berechneProjektErgebnis(zeilen);
    bereiche.push({
      name: 'Realisieren eines veranstaltungstechnischen Projekts',
      punkte: projektErgebnis.gesamtpunkte,
      gewichtung_prozent: 50,
      ist_sperrfach: true,
    });
  }

  if (bereiche.length === 0) return null;
  return berechneGesamtergebnis(bereiche);
}

router.get('/ergebnis/:prueflingId', requireAuth, (req, res) => {
  const db = getDb();
  const pruefling = db.prepare('SELECT * FROM pruefling WHERE id = ?').get(req.params.prueflingId);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');

  const ergebnis = berechnePrueflingsErgebnis(db, pruefling);

  res.render('ergebnis/pruefling', {
    title: `Gesamtergebnis – ${pruefling.name}`,
    user: req.user,
    pruefling,
    ergebnis,
  });
});

router.get('/ergebnis/termin/:terminId/export.csv', requireAuth, (req, res) => {
  const db = getDb();
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(req.params.terminId);

  const rows = pruefliche.map((p) => {
    const ergebnis = berechnePrueflingsErgebnis(db, p);
    return [
      p.name,
      p.betrieb || '',
      ergebnis ? ergebnis.gesamtpunkte : '',
      ergebnis ? ergebnis.note : '',
      ergebnis ? (ergebnis.bestanden ? 'bestanden' : 'nicht bestanden') : 'unvollständig',
    ];
  });

  const csv = zuCsv(['Name', 'Betrieb', 'Gesamtpunkte', 'Note', 'Ergebnis'], rows);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gesamtergebnis.csv"');
  res.send('﻿' + csv);
});

module.exports = router;
