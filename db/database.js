// db/database.js
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', 'inventory.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE', 'IN_USE', 'BROKEN')),
    location TEXT,
    type_id INTEGER REFERENCES types(id)
  )
`);

// --- Migration: add type_id to a parts table that already existed before this change ---
const columns = db.prepare("PRAGMA table_info(parts)").all();
const hasTypeId = columns.some((c) => c.name === 'type_id');
if (!hasTypeId) {
  db.exec('ALTER TABLE parts ADD COLUMN type_id INTEGER REFERENCES types(id)');
  console.log('Migrated: added type_id column to parts table');
}

// --- Seed some common starter types (only runs once, when table is empty) ---
const typeCount = db.prepare('SELECT COUNT(*) AS c FROM types').get().c;
if (typeCount === 0) {
  const insertType = db.prepare('INSERT INTO types (name) VALUES (?)');
  const seedTypes = db.transaction((names) => {
    names.forEach((n) => insertType.run(n));
  });
  seedTypes(['Motor', 'Servo', 'Sensor', 'Microcontroller', 'Structural', 'Electronic', 'Misc']);
  console.log('Seeded default types');
}

module.exports = db;