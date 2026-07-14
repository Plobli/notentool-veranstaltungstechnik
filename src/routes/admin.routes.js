const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware');
const { ART_LABEL, nameVorschlaege } = require('../lib/pruefung');
const { slugify, eindeutigerSlug } = require('../lib/slug');
const {
  erstelleEinladung,
  offeneEinladungen,
  loescheEinladung,
  erstelleReset,
} = require('../lib/konten');

const router = express.Router();

// Baut die absolute Basis-URL (Schema + Host) für Einladungs-/Reset-Links,
// damit der Admin einen vollständigen Link kopieren kann.
function basisUrl(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// Rendert das Admin-Dashboard. `link` (optional) ist ein gerade erzeugter
// Einladungs-/Reset-Link, der einmalig angezeigt wird.
function rendereAdmin(req, res, link = null) {
  const db = getDb();
  const termine = db.prepare('SELECT * FROM pruefungstermin ORDER BY id DESC').all();
  const pruefer = db.prepare('SELECT * FROM user ORDER BY name').all();
  res.render('admin/index', {
    title: 'Verwaltung',
    user: req.user,
    termine,
    pruefer,
    einladungen: offeneEinladungen(db),
    link,
    artLabel: ART_LABEL,
    vorschlaege: nameVorschlaege(),
  });
}

router.get('/admin', requireAdmin, (req, res) => rendereAdmin(req, res));

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

// Einladung erzeugen: gibt einen einmaligen Registrierungslink zurück, den der
// Admin dem neuen Prüfer übergibt.
router.post('/admin/einladungen', requireAdmin, (req, res) => {
  const db = getDb();
  const role = req.body.role === 'admin' ? 'admin' : 'pruefer';
  const code = erstelleEinladung(db, { role, erstelltVon: req.user.id });
  const link = `${basisUrl(req)}/registrieren?code=${code}`;
  rendereAdmin(req, res, { art: 'einladung', role, url: link });
});

router.post('/admin/einladungen/:id/loeschen', requireAdmin, (req, res) => {
  loescheEinladung(getDb(), Number(req.params.id));
  res.redirect('/admin');
});

// Passwort-Reset-Link für einen bestehenden Prüfer erzeugen (ohne E-Mail);
// wird dem Nutzer manuell übergeben.
router.post('/admin/pruefer/:id/reset', requireAdmin, (req, res) => {
  const db = getDb();
  const ziel = db.prepare('SELECT id, name FROM user WHERE id = ?').get(req.params.id);
  if (!ziel) return res.status(404).send('Nutzer nicht gefunden.');
  const token = erstelleReset(db, ziel.id);
  const link = `${basisUrl(req)}/passwort-reset?token=${token}`;
  rendereAdmin(req, res, { art: 'reset', name: ziel.name, url: link });
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
