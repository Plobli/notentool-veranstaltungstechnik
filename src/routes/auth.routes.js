const express = require('express');
const { getDb } = require('../db');
const {
  verifyPassword,
  hashPassword,
  createSession,
  destroySession,
} = require('../auth');
const { requireAuth } = require('../middleware');
const { pruefePasswort } = require('../lib/passwort');
const {
  findeGueltigeEinladung,
  verbraucheEinladung,
  findeGueltigenReset,
  verbraucheReset,
} = require('../lib/konten');

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
    secure: req.secure,
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

// --- Selbstregistrierung per Einladungscode ---

router.get('/registrieren', (req, res) => {
  const db = getDb();
  const code = req.query.code || '';
  const einladung = findeGueltigeEinladung(db, code);
  res.render('registrieren', {
    title: 'Registrieren',
    user: null,
    code,
    gueltig: Boolean(einladung),
    rolle: einladung ? einladung.role : null,
    error: null,
    werte: { name: '', email: '' },
  });
});

router.post('/registrieren', async (req, res) => {
  const db = getDb();
  const { code, name, email, password } = req.body;
  const einladung = findeGueltigeEinladung(db, code);

  const zeigeFehler = (fehler) =>
    res.render('registrieren', {
      title: 'Registrieren',
      user: null,
      code: code || '',
      gueltig: Boolean(einladung),
      rolle: einladung ? einladung.role : null,
      error: fehler,
      werte: { name: name || '', email: email || '' },
    });

  if (!einladung) {
    return zeigeFehler('Dieser Einladungslink ist ungültig oder abgelaufen.');
  }
  if (!name || !email) {
    return zeigeFehler('Bitte Name und E-Mail angeben.');
  }
  const pwCheck = pruefePasswort(password);
  if (!pwCheck.ok) return zeigeFehler(pwCheck.fehler);

  const hash = await hashPassword(password);
  try {
    const tx = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(name, email, hash, einladung.role);
      verbraucheEinladung(db, einladung.id);
      return info.lastInsertRowid;
    });
    const userId = tx();
    const sessionId = createSession(db, userId);
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: req.secure,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    res.redirect('/');
  } catch (err) {
    zeigeFehler('E-Mail bereits vergeben oder Eingabe ungültig.');
  }
});

// --- Eigenes Passwort ändern ---

router.get('/passwort', requireAuth, (req, res) => {
  res.render('passwort', { title: 'Passwort ändern', user: req.user, error: null, erfolg: false });
});

router.post('/passwort', requireAuth, async (req, res) => {
  const db = getDb();
  const { aktuell, neu, neu2 } = req.body;

  const zeigeFehler = (fehler) =>
    res.render('passwort', { title: 'Passwort ändern', user: req.user, error: fehler, erfolg: false });

  const frisch = db.prepare('SELECT password_hash FROM user WHERE id = ?').get(req.user.id);
  if (!frisch || !(await verifyPassword(aktuell, frisch.password_hash))) {
    return zeigeFehler('Das aktuelle Passwort ist falsch.');
  }
  if (neu !== neu2) {
    return zeigeFehler('Die neuen Passwörter stimmen nicht überein.');
  }
  const pwCheck = pruefePasswort(neu);
  if (!pwCheck.ok) return zeigeFehler(pwCheck.fehler);

  const hash = await hashPassword(neu);
  db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.render('passwort', { title: 'Passwort ändern', user: req.user, error: null, erfolg: true });
});

// --- Passwort-Reset per Einmal-Link (ohne E-Mail) ---

router.get('/passwort-reset', (req, res) => {
  const db = getDb();
  const token = req.query.token || '';
  const reset = findeGueltigenReset(db, token);
  res.render('passwort-reset', {
    title: 'Passwort zurücksetzen',
    user: null,
    token,
    gueltig: Boolean(reset),
    name: reset ? reset.name : null,
    error: null,
  });
});

router.post('/passwort-reset', async (req, res) => {
  const db = getDb();
  const { token, neu, neu2 } = req.body;
  const reset = findeGueltigenReset(db, token);

  const zeigeFehler = (fehler) =>
    res.render('passwort-reset', {
      title: 'Passwort zurücksetzen',
      user: null,
      token: token || '',
      gueltig: Boolean(reset),
      name: reset ? reset.name : null,
      error: fehler,
    });

  if (!reset) {
    return zeigeFehler('Dieser Reset-Link ist ungültig oder abgelaufen.');
  }
  if (neu !== neu2) {
    return zeigeFehler('Die Passwörter stimmen nicht überein.');
  }
  const pwCheck = pruefePasswort(neu);
  if (!pwCheck.ok) return zeigeFehler(pwCheck.fehler);

  const hash = await hashPassword(neu);
  db.transaction(() => {
    db.prepare('UPDATE user SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
    verbraucheReset(db, reset.id);
    // Alle bestehenden Sitzungen des Nutzers beenden (Sicherheit).
    db.prepare('DELETE FROM session WHERE user_id = ?').run(reset.user_id);
  })();

  res.render('login', {
    title: 'Anmelden',
    user: null,
    error: null,
    hinweis: 'Passwort gesetzt. Bitte melde dich mit dem neuen Passwort an.',
  });
});

module.exports = router;
