import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { extOf, extInfo, joinNative, parsePathTemplate, type PathAliasDTO } from "@/lib/asset-catalog";
import type { DeployPlanDTO } from "@/lib/script-package";

export type VaultLink = { label: string; url: string };

export type FileStatus = {
  resolvedPath: string;
  exists: boolean | null;
  isDirectory: boolean;
  size: number | null;
  modifiedAt: string | null;
  error: string | null;
};

export type ManagedFile = {
  id: string;
  name: string;
  ext: string;
  category: string;
  aliasKey: string | null;
  path: string;
  size: number | null;
  checksum: string | null;
  checksumAlgo: string | null;
  publishedAt: string | null;
  note: string;
};

export type ManagedFileDTO = ManagedFile & { status: FileStatus };

export type CategoryDTO = {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type FileSummary = { total: number; present: number; missing: number; size: number; formats: string[] };

export type AssetDTO = {
  id: string;
  title: string;
  categoryId: string | null;
  categoryName: string;
  categoryColor: string;
  kind: string;
  language: string;
  mediaKind: string;
  tags: string[];
  links: VaultLink[];
  content: string;
  files: ManagedFileDTO[];
  tech: Record<string, string>;
  fileSummary: FileSummary;
  packageInfo: { dcc: string; packageKind: string; moduleName: string; importPath: string };
  deploy: DeployPlanDTO | null;
  revision: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

export type RevisionDTO = {
  id: string;
  revision: number;
  content: string;
  savedAt: string;
  changeNote: string;
  files: ManagedFile[] | null;
  deploy: DeployPlanDTO | null;
};

export type ScanEntry = {
  name: string;
  path: string;
  ext: string;
  category: string;
  size: number | null;
  modifiedAt: string | null;
  isDirectory: boolean;
};

type CategoryRecord = CategoryDTO;

type AssetRecord = {
  id: string;
  title: string;
  categoryId: string | null;
  kind: string;
  language: string;
  mediaKind: string;
  tags: string[];
  links: VaultLink[];
  files: ManagedFile[];
  tech: Record<string, string>;
  package: {
    dcc: string;
    packageKind: string;
    moduleName: string;
    importPath: string;
  };
  deploy: DeployPlanDTO | null;
  revision: number;
  isFavorite: boolean;
  contentFile: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
};

type StoredRevision = { content: string; saved_at: string; revision: number; change_note: string; files?: ManagedFile[]; deploy?: DeployPlanDTO | null };
type StoredText = { content: string; history: StoredRevision[] };
type VaultConfig = { version: number; categories: CategoryRecord[]; assets: AssetRecord[] };
type AliasConfig = { version: number; aliases: PathAliasDTO[] };
type AssetInput = Record<string, unknown>;

export class VaultError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "VaultError";
  }
}

const configPath = join(process.cwd(), "config", "cg_manager_config.json");
const aliasPath = join(process.cwd(), "config", "path_aliases.json");
const storedTextsPath = join(process.cwd(), "stored_texts");
const assetLibraryPath = join(process.cwd(), "asset_library");
const maxHistory = 20;
const hashLimitBytes = 64 * 1024 * 1024;

const categorySeeds = [
  { name: "全局通用", description: "跨软件的管线工具与规范", color: "#94a3b8", icon: "globe", sortOrder: 0 },
  { name: "Maya", description: "绑定、动画与发布流程", color: "#fb923c", icon: "box", sortOrder: 1 },
  { name: "Houdini", description: "程序化建模与特效工具", color: "#f87171", icon: "sparkles", sortOrder: 2 },
  { name: "Blender", description: "几何节点、工具与插件", color: "#60a5fa", icon: "aperture", sortOrder: 3 },
  { name: "Unreal Engine", description: "运行时与技术美术资源", color: "#a78bfa", icon: "gamepad", sortOrder: 4 },
];

const aliasSeeds: Omit<PathAliasDTO, "id" | "createdAt" | "updatedAt">[] = [
  { key: "SHOW", label: "当前 Show 根目录", root: joinNative(assetLibraryPath, "show"), note: "示例目录，可改成 \\\\server\\show\\atlas", enabled: true },
  { key: "PUB", label: "发布区 publish", root: joinNative(assetLibraryPath, "publish"), note: "对外交付的模型与缓存", enabled: true },
  { key: "TEX", label: "贴图库", root: joinNative(assetLibraryPath, "texture"), note: "共享贴图与 Udim 序列", enabled: true },
];

// 进程内写入队列：让「读-改-写」在本地服务上串行执行，避免并发写坏 JSON。
let writeQueue: Promise<void> = Promise.resolve();

// 同一条请求链里嵌套申请锁（例如 ensureVaultSeed 内部还要取别名数据）时，
// 必须复用已持有的锁，否则会自我等待造成死锁。
const lockContext = new AsyncLocalStorage<{ held: true }>();

async function withWriteLock<T>(operation: () => Promise<T>) {
  if (lockContext.getStore()?.held) return operation();
  const previous = writeQueue;
  let release!: () => void;
  writeQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await lockContext.run({ held: true }, operation);
  } finally {
    release();
  }
}

async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ENOENT") console.error(`Unable to read JSON file ${filePath}`, error);
    return fallback;
  }
}

function now() {
  return new Date().toISOString();
}

function textValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanTags(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 14);
}

function cleanLinks(value: unknown): VaultLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((link): link is Record<string, unknown> => Boolean(link) && typeof link === "object")
    .map((link) => ({ label: textValue(link.label), url: textValue(link.url) }))
    .filter((link) => link.label && /^https?:\/\//i.test(link.url))
    .slice(0, 8);
}

function cleanTech(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const text = textValue(raw);
    if (text) output[key.slice(0, 40)] = text.slice(0, 120);
  }
  return output;
}

