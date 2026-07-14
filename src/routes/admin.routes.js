const express = require('express');
const { getDb } = require('../db');
const { requireAdmin } = require('../middleware');
const { ART_LABEL, nameVorschlaege } = require('../lib/pruefung');
const { slugify, eindeutigerSlug } = require('../lib/slug');
const { ladeTerminErgebnisse } = require('../lib/termin-ergebnisse');
const { TEILGEBIETE, BESTEHENSGRENZE } = require('../lib/schriftlich-struktur');
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

// Hat ein Prüfling bereits Bewertungen (schriftlich, Fachgespräch oder MEp)?
function hatErgebnisse(db, prueflingId) {
  const sp = db.prepare('SELECT 1 FROM schriftlich_punkt WHERE pruefling_id = ? LIMIT 1').get(prueflingId);
  if (sp) return true;
  const fg = db.prepare('SELECT 1 FROM fachgespraech_bewertung WHERE pruefling_id = ? LIMIT 1').get(prueflingId);
  if (fg) return true;
  const mep = db.prepare('SELECT 1 FROM mep_bewertung WHERE pruefling_id = ? LIMIT 1').get(prueflingId);
  return Boolean(mep);
}

router.get('/admin/termine/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE id = ?').get(req.params.id);
  if (!termin) return res.status(404).send('Prüfungstermin nicht gefunden.');
  const pruefliche = db
    .prepare('SELECT * FROM pruefling WHERE pruefungstermin_id = ? ORDER BY name')
    .all(termin.id)
    .map((p) => ({ ...p, hatErgebnisse: hatErgebnisse(db, p.id) }));
  res.render('admin/termin', { title: termin.name, user: req.user, termin, pruefliche });
});

router.post('/admin/termine/:id/pruefling', requireAdmin, (req, res) => {
  const { name, betrieb } = req.body;
  getDb()
    .prepare('INSERT INTO pruefling (pruefungstermin_id, name, betrieb) VALUES (?, ?, ?)')
    .run(req.params.id, name, betrieb || null);
  res.redirect(`/admin/termine/${req.params.id}`);
});

// Prüfling löschen – nur, solange er keine Bewertungen hat (verhindert
// versehentlichen Verlust erfasster Ergebnisse).
router.post('/admin/termine/:id/pruefling/:prueflingId/loeschen', requireAdmin, (req, res) => {
  const db = getDb();
  const pruefling = db
    .prepare('SELECT id FROM pruefling WHERE id = ? AND pruefungstermin_id = ?')
    .get(req.params.prueflingId, req.params.id);
  if (!pruefling) return res.status(404).send('Prüfling nicht gefunden.');
  if (hatErgebnisse(db, pruefling.id)) {
    return res.status(409).send('Prüfling hat bereits Bewertungen und kann nicht gelöscht werden.');
  }
  db.prepare('DELETE FROM pruefling WHERE id = ?').run(pruefling.id);
  res.redirect(`/admin/termine/${req.params.id}`);
});

// --- Wiederholer importieren ---

// Bestimmt je Prüfling die offenen (zu wiederholenden) und übernommenen Teile.
// Teile: die 4 schriftlichen Bereiche + Fachgespräch, jeweils bestanden ab 50.
// Rückgabe: { pruefling, insgesamtBestanden, offen:[label], uebernommen:[label] }.
function teileStatus(zeile) {
  const offen = [];
  const uebernommen = [];
  for (const t of TEILGEBIETE) {
    const b = zeile.schriftlich.bereiche[t.key];
    // Maßgeblich: nach MEp, falls für genau diesen Bereich wirksam.
    let bestanden = b.bestanden;
    if (zeile.mep && zeile.mep.teilgebiet === t.key) bestanden = zeile.mep.bereichNachMep >= BESTEHENSGRENZE;
    (bestanden ? uebernommen : offen).push(t.name);
  }
  const fg = zeile.bereiche.fachgespraech;
  if (fg !== null && fg >= BESTEHENSGRENZE) uebernommen.push('Fachgespräch');
  else offen.push('Fachgespräch');

  const insgesamtBestanden =
    (zeile.mep ? zeile.mep.bestanden : zeile.schriftlich.bestanden) &&
    fg !== null && fg >= BESTEHENSGRENZE;
  return { insgesamtBestanden, offen, uebernommen };
}

router.get('/admin/termine/:id/import', requireAdmin, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE id = ?').get(req.params.id);
  if (!termin) return res.status(404).send('Prüfungstermin nicht gefunden.');

  // Andere Abschluss-Termine als mögliche Vortermine.
  const vortermine = db
    .prepare("SELECT * FROM pruefungstermin WHERE id != ? AND art = 'abschluss' ORDER BY id DESC")
    .all(termin.id);

  const quelleId = Number(req.query.von) || (vortermine[0] && vortermine[0].id);
  const quelle = vortermine.find((t) => t.id === quelleId) || null;

  // Nicht bestandene Prüflinge des gewählten Vortermins (wiederholungsberechtigt).
  // Bereits importierte (wiederholt_von zeigt auf einen Prüfling des Vortermins)
  // werden ausgeblendet.
  let kandidaten = [];
  if (quelle) {
    const bereitsImportiert = new Set(
      db
        .prepare('SELECT wiederholt_von FROM pruefling WHERE pruefungstermin_id = ? AND wiederholt_von IS NOT NULL')
        .all(termin.id)
        .map((r) => r.wiederholt_von)
    );
    kandidaten = ladeTerminErgebnisse(db, quelle.id)
      .map((z) => ({ pruefling: z.pruefling, ...teileStatus(z) }))
      .filter((k) => !k.insgesamtBestanden && !bereitsImportiert.has(k.pruefling.id));
  }

  res.render('admin/import', {
    title: 'Wiederholer importieren',
    user: req.user,
    termin,
    vortermine,
    quelle,
    kandidaten,
  });
});

router.post('/admin/termine/:id/import', requireAdmin, (req, res) => {
  const db = getDb();
  const termin = db.prepare('SELECT * FROM pruefungstermin WHERE id = ?').get(req.params.id);
  if (!termin) return res.status(404).send('Prüfungstermin nicht gefunden.');

  // Angehakte Ursprungs-Prüflinge (Checkbox-Namen "pruefling_<id>").
  const ids = Object.keys(req.body)
    .filter((k) => k.startsWith('pruefling_'))
    .map((k) => Number(k.slice('pruefling_'.length)))
    .filter((n) => Number.isFinite(n));

  const insert = db.prepare(
    'INSERT INTO pruefling (pruefungstermin_id, name, betrieb, wiederholt_von) VALUES (?, ?, ?, ?)'
  );
  const tx = db.transaction((quellIds) => {
    for (const qid of quellIds) {
      const q = db.prepare('SELECT name, betrieb FROM pruefling WHERE id = ?').get(qid);
      if (!q) continue;
      // Doppel-Import vermeiden.
      const schonDa = db
        .prepare('SELECT 1 FROM pruefling WHERE pruefungstermin_id = ? AND wiederholt_von = ?')
        .get(termin.id, qid);
      if (schonDa) continue;
      insert.run(termin.id, q.name, q.betrieb || null, qid);
    }
  });
  tx(ids);
  res.redirect(`/admin/termine/${termin.id}`);
});

module.exports = router;
