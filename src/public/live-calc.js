// src/public/live-calc.js
// Live-Neuberechnung der Endpunktzahl beim Tippen, rein clientseitig zur sofortigen
// Rückmeldung. Die serverseitige Berechnung in scoring.js bleibt die verbindliche Quelle.
(function () {
  const form = document.getElementById('korrektur-form');
  if (!form) return;
  const summeAnzeige = document.getElementById('live-summe');

  function neuBerechnen() {
    let summe = 0;
    document.querySelectorAll('table').forEach((table) => {
      let rohSumme = 0;
      let maxSumme = 0;
      table.querySelectorAll('tbody tr').forEach((row) => {
        const max = parseFloat(row.children[1].textContent) || 0;
        const punkteInput = row.querySelector('.punkte-feld');
        const entfaelltInput = row.querySelector('input[type="checkbox"]');
        if (entfaelltInput && entfaelltInput.checked) return;
        rohSumme += parseFloat(punkteInput.value) || 0;
        maxSumme += max;
      });
      // Ziel-Anteil steht nicht im DOM; die genaue serverseitige Neuberechnung
      // erfolgt beim Speichern. Hier nur eine grobe Live-Anzeige der Rohsumme.
      summe += maxSumme > 0 ? rohSumme : 0;
    });
    if (summeAnzeige) summeAnzeige.textContent = summe.toFixed(1) + ' (Rohsumme, endgültige Berechnung nach dem Speichern)';
  }

  form.addEventListener('input', neuBerechnen);
})();
