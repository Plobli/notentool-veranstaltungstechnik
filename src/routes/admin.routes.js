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
  res.render('admin/termin', { title: termin.name, user: req.user, termin, pruefliche });
});

router.post('/admin/termine/:id/pruefling', requireAdmin, (req, res) => {
  const { name, betrieb } = req.body;
  getDb()
    .prepare('INSERT INTO pruefling (pruefungstermin_id, name, betrieb) VALUES (?, ?, ?)')
    .run(req.params.id, name, betrieb || null);
  res.redirect(`/admin/termine/${req.params.id}`);
});

module.exports = router;
