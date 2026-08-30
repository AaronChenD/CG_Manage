import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
const file = join(process.cwd(), "data", "cg-vault.sqlite");
if (!existsSync(file)) { console.error("数据库不存在"); process.exit(1); }
const db = new DatabaseSync(file);
const required = ["documents", "assets", "asset_files", "asset_revisions", "path_aliases", "trash_assets"];
const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
const missing = required.filter((name) => !rows.includes(name));
if (missing.length) { console.error(`缺少表：${missing.join(", ")}`); process.exit(1); }
const integrity = db.prepare("PRAGMA integrity_check").get();
if (integrity.integrity_check !== "ok") { console.error("SQLite integrity_check 失败"); process.exit(1); }
console.log("数据校验通过");
