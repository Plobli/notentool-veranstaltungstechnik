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

-- Einladung zur Selbstregistrierung. Der Admin erzeugt einen Code; der neue
-- Prüfer registriert sich damit über /registrieren. Nur der Hash des Codes
-- wird gespeichert (wie ein Passwort), Klartext existiert nur im Link.
-- Rolle kommt aus der Einladung (nicht vom Registrierenden wählbar).
-- Einmalgebrauch: verbraucht_am wird beim Anlegen des Kontos gesetzt.
CREATE TABLE IF NOT EXISTS einladung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin','pruefer')),
  erstellt_von INTEGER REFERENCES user(id) ON DELETE SET NULL,
  erstellt_am TEXT NOT NULL DEFAULT (datetime('now')),
  ablauf_am TEXT NOT NULL,
  verbraucht_am TEXT
);

-- Passwort-Reset ohne E-Mail: Der Admin erzeugt einen einmaligen Token, der
-- dem Nutzer manuell übergeben wird. Nur der Hash wird gespeichert.
-- Einmalgebrauch + zeitlicher Ablauf.
CREATE TABLE IF NOT EXISTS passwort_reset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  erstellt_am TEXT NOT NULL DEFAULT (datetime('now')),
  ablauf_am TEXT NOT NULL,
  verbraucht_am TEXT
);

CREATE TABLE IF NOT EXISTS pruefungstermin (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  art TEXT NOT NULL DEFAULT 'abschluss' CHECK (art IN ('abschluss','zwischen')),
  slug TEXT UNIQUE,
  ist_aktiv INTEGER NOT NULL DEFAULT 1,
  -- Dürfen Prüfer bei der schriftlichen Einzelkorrektur die Bewertungen der
  -- anderen einsehen? 0 = nein (nur eigener Bogen), 1 = ja (read-only sichtbar).
  einsicht_fremd INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pruefling (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  betrieb TEXT,
  -- Schriftliche Prüfung finalisiert? Dann sind die Einzelbögen gesperrt und
  -- nur noch der finale Bogen (schriftlich_punkt.pruefer_id IS NULL) zählt.
  schriftlich_finalisiert INTEGER NOT NULL DEFAULT 0
);

-- Schriftliche Prüfung als feste Tabelle (Auswertungsbogen).
-- Struktur (Teilgebiete/Felder/Faktoren) ist im Code verankert
-- (src/lib/schriftlich-struktur.js); hier werden nur die Rohpunkte je Prüfling
-- gespeichert.
--
-- Prüfer-getrennt: jeder Prüfer hat seinen eigenen Satz Punkte (pruefer_id).
-- pruefer_id IS NULL kennzeichnet den FINALEN Bogen – das maßgebliche Ergebnis,
-- das beim gemeinsamen Besprechungstermin festgelegt wird und in Dashboard/§20
-- einfließt.
CREATE TABLE IF NOT EXISTS schriftlich_punkt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  pruefer_id INTEGER REFERENCES user(id) ON DELETE CASCADE,  -- NULL = finaler Bogen
  teilgebiet TEXT NOT NULL,        -- 'wiso' | 'planung' | 'durchfuehrung' | 'energie'
  feld TEXT NOT NULL,              -- 'gebunden' | 'u1' … 'u11'
  punkte REAL,                     -- Rohpunkte; NULL = noch nicht eingetragen
  gestrichen INTEGER NOT NULL DEFAULT 0,  -- nur WISO: markiert die gestrichene Aufgabe
  UNIQUE(pruefling_id, pruefer_id, teilgebiet, feld)
);

CREATE TABLE IF NOT EXISTS schriftlich_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefungstermin_id INTEGER NOT NULL REFERENCES pruefungstermin(id) ON DELETE CASCADE,
  teilgebiet TEXT NOT NULL,          -- 'planung' | 'durchfuehrung' | 'energie'
  anzahl_fragen INTEGER NOT NULL,
  UNIQUE(pruefungstermin_id, teilgebiet)
);

-- Fachgespräch-Bewertung. Kriterien sind fest im Code
-- (src/lib/fachgespraech-struktur.js); hier werden je Prüfling und Kriterium
-- der Protokolltext und die Punkte gespeichert.
CREATE TABLE IF NOT EXISTS fachgespraech_bewertung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  kriterium_key TEXT NOT NULL,       -- 'anforderungen' | 'planung' | 'energie' | 'ablaeufe' | 'unterlagen'
  protokoll TEXT,
  punkte REAL,                       -- 0–100; NULL = noch nicht bewertet
  UNIQUE(pruefling_id, kriterium_key)
);

-- Mündliche Ergänzungsprüfung (§20 Abs. 3 VfAusbV). Auf Antrag des Prüflings
-- kann GENAU EIN schriftlicher Prüfungsbereich (< ausreichend), in dem die MEP
-- den Ausschlag geben kann, mündlich ergänzt werden. Bewertet wird – wie beim
-- Fachgespräch – über eine Liste von Protokoll-Zeilen (JSON in `protokoll`);
-- die mündlichen Punkte (0–100) gehen mit dem schriftlichen Ergebnis dieses
-- Bereichs im Verhältnis 2:1 in einen neuen Bereichswert ein.
--
-- `teilgebiet` ist einer der vier schriftlichen Bereiche
-- ('wiso' | 'planung' | 'durchfuehrung' | 'energie'). UNIQUE(pruefling_id)
-- erzwingt technisch, dass pro Prüfling höchstens eine MEP existiert.
CREATE TABLE IF NOT EXISTS mep_bewertung (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pruefling_id INTEGER NOT NULL REFERENCES pruefling(id) ON DELETE CASCADE,
  teilgebiet TEXT NOT NULL,
  protokoll TEXT,
  UNIQUE(pruefling_id)
);
