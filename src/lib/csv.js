// src/lib/csv.js

function feldEscapen(wert) {
  const text = String(wert === null || wert === undefined ? '' : wert);
  if (text.includes(';') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function zuCsv(header, rows) {
  const zeilen = [header.map(feldEscapen).join(';')];
  for (const row of rows) {
    zeilen.push(row.map(feldEscapen).join(';'));
  }
  return zeilen.join('\n');
}

module.exports = { zuCsv };
