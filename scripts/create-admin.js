// scripts/create-admin.js
const { getDb } = require('../src/db');
const { hashPassword } = require('../src/auth');

async function main() {
  const [, , name, email, password] = process.argv;
  if (!name || !email || !password) {
    console.error('Nutzung: node --env-file=.env scripts/create-admin.js "Name" email@example.com passwort');
    process.exit(1);
  }
  const db = getDb();
  const hash = await hashPassword(password);
  db.prepare(
    'INSERT INTO user (name, email, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(name, email, hash, 'admin');
  console.log(`Admin-Nutzer ${email} angelegt.`);
}

main();
