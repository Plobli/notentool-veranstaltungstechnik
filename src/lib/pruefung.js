// Zentrale Definitionen rund um Prüfungstyp und Bereiche.
//
// Jede Prüfung hat eine `art` (abschluss | zwischen). Die Art bestimmt, welche
// Bewertungsbereiche angeboten werden. Slugs der Bereiche sind Teil der URL:
//   /pruefung/<slug>/<bereich-slug>

// Bereiche je Prüfungstyp, in Anzeigereihenfolge.
// `fertig: false` markiert Bereiche, die aktuell nur strukturell vorbereitet
// sind (Platzhalterseite) und noch keine Bewertung haben.
// `pfad` überschreibt den Standard-URL-Pfad `<slug>` (z. B. Unterseiten).
// `unterpunkt: true` kennzeichnet abhängige Schritte (z. B. Finalisierung),
// die optisch enger an den vorherigen Bereich gehängt werden.
const BEREICHE = {
  abschluss: [
    { slug: 'schriftlich', name: 'Schriftliche Prüfung', fertig: true },
    { slug: 'schriftlich-final', name: 'Schriftlich: Finalisierung',
      pfad: 'schriftlich/final', hinweis: 'Einzelbewertungen zusammenführen',
      fertig: true, unterpunkt: true },
    { slug: 'fachgespraech', name: 'Fachgespräch', fertig: true },
    { slug: 'mep', name: 'Mündliche Ergänzungsprüfung', fertig: false },
  ],
  zwischen: [
    { slug: 'schriftlich', name: 'Schriftliche Prüfung', fertig: false },
    { slug: 'muendlich', name: 'Mündliche Prüfung', fertig: false },
  ],
};

const ART_LABEL = {
  abschluss: 'Abschlussprüfung',
  zwischen: 'Zwischenprüfung',
};

function bereicheFuer(art) {
  return BEREICHE[art] || BEREICHE.abschluss;
}

function terminBySlug(db, slug) {
  return db.prepare('SELECT * FROM pruefungstermin WHERE slug = ?').get(slug);
}

// Vorschlagsnamen je Prüfungstyp zum Vorausfüllen des Anlege-Formulars.
// Abschluss: Sommer- oder Winterprüfung je nach Monat (Sommer ca. Mai–Okt).
// Zwischen: einmal im Jahr, ohne Saison.
function nameVorschlaege(datum = new Date()) {
  const jahr = datum.getFullYear();
  const monat = datum.getMonth(); // 0-basiert
  const saison = monat >= 4 && monat <= 9 ? 'Sommer' : 'Winter';
  return {
    abschluss: `${saison} ${jahr}`,
    zwischen: `Zwischenprüfung ${jahr}`,
  };
}

module.exports = { BEREICHE, ART_LABEL, bereicheFuer, terminBySlug, nameVorschlaege };