function cleanDeploy(value: unknown): DeployPlanDTO | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const dcc = textValue(raw.dcc).slice(0, 40);
  const installTarget = textValue(raw.installTarget).slice(0, 40) || null;
  const hasEntry = raw.hasEntry === undefined ? true : Boolean(raw.hasEntry);
  const entryPoint = textValue(raw.entryPoint, "main").slice(0, 80);
  return {
    dcc,
    installTarget,
    installSubpath: textValue(raw.installSubpath).slice(0, 200),
    installMethod: textValue(raw.installMethod, "copy").slice(0, 24),
    hasEntry,
    entryPoint: entryPoint || "main",
    callContext: textValue(raw.callContext, "import").slice(0, 24),
    invocation: textValue(raw.invocation).slice(0, 2000),
    createdAt: textValue(raw.createdAt).slice(0, 40),
    updatedAt: textValue(raw.updatedAt).slice(0, 40),
  };
}

function packageDefaults() {
  return { dcc: "", packageKind: "单文件脚本", moduleName: "", importPath: "" };
}

type AssetShape = {
  mediaKind: string;
  files: ManagedFile[];
  tech: Record<string, string>;
  package: { dcc: string; packageKind: string; moduleName: string; importPath: string };
  deploy: DeployPlanDTO | null;
};

/**
 * 按资产类型裁剪字段，保证服务端数据始终自洽：
 *  - 文件资产：可有文件清单、资产细分与交付元数据（帧范围/上轴…），没有脚本部署计划
 *  - 可执行脚本：可有部署计划；只有「多文件包」形态才保留包内文件清单；没有交付元数据
 *  - 代码片段 / 参考链接：不带文件、元数据、部署计划
 */
function shapeByKind(kind: string, input: AssetShape): AssetShape {
  if (kind === "File") {
    return { mediaKind: input.mediaKind, files: input.files, tech: input.tech, package: packageDefaults(), deploy: null };
  }
  if (kind === "Executable") {
    const pkg = input.package;
    const isMultiFile = pkg.packageKind === "多文件包 / 模块";
    return { mediaKind: "其他", files: isMultiFile ? input.files : [], tech: {}, package: pkg, deploy: input.deploy };
  }
  return { mediaKind: "其他", files: [], tech: {}, package: packageDefaults(), deploy: null };
}

function cleanFiles(value: unknown): ManagedFile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((file): file is Record<string, unknown> => Boolean(file) && typeof file === "object")
    .map((file) => {
      const rawPath = textValue(file.path).replaceAll("\\", "/");
      if (!rawPath) return null;
      const parsed = parsePathTemplate(rawPath);
      // 只有显式写了 `$KEY/` 或 `{KEY}/` 前缀时才剥离，其余情况原样保留，避免路径被误吞。
      const prefix = /^\$\{?[A-Za-z_][A-Za-z0-9_.-]*\}?[\\/]?|^\{[A-Za-z_][A-Za-z0-9_.-]*\}[\\/]?/.exec(rawPath);
      const relative = prefix ? rawPath.slice(prefix[0].length) : rawPath;
      const name = textValue(file.name) || rawPath.split("/").pop() || "未命名文件";
      const ext = (textValue(file.ext) || extOf(name)).toLowerCase().replace(/[^a-z0-9]/g, "");
      return {
        id: textValue(file.id, randomUUID()),
        name: name.slice(0, 180),
        ext,
        category: textValue(file.category, extInfo(ext).category).slice(0, 24),
        aliasKey: textValue(file.aliasKey).toUpperCase().replace(/[^A-Z0-9_.-]/g, "").slice(0, 32) || parsed.aliasKey || null,
        path: relative.slice(0, 900),
        size: nullableNumber(file.size),
        checksum: textValue(file.checksum).slice(0, 128) || null,
        checksumAlgo: textValue(file.checksumAlgo).slice(0, 16) || null,
        publishedAt: textValue(file.publishedAt).slice(0, 40) || null,
        note: textValue(file.note).slice(0, 280),
      } satisfies ManagedFile;
    })
    .filter((file): file is ManagedFile => Boolean(file))
    .slice(0, 40);
}

function defaultConfig(): VaultConfig {
  return { version: 2, categories: [], assets: [] };
}

function toCategoryDTO(category: Record<string, unknown>): CategoryDTO {
  return {
    id: textValue(category.id, randomUUID()),
    name: textValue(category.name, "未命名空间"),
    description: textValue(category.description),
    color: textValue(category.color, "#94a3b8"),
    icon: textValue(category.icon, "box"),
    sortOrder: typeof category.sortOrder === "number" ? category.sortOrder : 99,
    createdAt: textValue(category.createdAt, now()),
    updatedAt: textValue(category.updatedAt, now()),
  };
}

function normalizeConfig(value: unknown): VaultConfig {
  if (!value || typeof value !== "object") return defaultConfig();
  const raw = value as { version?: unknown; categories?: unknown; assets?: unknown };
  const categories = Array.isArray(raw.categories)
    ? raw.categories
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(toCategoryDTO)
    : [];
  const assets = Array.isArray(raw.assets)
    ? raw.assets
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((asset) => {
          const kind = textValue(asset.kind, "Snippet");
          // 读取时按类型裁剪，历史数据里错配的字段（例如脚本带着「资产细分」）会被自动纠正。
          const shaped = shapeByKind(kind, {
            mediaKind: textValue(asset.mediaKind, "其他"),
            files: cleanFiles(asset.files),
            tech: cleanTech(asset.tech),
            package: {
              dcc: textValue((asset.package as Record<string, unknown> | undefined)?.dcc).slice(0, 40),
              packageKind: textValue((asset.package as Record<string, unknown> | undefined)?.packageKind, "单文件脚本").slice(0, 20),
              moduleName: textValue((asset.package as Record<string, unknown> | undefined)?.moduleName).slice(0, 120),
              importPath: textValue((asset.package as Record<string, unknown> | undefined)?.importPath).slice(0, 200),
            },
            deploy: cleanDeploy(asset.deploy),
          });
          return {
          id: textValue(asset.id, randomUUID()),
          title: textValue(asset.title, "未命名资产"),
          categoryId: typeof asset.categoryId === "string" ? asset.categoryId : null,
          kind,
          language: textValue(asset.language, "Python"),
          mediaKind: shaped.mediaKind,
          tags: cleanTags(asset.tags),
          links: cleanLinks(asset.links),
          files: shaped.files,
          tech: shaped.tech,
          package: shaped.package,
          deploy: shaped.deploy,
          revision: typeof asset.revision === "number" ? asset.revision : 1,
          isFavorite: Boolean(asset.isFavorite),
          contentFile: textValue(asset.contentFile, `${textValue(asset.id, randomUUID())}.json`),
          createdAt: textValue(asset.createdAt, now()),
          updatedAt: textValue(asset.updatedAt, now()),
          lastOpenedAt: typeof asset.lastOpenedAt === "string" ? asset.lastOpenedAt : null,
          };
        })
    : [];
  return { version: typeof raw.version === "number" ? raw.version : 2, categories, assets };
}

