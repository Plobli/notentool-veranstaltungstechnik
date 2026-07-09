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
const projektRoutes = require('./routes/projekt.routes');
const { requireAuth } = require('./middleware');

function fsExistsEnvFile() {
  return require('node:fs').existsSync('.env');
}

const app = express();

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

app.use((req, res, next) => {
  const db = getDb();
  req.user = getSessionUser(db, req.cookies.session_id);
  res.locals.user = req.user;
  next();
});


app.use('/', authRoutes);

app.use('/', adminRoutes);

app.use('/', schriftlichRoutes);

app.use('/', projektRoutes);

app.get('/', requireAuth, (req, res) => {
  res.render('dashboard', { title: 'Dashboard', user: req.user });
});

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server läuft auf Port ${port}`));
}

module.exports = { app };
