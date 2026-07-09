// src/lib/scoring.js

function berechneBlockPunkte(unteraufgaben, punkteEintraege, zielAnteil) {
  const eintragByUnteraufgabe = new Map(
    punkteEintraege.map((e) => [e.unteraufgabe_id, e])
  );

  let rohSumme = 0;
  let maxRohSumme = 0;

  for (const u of unteraufgaben) {
    const eintrag = eintragByUnteraufgabe.get(u.id);
    const entfaellt = eintrag ? Boolean(eintrag.entfaellt) : false;
    if (entfaellt) continue;
    rohSumme += eintrag ? Number(eintrag.punkte) || 0 : 0;
    maxRohSumme += Number(u.max_punkte) || 0;
  }

  const multiplikator = maxRohSumme > 0 ? zielAnteil / maxRohSumme : 0;
  const teilpunkte = Math.round(rohSumme * multiplikator);

  return { rohSumme, maxRohSumme, multiplikator, teilpunkte };
}

function berechneFachPunkte(bloecke) {
  const berechneteBloecke = bloecke.map((block) => {
    const ergebnis = berechneBlockPunkte(
      block.unteraufgaben,
      block.punkteEintraege,
      block.ziel_anteil
    );
    return { ...block, ...ergebnis };
  });

  const punkte = berechneteBloecke.reduce((sum, b) => sum + b.teilpunkte, 0);

  return { punkte, bloecke: berechneteBloecke };
}

function berechneProjektErgebnis(kriterien) {
  const berechnet = kriterien.map((k) => ({
    ...k,
    ergebnis: Math.round(k.punkte * k.faktor * 100) / 100,
  }));
  const gesamtpunkte = Math.round(
    berechnet.reduce((sum, k) => sum + k.ergebnis, 0)
  );
  return { gesamtpunkte, kriterien: berechnet };
}

function note(punkte) {
  if (punkte >= 92) return 'sehr gut';
  if (punkte >= 81) return 'gut';
  if (punkte >= 67) return 'befriedigend';
  if (punkte >= 50) return 'ausreichend';
  if (punkte >= 30) return 'mangelhaft';
  return 'ungenügend';
}

function berechneGesamtergebnis(bereiche) {
  const gesamtpunkte = Math.round(
    bereiche.reduce((sum, b) => sum + b.punkte * (b.gewichtung_prozent / 100), 0)
  );

  const gruende = [];

  for (const b of bereiche) {
    if (b.punkte < 30) {
      gruende.push(`${b.name} ist ungenügend (${b.punkte} Punkte)`);
    }
  }

  for (const b of bereiche) {
    if (b.ist_sperrfach && b.punkte < 50) {
      gruende.push(`Sperrfach ${b.name} ist nicht mindestens ausreichend (${b.punkte} Punkte)`);
    }
  }

  const nichtSperrfaecher = bereiche.filter((b) => !b.ist_sperrfach);
  const ausreichendeNichtSperrfaecher = nichtSperrfaecher.filter((b) => b.punkte >= 50);
  if (ausreichendeNichtSperrfaecher.length < 2) {
    gruende.push('Weniger als mindestens 2 weitere Bereiche sind ausreichend');
  }

  if (gesamtpunkte < 50) {
    gruende.push(`Gesamtergebnis ist nicht mindestens ausreichend (${gesamtpunkte} Punkte)`);
  }

  return {
    gesamtpunkte,
    note: note(gesamtpunkte),
    bestanden: gruende.length === 0,
    gruende,
  };
}

function berechneMepErgebnis(schriftlichePunkte, mepPunkte) {
  const ergebnis = Math.round((schriftlichePunkte * 2 + mepPunkte) / 3);
  return { ergebnis, bestanden: ergebnis >= 50 };
}

module.exports = {
  berechneBlockPunkte,
  berechneFachPunkte,
  berechneProjektErgebnis,
  note,
  berechneGesamtergebnis,
  berechneMepErgebnis,
};
