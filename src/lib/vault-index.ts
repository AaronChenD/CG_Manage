/**
 * SQLite 关系索引层。
 *
 * JSON 文档（documents 表）仍是唯一事实来源（source of truth）；
 * 这里把「分类 / 资产 / 文件 / 链接 / 版本 / 别名」拆成规范化关系表，
 * 并建立 FTS5 全文索引（trigram 分词，兼顾英文与中文子串检索）。
 *
 * 这些表是「可随时重建的派生索引」——删除或重建它们不会丢失任何用户数据，
 * 因此不做增量同步，而是用「版本戳」在查询前惰性重建（见 ensureIndexFresh）。
 */
import { join } from "node:path";
import { getDb, readDocument } from "@/lib/sqlite-store";

const storedTextsPath = join(process.cwd(), "stored_texts");

type IndexCategory = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type IndexLink = { label: string; url: string };
type IndexFile = {
  id: string;
  name: string;
  ext: string;
  category: string;
  aliasKey: string | null;
  path: string;
  isDirectory: boolean | null;
  size: number | null;
  checksum: string | null;
  checksumAlgo: string | null;
  publishedAt: string | null;
  note: string;
};
type IndexAsset = {
  id: string;
  title: string;
  categoryId: string | null;
  kind: string;
  language: string;
  mediaKind: string;
  tags: string[];
  links: IndexLink[];
  files: IndexFile[];
  contentFile: string;
  revision: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};
