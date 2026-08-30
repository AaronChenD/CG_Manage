import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";

const databasePath = join(process.cwd(), "data", "cg-vault.sqlite");
let database: DatabaseSync | null = null;

function db() {
  if (!database) {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    database.exec(`PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS documents (
        path TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trash_assets (
        asset_id TEXT PRIMARY KEY,
        snapshot_json TEXT NOT NULL,
        deleted_at TEXT NOT NULL
      );`);
  }
  return database;
}

/** 供关系索引层（vault-index）复用的共享数据库句柄。 */
export function getDb() {
  return db();
}

export function readDocument<T>(path: string, fallback: T): T {
  const row = db().prepare("SELECT json FROM documents WHERE path = ?").get(path) as { json?: string } | undefined;
  if (!row?.json) return fallback;
  return JSON.parse(row.json) as T;
}

export function writeDocument(path: string, value: unknown) {
  db().prepare(`INSERT INTO documents(path, json, updated_at) VALUES(?, ?, datetime('now'))
    ON CONFLICT(path) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`).run(path, JSON.stringify(value));
}

export function moveToTrash(assetId: string, snapshot: unknown) {
  db().prepare(`INSERT OR REPLACE INTO trash_assets(asset_id, snapshot_json, deleted_at) VALUES(?, ?, datetime('now'))`).run(assetId, JSON.stringify(snapshot));
}

export function listTrash() {
  return db().prepare("SELECT asset_id AS assetId, snapshot_json AS snapshot, deleted_at AS deletedAt FROM trash_assets ORDER BY deleted_at DESC").all();
}

export function removeFromTrash(assetId: string) {
  db().prepare("DELETE FROM trash_assets WHERE asset_id = ?").run(assetId);
}

export function backupDatabase(destination: string) {
  db().exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
}

export { databasePath };
