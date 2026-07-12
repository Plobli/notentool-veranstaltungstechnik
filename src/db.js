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
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

module.exports = { getDb, closeDb };
