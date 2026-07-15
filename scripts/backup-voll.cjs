// Erstellt ein konsistentes VOLL-Backup der Datenbank (inkl. user/session) und
// räumt alte Backups nach einer Aufbewahrungsstrategie auf. Gedacht für den
// automatischen täglichen Backup-Service (siehe docker-compose.yml) und für den
// manuellen Aufruf vor einem Update.
//
// Aufruf:  node scripts/backup-voll.cjs
// Umgebung:
//   DB_PATH        Quelle (Default: /app/data/pruefung.sqlite)
//   BACKUP_DIR     Zielordner (Default: /app/data/backups)
//   BACKUP_KEEP    Anzahl aufzubewahrender Backups (Default: 30); ältere werden gelöscht
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const SRC = process.env.DB_PATH || '/app/data/pruefung.sqlite';
const DIR = process.env.BACKUP_DIR || '/app/data/backups';
const KEEP = Math.max(1, Number(process.env.BACKUP_KEEP) || 30);

// Zeitstempel YYYYMMDD_HHMMSS (lokale Serverzeit).
function stempel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

if (!fs.existsSync(SRC)) {
  console.error('Backup abgebrochen: Quelle nicht gefunden: ' + SRC);
  process.exit(1);
}
fs.mkdirSync(DIR, { recursive: true });

const out = path.join(DIR, `pruefung_${stempel()}.sqlite`);

// Konsistente Vollkopie: WAL-Checkpoint + VACUUM INTO liest inkl. WAL-Inhalt.
const src = new Database(SRC, { readonly: false });
src.pragma('wal_checkpoint(TRUNCATE)');
if (fs.existsSync(out)) fs.unlinkSync(out);
src.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
src.close();
console.log('Backup erstellt: ' + out);

// Aufräumen: nur die neuesten KEEP Backups behalten, ältere löschen.
const dateien = fs
  .readdirSync(DIR)
  .filter((f) => /^pruefung_\d{8}_\d{6}\.sqlite$/.test(f))
  .sort(); // Namensschema ist chronologisch sortierbar
const zuViel = dateien.slice(0, Math.max(0, dateien.length - KEEP));
for (const f of zuViel) {
  fs.unlinkSync(path.join(DIR, f));
  console.log('Altes Backup gelöscht: ' + f);
}
console.log(`Aufbewahrung: ${Math.min(dateien.length, KEEP)}/${KEEP} Backups im Ordner.`);
