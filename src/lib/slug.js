// Erzeugt URL-Slugs aus Prüfungsnamen. Deutsche Umlaute werden ausgeschrieben
// (ü->ue, ß->ss), damit die URL ASCII bleibt: 'Winter 2027' -> 'winter-2027'.

const UMLAUTE = {
  ä: 'ae', ö: 'oe', ü: 'ue',
  Ä: 'ae', Ö: 'oe', Ü: 'ue',
  ß: 'ss',
};

function slugify(text) {
  return String(text)
    .replace(/[äöüÄÖÜß]/g, (ch) => UMLAUTE[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-') // alles Nicht-Alphanumerische zu Bindestrichen
    .replace(/^-+|-+$/g, ''); // führende/abschließende Bindestriche weg
}

// Macht einen Slug innerhalb einer Menge bereits vergebener Slugs eindeutig,
// indem bei Kollision -2, -3, … angehängt wird.
function eindeutigerSlug(basis, vergebene) {
  const set = vergebene instanceof Set ? vergebene : new Set(vergebene);
  let kandidat = basis || 'pruefung';
  let n = 2;
  while (set.has(kandidat)) {
    kandidat = `${basis}-${n}`;
    n += 1;
  }
  return kandidat;
}

module.exports = { slugify, eindeutigerSlug };
