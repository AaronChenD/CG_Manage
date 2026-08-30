import { mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const source = join(root, "data", "cg-vault.sqlite");
if (!existsSync(source)) {
  console.error("数据库尚未创建，请先启动一次应用。");
  process.exit(1);
}
const targetDir = join(root, "data", "backups");
await mkdir(targetDir, { recursive: true });
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const target = join(targetDir, `cg-vault-${stamp}.sqlite`);
const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
db.close();
console.log(`备份完成：${target}`);
