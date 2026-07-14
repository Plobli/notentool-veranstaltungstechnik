const crypto = require('node:crypto');

function hashPassword(plain) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(plain, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(plain, hash) {
  return new Promise((resolve, reject) => {
    const [salt, storedHash] = hash.split(':');
    crypto.scrypt(plain, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      const storedBuffer = Buffer.from(storedHash, 'hex');
      const match =
        storedBuffer.length === derivedKey.length &&
        crypto.timingSafeEqual(storedBuffer, derivedKey);
      resolve(match);
    });
  });
}

function createSession(db, userId) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO session (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    sessionId,
    userId,
    expiresAt
  );
  return sessionId;
}

function getSessionUser(db, sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM session s
       JOIN user u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    )
    .get(sessionId);
  return row || null;
}

function destroySession(db, sessionId) {
  db.prepare('DELETE FROM session WHERE id = ?').run(sessionId);
}

// Einmal-Token für Einladungen und Passwort-Reset. Die Tokens sind bereits
// hochentropisch (32 Zufallsbytes), daher genügt zum Speichern ein schneller
// SHA-256-Hash: Klartext liegt nie in der DB, Brute-Force ist chancenlos.
function erzeugeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  destroySession,
  erzeugeToken,
  hashToken,
};
