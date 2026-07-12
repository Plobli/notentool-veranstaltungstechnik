if (fsExistsEnvFile()) {
  // Node >=20 lädt .env selbst über --env-file beim Start (siehe package.json/README)
}

const express = require('express');
const path = require('node:path');
const { getDb } = require('./db');
const { getSessionUser } = require('./auth');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const schriftlichRoutes = require('./routes/schriftlich.routes');
const schriftlichbogenRoutes = require('./routes/schriftlichbogen.routes');
const fachgespraechRoutes = require('./routes/fachgespraech.routes');
const projektRoutes = require('./routes/projekt.routes');
const ergebnisRoutes = require('./routes/ergebnis.routes');
const { requireAuth } = require('./middleware');

function fsExistsEnvFile() {
  return require('node:fs').existsSync('.env');
}

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function parseCookies(req, res, next) {
  const header = req.headers.cookie || '';
  req.cookies = Object.fromEntries(
    header.split(';').filter(Boolean).map((pair) => {
      const [key, ...rest] = pair.trim().split('=');
      return [key, decodeURIComponent(rest.join('='))];
    })
  );
  res.cookie = (name, value, opts = {}) => {
    const parts = [`${name}=${encodeURIComponent(value)}`];
    if (opts.maxAge) parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
    parts.push('Path=/');
    if (opts.httpOnly) parts.push('HttpOnly');
    if (opts.secure) parts.push('Secure');
    parts.push('SameSite=Lax');
    res.append('Set-Cookie', parts.join('; '));
  };
  res.clearCookie = (name) => {
    res.append('Set-Cookie', `${name}=; Path=/; Max-Age=0`);
  };
  next();
}

app.use(parseCookies);

// Bettet jede gerenderte View in das gemeinsame Layout (layout.ejs) ein.
// Views bleiben reine Inhalts-Fragmente; hier wird das HTML-Gerüst inkl. CSS
// darum gelegt. 'layout' selbst wird unverändert durchgereicht.
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = (view, options = {}, callback) => {
    if (view === 'layout') return originalRender(view, options, callback);
    originalRender(view, options, (err, html) => {
      if (err) return next(err);
      originalRender('layout', { ...options, body: html }, callback);
    });
  };
  next();
});

app.use((req, res, next) => {
  const db = getDb();
  req.user = getSessionUser(db, req.cookies.session_id);
  res.locals.user = req.user;
  next();
});


app.use('/', authRoutes);

app.use('/', adminRoutes);

app.use('/', schriftlichbogenRoutes);

app.use('/', fachgespraechRoutes);

app.use('/', schriftlichRoutes);

app.use('/', projektRoutes);

app.use('/', ergebnisRoutes);

app.get('/', requireAuth, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 1 ORDER BY id DESC LIMIT 1').get();

  if (!termin) {
    return res.render('dashboard', { title: 'Dashboard', user: req.user, termin: null, pruefliche: [] });
  }

  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id);
  const faecher = db
    .prepare('SELECT * FROM fach WHERE pruefungstermin_id = ? ORDER BY sortierung')
    .all(termin.id);

  const status = pruefliche.map((p) => {
    const abgeschlosseneFaecher = faecher.filter((f) => {
      const eintrag = db
        .prepare(
          "SELECT 1 FROM korrektureintrag WHERE pruefling_id = ? AND fach_id = ? AND pruefer_id = ? AND status = 'abgeschlossen'"
        )
        .get(p.id, f.id, req.user.id);
      return Boolean(eintrag);
    });
    return {
      pruefling: p,
      abgeschlossen: abgeschlosseneFaecher.length,
      gesamt: faecher.length,
    };
  });

  res.render('dashboard', { title: 'Dashboard', user: req.user, termin, pruefliche: status, faecher });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server läuft auf Port ${port}`));
}

module.exports = { app };
