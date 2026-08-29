/**
 * 纯数据 + 纯函数模块：不含任何 Node 内置 API，因此服务端与客户端组件都可安全导入。
 */

export type PathAliasDTO = {
  id: string;
  key: string;
  label: string;
  root: string;
  note: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type MediaKind =
  | "模型"
  | "动画"
  | "缓存几何"
  | "装配/引用"
  | "场景工程"
  | "贴图/序列帧"
  | "特效体积"
  | "配置"
  | "预览影片"
  | "其他";

export const MEDIA_KINDS: MediaKind[] = [
  "模型",
  "动画",
  "缓存几何",
  "装配/引用",
  "场景工程",
  "贴图/序列帧",
  "特效体积",
  "配置",
  "预览影片",
  "其他",
];

export type ExtInfo = {
  label: string;
  category: MediaKind;
  dcc: string;
  binary: boolean;
};

/** 资产格式细分目录：扩展名 → 说明、归类、所属 DCC、是否二进制。 */
export const EXT_CATALOG: Record<string, ExtInfo> = {
  fbx: { label: "FBX 交换格式", category: "模型", dcc: "Maya / MotionBuilder", binary: true },
  bvh: { label: "BVH 骨骼动画", category: "动画", dcc: "MotionBuilder / Houdini", binary: false },
  c3d: { label: "C3D 动捕数据", category: "动画", dcc: "Vicon / MotionBuilder", binary: true },
  abc: { label: "Alembic 缓存", category: "缓存几何", dcc: "Houdini / Maya", binary: true },
  vrmap: { label: "Alembic 顶点映射", category: "缓存几何", dcc: "Houdini", binary: true },
  usd: { label: "USD 场景", category: "装配/引用", dcc: "Unreal / Houdini / Karma", binary: true },
  usda: { label: "USD ASCII", category: "装配/引用", dcc: "Houdini / Karma", binary: false },
  usdc: { label: "USD 二进制", category: "装配/引用", dcc: "Unreal / Karma", binary: true },
  usdz: { label: "USD 打包包", category: "装配/引用", dcc: "Unreal / Stage Manager", binary: true },
  udims: { label: "Udim 贴图集", category: "贴图/序列帧", dcc: "Mari / Substance", binary: false },
  ma: { label: "Maya ASCII 场景", category: "场景工程", dcc: "Maya", binary: false },
  mb: { label: "Maya 二进制场景", category: "场景工程", dcc: "Maya", binary: true },
  hip: { label: "Houdini 工程", category: "场景工程", dcc: "Houdini", binary: true },
  hipnc: { label: "Houdini 加密工程", category: "场景工程", dcc: "Houdini", binary: true },
  hiplc: { label: "Houdini 许可工程", category: "场景工程", dcc: "Houdini", binary: true },
  blend: { label: "Blender 工程", category: "场景工程", dcc: "Blender", binary: true },
  max: { label: "3ds Max 场景", category: "场景工程", dcc: "3ds Max", binary: true },
  ztl: { label: "ZTool", category: "模型", dcc: "ZBrush", binary: false },
  sbsar: { label: "Substance 参数材质", category: "贴图/序列帧", dcc: "Substance Designer", binary: true },
  txt: { label: "纯文本", category: "配置", dcc: "通用", binary: false },
  json: { label: "JSON 配置", category: "配置", dcc: "通用", binary: false },
  yaml: { label: "YAML 配置", category: "配置", dcc: "通用", binary: false },
  toml: { label: "TOML 配置", category: "配置", dcc: "通用", binary: false },
  ini: { label: "INI 配置", category: "配置", dcc: "通用", binary: false },
  py: { label: "Python 脚本", category: "配置", dcc: "Maya / Blender / Houdini", binary: false },
  mel: { label: "MEL 脚本", category: "配置", dcc: "Maya", binary: false },
  vex: { label: "VEX 代码", category: "配置", dcc: "Houdini", binary: false },
  hscript: { label: "HScript", category: "配置", dcc: "Houdini", binary: false },
  glsl: { label: "GLSL 着色器", category: "配置", dcc: "引擎", binary: false },
  hlsl: { label: "HLSL 着色器", category: "配置", dcc: "Unreal / DirectX", binary: false },
  css: { label: "CSS 样式", category: "配置", dcc: "Web", binary: false },
  png: { label: "PNG 位图", category: "贴图/序列帧", dcc: "通用", binary: true },
  jpg: { label: "JPEG 位图", category: "贴图/序列帧", dcc: "通用", binary: true },
  jpeg: { label: "JPEG 位图", category: "贴图/序列帧", dcc: "通用", binary: true },
  tga: { label: "TGA 位图", category: "贴图/序列帧", dcc: "通用", binary: true },
  exr: { label: "OpenEXR 序列", category: "贴图/序列帧", dcc: "Nuke / Houdini", binary: true },
  tx: { label: "tx  tiled 贴图", category: "贴图/序列帧", dcc: "Arnold / RenderMan", binary: true },
  tif: { label: "TIFF 位图", category: "贴图/序列帧", dcc: "Mari / Nuke", binary: true },
  mov: { label: "MOV 影片", category: "预览影片", dcc: "通用", binary: true },
  mp4: { label: "MP4 影片", category: "预览影片", dcc: "通用", binary: true },
  gif: { label: "GIF 动画", category: "预览影片", dcc: "通用", binary: true },
  pdf: { label: "PDF 文档", category: "其他", dcc: "通用", binary: true },
  md: { label: "Markdown 文档", category: "其他", dcc: "通用", binary: false },
  docx: { label: "Word 文档", category: "其他", dcc: "通用", binary: true },
};

/** 侧栏/筛选用的常用格式分组。 */
export const FORMAT_GROUPS: { key: string; label: string; exts: string[] }[] = [
  { key: "model", label: "模型 / 交换", exts: ["fbx", "obj", "gltf", "glb", "ztl"] },
  { key: "anim", label: "动画 / 动捕", exts: ["bvh", "c3d"] },
  { key: "cache", label: "几何缓存", exts: ["abc", "vrmap", "vdb"] },
  { key: "usd", label: "USD 装配", exts: ["usd", "usda", "usdc", "usdz", "udims"] },
  { key: "scene", label: "DCC 工程", exts: ["ma", "mb", "hip", "hipnc", "hiplc", "blend", "max"] },
  { key: "map", label: "贴图 / 序列", exts: ["png", "jpg", "jpeg", "tga", "exr", "tx", "tif", "sbsar"] },
  { key: "movie", label: "预览影片", exts: ["mov", "mp4", "gif"] },
];

export function extOf(nameOrPath: string) {
  const clean = String(nameOrPath ?? "").split(/[\\/]/).pop() ?? "";
  const dot = clean.lastIndexOf(".");
  if (dot <= 0 || dot === clean.length - 1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

export function extInfo(ext: string): ExtInfo {
  return EXT_CATALOG[ext] ?? { label: ext ? `.${ext} 文件` : "未知格式", category: "其他", dcc: "通用", binary: true };
}

export function formatBytes(size: number | null | undefined) {
  if (size === null || size === undefined) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function pathBasename(path: string) {
  return String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? String(path ?? "");
}

export function parentPath(path: string) {
  const clean = String(path ?? "").replace(/[\\/]+$/, "");
  const index = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return index <= 2 ? clean : clean.slice(0, index);
}

/** 使用原生分隔符拼接，避免 UNC 与 Windows 路径被写歪。 */
export function joinNative(root: string, relative: string) {
  const rel = String(relative ?? "").replace(/^[\\/]+/, "").replace(/[\\/]+/g, "/");
  const base = String(root ?? "").replace(/[\\/]+$/, "");
  if (!rel) return base;
  const useBackslash = base.includes("\\") && !base.includes("/");
  return useBackslash ? `${base}\\${rel.replaceAll("/", "\\")}` : `${base}/${rel}`;
}

export type ParsedTemplate = {
  aliasKey: string | null;
  relative: string;
  absolute: boolean;
  unc: boolean;
  usesBraces: boolean;
};

/** 解析 `$PROJ/mesh/hero.fbx`、`{PROJ}/mesh/x.fbx`、`\\server\share\...`、`/show/...`。 */
export function parsePathTemplate(template: string): ParsedTemplate {
  const raw = String(template ?? "").trim();
  const unc = raw.startsWith("\\\\") || raw.startsWith("//");
  const absolute = unc || raw.startsWith("/") || /^[A-Za-z]:[\\/]/.test(raw);
  const braceMatch = /^\{([A-Za-z0-9_.-]+)\}([\\/]|$)/.exec(raw);
  if (braceMatch) {
    return { aliasKey: braceMatch[1].toUpperCase(), relative: raw.slice(braceMatch[0].length), absolute: true, unc, usesBraces: true };
  }
  // 只有显式写 `$KEY/...` 才当作别名，避免把 `model/hero.fbx` 误判成 `$MODEL`。
  const dollarMatch = /^\$\{([A-Za-z_][A-Za-z0-9_.-]*)\}([\\/].*)?$|^\$([A-Za-z_][A-Za-z0-9_.-]*)([\\/].*)?$/.exec(raw);
  if (dollarMatch) {
    const key = (dollarMatch[1] ?? dollarMatch[3]).toUpperCase();
    const relative = String(dollarMatch[2] ?? dollarMatch[4] ?? "").replace(/^[\\/]+/, "");
    return { aliasKey: key, relative, absolute: false, unc: false, usesBraces: raw.startsWith("${") };
  }
  return { aliasKey: null, relative: raw.replace(/^[\\/]+/, ""), absolute, unc, usesBraces: false };
}

/** 用于表单提示：这条路径会被解析成什么。 */
export function resolveTemplate(template: string, aliases: PathAliasDTO[]) {
  const parsed = parsePathTemplate(template);
  if (!parsed.aliasKey) return { resolved: template, aliasKey: null as string | null, error: null as string | null };
  const alias = aliases.find((item) => item.key.toUpperCase() === parsed.aliasKey);
  if (!alias) return { resolved: template, aliasKey: parsed.aliasKey, error: `未定义路径别名 $${parsed.aliasKey}` };
  if (!alias.enabled) return { resolved: template, aliasKey: parsed.aliasKey, error: `路径别名 $${parsed.aliasKey} 已停用` };
  return { resolved: joinNative(alias.root, parsed.relative), aliasKey: parsed.aliasKey, error: null };
}

export function templateForDisplay(aliasKey: string | null, relative: string) {
  if (!aliasKey) return relative;
  return `$${aliasKey}${relative ? `/${relative.replace(/^[\\/]+/, "")}` : ""}`;
}

export const TECH_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: "frameRange", label: "帧范围", placeholder: "1-120" },
  { key: "fps", label: "帧率", placeholder: "24 / 30 / 48" },
  { key: "unitScale", label: "单位", placeholder: "cm / m / inch" },
  { key: "upAxis", label: "上轴", placeholder: "Y-up / Z-up" },
  { key: "lod", label: "LOD 层级", placeholder: "LOD0-LOD3" },
  { key: "reference", label: "引用策略", placeholder: "Reference / Payload / Export" },
];

export const ASSET_TYPES = [
  { value: "Snippet", label: "代码片段" },
  { value: "Executable", label: "可执行脚本" },
  { value: "Reference", label: "参考链接" },
  { value: "File", label: "文件资产" },
] as const;

export function assetTypeLabel(kind: string) {
  return ASSET_TYPES.find((item) => item.value === kind)?.label ?? kind;
}

export function isFileType(kind: string) {
  return kind === "File";
}

export type FileStatusTone = "present" | "missing" | "unknown" | "error";

export function statusTone(exists: boolean | null, error: string | null): FileStatusTone {
  if (error) return "error";
  if (exists === null || exists === undefined) return "unknown";
  return exists ? "present" : "missing";
}
