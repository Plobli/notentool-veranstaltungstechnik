// src/lib/passwort.js
//
// Zentrale Passwort-Richtlinie, angewandt bei Registrierung, Passwort ändern
// und Passwort-Reset. Bewusst schlank: Mindestlänge plus Abgleich gegen
// offensichtlich schwache Passwörter – kein Zwang zu Sonderzeichen o. Ä.

const MIN_LAENGE = 10;

// Kleine Liste offensichtlich trivialer Passwörter (klein geschrieben).
// Der Abgleich ist case-insensitiv und ignoriert umgebende Leerzeichen.
const TRIVIAL = new Set([
  'passwort', 'password', 'geheim', 'geheimnis', '1234567890', '0123456789',
  'qwertzuiop', 'qwertyuiop', 'passwort123', 'password123', 'admin12345',
  'willkommen', 'changeme', 'change-me', 'test1234', 'letmein123',
  'prueferprueferpruefer',
]);

// Prüft ein Passwort gegen die Richtlinie.
// Rückgabe: { ok: true } oder { ok: false, fehler: '<deutscher Text>' }.
function pruefePasswort(pw) {
  const wert = typeof pw === 'string' ? pw : '';
  if (wert.length < MIN_LAENGE) {
    return { ok: false, fehler: `Das Passwort muss mindestens ${MIN_LAENGE} Zeichen lang sein.` };
  }
  if (TRIVIAL.has(wert.trim().toLowerCase())) {
    return { ok: false, fehler: 'Dieses Passwort ist zu einfach zu erraten. Bitte wähle ein anderes.' };
  }
  return { ok: true };
}

module.exports = { pruefePasswort, MIN_LAENGE };
