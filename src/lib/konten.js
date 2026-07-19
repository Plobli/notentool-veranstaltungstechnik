// src/lib/konten.js
//
// Logik rund um Einladungen (Selbstregistrierung) und Passwort-Reset ohne
// E-Mail. Codes/Tokens werden im Klartext nur einmal beim Erzeugen
// zurückgegeben (für den Link) und in der DB ausschließlich als Hash abgelegt.

const { erzeugeToken, hashToken } = require('../auth');

// Gültigkeitsdauern.
const EINLADUNG_TAGE = 7;
const RESET_STUNDEN = 24;

function inTagen(tage) {
  return new Date(Date.now() + tage * 24 * 60 * 60 * 1000).toISOString();
}
function inStunden(stunden) {
  return new Date(Date.now() + stunden * 60 * 60 * 1000).toISOString();
}

// --- Einladungen ---

// Erzeugt eine Einladung für eine Rolle, gültig für `maxNutzungen`
// Registrierungen (Standard 1). Für eine Gruppen-Einladung (z.B. WhatsApp)
// kann der Admin ein höheres Limit setzen. Rückgabe: der Klartext-Code (nur
// hier verfügbar) – daraus baut die Route den Registrierungslink.
function erstelleEinladung(db, { role, erstelltVon, maxNutzungen }) {
  const rolle = role === 'admin' ? 'admin' : 'pruefer';
  const limit = Math.max(1, Number(maxNutzungen) || 1);
  const code = erzeugeToken();
  db.prepare(
    `INSERT INTO einladung (code_hash, role, erstellt_von, ablauf_am, max_nutzungen)
     VALUES (?, ?, ?, ?, ?)`
  ).run(hashToken(code), rolle, erstelltVon || null, inTagen(EINLADUNG_TAGE), limit);
  return code;
}

// Liefert die gültige (nicht ausgeschöpfte, nicht abgelaufene) Einladung zu
// einem Code oder null.
function findeGueltigeEinladung(db, code) {
  if (!code) return null;
  return (
    db
      .prepare(
        `SELECT * FROM einladung
         WHERE code_hash = ? AND genutzt_anzahl < max_nutzungen AND ablauf_am > datetime('now')`
      )
      .get(hashToken(code)) || null
  );
}

// Zählt eine Nutzung der Einladung. Ist das Limit danach erreicht, wird sie
// zusätzlich als verbraucht markiert (für die Admin-Übersicht).
function verbraucheEinladung(db, id) {
  db.prepare(
    `UPDATE einladung
     SET genutzt_anzahl = genutzt_anzahl + 1,
         verbraucht_am = CASE WHEN genutzt_anzahl + 1 >= max_nutzungen THEN datetime('now') ELSE verbraucht_am END
     WHERE id = ?`
  ).run(id);
}

// Offene Einladungen für die Admin-Übersicht (Klartext-Code steht nicht mehr
// zur Verfügung – nur Rolle/Ablauf/Nutzungsstand).
function offeneEinladungen(db) {
  return db
    .prepare(
      `SELECT e.id, e.role, e.erstellt_am, e.ablauf_am, e.max_nutzungen, e.genutzt_anzahl, u.name AS ersteller
       FROM einladung e LEFT JOIN user u ON u.id = e.erstellt_von
       WHERE e.genutzt_anzahl < e.max_nutzungen AND e.ablauf_am > datetime('now')
       ORDER BY e.erstellt_am DESC`
    )
    .all();
}

function loescheEinladung(db, id) {
  db.prepare('DELETE FROM einladung WHERE id = ?').run(id);
}

// --- Passwort-Reset ---

// Erzeugt einen Reset-Token für einen Nutzer. Etwaige offene Tokens desselben
// Nutzers werden entwertet (nur der neueste gilt). Rückgabe: Klartext-Token.
function erstelleReset(db, userId) {
  db.prepare(
    "UPDATE passwort_reset SET verbraucht_am = datetime('now') WHERE user_id = ? AND verbraucht_am IS NULL"
  ).run(userId);
  const token = erzeugeToken();
  db.prepare(
    `INSERT INTO passwort_reset (token_hash, user_id, ablauf_am)
     VALUES (?, ?, ?)`
  ).run(hashToken(token), userId, inStunden(RESET_STUNDEN));
  return token;
}

// Liefert den gültigen Reset-Datensatz (inkl. user) zu einem Token oder null.
function findeGueltigenReset(db, token) {
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT r.*, u.email, u.name FROM passwort_reset r
         JOIN user u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.verbraucht_am IS NULL AND r.ablauf_am > datetime('now')`
      )
      .get(hashToken(token)) || null
  );
}

function verbraucheReset(db, id) {
  db.prepare("UPDATE passwort_reset SET verbraucht_am = datetime('now') WHERE id = ?").run(id);
}

module.exports = {
  EINLADUNG_TAGE,
  RESET_STUNDEN,
  erstelleEinladung,
  findeGueltigeEinladung,
  verbraucheEinladung,
  offeneEinladungen,
  loescheEinladung,
  erstelleReset,
  findeGueltigenReset,
  verbraucheReset,
};
