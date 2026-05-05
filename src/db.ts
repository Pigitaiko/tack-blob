import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function createDb(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS pins (
      requestid TEXT PRIMARY KEY,
      cid TEXT NOT NULL,
      name TEXT,
      status TEXT NOT NULL CHECK(status IN ('queued', 'pinning', 'pinned', 'failed')),
      origins TEXT NOT NULL,
      meta TEXT NOT NULL,
      delegates TEXT NOT NULL,
      info TEXT NOT NULL,
      owner TEXT NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      expires_at INTEGER,
      expired_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_pins_cid ON pins(cid);
    CREATE INDEX IF NOT EXISTS idx_pins_name ON pins(name);
    CREATE INDEX IF NOT EXISTS idx_pins_status ON pins(status);
    CREATE INDEX IF NOT EXISTS idx_pins_created ON pins(created);
    CREATE INDEX IF NOT EXISTS idx_pins_owner ON pins(owner);
  `);

  const columns = db.prepare(`PRAGMA table_info(pins)`).all() as Array<{ name: string }>;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has('expires_at')) {
    db.exec('ALTER TABLE pins ADD COLUMN expires_at INTEGER');
  }
  if (!columnNames.has('expired_at')) {
    db.exec('ALTER TABLE pins ADD COLUMN expired_at INTEGER');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_pins_expires_at ON pins(expires_at)');

  return db;
}