async function readConfig() {
  return normalizeConfig(await readJson<unknown>(configPath, defaultConfig()));
}

async function readAliasConfig(): Promise<AliasConfig> {
  const value = await readJson<unknown>(aliasPath, { version: 1, aliases: [] });
  const raw = (value && typeof value === "object" ? (value as { aliases?: unknown }).aliases : null) ?? [];
  const aliases = Array.isArray(raw)
    ? raw
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          id: textValue(item.id, randomUUID()),
          key: textValue(item.key).toUpperCase().replace(/[^A-Z0-9_.-]/g, "").slice(0, 32),
          label: textValue(item.label),
          root: textValue(item.root),
          note: textValue(item.note),
          enabled: item.enabled === undefined ? true : Boolean(item.enabled),
          createdAt: textValue(item.createdAt, now()),
          updatedAt: textValue(item.updatedAt, now()),
        }))
        .filter((item) => item.key && item.root)
    : [];
  return { version: 1, aliases };
}

async function saveAliases(config: AliasConfig) {
  await writeJsonAtomic(aliasPath, config);
}

export async function getPathAliases(): Promise<PathAliasDTO[]> {
  const existing = await readAliasConfig();
  if (existing.aliases.length) return existing.aliases;
  const timestamp = now();
  const seeded: PathAliasDTO[] = aliasSeeds.map((seed) => ({ ...seed, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp }));
  await withWriteLock(() => saveAliases({ version: 1, aliases: seeded }));
  return seeded;
}

async function readStoredText(contentFile: string): Promise<StoredText> {
  const fallback: StoredText = { content: "", history: [] };
  const value = await readJson<unknown>(join(storedTextsPath, contentFile), fallback);
  if (!value || typeof value !== "object") return fallback;
  const raw = value as { content?: unknown; history?: unknown };
  const history = Array.isArray(raw.history)
    ? raw.history
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map((item) => ({
          content: typeof item.content === "string" ? item.content : "",
          saved_at: textValue(item.saved_at, now()),
          revision: typeof item.revision === "number" ? item.revision : 1,
          change_note: textValue(item.change_note),
          files: Array.isArray(item.files) ? cleanFiles(item.files) : undefined,
          deploy: item.deploy ? cleanDeploy(item.deploy) : undefined,
        }))
        .slice(-maxHistory)
    : [];
  return { content: typeof raw.content === "string" ? raw.content : "", history };
}

async function saveStoredText(contentFile: string, value: StoredText) {
  await writeJsonAtomic(join(storedTextsPath, contentFile), value);
}

async function saveConfig(config: VaultConfig) {
  await writeJsonAtomic(configPath, config);
}

/** 路径解析：别名 + 相对路径 → 服务器可访问的真实路径。 */
function resolvePath(file: ManagedFile, aliases: PathAliasDTO[]): FileStatus {
  const template = file.aliasKey ? `$${file.aliasKey}/${file.path}` : file.path;
  const alias = file.aliasKey ? aliases.find((item) => item.key.toUpperCase() === file.aliasKey?.toUpperCase()) : undefined;
  if (file.aliasKey && !alias) {
    return { resolvedPath: template, exists: null, isDirectory: false, size: null, modifiedAt: null, error: `未定义路径别名 $${file.aliasKey}` };
  }
  if (file.aliasKey && alias && !alias.enabled) {
    return { resolvedPath: template, exists: null, isDirectory: false, size: null, modifiedAt: null, error: `路径别名 $${file.aliasKey} 已停用` };
  }
  const resolved = alias ? joinNative(alias.root, file.path) : file.path;
  return { resolvedPath: resolved, exists: null, isDirectory: false, size: null, modifiedAt: null, error: null };
}

