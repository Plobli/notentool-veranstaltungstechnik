CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','pruefer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pruefungstermin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ist_aktiv INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS pruefling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  betrieb TEXT
);

CREATE TABLE IF NOT EXISTS fach (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  gewichtung_prozent REAL NOT NULL,
  ist_sperrfach INTEGER NOT NULL DEFAULT 0,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS aufgabenblock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fach_id INTEGER NOT NULL REFERENCES fach(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  ziel_anteil REAL NOT NULL,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS unteraufgabe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aufgabenblock_id INTEGER NOT NULL REFERENCES aufgabenblock(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  max_punkte REAL NOT NULL,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS korrektureintrag (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  fach_id INTEGER NOT NULL REFERENCES fach(id) ON DELETE CASCADE,
  pruefer_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'entwurf' CHECK (status IN ('entwurf','abgeschlossen')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pruefling_id, fach_id, pruefer_id)
);

CREATE TABLE IF NOT EXISTS korrekturpunkt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  korrektureintrag_id INTEGER NOT NULL REFERENCES korrektureintrag(id) ON DELETE CASCADE,
  unteraufgabe_id INTEGER NOT NULL REFERENCES unteraufgabe(id) ON DELETE CASCADE,
  punkte REAL,
  entfaellt INTEGER NOT NULL DEFAULT 0,
  UNIQUE(korrektureintrag_id, unteraufgabe_id)
);

CREATE TABLE IF NOT EXISTS projekt_kriterium (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  faktor REAL NOT NULL,
  sortierung INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projekt_bewertung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  projekt_kriterium_id INTEGER NOT NULL REFERENCES projekt_kriterium(id) ON DELETE CASCADE,
  protokoll TEXT,
  punkte REAL,
  final INTEGER NOT NULL DEFAULT 0,
  UNIQUE(pruefling_id, projekt_kriterium_id)
);

-- Schriftliche Prüfung als feste Tabelle (Auswertungsbogen).
-- Struktur (Teilgebiete/Felder/Faktoren) ist im Code verankert
-- (src/lib/schriftlich-struktur.js); hier werden nur die Rohpunkte je Prüfling
-- gespeichert. Ein gemeinsamer Bogen pro Jahrgang, kein Prüfer-getrennter Status.
CREATE TABLE IF NOT EXISTS schriftlich_punkt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  teilgebiet TEXT NOT NULL,        -- 'wiso' | 'planung' | 'durchfuehrung' | 'energie'
  feld TEXT NOT NULL,              -- 'gebunden' | 'u1' … 'u11'
  punkte REAL,                     -- Rohpunkte; NULL = noch nicht eingetragen
  gestrichen INTEGER NOT NULL DEFAULT 0,  -- nur WISO: markiert die gestrichene Aufgabe
  UNIQUE(pruefling_id, teilgebiet, feld)
);

CREATE TABLE IF NOT EXISTS schriftlich_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  teilgebiet TEXT NOT NULL,          -- 'planung' | 'durchfuehrung' | 'energie'
  anzahl_fragen INTEGER NOT NULL,
  UNIQUE(pruefungstermin_id, teilgebiet)
);

CREATE TABLE IF NOT EXISTS mep_ergebnis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  fach_id INTEGER NOT NULL REFERENCES fach(id) ON DELETE CASCADE,
  punkte REAL NOT NULL,
  UNIQUE(pruefling_id, fach_id)
);
