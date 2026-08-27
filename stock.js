#!/usr/bin/env node
// stock.js
const db = require('./db/database');

const VALID_STATUSES = ['AVAILABLE', 'IN_USE', 'BROKEN'];
const [, , command, ...args] = process.argv;

function getTypeIdByName(name) {
  if (!name) return { ok: true, typeId: null };
  const row = db.prepare('SELECT * FROM types WHERE name = ? COLLATE NOCASE').get(name);
  if (!row) {
    const valid = db.prepare('SELECT name FROM types ORDER BY name').all().map((t) => t.name);
    return {
      ok: false,
      error: `Unknown type "${name}". Valid types: ${valid.join(', ')}. Add one with: node stock.js add-type <name>`,
    };
  }
  return { ok: true, typeId: row.id };
}

const PART_SELECT = `
  SELECT parts.*, types.name AS type
  FROM parts
  LEFT JOIN types ON parts.type_id = types.id
`;

function printTable(parts) {
  if (parts.length === 0) {
    console.log('No parts found.');
    return;
  }
  const rows = parts.map((p) => ({
    ID: p.id,
    Name: p.name,
    Type: p.type || '-',
    Qty: p.quantity,
    Status: p.status,
    Location: p.location || '-',
  }));
  console.table(rows);
}

function cmdList() {
  const parts = db.prepare(`${PART_SELECT} ORDER BY parts.id`).all();
  printTable(parts);
}

function cmdAdd(name, quantity, status, location, type) {
  if (!name || quantity === undefined) {
    console.error('Usage: node stock.js add <name> <quantity> [status] [location] [type]');
    process.exit(1);
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    console.error('Error: quantity must be a non-negative integer.');
    process.exit(1);
  }
  const finalStatus = status || 'AVAILABLE';
  if (!VALID_STATUSES.includes(finalStatus)) {
    console.error(`Error: status must be one of ${VALID_STATUSES.join(', ')}`);
    process.exit(1);
  }
  const typeResult = getTypeIdByName(type);
  if (!typeResult.ok) {
    console.error(`Error: ${typeResult.error}`);
    process.exit(1);
  }

  const info = db
    .prepare('INSERT INTO parts (name, quantity, status, location, type_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, qty, finalStatus, location || null, typeResult.typeId);

  console.log(`Added part #${info.lastInsertRowid}: ${name}`);
  printTable([db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(info.lastInsertRowid)]);
}

function cmdUpdate(id, field, value) {
  const validFields = ['name', 'quantity', 'status', 'location', 'type'];
  if (!id || !field || value === undefined) {
    console.error('Usage: node stock.js update <id> <field> <value>');
    console.error(`Valid fields: ${validFields.join(', ')}`);
    process.exit(1);
  }
  if (!validFields.includes(field)) {
    console.error(`Error: field must be one of ${validFields.join(', ')}`);
    process.exit(1);
  }

  const existing = db.prepare('SELECT * FROM parts WHERE id = ?').get(id);
  if (!existing) {
    console.error(`Error: no part found with id ${id}`);
    process.exit(1);
  }

  if (field === 'quantity') {
    const qty = Number(value);
    if (!Number.isInteger(qty) || qty < 0) {
      console.error('Error: quantity must be a non-negative integer.');
      process.exit(1);
    }
    db.prepare('UPDATE parts SET quantity = ? WHERE id = ?').run(qty, id);
  } else if (field === 'status') {
    if (!VALID_STATUSES.includes(value)) {
      console.error(`Error: status must be one of ${VALID_STATUSES.join(', ')}`);
      process.exit(1);
    }
    db.prepare('UPDATE parts SET status = ? WHERE id = ?').run(value, id);
  } else if (field === 'type') {
    const typeResult = getTypeIdByName(value);
    if (!typeResult.ok) {
      console.error(`Error: ${typeResult.error}`);
      process.exit(1);
    }
    db.prepare('UPDATE parts SET type_id = ? WHERE id = ?').run(typeResult.typeId, id);
  } else {
    // name or location: plain text fields
    db.prepare(`UPDATE parts SET ${field} = ? WHERE id = ?`).run(value, id);
  }

  console.log(`Updated part #${id}: ${field} -> ${value}`);
  printTable([db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(id)]);
}

function cmdRemove(id) {
  if (!id) {
    console.error('Usage: node stock.js remove <id>');
    process.exit(1);
  }
  const info = db.prepare('DELETE FROM parts WHERE id = ?').run(id);
  if (info.changes === 0) {
    console.error(`Error: no part found with id ${id}`);
    process.exit(1);
  }
  console.log(`Removed part #${id}`);
}

function cmdTypes() {
  const types = db.prepare('SELECT * FROM types ORDER BY name').all();
  if (types.length === 0) {
    console.log('No types defined yet.');
    return;
  }
  console.table(types.map((t) => ({ ID: t.id, Name: t.name })));
}

function cmdAddType(name) {
  if (!name) {
    console.error('Usage: node stock.js add-type <name>');
    process.exit(1);
  }
  try {
    const info = db.prepare('INSERT INTO types (name) VALUES (?)').run(name.trim());
    console.log(`Added type #${info.lastInsertRowid}: ${name}`);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      console.error(`Error: type "${name}" already exists`);
      process.exit(1);
    }
    throw err;
  }
}

function printHelp() {
  console.log(`
brick-stock CLI

Usage:
  node stock.js list
  node stock.js add <name> <quantity> [status] [location] [type]
  node stock.js update <id> <field> <value>
  node stock.js remove <id>
  node stock.js types
  node stock.js add-type <name>
  
Valid statuses: ${VALID_STATUSES.join(', ')}
Valid update fields: name, quantity, status, location, type
  `);
}

switch (command) {
  case 'list':
    cmdList();
    break;
  case 'add':
    cmdAdd(...args);
    break;
  case 'update':
    cmdUpdate(...args);
    break;
  case 'remove':
    cmdRemove(...args);
    break;
  case 'types':
    cmdTypes();
    break;
  case 'add-type':
    cmdAddType(...args);
    break;
  default:
    printHelp();
}