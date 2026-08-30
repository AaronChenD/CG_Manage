import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const input = process.argv[2];
if (!input) {
  console.error("用法：npm run restore -- data/backups/cg-vault-xxxx.sqlite");
  process.exit(1);
}
const source = join(process.cwd(), input);
const target = join(process.cwd(), "data", "cg-vault.sqlite");
if (!existsSync(source)) {
  console.error(`备份文件不存在：${source}`);
  process.exit(1);
}
const check = new DatabaseSync(source);
check.prepare("SELECT 1 FROM documents LIMIT 1").get();
check.close();
await mkdir(join(process.cwd(), "data"), { recursive: true });
if (existsSync(target)) await copyFile(target, `${target}.before-restore.bak`);
await copyFile(source, target);
console.log(`恢复完成：${target}`);
