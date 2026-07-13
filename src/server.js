if (fsExistsEnvFile()) {
  // Node >=20 lädt .env selbst über --env-file beim Start (siehe package.json/README)
}

const express = require('express');
const path = require('node:path');
const { getDb } = require('./db');
const { getSessionUser } = require('./auth');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const pruefungRoutes = require('./routes/pruefung.routes');
const schriftlichbogenRoutes = require('./routes/schriftlichbogen.routes');
const fachgespraechRoutes = require('./routes/fachgespraech.routes');
const mepRoutes = require('./routes/mep.routes');
const { requireAuth } = require('./middleware');
const { ART_LABEL } = require('./lib/pruefung');

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

app.use('/', pruefungRoutes);

app.use('/', schriftlichbogenRoutes);

app.use('/', fachgespraechRoutes);

app.use('/', mepRoutes);

app.get('/', requireAuth, (req, res) => {
  const db = getDb();

  // Alle aktiven Termine, neueste zuerst.
  const aktive = db
    .prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 1 ORDER BY id DESC')
    .all();

  // Vergangene (inaktive) Termine, neueste zuerst.
  const vergangene = db
    .prepare('SELECT * FROM pruefungstermin WHERE ist_aktiv = 0 ORDER BY id DESC')
    .all();

  res.render('dashboard', {
    title: 'Dashboard',
    user: req.user,
    aktive,
    vergangene,
    artLabel: ART_LABEL,
  });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server läuft auf Port ${port}`));
}

module.exports = { app };
