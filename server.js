// server.js
const express = require('express');
const db = require('./db/database');
const { importCsvText } = require('./import-csv');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

app.post('/api/import/csv', (req, res) => {
  if (!req.body || typeof req.body.csv !== 'string') {
    return res.status(400).json({ error: 'csv must be provided as a string' });
  }

  try {
    const imported = importCsvText(req.body.csv);
    res.status(201).json({ imported });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

const VALID_STATUSES = ['AVAILABLE', 'IN_USE', 'BROKEN', 'IN_SHIPMENT'];

function resolveTypeId(typeName) {
  // Returns { ok: true, typeId } or { ok: false, error }
  if (typeName === undefined || typeName === null || typeName === '') {
    return { ok: true, typeId: null };
  }
  const row = db.prepare('SELECT * FROM types WHERE name = ? COLLATE NOCASE').get(typeName);
  if (!row) {
    const valid = db.prepare('SELECT name FROM types ORDER BY name').all().map((t) => t.name);
    return {
      ok: false,
      error: `Unknown type "${typeName}". Valid types: ${valid.join(', ')}. Add new ones via POST /api/types.`,
    };
  }
  return { ok: true, typeId: row.id };
}

const PART_SELECT = `
  SELECT parts.*, types.name AS type
  FROM parts
  LEFT JOIN types ON parts.type_id = types.id
`;

// ===== TYPES =====

app.get('/api/types', (req, res) => {
  res.json(db.prepare('SELECT * FROM types ORDER BY name').all());
});

app.post('/api/types', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required and must be a non-empty string' });
  }
  try {
    const info = db.prepare('INSERT INTO types (name) VALUES (?)').run(name.trim());
    res.status(201).json(db.prepare('SELECT * FROM types WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: `Type "${name}" already exists` });
    }
    throw err;
  }
});

// --- ADDED: DELETE a type by ID ---
app.delete('/api/types/:id', (req, res) => {
  const typeId = req.params.id;
  
  // Use a transaction to safely unassign parts and delete the tag
  const deleteTypeTx = db.transaction((id) => {
    db.prepare('UPDATE parts SET type_id = NULL WHERE type_id = ?').run(id);
    const info = db.prepare('DELETE FROM types WHERE id = ?').run(id);
    return info.changes;
  });

  const changes = deleteTypeTx(typeId);
  if (changes === 0) {
    return res.status(404).json({ error: 'Type not found' });
  }
  
  res.status(204).send();
});

// ===== PARTS =====

app.post('/api/parts', (req, res) => {
  const { name, quantity, status, location, type } = req.body;

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required and must be a string' });
  }
  const qty = quantity === undefined ? 0 : Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    return res.status(400).json({ error: 'quantity must be a non-negative integer' });
  }
  const finalStatus = status || 'AVAILABLE';
  if (!VALID_STATUSES.includes(finalStatus)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }
  const typeResult = resolveTypeId(type);
  if (!typeResult.ok) return res.status(400).json({ error: typeResult.error });

  const info = db
    .prepare('INSERT INTO parts (name, quantity, status, location, type_id) VALUES (?, ?, ?, ?, ?)')
    .run(name, qty, finalStatus, location || null, typeResult.typeId);

  res.status(201).json(db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(info.lastInsertRowid));
});

app.get('/api/parts', (req, res) => {
  res.json(db.prepare(`${PART_SELECT} ORDER BY parts.id`).all());
});

app.get('/api/parts/:id', (req, res) => {
  const part = db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(req.params.id);
  if (!part) return res.status(404).json({ error: 'Part not found' });
  res.json(part);
});

app.put('/api/parts/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Part not found' });

  const { name, quantity, status, location, type } = req.body;

  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }
  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 0)) {
    return res.status(400).json({ error: 'quantity must be a non-negative integer' });
  }

  let typeId = existing.type_id;
  if (type !== undefined) {
    const typeResult = resolveTypeId(type);
    if (!typeResult.ok) return res.status(400).json({ error: typeResult.error });
    typeId = typeResult.typeId;
  }

  const updated = {
    name: name !== undefined ? name : existing.name,
    quantity: quantity !== undefined ? quantity : existing.quantity,
    status: status !== undefined ? status : existing.status,
    location: location !== undefined ? location : existing.location,
  };

  const mergeTarget = db.prepare(
    `SELECT * FROM parts
     WHERE id != ? AND name = ? COLLATE NOCASE AND status = ? AND type_id IS ?`
  ).get(req.params.id, updated.name, updated.status, typeId);

  if (mergeTarget) {
    const mergeTransaction = db.transaction(() => {
      db.prepare('UPDATE parts SET quantity = quantity + ? WHERE id = ?')
        .run(updated.quantity, mergeTarget.id);
      db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
      return db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(mergeTarget.id);
    });
    return res.json({ merged: true, part: mergeTransaction() });
  }

  db.prepare(
    'UPDATE parts SET name = ?, quantity = ?, status = ?, location = ?, type_id = ? WHERE id = ?'
  ).run(updated.name, updated.quantity, updated.status, updated.location, typeId, req.params.id);

  res.json({ merged: false, part: db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(req.params.id) });
});

app.post('/api/parts/:id/split', (req, res) => {
  const existing = db.prepare('SELECT * FROM parts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Part not found' });

  const quantity = Number(req.body.quantity);
  const status = req.body.status || existing.status;
  const location = req.body.location === undefined ? existing.location : req.body.location;
  const type = req.body.type === undefined ? existing.type_id : req.body.type;

  if (!Number.isInteger(quantity) || quantity <= 0 || quantity >= existing.quantity) {
    return res.status(400).json({ error: `quantity must be greater than 0 and less than ${existing.quantity}` });
  }
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` });
  }

  let typeId = type;
  if (typeof type === 'string' || type === null) {
    const typeResult = resolveTypeId(type);
    if (!typeResult.ok) return res.status(400).json({ error: typeResult.error });
    typeId = typeResult.typeId;
  }

  const splitTransaction = db.transaction(() => {
    db.prepare('UPDATE parts SET quantity = quantity - ? WHERE id = ?').run(quantity, req.params.id);
    const info = db.prepare(
      'INSERT INTO parts (name, quantity, status, location, type_id) VALUES (?, ?, ?, ?, ?)'
    ).run(existing.name, quantity, status, location || null, typeId);
    return {
      source: db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(req.params.id),
      created: db.prepare(`${PART_SELECT} WHERE parts.id = ?`).get(info.lastInsertRowid),
    };
  });

  res.status(201).json(splitTransaction());
});

app.delete('/api/parts/:id', (req, res) => {
  const info = db.prepare('DELETE FROM parts WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Part not found' });
  res.status(204).send();
});

app.listen(PORT, () => {
  console.log(`Inventory server running at http://localhost:${PORT}`);
});