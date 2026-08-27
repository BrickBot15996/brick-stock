const fs = require('fs');
const path = require('path');
const db = require('./db/database');

const DEFAULT_TAG = 'Misc';
const VALID_STATUSES = new Set(['AVAILABLE', 'IN_USE', 'BROKEN', 'IN_SHIPMENT']);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && nextCharacter === '\n') index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
    } else {
      value += character;
    }
  }

  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((currentRow) => currentRow.some((cell) => cell.trim() !== ''));
}

function normalizeStatus(status) {
  return (status || 'AVAILABLE').trim().toUpperCase().replace(/[ -]+/g, '_');
}

function importCsvText(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length === 0) throw new Error('CSV is empty');

  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, '').trim().toUpperCase());
  const column = (name) => headers.indexOf(name);
  const nameColumn = column('NAME');
  const quantityColumn = column('QTY');
  const tagColumn = column('TAG');
  const statusColumn = column('STATUS');

  if (nameColumn === -1 || quantityColumn === -1) {
    throw new Error('CSV must contain NAME and QTY columns');
  }

  const insertType = db.prepare('INSERT OR IGNORE INTO types (name) VALUES (?)');
  const findType = db.prepare('SELECT id FROM types WHERE name = ? COLLATE NOCASE');
  const insertPart = db.prepare(
    'INSERT INTO parts (name, quantity, status, type_id) VALUES (?, ?, ?, ?)'
  );

  const importTransaction = db.transaction((dataRows) => {
    for (const [offset, values] of dataRows.entries()) {
      const rowNumber = offset + 2;
      const name = (values[nameColumn] || '').trim();
      const quantityText = (values[quantityColumn] || '').trim();
      const quantity = Number(quantityText);
      const tag = ((tagColumn === -1 ? '' : values[tagColumn]) || '').trim() || DEFAULT_TAG;
      const statusValue = statusColumn === -1 ? '' : values[statusColumn];
      const status = normalizeStatus(statusValue);

      if (!name) throw new Error(`Row ${rowNumber}: NAME is required`);
      if (!Number.isInteger(quantity) || quantity < 0) {
        throw new Error(`Row ${rowNumber}: QTY must be a non-negative integer`);
      }
      if (!VALID_STATUSES.has(status)) {
        throw new Error(`Row ${rowNumber}: unknown Status "${statusValue}"`);
      }

      insertType.run(tag);
      const type = findType.get(tag);
      insertPart.run(name, quantity, status, type.id);
    }
    return dataRows.length;
  });

  return importTransaction(rows.slice(1));
}

function importCsv(fileName) {
  return importCsvText(fs.readFileSync(path.resolve(fileName), 'utf8'));
}

if (require.main === module) {
  const fileName = process.argv[2];
  if (!fileName) {
    console.error('Usage: npm run import -- path/to/stock.csv');
    process.exitCode = 1;
  } else {
    try {
      console.log(`Imported ${importCsv(fileName)} part(s) from ${fileName}`);
    } catch (error) {
      console.error(`Import failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { importCsv, importCsvText, parseCsv };