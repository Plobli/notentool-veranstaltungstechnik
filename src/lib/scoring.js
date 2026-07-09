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

module.exports = { berechneBlockPunkte, berechneFachPunkte };
