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

module.exports = { berechneBlockPunkte, berechneFachPunkte, berechneProjektErgebnis };
