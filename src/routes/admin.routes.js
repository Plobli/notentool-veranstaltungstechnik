const express = require('express');
const { getDb } = require('../db');
const { hashPassword } = require('../auth');
const { requireAdmin } = require('../middleware');

const router = express.Router();

router.get('/admin', requireAdmin, (req, res) => {
  const db = getDb();
  const termine = db.prepare('SELECT * FROM pruefungstermin ORDER BY id DESC').all();
  const pruefer = db.prepare("SELECT * FROM user ORDER BY name").all();
  res.render('admin/index', { title: 'Verwaltung', user: req.user, termine, pruefer });
});

router.post('/admin/pruefungstermine', requireAdmin, (req, res) => {
  const { name } = req.body;
  getDb()
    .prepare('INSERT INTO pruefungstermin (name, ist_aktiv) VALUES (?, 1)')
    .run(name);
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

module.exports = router;
