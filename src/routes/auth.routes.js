const express = require('express');
const { getDb } = require('../db');
const { verifyPassword, createSession, destroySession } = require('../auth');

const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { title: 'Anmelden', user: null, error: null });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const db = getDb();
  const user = db.prepare('SELECT * FROM user WHERE email = ?').get(email);

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.render('login', {
      title: 'Anmelden',
      user: null,
      error: 'E-Mail oder Passwort falsch.',
    });
  }

  const sessionId = createSession(db, user.id);
  res.cookie('session_id', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  if (req.cookies.session_id) {
    destroySession(getDb(), req.cookies.session_id);
  }
  res.clearCookie('session_id');
  res.redirect('/login');
});

module.exports = router;