async function statTarget(status: FileStatus): Promise<FileStatus> {
  if (status.error) return status;
  try {
    const info = await stat(status.resolvedPath);
    return {
      ...status,
      exists: true,
      isDirectory: info.isDirectory(),
      size: info.size,
      modifiedAt: info.mtime.toISOString(),
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") return { ...status, exists: false };
    return { ...status, exists: null, error: code === "EACCES" ? "没有访问权限" : `无法访问路径（${code ?? "未知错误"}）` };
  }
}

async function hashFile(resolvedPath: string) {
  const info = await stat(resolvedPath);
  if (info.isDirectory()) throw new VaultError(400, "该路径是目录，无法计算校验和。");
  if (info.size > hashLimitBytes) throw new VaultError(400, `文件超过 ${Math.round(hashLimitBytes / 1024 / 1024)} MB，已跳过校验和计算。`);
  const hash = createHash("md5");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(resolvedPath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return { digest: hash.digest("hex"), size: info.size, algorithm: "md5" };
}

function summaryOf(files: ManagedFileDTO[]): FileSummary {
  return files.reduce<FileSummary>(
    (summary, file) => ({
      total: summary.total + 1,
      present: summary.present + (file.status.exists === true ? 1 : 0),
      missing: summary.missing + (file.status.exists === false ? 1 : 0),
      size: summary.size + (file.status.size ?? file.size ?? 0),
      formats: file.ext && !summary.formats.includes(file.ext) ? [...summary.formats, file.ext] : summary.formats,
    }),
    { total: 0, present: 0, missing: 0, size: 0, formats: [] },
  );
}

async function hydrateFiles(files: ManagedFile[], aliases: PathAliasDTO[]): Promise<ManagedFileDTO[]> {
  const withPaths = files.map((file) => ({ file, status: resolvePath(file, aliases) }));
  const statuses = await Promise.all(withPaths.map((item) => statTarget(item.status)));
  return withPaths.map((item, index) => ({
    ...item.file,
    size: item.file.size ?? statuses[index].size,
    status: statuses[index],
  }));
}

async function buildAssetDTO(asset: AssetRecord, categories: CategoryRecord[], aliases: PathAliasDTO[], stored: StoredText): Promise<AssetDTO> {
  const category = categories.find((item) => item.id === asset.categoryId) ?? null;
  const files = await hydrateFiles(asset.files, aliases);
  return {
    id: asset.id,
    title: asset.title,
    categoryId: asset.categoryId,
    categoryName: category?.name ?? "未分类",
    categoryColor: category?.color ?? "#64748b",
    kind: asset.kind,
    language: asset.language,
    mediaKind: asset.mediaKind,
    tags: asset.tags,
    links: asset.links,
    content: stored.content,
    files,
    tech: asset.tech,
    fileSummary: summaryOf(files),
    packageInfo: {
      dcc: asset.package.dcc,
      packageKind: asset.package.packageKind,
      moduleName: asset.package.moduleName,
      importPath: asset.package.importPath,
    },
    deploy: asset.deploy,
    revision: asset.revision,
    isFavorite: asset.isFavorite,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
    lastOpenedAt: asset.lastOpenedAt,
  };
}

async function seedLibrarySamples() {
  const samples: { file: string; body: string }[] = [
    { file: "show/character/hero_rig.ma", body: "# example Maya scene placeholder\n" },
    { file: "publish/model/hero_body.fbx", body: "Kaydara FBX Binary  \u0000placeholder\n" },
    { file: "publish/anim/hero_walk.bvh", body: "HIERARCHY\nROOT hero_Hips\n{\n  OFFSET 0.0 0.0 0.0\n}\n" },
    { file: "publish/cache/hero_geo.abc", body: "oABC1234\nplaceholder alembic stream\n" },
    { file: "publish/usd/hero.usda", body: '#usda 1.0\n(\n    defaultPrim = "hero"\n)\n' },
    { file: "texture/hero_body_basecolor.png", body: "\u0089PNG\r\n\u001a\n placeholder\n" },
  ];
  for (const sample of samples) {
    const target = join(assetLibraryPath, sample.file);
    if (existsSync(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, sample.body, "utf8");
  }
}

export async function ensureVaultSeed() {
  await withWriteLock(async () => {
    const config = await readConfig();
    if (config.categories.length && config.assets.length && config.version >= 2) return;

    const timestamp = now();
    const categories = config.categories.length
      ? config.categories
      : categorySeeds.map((seed) => ({ ...seed, id: randomUUID(), createdAt: timestamp, updatedAt: timestamp }));
    const getCategoryId = (name: string) => categories.find((category) => category.name === name)?.id ?? null;

    const needsTextSeed = config.assets.length === 0;
    // needsFileLayer：老版本 config（version < 2）没有文件资产与别名机制，这里增量补齐，
    // 不会覆盖用户已有的文本资产。
    if (needsTextSeed || config.version < 2) {
      await seedLibrarySamples();
      const aliases = await getPathAliases();
      const rel = (aliasKey: string, path: string) => (aliases.find((alias) => alias.key === aliasKey) ? path : path);
      type SeedAsset = {
        title: string;
        category: string;
        kind: string;
        language: string;
        mediaKind: string;
        tags: string[];
        content: string;
        revision: number;
        isFavorite?: boolean;
        package?: { dcc: string; packageKind: string; moduleName: string; importPath: string };
        deploy?: DeployPlanDTO;
        files?: SeedFile[];
      };
      type SeedFile = { name: string; aliasKey: string | null; path: string; category: string };
      type SeedFileAsset = Omit<SeedAsset, "kind" | "language"> & { files: SeedFile[]; tech: Record<string, string> };

      const textAssets: SeedAsset[] = [
        {
          title: "智能发布 — Alembic 缓存导出",
          category: "Maya",
          kind: "Executable",
          language: "Python",
          mediaKind: "其他",
          tags: ["发布", "缓存", "管线", "批处理"],
          content: `import maya.cmds as cmds
from pathlib import Path

def publish_alembic(output_dir: str):
    """按当前场景名导出 Alembic 缓存，返回目标路径。"""
    scene = Path(cmds.file(q=True, sn=True))
    cache_name = scene.stem + "_geo.abc"
    target = Path(output_dir) / cache_name
    cmds.AbcExport(j=f"-frameRange 1 120 -uvWrite -file {target}")
    return target

print(publish_alembic("$PUB/cache"))`,
          revision: 4,
          isFavorite: true,
        },
        {
          title: "属性散布工具包（Point Wrangle）",
          category: "Houdini",
          kind: "Snippet",
          language: "VEX",
          mediaKind: "其他",
          tags: ["点属性", "散布", "程序化"],
          content: `// Point wrangle —— 确定性属性散布
int seed = chi("seed");
float density = fit01(rand(@ptnum + seed), 0.15, 1.0);
f@pscale = density * chf("scale");
v@Cd = chramp("palette", rand(@ptnum * 17 + seed));`,
          revision: 2,
          isFavorite: true,
        },
        {
          title: "贴图路径批量重链",
          category: "Blender",
          kind: "Executable",
          language: "Python",
          mediaKind: "其他",
          tags: ["贴图", "路径", "生产环境"],
          content: `import bpy
from pathlib import Path

# 将所有外部贴图重新指向当前项目的规范目录
ROOT = Path("$TEX")
for image in bpy.data.images:
    if image.source == 'FILE':
        image.filepath = str(ROOT / Path(image.filepath).name)
        image.reload()`,
          revision: 8,
        },
        {
          title: "镜头交接检查表",
          category: "全局通用",
          kind: "Reference",
          language: "Markdown",
          mediaKind: "其他",
          tags: ["交接", "审核", "流程"],
          content: `# 镜头交接检查表

- [ ] 工作文件已升版本
- [ ] 校验帧范围与摄像机
- [ ] 导出缓存并核对路径
- [ ] 检查引用文件的发布路径
- [ ] 附上预览视频并通知下游部门`,
          revision: 3,
        },
        {
          title: "my_rig_tools 绑定工具包（Maya 多文件模块）",
          category: "Maya",
          kind: "Executable",
          language: "Python",
          mediaKind: "其他",
          tags: ["maya", "rigging", "工具包", "模块"],
          content: `绑定工具集，包含多个模块文件。

安装：把整个 my_rig_tools 目录放进 Maya 用户脚本目录
调用：shelf 按钮执行 import my_rig_tools; my_rig_tools.main()`,
          package: { dcc: "Maya", packageKind: "多文件包 / 模块", moduleName: "my_rig_tools", importPath: "scripts/my_rig_tools" },
          deploy: {
            dcc: "Maya",
            installTarget: "maya-scripts",
            installSubpath: "scripts/my_rig_tools",
            installMethod: "symlink",
            hasEntry: true,
            entryPoint: "main",
            callContext: "shelf",
            invocation: "import my_rig_tools\nmy_rig_tools.main()",
            createdAt: "",
            updatedAt: "",
          },
          files: [
            { name: "__init__.py", aliasKey: "SHOW", path: "tools/my_rig_tools/__init__.py", category: "配置" },
            { name: "rig_utils.py", aliasKey: "SHOW", path: "tools/my_rig_tools/rig_utils.py", category: "配置" },
            { name: "ui.py", aliasKey: "SHOW", path: "tools/my_rig_tools/ui.py", category: "配置" },
          ],
          revision: 2,
          isFavorite: true,
        },
      ];

      const fileAssets: SeedFileAsset[] = [
        {
          title: "Hero 角色模型（FBX 交付包）",
          category: "Maya",
          mediaKind: "模型",
          tags: ["角色", "模型", "fbx", "交付"],
          content: `交付说明

• 命名规范：hero_<部位>_<版本>
• 单位 cm，Y-up，冻结变换后导出
• 引用材质使用 $TEX 下的共享贴图`,
          files: [
            { name: "hero_body.fbx", aliasKey: "PUB", path: rel("PUB", "model/hero_body.fbx"), category: "模型" },
            { name: "hero_eyes.fbx", aliasKey: "PUB", path: rel("PUB", "model/hero_eyes.fbx"), category: "模型" },
          ],
          tech: { frameRange: "—", unitScale: "cm", upAxis: "Y-up", reference: "Reference" },
          revision: 3,
          isFavorite: true,
        },
        {
          title: "Hero 走路动画（BVH）",
          category: "全局通用",
          mediaKind: "动画",
          tags: ["动捕", "bvh", "走路"],
          content: `动捕原始数据，已清理抖动；重定向到 hero_rig 前请先确认骨骼命名。`,
          files: [{ name: "hero_walk.bvh", aliasKey: "PUB", path: rel("PUB", "anim/hero_walk.bvh"), category: "动画" }],
          tech: { frameRange: "1-48", fps: "30", upAxis: "Y-up" },
          revision: 2,
        },
        {
          title: "Hero 几何缓存（Alembic）",
          category: "Houdini",
          mediaKind: "缓存几何",
          tags: ["abc", "缓存", "sim"],
          content: `布料 + 头发双缓存，帧范围 1-120，包含 uvWrite 与 velocity 通道。`,
          files: [
            { name: "hero_geo.abc", aliasKey: "PUB", path: rel("PUB", "cache/hero_geo.abc"), category: "缓存几何" },
            { name: "hero_sim_final.abc", aliasKey: "SHOW", path: rel("SHOW", "fx/cache/hero_sim_final.abc"), category: "缓存几何" },
          ],
          tech: { frameRange: "1-120", fps: "24", unitScale: "cm" },
          revision: 5,
        },
        {
          title: "Hero USD 装配（Stage）",
          category: "Unreal Engine",
          mediaKind: "装配/引用",
          tags: ["usd", "装配", "onefile"],
          content: `Stage 结构：hero/geo（Payload）+ hero/material（Reference）。缺失文件通常是贴图别名未配置。`,
          files: [
            { name: "hero.usda", aliasKey: "PUB", path: rel("PUB", "usd/hero.usda"), category: "装配/引用" },
            { name: "hero_body_basecolor.png", aliasKey: "TEX", path: rel("TEX", "hero_body_basecolor.png"), category: "贴图/序列帧" },
          ],
          tech: { lod: "LOD0-LOD3", reference: "Payload" },
          revision: 1,
        },
        {
          title: "Hero 绑定工程（Maya 场景）",
          category: "Maya",
          mediaKind: "场景工程",
          tags: ["rig", "绑定", "工程"],
          content: `工作区场景，包含 build 与 anim 两套命名空间。`,
          files: [{ name: "hero_rig.ma", aliasKey: "SHOW", path: rel("SHOW", "character/hero_rig.ma"), category: "场景工程" }],
          tech: { upAxis: "Y-up", unitScale: "cm" },
          revision: 6,
        },
      ];

      const assets: AssetRecord[] = needsTextSeed ? [] : [...config.assets];
      for (const seed of needsTextSeed ? textAssets : []) {
        const id = randomUUID();
        const contentFile = `${id}.json`;
        assets.push({
          id,
          title: seed.title,
          categoryId: getCategoryId(seed.category),
          kind: seed.kind,
          language: seed.language,
          mediaKind: seed.mediaKind,
          tags: seed.tags,
          links: [],
          files: (seed.files ?? []).map((file) => ({
            id: randomUUID(),
            name: file.name,
            ext: extOf(file.name),
            category: file.category,
            aliasKey: file.aliasKey,
            path: file.path,
            size: null,
            checksum: null,
            checksumAlgo: null,
            publishedAt: null,
            note: "",
          })),
          tech: {},
          package: seed.package ?? packageDefaults(),
          deploy: seed.deploy ?? null,
          revision: seed.revision,
          isFavorite: Boolean(seed.isFavorite),
          contentFile,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: null,
        });
        const history: StoredRevision[] = seed.title.startsWith("智能发布")
          ? [
              { revision: 2, content: "# 管线发布工具初始版本\n# 使用当前场景名生成缓存路径。", saved_at: timestamp, change_note: "初始原型" },
              { revision: 3, content: "import maya.cmds as cmds\n# 发布前增加场景校验。", saved_at: timestamp, change_note: "新增场景校验" },
            ]
          : [];
        await saveStoredText(contentFile, { content: seed.content, history });
      }

      const alreadyHasFileAssets = config.assets.some((item) => item.kind === "File");
      for (const seed of alreadyHasFileAssets ? [] : fileAssets) {
        const id = randomUUID();
        const contentFile = `${id}.json`;
        const files: ManagedFile[] = seed.files.map((file) => ({
          id: randomUUID(),
          name: file.name,
          ext: extOf(file.name),
          category: file.category,
          aliasKey: file.aliasKey,
          path: file.path,
          size: null,
          checksum: null,
          checksumAlgo: null,
          publishedAt: null,
          note: "",
        }));
        assets.push({
          id,
          title: seed.title,
          categoryId: getCategoryId(seed.category),
          kind: "File",
          language: "File",
          mediaKind: seed.mediaKind,
          tags: seed.tags,
          links: [],
          files,
          tech: seed.tech,
          package: packageDefaults(),
          deploy: null,
          revision: seed.revision,
          isFavorite: Boolean(seed.isFavorite),
          contentFile,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastOpenedAt: null,
        });
        await saveStoredText(contentFile, {
          content: seed.content,
          history: [{ revision: Math.max(1, seed.revision - 1), content: "（上一版发布说明）", saved_at: timestamp, change_note: "路径调整", files }],
        });
      }

      await saveConfig({ version: 2, categories, assets });
      return;
    }

    await saveConfig({ ...config, categories });
  });
}

export async function getVaultSnapshot() {
  await ensureVaultSeed();
  const [config, aliases] = await Promise.all([readConfig(), getPathAliases()]);
  const categories = [...config.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-CN"));
  const assets = await Promise.all(
    config.assets.map(async (asset) => buildAssetDTO(asset, config.categories, aliases, await readStoredText(asset.contentFile))),
  );
  assets.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  return { categories: categories.map((category) => ({ ...category })), assets, aliases };
}

export async function getAssetById(id: string) {
  await ensureVaultSeed();
  const [config, aliases] = await Promise.all([readConfig(), getPathAliases()]);
  const asset = config.assets.find((item) => item.id === id);
  if (!asset) return null;
  return buildAssetDTO(asset, config.categories, aliases, await readStoredText(asset.contentFile));
}

export async function getAssetHistory(id: string): Promise<RevisionDTO[]> {
  await ensureVaultSeed();
  const config = await readConfig();
  const asset = config.assets.find((item) => item.id === id);
  if (!asset) return [];
  const stored = await readStoredText(asset.contentFile);
  return stored.history
    .slice()
    .reverse()
    .map((revision) => ({
      id: `${asset.id}-${revision.revision}`,
      revision: revision.revision,
      content: revision.content,
      savedAt: revision.saved_at,
      changeNote: revision.change_note,
      files: revision.files ?? null,
      deploy: revision.deploy ?? null,
    }));
}

function requireTitle(value: unknown, fallback = "") {
  const title = textValue(value, fallback);
  if (!title) throw new VaultError(400, "请填写资产标题。");
  if (title.length > 180) throw new VaultError(400, "标题长度不能超过 180 个字符。");
  return title;
}

async function requireAliasesExist(files: ManagedFile[]) {
  if (!files.some((file) => file.aliasKey)) return;
  const aliases = await getPathAliases();
  for (const file of files) {
    if (!file.aliasKey) continue;
    const alias = aliases.find((item) => item.key.toUpperCase() === file.aliasKey?.toUpperCase());
    if (!alias) throw new VaultError(400, `未定义路径别名 $${file.aliasKey}，请先在路径别名管理中创建。`);
  }
}

export async function createAsset(input: AssetInput) {
  return withWriteLock(async () => {
    const config = await readConfig();
    const title = requireTitle(input.title);
    const kind = textValue(input.kind, "Snippet").slice(0, 24);
    const categoryId = typeof input.categoryId === "string" ? input.categoryId || null : null;
    if (categoryId && !config.categories.some((category) => category.id === categoryId)) throw new VaultError(400, "所选软件空间已不存在，请重新选择。");
    const files = cleanFiles(input.files);
    await requireAliasesExist(files);

    const id = randomUUID();
    const timestamp = now();
    const contentFile = `${id}.json`;
    const shaped = shapeByKind(kind, {
      mediaKind: textValue(input.mediaKind, "其他").slice(0, 24),
      files,
      tech: cleanTech(input.tech),
      package: {
        dcc: textValue((input.package as Record<string, unknown> | undefined)?.dcc).slice(0, 40),
        packageKind: textValue((input.package as Record<string, unknown> | undefined)?.packageKind, "单文件脚本").slice(0, 20),
        moduleName: textValue((input.package as Record<string, unknown> | undefined)?.moduleName).slice(0, 120),
        importPath: textValue((input.package as Record<string, unknown> | undefined)?.importPath).slice(0, 200),
      },
      deploy: cleanDeploy(input.deploy),
    });

    const asset: AssetRecord = {
      id,
      title,
      categoryId,
      kind,
      language: textValue(input.language, kind === "File" ? "File" : "Python").slice(0, 32),
      mediaKind: shaped.mediaKind,
      tags: cleanTags(input.tags),
      links: cleanLinks(input.links),
      files: shaped.files,
      tech: shaped.tech,
      package: shaped.package,
      deploy: shaped.deploy,
      revision: 1,
      isFavorite: Boolean(input.isFavorite),
      contentFile,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastOpenedAt: null,
    };
    await saveStoredText(contentFile, { content: typeof input.content === "string" ? input.content : "", history: [] });
    await saveConfig({ version: 2, categories: config.categories, assets: [asset, ...config.assets] });
    return buildAssetDTO(asset, config.categories, await getPathAliases(), await readStoredText(contentFile));
  });
}

export async function updateAsset(id: string, input: AssetInput) {
  return withWriteLock(async () => {
    const config = await readConfig();
    const index = config.assets.findIndex((item) => item.id === id);
    if (index < 0) throw new VaultError(404, "该资产不存在或已被删除。");
    if (!Number.isInteger(input.revision)) throw new VaultError(400, "缺少版本号，无法安全保存。");

    const current = config.assets[index];
    if (current.revision !== input.revision) {
      throw new VaultError(409, `该资产已在其他页面更新，服务器当前版本为 v${current.revision}，请刷新后再保存。`);
    }

    const stored = await readStoredText(current.contentFile);
    const title = requireTitle(input.title, current.title);
    const categoryId = typeof input.categoryId === "string" ? input.categoryId || null : current.categoryId;
    if (categoryId && !config.categories.some((category) => category.id === categoryId)) throw new VaultError(400, "所选软件空间已不存在，请重新选择。");

    const kind = textValue(input.kind, current.kind).slice(0, 24);
    const files = input.files === undefined ? current.files : cleanFiles(input.files);
    if (input.files !== undefined) await requireAliasesExist(files);
    const pkg = input.package === undefined ? current.package : {
      dcc: textValue((input.package as Record<string, unknown> | undefined)?.dcc).slice(0, 40),
      packageKind: textValue((input.package as Record<string, unknown> | undefined)?.packageKind, "单文件脚本").slice(0, 20),
      moduleName: textValue((input.package as Record<string, unknown> | undefined)?.moduleName).slice(0, 120),
      importPath: textValue((input.package as Record<string, unknown> | undefined)?.importPath).slice(0, 200),
    };
    const shaped = shapeByKind(kind, {
      mediaKind: textValue(input.mediaKind, current.mediaKind).slice(0, 24),
      files,
      tech: input.tech === undefined ? current.tech : cleanTech(input.tech),
      package: pkg,
      deploy: input.deploy === undefined ? current.deploy : cleanDeploy(input.deploy),
    });
    const content = typeof input.content === "string" ? input.content : stored.content;
    // 内容、文件清单、部署计划任一变，都应当生成新版本，保证版本号能代表完整状态。
    const contentChanged =
      content !== stored.content
      || JSON.stringify(shaped.files) !== JSON.stringify(current.files)
      || JSON.stringify(shaped.deploy) !== JSON.stringify(current.deploy)
      || JSON.stringify(shaped.package) !== JSON.stringify(current.package);

    const timestamp = now();
    const nextRevision = contentChanged ? current.revision + 1 : current.revision;
    const nextStored: StoredText = {
      content,
      history: contentChanged
        ? [
            ...stored.history,
            {
              content: stored.content,
              saved_at: timestamp,
              revision: current.revision,
              change_note: textValue(input.changeNote).slice(0, 280),
              files: current.files,
              deploy: current.deploy,
            },
          ].slice(-maxHistory)
        : stored.history,
    };
    const updated: AssetRecord = {
      ...current,
      title,
      categoryId,
      kind,
      language: textValue(input.language, current.language).slice(0, 32),
      mediaKind: shaped.mediaKind,
      tags: input.tags === undefined ? current.tags : cleanTags(input.tags),
      links: input.links === undefined ? current.links : cleanLinks(input.links),
      files: shaped.files,
      tech: shaped.tech,
      package: shaped.package,
      deploy: shaped.deploy,
      revision: nextRevision,
      isFavorite: typeof input.isFavorite === "boolean" ? input.isFavorite : current.isFavorite,
      updatedAt: timestamp,
      lastOpenedAt: timestamp,
    };

    if (contentChanged) await saveStoredText(current.contentFile, nextStored);
    config.assets[index] = updated;
    await saveConfig({ version: 2, categories: config.categories, assets: config.assets });
    return buildAssetDTO(updated, config.categories, await getPathAliases(), contentChanged ? nextStored : stored);
  });
}

export async function deleteAsset(id: string) {
  return withWriteLock(async () => {
    const config = await readConfig();
    const asset = config.assets.find((item) => item.id === id);
    if (!asset) throw new VaultError(404, "该资产不存在或已被删除。");
    await saveConfig({ version: config.version, categories: config.categories, assets: config.assets.filter((item) => item.id !== id) });
    try {
      await unlink(join(storedTextsPath, asset.contentFile));
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  });
}

export async function createCategory(input: AssetInput): Promise<CategoryDTO> {
  return withWriteLock(async () => {
    const config = await readConfig();
    const name = textValue(input.name);
    if (!name) throw new VaultError(400, "请填写软件空间名称。");
    if (name.length > 80) throw new VaultError(400, "名称长度不能超过 80 个字符。");
    if (config.categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) throw new VaultError(409, "已存在同名软件空间，请换一个名称。");
    const timestamp = now();
    const validColors = new Set(["#94a3b8", "#fb923c", "#f87171", "#60a5fa", "#a78bfa", "#34d399", "#fbbf24", "#f472b6"]);
    const category: CategoryDTO = {
      id: randomUUID(),
      name,
      description: textValue(input.description).slice(0, 240),
      color: typeof input.color === "string" && validColors.has(input.color) ? input.color : "#34d399",
      icon: "box",
      sortOrder: typeof input.sortOrder === "number" ? input.sortOrder : 99,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveConfig({ version: 2, categories: [...config.categories, category], assets: config.assets });
    return category;
  });
}

export async function createPathAlias(input: AssetInput): Promise<PathAliasDTO> {
  return withWriteLock(async () => {
    const config = await readAliasConfig();
    const key = textValue(input.key).toUpperCase().replace(/[^A-Z0-9_.-]/g, "");
    const root = textValue(input.root);
    if (!/^[A-Z][A-Z0-9_.-]{0,31}$/.test(key)) throw new VaultError(400, "别名需以字母开头，仅包含大写字母、数字、下划线或点，长度不超过 32。");
    if (!root) throw new VaultError(400, "请填写根路径。");
    if (config.aliases.some((alias) => alias.key === key)) throw new VaultError(409, `别名 $${key} 已存在。`);
    const timestamp = now();
    const alias: PathAliasDTO = {
      id: randomUUID(),
      key,
      label: textValue(input.label).slice(0, 80) || key,
      root,
      note: textValue(input.note).slice(0, 240),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await saveAliases({ version: 1, aliases: [...config.aliases, alias] });
    return alias;
  });
}

export async function updatePathAlias(id: string, input: AssetInput): Promise<PathAliasDTO> {
  return withWriteLock(async () => {
    const config = await readAliasConfig();
    const index = config.aliases.findIndex((alias) => alias.id === id);
    if (index < 0) throw new VaultError(404, "该路径别名不存在。");
    const current = config.aliases[index];
    const key = input.key === undefined ? current.key : textValue(input.key).toUpperCase().replace(/[^A-Z0-9_.-]/g, "");
    if (!/^[A-Z][A-Z0-9_.-]{0,31}$/.test(key)) throw new VaultError(400, "别名格式不合法。");
    if (config.aliases.some((alias, aliasIndex) => aliasIndex !== index && alias.key === key)) throw new VaultError(409, `别名 $${key} 已存在。`);
    const updated: PathAliasDTO = {
      ...current,
      key,
      label: input.label === undefined ? current.label : textValue(input.label).slice(0, 80) || key,
      root: input.root === undefined ? current.root : textValue(input.root),
      note: input.note === undefined ? current.note : textValue(input.note).slice(0, 240),
      enabled: input.enabled === undefined ? current.enabled : Boolean(input.enabled),
      updatedAt: now(),
    };
    if (!updated.root) throw new VaultError(400, "根路径不能为空。");
    config.aliases[index] = updated;
    await saveAliases({ version: 1, aliases: config.aliases });
    return updated;
  });
}

export async function deletePathAlias(id: string) {
  return withWriteLock(async () => {
    const config = await readAliasConfig();
    const target = config.aliases.find((alias) => alias.id === id);
    if (!target) throw new VaultError(404, "该路径别名不存在。");
    const vault = await readConfig();
    const used = vault.assets.filter((asset) => asset.files.some((file) => file.aliasKey === target.key));
    if (used.length) throw new VaultError(409, `该别名仍被 ${used.length} 个资产引用，请先调整这些文件路径。`);
    await saveAliases({ version: 1, aliases: config.aliases.filter((alias) => alias.id !== id) });
  });
}

/** 供编辑器使用：解析并校验一批路径。 */
export async function checkPaths(entries: unknown, withHash = false) {
  const aliases = await getPathAliases();
  const list = Array.isArray(entries) ? entries : [];
  const results = await Promise.all(
    list.slice(0, 60).map(async (entry) => {
      const raw = typeof entry === "string" ? { path: entry } : ((entry ?? {}) as Record<string, unknown>);
      const aliasKey = textValue(raw.aliasKey).toUpperCase() || null;
      const template = textValue(raw.path);
      const file: ManagedFile = {
        id: "check",
        name: template.split(/[\\/]/).pop() ?? template,
        ext: extOf(template),
        category: "其他",
        aliasKey,
        path: aliasKey ? template.replace(new RegExp(`^\\$?\\{?${aliasKey}\\}?[\\\\/]`), "") : template,
        size: null,
        checksum: null,
        checksumAlgo: null,
        publishedAt: null,
        note: "",
      };
      const status = await statTarget(resolvePath(file, aliases));
      let checksum: { digest: string; size: number; algorithm: string } | null = null;
      let hashError: string | null = null;
      if (withHash && status.exists && !status.isDirectory) {
        try {
          checksum = await hashFile(status.resolvedPath);
        } catch (error) {
          hashError = error instanceof VaultError ? error.message : "校验和计算失败。";
        }
      }
      return { ...status, checksum: checksum?.digest ?? null, checksumAlgo: checksum?.algorithm ?? null, hashError };
    }),
  );
  return results;
}

/** 目录浏览：供编辑器从共享目录直接挑选文件。 */
export async function scanDirectory(target: unknown, options: { extensions?: unknown; includeDirectories?: unknown } = {}) {
  const aliases = await getPathAliases();
  const raw = typeof target === "string" ? { path: target } : ((target ?? {}) as Record<string, unknown>);
  const aliasKey = textValue(raw.aliasKey).toUpperCase() || null;
  const template = textValue(raw.path);
  const parsed = parsePathTemplate(template);
  const usedKey = aliasKey ?? parsed.aliasKey;
  if (!template && !usedKey) throw new VaultError(400, "请填写要浏览的目录路径，或先选择一个路径别名。");
  let dir = parsed.relative;
  if (usedKey) {
    const alias = aliases.find((item) => item.key === usedKey);
    if (!alias) throw new VaultError(400, `未定义路径别名 $${usedKey}。`);
    dir = joinNative(alias.root, parsed.relative);
  }
  if (!dir) throw new VaultError(400, "请填写要浏览的目录路径。");
  if (!existsSync(dir)) throw new VaultError(404, `目录不存在：${dir}`);
  const info = await stat(dir);
  if (!info.isDirectory()) throw new VaultError(400, "该路径不是目录。");

  const allow = Array.isArray(options.extensions)
    ? options.extensions.filter((ext): ext is string => typeof ext === "string").map((ext) => ext.toLowerCase().replace(/^\./, ""))
    : [];
  const includeDirectories = options.includeDirectories === undefined ? true : Boolean(options.includeDirectories);
  const names = await readdir(dir, { withFileTypes: true });
  const entries = await Promise.all(
    names
      .filter((entry) => !entry.name.startsWith("."))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, "zh-CN"))
      .map(async (entry) => {
        const fullPath = joinNative(dir, entry.name);
        try {
          const child = await stat(fullPath);
          return {
            name: entry.name,
            path: fullPath,
            ext: extOf(entry.name),
            category: extInfo(extOf(entry.name)).category,
            size: entry.isDirectory() ? null : child.size,
            modifiedAt: child.mtime.toISOString(),
            isDirectory: entry.isDirectory(),
          } satisfies ScanEntry;
        } catch {
          return { name: entry.name, path: fullPath, ext: extOf(entry.name), category: "其他", size: null, modifiedAt: null, isDirectory: entry.isDirectory() } satisfies ScanEntry;
        }
      }),
  );
  const filtered = entries.filter((entry) => (entry.isDirectory ? includeDirectories : allow.length === 0 || allow.includes(entry.ext)));
  return { directory: dir, entries: filtered };
}
