const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { slugify, eindeutigerSlug } = require('./lib/slug');

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;
  const dbPath = process.env.DB_PATH || './data/pruefung.sqlite';
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  dbInstance.exec(schema);
  migriere(dbInstance);
  return dbInstance;
}

// Ergänzt Spalten, die per CREATE TABLE IF NOT EXISTS nicht mehr an bestehende
// Tabellen kommen, und füllt sie für Alt-Zeilen. Idempotent.
function migriere(db) {
  const spalten = db.prepare('PRAGMA table_info(pruefungstermin)').all().map((c) => c.name);
  if (!spalten.includes('art')) {
    db.exec("ALTER TABLE pruefungstermin ADD COLUMN art TEXT NOT NULL DEFAULT 'abschluss'");
  }
  if (!spalten.includes('slug')) {
    db.exec('ALTER TABLE pruefungstermin ADD COLUMN slug TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_pruefungstermin_slug ON pruefungstermin(slug)');
  }
  // Slugs für Zeilen ohne Slug nachtragen.
  const ohneSlug = db.prepare('SELECT id, name FROM pruefungstermin WHERE slug IS NULL OR slug = ?').all('');
  if (ohneSlug.length) {
    const vergebene = new Set(
      db.prepare('SELECT slug FROM pruefungstermin WHERE slug IS NOT NULL AND slug != ?').all('').map((r) => r.slug)
    );
    const setzeSlug = db.prepare('UPDATE pruefungstermin SET slug = ? WHERE id = ?');
    for (const t of ohneSlug) {
      const slug = eindeutigerSlug(slugify(t.name), vergebene);
      vergebene.add(slug);
      setzeSlug.run(slug, t.id);
    }
  }

  // Sichtbarkeits-Schalter für fremde Einzelbewertungen.
  if (!spalten.includes('einsicht_fremd')) {
    db.exec('ALTER TABLE pruefungstermin ADD COLUMN einsicht_fremd INTEGER NOT NULL DEFAULT 0');
  }

  // Finalisierungs-Flag je Prüfling.
  const prSpalten = db.prepare('PRAGMA table_info(pruefling)').all().map((c) => c.name);
  if (!prSpalten.includes('schriftlich_finalisiert')) {
    db.exec('ALTER TABLE pruefling ADD COLUMN schriftlich_finalisiert INTEGER NOT NULL DEFAULT 0');
  }

  // schriftlich_punkt prüfer-getrennt machen: alte Zeilen (gemeinsamer Bogen)
  // werden zum finalen Bogen (pruefer_id = NULL). Nur nötig, solange die
  // pruefer_id-Spalte fehlt.
  const spSpalten = db.prepare('PRAGMA table_info(schriftlich_punkt)').all().map((c) => c.name);
  if (spSpalten.length && !spSpalten.includes('pruefer_id')) {
    db.exec(`
      CREATE TABLE schriftlich_punkt_neu (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
        pruefer_id INTEGER REFERENCES user(id) ON DELETE CASCADE,
        teilgebiet TEXT NOT NULL,
        feld TEXT NOT NULL,
        punkte REAL,
        gestrichen INTEGER NOT NULL DEFAULT 0,
        UNIQUE(pruefling_id, pruefer_id, teilgebiet, feld)
      );
      INSERT INTO schriftlich_punkt_neu (id, pruefling_id, pruefer_id, teilgebiet, feld, punkte, gestrichen)
        SELECT id, pruefling_id, NULL, teilgebiet, feld, punkte, gestrichen FROM schriftlich_punkt;
      DROP TABLE schriftlich_punkt;
      ALTER TABLE schriftlich_punkt_neu RENAME TO schriftlich_punkt;
    `);
  }

  // Partieller Unique-Index für den finalen Bogen: garantiert genau eine
  // finale Zeile je (Prüfling, Teilgebiet, Feld) trotz NULL-Semantik von UNIQUE,
  // und macht ON CONFLICT beim finalen Upsert nutzbar.
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schriftlich_final
           ON schriftlich_punkt(pruefling_id, teilgebiet, feld)
           WHERE pruefer_id IS NULL`);
  // Analog für Einzelbögen (pruefer_id gesetzt).
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_schriftlich_pruefer
           ON schriftlich_punkt(pruefling_id, pruefer_id, teilgebiet, feld)
           WHERE pruefer_id IS NOT NULL`);
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, closeDb };
