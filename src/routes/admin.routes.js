const express = require('express');
const { getDb } = require('../db');
const { hashPassword } = require('../auth');
const { requireAdmin } = require('../middleware');
const { ART_LABEL, nameVorschlaege } = require('../lib/pruefung');
const { slugify, eindeutigerSlug } = require('../lib/slug');

const router = express.Router();

router.get('/admin', requireAdmin, (req, res) => {
  const db = getDb();
  const termine = db.prepare('SELECT * FROM pruefungstermin ORDER BY id DESC').all();
  const pruefer = db.prepare("SELECT * FROM user ORDER BY name").all();
  res.render('admin/index', {
    title: 'Verwaltung',
    user: req.user,
    termine,
    pruefer,
    artLabel: ART_LABEL,
    vorschlaege: nameVorschlaege(),
  });
});

router.post('/admin/pruefungstermine', requireAdmin, (req, res) => {
  const db = getDb();
  const name = (req.body.name || '').trim();
  const art = req.body.art === 'zwischen' ? 'zwischen' : 'abschluss';
  if (!name) return res.redirect('/admin');

  const vergebene = new Set(
    db.prepare('SELECT slug FROM pruefungstermin WHERE slug IS NOT NULL').all().map((r) => r.slug)
  );
  const slug = eindeutigerSlug(slugify(name), vergebene);

  db.prepare('INSERT INTO pruefungstermin (name, art, slug, ist_aktiv) VALUES (?, ?, ?, 1)')
    .run(name, art, slug);
  res.redirect('/admin');
});

router.get('/admin/pruefer/neu', requireAdmin, (req, res) => {
  res.render('admin/pruefer-neu', { title: 'Prüfer anlegen', user: req.user, error: null });
});

router.post('/admin/pruefer', requireAdmin, async (req, res) => {
  const { name, email, password, role } = req.body;
  const hash = await hashPassword(password);
  try {
    getDb()
      .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, hash, role === 'admin' ? 'admin' : 'pruefer');
    res.redirect('/admin');
  } catch (err) {
    res.render('admin/pruefer-neu', {
      title: 'Prüfer anlegen',
      user: req.user,
      error: 'E-Mail bereits vergeben oder Eingabe ungültig.',
    });
  }
});

router.get('/admin/termine/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE id = ?').get(req.params.id);
  if (!termin) return res.status(404).send('Prüfungstermin nicht gefunden.');
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id);
  const faecher = db
    .prepare('SELECT * FROM fach WHERE pruefungstermin_id = ? ORDER BY sortierung')
    .all(termin.id);
  res.render('admin/termin', { title: termin.name, user: req.user, termin, pruefliche, faecher });
});

router.post('/admin/termine/:id/pruefling', requireAdmin, (req, res) => {
  const { name, betrieb } = req.body;
  getDb()
    .prepare('INSERT INTO pruefling (pruefungstermin_id, name, betrieb) VALUES (?, ?, ?)')
    .run(req.params.id, name, betrieb || null);
  res.redirect(`/admin/termine/${req.params.id}`);
});

router.get('/admin/termine/:id/fach/neu', requireAdmin, (req, res) => {
  res.render('admin/fach-neu', { title: 'Fach anlegen', user: req.user, terminId: req.params.id });
});

router.post('/admin/termine/:id/fach', requireAdmin, (req, res) => {
  const { name, gewichtung_prozent, ist_sperrfach } = req.body;
  getDb()
    .prepare(
      'INSERT INTO fach (pruefungstermin_id, name, gewichtung_prozent, ist_sperrfach) VALUES (?, ?, ?, ?)'
    )
    .run(req.params.id, name, Number(gewichtung_prozent), ist_sperrfach ? 1 : 0);
  res.redirect(`/admin/termine/${req.params.id}`);
});

router.get('/admin/faecher/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const fach = db.prepare('SELECT * FROM fach WHERE id = ?').get(req.params.id);
  if (!fach) return res.status(404).send('Fach nicht gefunden.');
  const bloecke = db
    .prepare('SELECT * FROM aufgabenblock WHERE fach_id = ? ORDER BY sortierung')
    .all(fach.id);
  for (const block of bloecke) {
    block.unteraufgaben = db
      .prepare('SELECT * FROM unteraufgabe WHERE aufgabenblock_id = ? ORDER BY sortierung')
      .all(block.id);
  }
  res.render('admin/fach', { title: fach.name, user: req.user, fach, bloecke });
});

router.post('/admin/faecher/:id/block', requireAdmin, (req, res) => {
  const { name, ziel_anteil } = req.body;
  getDb()
    .prepare('INSERT INTO aufgabenblock (fach_id, name, ziel_anteil) VALUES (?, ?, ?)')
    .run(req.params.id, name, Number(ziel_anteil));
  res.redirect(`/admin/faecher/${req.params.id}`);
});

router.post('/admin/bloecke/:id/unteraufgabe', requireAdmin, (req, res) => {
  const { code, max_punkte } = req.body;
  const db = getDb();
  const block = db.prepare('SELECT * FROM aufgabenblock WHERE id = ?').get(req.params.id);
  if (!block) return res.status(404).send('Block nicht gefunden.');
  db.prepare(
    'INSERT INTO unteraufgabe (aufgabenblock_id, code, max_punkte) VALUES (?, ?, ?)'
  ).run(req.params.id, code, Number(max_punkte));
  res.redirect(`/admin/faecher/${block.fach_id}`);
});

router.get('/admin/termine/:id/kriterien', requireAdmin, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE id = ?').get(req.params.id);
  if (!termin) return res.status(404).send('Prüfungstermin nicht gefunden.');
  const kriterien = db
    .prepare('SELECT * FROM projekt_kriterium WHERE pruefungstermin_id = ? ORDER BY sortierung')
    .all(termin.id);
  res.render('admin/kriterien', { title: 'Bewertungskriterien', user: req.user, termin, kriterien });
});

router.post('/admin/termine/:id/kriterien', requireAdmin, (req, res) => {
  const { name, faktor } = req.body;
  getDb()
    .prepare('INSERT INTO projekt_kriterium (pruefungstermin_id, name, faktor) VALUES (?, ?, ?)')
    .run(req.params.id, name, Number(faktor));
  res.redirect(`/admin/termine/${req.params.id}/kriterien`);
});

module.exports = router;
