// src/lib/fachgespraech-struktur.js
//
// Feste Struktur des Fachgespräch-Bewertungsbogens.
// Wie bei der schriftlichen Prüfung ist die Struktur bewusst im Code verankert
// (Vorlage: Dokumente/Bewertungsbogen Fachgespräche.pdf); pro Prüfling werden
// nur Protokoll-Text und Punkte je Kriterium gespeichert.
//
// Ergebnis je Kriterium = Punkte (0–100) × Faktor. Die Faktoren summieren sich
// zu 1,0, sodass die Gesamtpunktzahl wieder auf der 100-Punkte-Skala liegt.

const FACHGESPRAECH_KRITERIEN = [
  {
    key: 'anforderungen',
    nr: 1,
    name: 'Anforderungen auswerten',
    beschreibung:
      'Technische Anforderungen; Inhaltliche Anforderungen; Künstlerische ' +
      'Anforderungen; Bühnenanweisungen und Rider berücksichtigt; Intention ' +
      'des Auftraggebers erkannt',
    faktor: 0.1,
  },
  {
    key: 'planung',
    nr: 2,
    name: 'Planen und Einsetzen der Veranstaltungstechnik',
    beschreibung:
      'räumliche Gegebenheiten einbezogen (Hallradien, Sichtlinien, etc.); ' +
      'ggf. vor Ort vorhandene Technik genutzt; Sicherheitsanforderungen an ' +
      'die Technik betrachtet; geeignete Technik für die Anforderung ' +
      'ausgewählt; Inbetriebnahme und Bedienung zielführend',
    faktor: 0.2,
  },
  {
    key: 'energie',
    nr: 3,
    name: 'Energieversorgung',
    beschreibung:
      'Stromversorgung konzipiert; elektrische Anlage errichtet; Elektrische ' +
      'Inbetriebnahme und Prüfungen durchgeführt; Schutzmaßnahmen umgesetzt',
    faktor: 0.2,
  },
  {
    key: 'ablaeufe',
    nr: 4,
    name: 'Abläufe planen und abstimmen',
    beschreibung:
      'Logistische Abläufe; Veranstaltungsabläufe; Rechtliche Vorgaben ' +
      'einbezogen, Ökonomische Aspekte beachtet; Schnittstellen zu allen ' +
      'Beteiligten erkannt',
    faktor: 0.1,
  },
  {
    key: 'unterlagen',
    nr: 5,
    name: 'Technische Unterlagen erstellen',
    beschreibung:
      'Technische Unterlagen erstellt; Alle notwendigen Unterlagen vorhanden; ' +
      'Abläufe dokumentiert; Unterlagen zielgruppengerecht zusammengefasst',
    faktor: 0.4,
  },
];

const FACHGESPRAECH_KRITERIUM_BY_KEY = new Map(
  FACHGESPRAECH_KRITERIEN.map((k) => [k.key, k])
);

// Höchstpunktzahl je Kriterium (Rohwert) und Bestehensgrenze (Note 4).
const FACHGESPRAECH_MAX_PUNKTE = 100;
const FACHGESPRAECH_BESTEHENSGRENZE = 50;

module.exports = {
  FACHGESPRAECH_KRITERIEN,
  FACHGESPRAECH_KRITERIUM_BY_KEY,
  FACHGESPRAECH_MAX_PUNKTE,
  FACHGESPRAECH_BESTEHENSGRENZE,
};