type IndexAlias = {
  id: string;
  key: string;
  label: string;
  root: string;
  note: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type IndexConfig = { categories: IndexCategory[]; assets: IndexAsset[] };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  icon TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 99,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_id TEXT,
  kind TEXT NOT NULL,
  language TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT '其他',
  tags_json TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  content_file TEXT NOT NULL,
  search_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_opened_at TEXT
);
CREATE TABLE IF NOT EXISTS asset_files (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  alias_key TEXT,
  path TEXT NOT NULL,
  is_directory INTEGER NOT NULL DEFAULT 0,
  size INTEGER,
  checksum TEXT,
  checksum_algo TEXT,
  published_at TEXT,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS asset_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL,
  label TEXT NOT NULL,
  url TEXT NOT NULL,
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS asset_revisions (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  content TEXT NOT NULL,
  files_json TEXT,
  deploy_json TEXT,
  saved_at TEXT NOT NULL,
  change_note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(asset_id) REFERENCES assets(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS path_aliases (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  root TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS trash_assets (
  asset_id TEXT PRIMARY KEY,
  snapshot_json TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_asset_files_asset ON asset_files(asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_files_alias ON asset_files(alias_key);
CREATE INDEX IF NOT EXISTS idx_revisions_asset ON asset_revisions(asset_id, revision);
CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(
  asset_id UNINDEXED,
  title,
  content,
  tags,
  file_paths,
  category,
  tokenize='trigram'
);
`;

let schemaReady = false;
export function ensureIndexSchema() {
  if (schemaReady) return;
  getDb().exec(SCHEMA);
  schemaReady = true;
}

type StoredText = {
  content: string;
  history: { revision: number; content: string; saved_at: string; change_note: string; files?: IndexFile[]; deploy?: unknown }[];
};

function storedText(contentFile: string): StoredText {
  const raw = readDocument<{ content?: unknown; history?: unknown[] } | undefined>(join(storedTextsPath, contentFile), undefined);
  return {
    content: typeof raw?.content === "string" ? raw.content : "",
    history: Array.isArray(raw?.history)
      ? raw.history
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
          .map((item) => ({
            revision: typeof item.revision === "number" ? item.revision : 1,
            content: typeof item.content === "string" ? item.content : "",
            saved_at: typeof item.saved_at === "string" ? item.saved_at : "",
            change_note: typeof item.change_note === "string" ? item.change_note : "",
            files: Array.isArray(item.files) ? (item.files as IndexFile[]) : undefined,
            deploy: item.deploy,
          }))
      : [],
  };
}

/** 构造「版本戳」：资产数 / 最新更新时间 / 分类数 / 别名数。任一变即触发重建。 */
function computeStamp(config: IndexConfig, aliases: IndexAlias[]): string {
  let maxAssetUpdated = "";
  let maxAliasUpdated = "";
  for (const asset of config.assets) if (asset.updatedAt > maxAssetUpdated) maxAssetUpdated = asset.updatedAt;
  for (const alias of aliases) if (alias.updatedAt > maxAliasUpdated) maxAliasUpdated = alias.updatedAt;
  return [config.assets.length, maxAssetUpdated, config.categories.length, aliases.length, maxAliasUpdated].join("|");
}

/** 全量重建关系表与 FTS 索引（单个事务，同步执行，事件循环内原子完成）。 */
export function rebuildIndex(config: IndexConfig, aliases: IndexAlias[]) {
  ensureIndexSchema();
  const db = getDb();
  const categoryName = new Map(config.categories.map((category) => [category.id, category.name]));

  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec("DELETE FROM asset_search; DELETE FROM asset_revisions; DELETE FROM asset_links; DELETE FROM asset_files; DELETE FROM assets; DELETE FROM categories; DELETE FROM path_aliases;");

    const insCategory = db.prepare("INSERT INTO categories(id,name,description,color,icon,sort_order,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const category of config.categories) insCategory.run(category.id, category.name, category.description, category.color, category.icon, category.sortOrder, category.createdAt, category.updatedAt);

    const insAlias = db.prepare("INSERT INTO path_aliases(id,key,label,root,note,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)");
    for (const alias of aliases) insAlias.run(alias.id, alias.key, alias.label, alias.root, alias.note, alias.enabled ? 1 : 0, alias.createdAt, alias.updatedAt);

    const insAsset = db.prepare("INSERT INTO assets(id,title,category_id,kind,language,media_kind,tags_json,revision,is_favorite,content_file,search_text,created_at,updated_at,last_opened_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insFile = db.prepare("INSERT INTO asset_files(id,asset_id,name,ext,category,alias_key,path,is_directory,size,checksum,checksum_algo,published_at,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
    const insLink = db.prepare("INSERT INTO asset_links(asset_id,label,url) VALUES(?,?,?)");
    const insRevision = db.prepare("INSERT INTO asset_revisions(id,asset_id,revision,content,files_json,deploy_json,saved_at,change_note) VALUES(?,?,?,?,?,?,?,?)");
    const insFts = db.prepare("INSERT INTO asset_search(asset_id,title,content,tags,file_paths,category) VALUES(?,?,?,?,?,?)");

    for (const asset of config.assets) {
      const stored = storedText(asset.contentFile);
      const category = categoryName.get(asset.categoryId ?? "") ?? "";
      const fileHaystack = asset.files
        .map((file) => [file.name, file.path, file.aliasKey ? `$${file.aliasKey}` : "", file.checksum ?? "", file.note, file.category, file.ext].filter(Boolean).join(" "))
        .join(" ");
      const searchText = [asset.title, stored.content, asset.tags.join(" "), asset.language, asset.mediaKind, category, fileHaystack, ...asset.links.map((link) => `${link.label} ${link.url}`)].filter(Boolean).join(" ");

      insAsset.run(asset.id, asset.title, asset.categoryId, asset.kind, asset.language, asset.mediaKind, JSON.stringify(asset.tags), asset.revision, asset.isFavorite ? 1 : 0, asset.contentFile, searchText, asset.createdAt, asset.updatedAt, asset.lastOpenedAt);
      insFts.run(asset.id, asset.title, stored.content, asset.tags.join(" "), fileHaystack, category);
      for (const file of asset.files) insFile.run(file.id, asset.id, file.name, file.ext, file.category, file.aliasKey, file.path, file.isDirectory ? 1 : 0, file.size, file.checksum, file.checksumAlgo, file.publishedAt, file.note);
      for (const link of asset.links) insLink.run(asset.id, link.label, link.url);
      for (const revision of stored.history) insRevision.run(`${asset.id}-${revision.revision}`, asset.id, revision.revision, revision.content, revision.files ? JSON.stringify(revision.files) : null, revision.deploy ? JSON.stringify(revision.deploy) : null, revision.saved_at, revision.change_note);
    }

    const stamp = computeStamp(config, aliases);
    db.prepare("INSERT INTO index_meta(key,value) VALUES('stamp',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(stamp);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* 忽略回滚失败 */
    }
    throw error;
  }
}

/** 查询前确保索引与当前 JSON 数据一致；仅在版本戳变化时重建。 */
export function ensureIndexFresh(config: IndexConfig, aliases: IndexAlias[]) {
  ensureIndexSchema();
  const stamp = computeStamp(config, aliases);
  const row = getDb().prepare("SELECT value FROM index_meta WHERE key = 'stamp'").get() as { value?: string } | undefined;
  if (row?.value === stamp) return;
  rebuildIndex(config, aliases);
}

export type IndexQuery = {
  query?: string;
  kind?: string;
  categoryId?: string;
  sort?: "updated" | "name";
  page?: number;
  pageSize?: number;
};

export type IndexQueryResult = {
  ids: string[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/**
 * 服务端关系表查询：FTS5 全文检索（trigram）+ 分类/类型过滤 + 分页。
 * 不足 3 个字符的查询（trigram 无法命中）回退到 search_text 的 LIKE 子串匹配。
 */
export function queryAssetIds(options: IndexQuery): IndexQueryResult {
  ensureIndexSchema();
  const db = getDb();
  const query = options.query?.trim() ?? "";
  const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));
  const page = Math.max(1, options.page ?? 1);

  const where: string[] = [];
  const params: (string | number | null)[] = [];

  if (options.kind && options.kind !== "All") {
    where.push("a.kind = ?");
    params.push(options.kind);
  }
  if (options.categoryId && options.categoryId !== "all") {
    where.push("a.category_id = ?");
    params.push(options.categoryId);
  }

  let fromSql = "FROM assets a";
  let orderSql = "ORDER BY a.is_favorite DESC, a.updated_at DESC, a.title";
  if (query) {
    const short = Array.from(query).length < 3;
    if (!short) {
      fromSql = "FROM asset_search s JOIN assets a ON a.id = s.asset_id";
      where.push("asset_search MATCH ?");
      params.push(query);
      orderSql = "ORDER BY bm25(asset_search), a.is_favorite DESC";
    } else {
      where.push("a.search_text LIKE ?");
      params.push(`%${query}%`);
    }
  } else if (options.sort === "name") {
    orderSql = "ORDER BY a.title COLLATE NOCASE";
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) AS n ${fromSql} ${whereSql}`).get(...params) as { n: number }).n;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const offset = (page - 1) * pageSize;
  const rows = db.prepare(`SELECT a.id ${fromSql} ${whereSql} ${orderSql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as { id: string }[];

  return { ids: rows.map((row) => row.id), total, page, pageSize, totalPages };
}

export type RelationalReport = {
  totals: { assets: number; files: number; categories: number; aliases: number; revisions: number };
  aliasUsage: { key: string; label: string; enabled: boolean; files: number; assets: number }[];
  filesByCategory: { category: string; files: number; size: number }[];
  filesByFormat: { ext: string; files: number }[];
  assetsByKind: { kind: string; count: number }[];
  assetsMissingChecksum: number;
  duplicatesByPath: { path: string; count: number }[];
  duplicatesByChecksum: { checksum: string; count: number }[];
};

/** 关系表聚合报告：别名引用、分类/格式统计、缺失校验和、重复项等，全部走 SQL 关联查询。 */
export function relationalReport(): RelationalReport {
  ensureIndexSchema();
  const db = getDb();
  const one = <T>(sql: string) => (db.prepare(sql).get() as T);
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];
  return {
    totals: {
      assets: one<{ n: number }>("SELECT COUNT(*) AS n FROM assets").n,
      files: one<{ n: number }>("SELECT COUNT(*) AS n FROM asset_files").n,
      categories: one<{ n: number }>("SELECT COUNT(*) AS n FROM categories").n,
      aliases: one<{ n: number }>("SELECT COUNT(*) AS n FROM path_aliases").n,
      revisions: one<{ n: number }>("SELECT COUNT(*) AS n FROM asset_revisions").n,
    },
    aliasUsage: all<{ key: string; label: string; enabled: number; files: number; assets: number }>(
      `SELECT p.key, p.label, p.enabled, COUNT(f.id) AS files, COUNT(DISTINCT f.asset_id) AS assets
       FROM path_aliases p LEFT JOIN asset_files f ON f.alias_key = p.key
       GROUP BY p.key ORDER BY files DESC`,
    ).map((row) => ({ ...row, enabled: Boolean(row.enabled) })),
    filesByCategory: all<{ category: string; files: number; size: number }>(
      "SELECT category, COUNT(*) AS files, COALESCE(SUM(size),0) AS size FROM asset_files GROUP BY category ORDER BY files DESC",
    ),
    filesByFormat: all<{ ext: string; files: number }>(
      "SELECT ext, COUNT(*) AS files FROM asset_files WHERE ext != '' GROUP BY ext ORDER BY files DESC",
    ),
    assetsByKind: all<{ kind: string; count: number }>("SELECT kind, COUNT(*) AS count FROM assets GROUP BY kind"),
    assetsMissingChecksum: one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM (SELECT asset_id FROM asset_files WHERE size IS NOT NULL AND checksum IS NULL GROUP BY asset_id)",
    ).n,
    duplicatesByPath: all<{ path: string; count: number }>(
      "SELECT COALESCE(alias_key,'') || ':' || path AS path, COUNT(*) AS count FROM asset_files GROUP BY alias_key, path HAVING COUNT(*) > 1",
    ),
    duplicatesByChecksum: all<{ checksum: string; count: number }>(
      "SELECT checksum, COUNT(*) AS count FROM asset_files WHERE checksum IS NOT NULL GROUP BY checksum HAVING COUNT(*) > 1",
    ),
  };
}
