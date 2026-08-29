"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileCode2,
  FolderOpen,
  FolderTree,
  History,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Ruler,
  ScanLine,
  TerminalSquare,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import {
  ASSET_TYPES,
  MEDIA_KINDS,
  TECH_FIELDS,
  extInfo,
  extOf,
  formatBytes,
  joinNative,
  parentPath,
  pathBasename,
  templateForDisplay,
  type PathAliasDTO,
} from "@/lib/asset-catalog";
import { PackagePlus, PanelTopOpen, Wrench, PlayCircle } from "lucide-react";
import {
  CALL_CONTEXTS,
  INSTALL_METHODS,
  INSTALL_TARGETS,
  installTargetsFor,
  invocationSnippet,
  packageDescriptorSnippet,
  type DeployPlanDTO,
} from "@/lib/script-package";
import type { AssetDTO, CategoryDTO, ManagedFile, ManagedFileDTO, RevisionDTO } from "@/lib/vault";

type Tone = "success" | "error";

export type FileDraft = {
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
  resolvedPath?: string;
  exists?: boolean | null;
  statusError?: string | null;
  modifiedAt?: string | null;
};

export type EditorDraft = {
  title: string;
  categoryId: string | null;
  kind: string;
  language: string;
  mediaKind: string;
  tagsText: string;
  content: string;
  revision: number;
  isFavorite: boolean;
  links: { label: string; url: string }[];
  changeNote: string;
  files: FileDraft[];
  tech: Record<string, string>;
  pkg: { dcc: string; packageKind: string; moduleName: string; importPath: string };
  deploy: DeployPlanDTO | null;
};

const LANGUAGES = ["Python", "MEL", "VEX", "JavaScript", "C#", "JSON", "Markdown", "Text", "HLSL", "GLSL", "HScript", "C++"];

function fileFromDTO(file: ManagedFileDTO): FileDraft {
  return {
    id: file.id,
    name: file.name,
    ext: file.ext,
    category: file.category,
    aliasKey: file.aliasKey,
    path: file.path,
    size: file.size,
    checksum: file.checksum,
    checksumAlgo: file.checksumAlgo,
    publishedAt: file.publishedAt,
    note: file.note,
    resolvedPath: file.status.resolvedPath,
    exists: file.status.exists,
    statusError: file.status.error,
    modifiedAt: file.status.modifiedAt,
  };
}

/** 历史快照里的文件清单没有实时状态，恢复时标记为“未校验”。 */
function fileFromRevision(file: ManagedFile): FileDraft {
  return {
    id: file.id,
    name: file.name,
    ext: file.ext,
    category: file.category,
    aliasKey: file.aliasKey,
    path: file.path,
    size: file.size,
    checksum: file.checksum,
    checksumAlgo: file.checksumAlgo,
    publishedAt: file.publishedAt,
    note: file.note,
    resolvedPath: file.aliasKey ? `$${file.aliasKey}/${file.path}` : file.path,
    exists: null,
    statusError: null,
    modifiedAt: null,
  };
}

export function draftFromAsset(asset?: AssetDTO | null, categoryId?: string | null): EditorDraft {
  return {
    title: asset?.title ?? "",
    categoryId: asset?.categoryId ?? categoryId ?? null,
    kind: asset?.kind ?? "Snippet",
    language: asset?.language ?? "Python",
    mediaKind: asset?.mediaKind ?? "其他",
    tagsText: asset?.tags.join(", ") ?? "",
    content: asset?.content ?? "",
    revision: asset?.revision ?? 0,
    isFavorite: asset?.isFavorite ?? false,
    links: asset?.links ?? [],
    changeNote: "",
    files: asset?.files.map(fileFromDTO) ?? [],
    tech: asset?.tech ?? {},
    pkg: asset?.packageInfo ?? { dcc: "", packageKind: "单文件脚本", moduleName: "", importPath: "" },
    deploy: asset?.deploy ?? null,
  };
}

function signatureOf(files: FileDraft[]) {
  return files.map((file) => `${file.name}|${file.aliasKey ?? ""}|${file.path}|${file.category}|${file.note}|${file.checksum ?? ""}`).join("||");
}

/** 将服务器返回的绝对路径折回最匹配的别名，便于跨机器共享。 */
function foldIntoAlias(absPath: string, aliases: PathAliasDTO[]) {
  const normalized = absPath.replaceAll("\\", "/");
  const candidates = aliases
    .filter((alias) => alias.enabled)
    .map((alias) => ({ alias, root: alias.root.replaceAll("\\", "/").replace(/\/+$/, "") }))
    .filter((item) => item.root && normalized.startsWith(`${item.root}/`))
    .sort((a, b) => b.root.length - a.root.length);
  const best = candidates[0];
  if (!best) return { aliasKey: null as string | null, path: absPath };
  return { aliasKey: best.alias.key, path: normalized.slice(best.root.length + 1) };
}

export default function AssetEditor({
  asset,
  categories,
  aliases,
  onAliasesChanged,
  onSaved,
  onDeleted,
  onNotify,
  onClose,
}: {
  asset: AssetDTO | null;
  categories: CategoryDTO[];
  aliases: PathAliasDTO[];
  onAliasesChanged: (aliases: PathAliasDTO[]) => void;
  onSaved: (asset: AssetDTO, isNew: boolean) => void;
  onDeleted: (id: string) => void;
  onNotify: (message: string, tone?: Tone) => void;
  onClose: () => void;
}) {
  const id = asset?.id ?? null;
  const [draft, setDraft] = useState<EditorDraft>(() => draftFromAsset(asset));
  const [history, setHistory] = useState<RevisionDTO[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [loading, setLoading] = useState(Boolean(id));
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [browseAlias, setBrowseAlias] = useState<string>(aliases[0]?.key ?? "");
  const [browseEntries, setBrowseEntries] = useState<{ name: string; path: string; ext: string; size: number | null; isDirectory: boolean }[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // 记录“打开时”的文件清单签名，用于判断用户是否真的改过文件，而不是一直显示“已修改”。
  const [baselineFileSignature, setBaselineFileSignature] = useState<string | null>(id === null ? "" : null);

  const isFileAsset = draft.kind === "File";
  const isExecutable = draft.kind === "Executable";
  const isReference = draft.kind === "Reference";
  const isScriptLike = draft.kind === "Snippet" || isExecutable;

  // 能力开关：每种资产类型只暴露与自己相关的字段，避免代码资产出现帧范围/上轴这类文件专属参数。
  const isScriptPackage = isExecutable && draft.pkg.packageKind === "多文件包 / 模块";
  const supportsFiles = isFileAsset || isScriptPackage;   // 文件清单
  const supportsTech = isFileAsset;                        // 帧范围/帧率/单位/上轴等交付元数据
  const supportsMediaKind = isFileAsset;                   // 资产细分（模型/动画/缓存…）
  // 部署与调用只对「可执行脚本」开放；其它类型服务端会丢弃 deploy，UI 不应继续展示一个
  // 保存后必定丢失的配置区，否则用户会误以为配置已生效。
  const supportsDeploy = isExecutable;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!id) {
        setLoading(false);
        setBaselineFileSignature("");
        titleRef.current?.focus();
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`/api/vault/assets/${id}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "无法打开资产。");
        if (cancelled) return;
        const loaded = draftFromAsset(payload.asset);
        setDraft(loaded);
        setBaselineFileSignature(signatureOf(loaded.files));
        setHistory(payload.history ?? []);
      } catch (error) {
        if (!cancelled) onNotify(error instanceof Error ? error.message : "无法载入最新内容。", "error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const update = <K extends keyof EditorDraft>(key: K, value: EditorDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  const [descriptor, setDescriptor] = useState<string | null>(null);

  function ensureDeploy(): DeployPlanDTO {
    return draft.deploy ?? { dcc: draft.pkg.dcc, installTarget: null, installSubpath: "", installMethod: "copy", hasEntry: true, entryPoint: "main", callContext: "import", invocation: "", createdAt: "", updatedAt: "" };
  }

  const updateDeploy = (key: keyof DeployPlanDTO, value: string | boolean | null) => {
    const current = ensureDeploy();
    setDraft((d) => ({ ...d, deploy: { ...current, [key]: value } as DeployPlanDTO }));
  };

  const regenerateInvocation = () => {
    const deploy = ensureDeploy();
    const targetKey = deploy.installTarget ?? INSTALL_TARGETS.find((target) => target.dcc === draft.pkg.dcc)?.key ?? "";
    return invocationSnippet(targetKey, draft.pkg.moduleName, deploy.entryPoint, draft.language);
  };

  const generateDescriptor = () => {
    const deploy = ensureDeploy();
    const targetKey = deploy.installTarget ?? "";
    if (!targetKey) {
      onNotify("请先选择安装位置（例如 Maya 的 scripts/ 或 Houdini 的 packages/）。", "error");
      return;
    }
    const root = deploy.installSubpath || draft.pkg.importPath;
    const snippet = packageDescriptorSnippet(targetKey, draft.pkg.moduleName, root);
    setDescriptor(snippet);
    onNotify("已生成描述文件内容，可复制后放到对应目录。");
  };

  const updateFile = (fileId: string, patch: Partial<FileDraft>) =>
    setDraft((current) => ({
      ...current,
      files: current.files.map((file) => {
        if (file.id !== fileId) return file;
        const next = { ...file, ...patch };
        const ext = extOf(next.path || next.name);
        return { ...next, ext, category: patch.category ?? (next.category && next.category !== "其他" ? next.category : extInfo(ext).category) };
      }),
    }));

  const addFile = (init: Partial<FileDraft> = {}) => {
    const next: FileDraft = {
      id: `local-${Math.random().toString(36).slice(2, 10)}`,
      name: "",
      ext: "",
      category: "其他",
      aliasKey: aliases[0]?.key ?? null,
      path: "",
      size: null,
      checksum: null,
      checksumAlgo: null,
      publishedAt: null,
      note: "",
      exists: null,
      statusError: null,
      ...init,
    };
    setDraft((current) => ({ ...current, files: [...current.files, next] }));
  };

  const removeFile = (fileId: string) => setDraft((current) => ({ ...current, files: current.files.filter((file) => file.id !== fileId) }));

  const checkFiles = async (targets: FileDraft[], withHash = false) => {
    const usable = targets.filter((file) => file.path.trim() || file.aliasKey);
    if (!usable.length) {
      onNotify("请先填写至少一个文件路径。", "error");
      return;
    }
    setIsChecking(true);
    try {
      const response = await fetch("/api/vault/files/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          withHash,
          entries: usable.map((file) => ({ aliasKey: file.aliasKey, path: file.aliasKey ? file.path : file.path || file.resolvedPath })),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "路径校验失败。");
      const statuses = (result.results ?? []) as (NonNullable<ManagedFileDTO["status"]> & { checksum: string | null; checksumAlgo: string | null; hashError: string | null })[];
      const statusById = new Map(usable.map((file, index) => [file.id, statuses[index]]));
      setDraft((current) => ({
        ...current,
        files: current.files.map((file) => {
          const status = statusById.get(file.id);
          if (!status) return file;
          return {
            ...file,
            exists: status.exists,
            resolvedPath: status.resolvedPath,
            statusError: status.error,
            modifiedAt: status.modifiedAt,
            size: status.size ?? file.size,
            checksum: status.checksum ?? file.checksum,
            checksumAlgo: status.checksumAlgo ?? file.checksumAlgo,
          };
        }),
      }));
      const present = statuses.filter((status) => status.exists === true).length;
      const missing = statuses.filter((status) => status.exists === false).length;
      const failed = statuses.filter((status) => status.error).length;
      const hashMiss = withHash ? statuses.filter((status) => status.hashError).length : 0;
      const summary = `校验完成：存在 ${present} · 缺失 ${missing}${failed ? ` · 无法访问 ${failed}` : ""}${hashMiss ? ` · 未算校验和 ${hashMiss}` : ""}`;
      onNotify(summary, missing || failed ? "error" : "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "路径校验失败。", "error");
    } finally {
      setIsChecking(false);
    }
  };

  const scan = async (targetPath: string, aliasKey: string | null) => {
    setBrowseLoading(true);
    setBrowseError(null);
    try {
      const response = await fetch("/api/vault/files/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: { aliasKey, path: targetPath } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "无法读取该目录。");
      setBrowseEntries(result.entries ?? []);
      setBrowsePath(result.directory ?? targetPath);
      setBrowseAlias(aliasKey ?? "");
    } catch (error) {
      setBrowseEntries([]);
      setBrowseError(error instanceof Error ? error.message : "无法读取该目录。");
    } finally {
      setBrowseLoading(false);
    }
  };

  const openBrowser = () => {
    const next = !browserOpen;
    setBrowserOpen(next);
    if (next && !browseEntries.length && !browseLoading) {
      void scan(browsePath, browseAlias || aliases[0]?.key || null);
    }
  };

  const save = async () => {
    if (isSaving || loading) return;
    if (!draft.title.trim()) {
      onNotify("请先填写资产标题。", "error");
      return;
    }
    const incomplete = draft.files.findIndex((file) => !file.name.trim() || !file.path.trim());
    if (supportsFiles && incomplete >= 0) {
      onNotify(`第 ${incomplete + 1} 个文件缺少名称或路径。`, "error");
      return;
    }
    setIsSaving(true);
    const payload = {
      title: draft.title,
      categoryId: draft.categoryId,
      kind: draft.kind,
      language: isFileAsset ? "File" : draft.language,
      tags: draft.tagsText.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      content: draft.content,
      links: draft.links,
      isFavorite: draft.isFavorite,
      revision: draft.revision,
      changeNote: draft.changeNote,
      files: supportsFiles
        ? draft.files.map((file) => ({
            id: file.id.startsWith("local-") ? undefined : file.id,
            name: file.name,
            ext: file.ext,
            category: file.category,
            aliasKey: file.aliasKey,
            path: file.path,
            size: file.size,
            checksum: file.checksum,
            checksumAlgo: file.checksumAlgo,
            publishedAt: file.publishedAt,
            note: file.note,
          }))
        : [],
      mediaKind: supportsMediaKind ? draft.mediaKind : "其他",
      tech: supportsTech ? draft.tech : {},
      package: isScriptLike ? draft.pkg : { dcc: "", packageKind: "单文件脚本", moduleName: "", importPath: "" },
      deploy: isExecutable ? draft.deploy : null,
    };

    try {
      const response = await fetch(id ? `/api/vault/assets/${id}` : "/api/vault", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) onNotify("该资产已在其他页面被修改，请重新打开后再保存，避免覆盖新版本。", "error");
        else onNotify(result.error ?? "保存失败。", "error");
        return;
      }
      onSaved(result.asset, !id);
      onNotify(id ? `已保存 v${result.asset.revision}${isFileAsset ? ` · ${result.asset.fileSummary.total} 个文件` : ""}。` : "资产已加入代码库。");
    } catch {
      onNotify("保存时网络异常，你的编辑内容仍保留在编辑器中。", "error");
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async () => {
    if (!id || !window.confirm("删除该资产及其全部历史版本？此操作不可撤销。")) return;
    try {
      const response = await fetch(`/api/vault/assets/${id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除失败。");
      onDeleted(id);
      onNotify("资产及其正文文件已删除。");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "删除失败。", "error");
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const fileSignature = useMemo(() => signatureOf(draft.files), [draft.files]);
  // 新建（id 为空）只要有文件就算已填写；编辑中则与打开时的清单对比，避免“无改动也提示已修改”。
  const dirtyFiles = isFileAsset && (id === null ? fileSignature !== "" : baselineFileSignature !== null && fileSignature !== baselineFileSignature);

  return <div className="modal-layer" role="dialog" aria-modal="true" aria-label="资产编辑器">
    <div className="editor-modal">
      <header className="editor-header">
        <div className="editor-title">
          <div className="editor-file-icon">{isFileAsset ? <FolderTree size={18} /> : <FileCode2 size={18} />}</div>
          <div>
            <strong>{id ? "编辑资产" : "新建资产"}</strong>
            <span>{id ? `当前版本 v${draft.revision} · 内容或路径变化都会生成新版本` : "支持代码片段、可执行脚本、参考资料与 CG 文件资产"}</span>
          </div>
        </div>
        <div className="editor-actions">
          <div className={`type-switch ${isFileAsset ? "is-file" : ""}`}>
            {ASSET_TYPES.map((type) => <button key={type.value} className={draft.kind === type.value ? "active" : ""} onClick={() => update("kind", type.value)}>{type.label}</button>)}
          </div>
          {id && <button className="icon-button danger-button" onClick={() => void remove()} aria-label="删除资产"><Trash2 size={17} /></button>}
          <button className="icon-button" onClick={onClose} aria-label="关闭编辑器"><X size={19} /></button>
        </div>
      </header>

      {loading ? <div className="editor-loading"><LoaderCircle size={26} className="spin" /> 正在载入最新内容与版本历史…</div> : <div className="editor-body">
        <div className="editor-form">
          <div className="form-row split">
            <label>标题<input ref={titleRef} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder={isFileAsset ? "例如：Hero 角色模型（FBX 交付包）" : "例如：批量导出 Alembic 缓存"} /></label>
            <label>软件空间<select value={draft.categoryId ?? ""} onChange={(event) => update("categoryId", event.target.value || null)}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          </div>

          <div className="form-row triple">
            <label>资产类型<select value={draft.kind} onChange={(event) => update("kind", event.target.value)}>{ASSET_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
            {supportsMediaKind ? <label>资产细分<select value={draft.mediaKind} onChange={(event) => update("mediaKind", event.target.value)}>{MEDIA_KINDS.map((kind) => <option key={kind}>{kind}</option>)}</select></label>
              : <label>语言<select value={draft.language} onChange={(event) => update("language", event.target.value)}>{LANGUAGES.map((language) => <option key={language}>{language}</option>)}</select></label>}
            <label className="favorite-field"><span>置顶收藏</span><button type="button" className={`favorite-switch ${draft.isFavorite ? "on" : ""}`} onClick={() => update("isFavorite", !draft.isFavorite)} aria-label="切换收藏"><i /></button></label>
          </div>

          <label>标签<span className="field-hint">逗号分隔，可用于 maya、rigging、fbx、pipeline 等</span><input value={draft.tagsText} onChange={(event) => update("tagsText", event.target.value)} placeholder="角色, 模型, 交付, fbx" /></label>

          {supportsFiles && <section className={`section-block file-section ${isFileAsset ? "" : "is-package-files"}`}>
            <div className="section-head">
              <div className="section-title"><FolderOpen size={16} /><span>{isFileAsset ? "文件与路径" : "包内文件（__init__.py、模块文件等）"}</span><b>{draft.files.length}</b></div>
              <div className="section-tools">
                <button type="button" className="ghost-tiny" onClick={() => addFile()}><Plus size={14} /> 添加文件</button>
                <button type="button" className="ghost-tiny" onClick={openBrowser}><ScanLine size={14} /> {browserOpen ? "收起浏览" : "从目录导入"}</button>
                <button type="button" className="ghost-tiny" onClick={() => void checkFiles(draft.files)} disabled={isChecking}>{isChecking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} 校验全部</button>
                <button type="button" className="ghost-tiny" onClick={() => void checkFiles(draft.files, true)} disabled={isChecking}><Zap size={14} /> 校验并算 MD5</button>
              </div>
            </div>

            {browserOpen && <div className="browser-panel">
              <div className="browser-form">
                <select value={browseAlias} onChange={(event) => setBrowseAlias(event.target.value)} aria-label="选择别名">
                  <option value="">直接输入路径</option>
                  {aliases.map((alias) => <option key={alias.id} value={alias.key}>${alias.key} → {alias.root}</option>)}
                </select>
                <input value={browsePath} onChange={(event) => setBrowsePath(event.target.value)} placeholder={browseAlias ? "model/hero" : "D:/Show 或 \\\\server\\show\\atlas"} />
                <button type="button" className="primary-tiny" onClick={() => void scan(browsePath, browseAlias || null)} disabled={browseLoading}>{browseLoading ? <LoaderCircle size={14} className="spin" /> : <FolderOpen size={14} />} 载入</button>
              </div>
              {browseError && <p className="browser-error">{browseError}</p>}
              {browseEntries.length > 0 && <div className="browser-list">
                {parentPath(browsePath) !== browsePath && <button type="button" className="browser-item is-up" onClick={() => void scan(parentPath(browsePath), null)}>↑ 返回上级目录</button>}
                {browseEntries.map((entry) => {
                  const folded = foldIntoAlias(entry.path, aliases);
                  return <button key={entry.path} type="button" className={`browser-item ${entry.isDirectory ? "is-dir" : ""}`}
                    onClick={() => (entry.isDirectory ? void scan(entry.path, null) : (addFile({ name: entry.name, ext: entry.ext, path: folded.path, aliasKey: folded.aliasKey, size: entry.size, category: extInfo(entry.ext).category }), onNotify(`已加入 ${entry.name}`)))}>
                    <span className="browser-name">{entry.isDirectory ? "▸ " : ""}{entry.name}</span>
                    {entry.ext && <i className="ext-badge">{entry.ext}</i>}
                    <span className="browser-size">{entry.isDirectory ? "目录" : formatBytes(entry.size)}</span>
                    {!entry.isDirectory && <em className="browser-add">加入资产</em>}
                  </button>;
                })}
              </div>}
              {!browseEntries.length && !browseLoading && !browseError && <p className="browser-hint">选择别名后载入目录，点击文件即可加入当前资产。</p>}
            </div>}

            <div className="file-list">
              {draft.files.length === 0 && <p className="file-empty">尚未登记文件。建议用「$别名 / 相对路径」的形式记录，例如 <code>$PUB/model/hero_body.fbx</code>。</p>}
              {draft.files.map((file, index) => {
                const info = extInfo(file.ext);
                const tone = file.statusError ? "error" : file.exists === true ? "present" : file.exists === false ? "missing" : "unknown";
                return <div key={file.id} className={`file-row tone-${tone}`}>
                  <div className="file-row-top">
                    <span className="file-index">{String(index + 1).padStart(2, "0")}</span>
                    <input className="file-name" value={file.name} onChange={(event) => updateFile(file.id, { name: event.target.value, ext: extOf(event.target.value || file.path) })} placeholder="hero_body.fbx" />
                    <select className="mini-select" value={file.aliasKey ?? ""} onChange={(event) => updateFile(file.id, { aliasKey: event.target.value || null })} aria-label="路径别名">
                      <option value="">绝对路径</option>
                      {aliases.map((alias) => <option key={alias.id} value={alias.key}>${alias.key}</option>)}
                    </select>
                    <input className="file-path" value={file.path} onChange={(event) => updateFile(file.id, { path: event.target.value, name: file.name || pathBasename(event.target.value) })} placeholder="model/hero_body.fbx" />
                    <select className="mini-select" value={file.category} onChange={(event) => updateFile(file.id, { category: event.target.value })} aria-label="文件类别">
                      {MEDIA_KINDS.map((kind) => <option key={kind}>{kind}</option>)}
                    </select>
                    <button type="button" className="icon-tiny" onClick={() => void checkFiles([file])} aria-label="校验该路径" title="校验路径">{isChecking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}</button>
                    <button type="button" className="icon-tiny danger" onClick={() => removeFile(file.id)} aria-label="移除该文件"><X size={14} /></button>
                  </div>
                  <div className="file-row-meta">
                    {file.ext && <i className="ext-badge strong">{file.ext}</i>}
                    <span className="path-template" title={file.resolvedPath ?? templateForDisplay(file.aliasKey, file.path)}>{templateForDisplay(file.aliasKey, file.path) || "（未填写路径）"}</span>
                    <span className={`status-pill ${tone}`}>{file.statusError ?? (tone === "present" ? "路径存在" : tone === "missing" ? "路径缺失" : "未校验")}</span>
                    <span className="size-text">{formatBytes(file.size)}</span>
                    {file.checksum && <code className="hash-text" title={`${file.checksumAlgo ?? "md5"}: ${file.checksum}`}>{(file.checksumAlgo ?? "md5").toUpperCase()} {file.checksum.slice(0, 10)}…</code>}
                    {file.resolvedPath && <button type="button" className="icon-tiny" title="复制服务器真实路径" onClick={() => void navigator.clipboard.writeText(file.resolvedPath ?? "").then(() => onNotify("真实路径已复制。")).catch(() => onNotify("剪贴板不可用。", "error"))}><Copy size={13} /></button>}
                    {info.dcc !== "通用" && <span className="dcc-text">{info.dcc}</span>}
                  </div>
                  <input className="file-note" value={file.note} onChange={(event) => setDraft((current) => ({ ...current, files: current.files.map((item) => item.id === file.id ? { ...item, note: event.target.value } : item) }))} placeholder={`备注：${info.label}${file.modifiedAt ? ` · 磁盘修改于 ${new Date(file.modifiedAt).toLocaleDateString("zh-CN")}` : ""}`} />
                </div>;
              })}
            </div>

            {supportsTech ? <>
              <div className="tech-grid">
                {TECH_FIELDS.map((field) => <label key={field.key}>{field.label}<input value={draft.tech[field.key] ?? ""} onChange={(event) => update("tech", { ...draft.tech, [field.key]: event.target.value })} placeholder={field.placeholder} /></label>)}
              </div>
              <p className="field-note"><Ruler size={13} /> 技术元数据用于交付核对：单位/上轴不一致是 DCC 之间模型缩放错误的常见原因。</p>
            </> : <p className="field-note"><Ruler size={13} /> 按实际目录结构登记包内文件；保存后可在此校验这些文件是否真实存在。</p>}
          </section>}

          <label className="code-field">
            <span>{isFileAsset ? "交付说明 / 发布备注" : "代码内容"}</span>
            <div className="code-editor-wrap">
              <div className="code-editor-head"><span><TerminalSquare size={15} /> {isFileAsset ? "Markdown 说明" : draft.language}</span><span>UTF-8</span></div>
              <textarea value={draft.content} onChange={(event) => update("content", event.target.value)} spellCheck={false} placeholder={isFileAsset ? "记录导出设置、命名规范、依赖的贴图与引用策略…" : "粘贴代码、命令、笔记或参考资料…"} />
            </div>
          </label>

          {draft.kind === "Snippet" && !supportsDeploy && <p className="type-hint"><PackagePlus size={13} /> 代码片段用于随手复制，不涉及安装。若这段代码需要装进 Maya / Houdini 的脚本目录并提供入口，请把类型改为「可执行脚本」。</p>}
          {isReference && <p className="type-hint"><Link2 size={13} /> 参考链接以说明文字与下方链接为主，不需要文件路径与交付元数据。</p>}

          {supportsDeploy && <section className="section-block package-section">
            <div className="section-head">
              <div className="section-title"><PackagePlus size={16} /><span>脚本包 · 部署与调用</span></div>
            </div>
            <p className="section-sub">Maya 类的脚本常常是「多个文件组成的包」，需要放到 DCC 的脚本目录，并明确怎么触发调用。</p>

            <div className="pkg-grid">
              <label>包形态<select value={draft.pkg.packageKind} onChange={(event) => update("pkg", { ...draft.pkg, packageKind: event.target.value })}>
                <option value="单文件脚本">单文件脚本</option>
                <option value="多文件包 / 模块">多文件包 / 模块</option>
              </select></label>
              <label>目标软件<select value={draft.pkg.dcc} onChange={(event) => update("pkg", { ...draft.pkg, dcc: event.target.value })}>
                <option value="">（未指定）</option>
                {[...new Set(INSTALL_TARGETS.map((target) => target.dcc))].map((dcc) => <option key={dcc}>{dcc}</option>)}
              </select></label>
              <label>模块名 / 包名<input value={draft.pkg.moduleName} onChange={(event) => update("pkg", { ...draft.pkg, moduleName: event.target.value })} placeholder="例如 my_rig_tools" /></label>
              <label>安装子路径<span className="field-hint">相对 DCC 脚本目录</span><input value={draft.pkg.importPath} onChange={(event) => update("pkg", { ...draft.pkg, importPath: event.target.value })} placeholder="例如 scripts/my_rig_tools" /></label>
            </div>

            <div className="deploy-grid">
              <label>安装位置<select value={draft.deploy?.installTarget ?? ""} onChange={(event) => {
                const target = INSTALL_TARGETS.find((item) => item.key === event.target.value);
                update("deploy", { ...(draft.deploy ?? { dcc: "", installTarget: null, installSubpath: "", installMethod: "copy", hasEntry: true, entryPoint: "main", callContext: "import", invocation: "", createdAt: "", updatedAt: "" }), installTarget: event.target.value || null, dcc: draft.pkg.dcc });
              }}>
                <option value="">（未设置）</option>
                {installTargetsFor(draft.pkg.dcc).map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
              </select></label>
              <label>安装方式<select value={draft.deploy?.installMethod ?? "copy"} onChange={(event) => updateDeploy("installMethod", event.target.value)}>
                {INSTALL_METHODS.map((method) => <option key={method.key} value={method.key}>{method.label}</option>)}
              </select></label>
              <label>是否已有入口<select value={draft.deploy?.hasEntry ? "yes" : "no"} onChange={(event) => updateDeploy("hasEntry", event.target.value === "yes")}>
                <option value="yes">有入口（可 import 后调用）</option>
                <option value="no">无入口（仅装目录）</option>
              </select></label>
              <label>入口函数名<input value={draft.deploy?.entryPoint ?? "main"} onChange={(event) => updateDeploy("entryPoint", event.target.value)} disabled={draft.deploy?.hasEntry === false} placeholder="main / run" /></label>
              <label>调用方式<select value={draft.deploy?.callContext ?? "import"} onChange={(event) => updateDeploy("callContext", event.target.value)}>
                {CALL_CONTEXTS.map((context) => <option key={context.key} value={context.key}>{context.label}</option>)}
              </select></label>
            </div>

            {draft.deploy?.installTarget && <div className="install-target-note">
              <Wrench size={13} />
              <div>
                <strong>{INSTALL_TARGETS.find((target) => target.key === draft.deploy?.installTarget)?.description}</strong>
                <code>{INSTALL_TARGETS.find((target) => target.key === draft.deploy?.installTarget)?.dirHint}</code>
                <em>环境变量：{INSTALL_TARGETS.find((target) => target.key === draft.deploy?.installTarget)?.envVar}</em>
              </div>
            </div>}

            <label className="invoke-label">调用示例（自动生成，可手动修改）<div className="invoke-box">
              <textarea value={draft.deploy?.invocation ?? ""} onChange={(event) => updateDeploy("invocation", event.target.value)} placeholder="import my_tool&#10;my_tool.main()" spellCheck={false} />
              <button type="button" className="ghost-tiny" onClick={() => setDraft((current) => ({ ...current, deploy: { ...(current.deploy ?? { dcc: "", installTarget: null, installSubpath: "", installMethod: "copy", hasEntry: true, entryPoint: "main", callContext: "import", invocation: "", createdAt: "", updatedAt: "" }), invocation: regenerateInvocation() } }))}><RefreshCw size={14} /> 重新生成</button>
              <button type="button" className="ghost-tiny" onClick={() => void navigator.clipboard.writeText(draft.deploy?.invocation ?? "").then(() => onNotify("调用示例已复制。")).catch(() => onNotify("剪贴板不可用。", "error"))}><Copy size={14} /> 复制</button>
            </div></label>

            <div className="descriptor-row">
              <button type="button" className="ghost-tiny" onClick={generateDescriptor}><PanelTopOpen size={14} /> 生成包描述 / 安装文件内容</button>
              {descriptor && <button type="button" className="ghost-tiny" onClick={() => { setDescriptor(null); onNotify("描述文件内容已清空。"); }}>清除</button>}
              {descriptor && <button type="button" className="ghost-tiny" onClick={() => void navigator.clipboard.writeText(descriptor).then(() => onNotify("描述文件内容已复制。")).catch(() => onNotify("剪贴板不可用。", "error"))}><Copy size={14} /> 复制描述内容</button>}
            </div>
            {descriptor && <pre className="descriptor-preview" onClick={() => void navigator.clipboard.writeText(descriptor).then(() => onNotify("描述文件内容已复制。")).catch(() => onNotify("剪贴板不可用。", "error"))}>{descriptor}</pre>}
          </section>}

          <label>版本说明 <span className="field-hint">可选，随本次保存记录</span><input value={draft.changeNote} onChange={(event) => update("changeNote", event.target.value)} placeholder={isFileAsset ? "例如：新增 LOD2 缓存，贴图路径改为 $TEX" : "这次修改解决了什么问题？"} /></label>

          <div className="link-edit-area"><div><span>参考链接</span><small>文档、插件下载、内部资料</small></div><button type="button" className="add-link-button" onClick={() => update("links", [...draft.links, { label: "", url: "" }])}><Plus size={14} /> 添加链接</button></div>
          {draft.links.map((link, index) => <div className="link-input-row" key={index}>
            <Link2 size={15} />
            <input value={link.label} onChange={(event) => update("links", draft.links.map((item, itemIndex) => (itemIndex === index ? { ...item, label: event.target.value } : item)))} placeholder="链接名称" />
            <input value={link.url} onChange={(event) => update("links", draft.links.map((item, itemIndex) => (itemIndex === index ? { ...item, url: event.target.value } : item)))} placeholder="https://…" />
            <button type="button" onClick={() => update("links", draft.links.filter((_, itemIndex) => itemIndex !== index))} aria-label="删除链接"><X size={15} /></button>
          </div>)}
        </div>

        <aside className="revision-panel">
          <div className="revision-panel-head"><span>版本历史</span><History size={16} /></div>
          <div className="current-version"><span>当前版本</span><strong>v{draft.revision || 1}</strong><small>保存前会比对服务器版本号，避免多页面互相覆盖。</small></div>
          {isFileAsset && <div className="version-stat"><span>已登记文件</span><strong>{draft.files.length}</strong><small>{draft.files.filter((file) => file.exists === true).length} 个可访问 · {draft.files.filter((file) => file.exists === false).length} 个缺失</small></div>}
          {history.length ? <div className="history-list">{history.map((revision) => <button key={revision.id} className="history-row" onClick={() => {
            setDraft((current) => ({
              ...current,
              content: revision.content,
              changeNote: `从 v${revision.revision} 恢复`,
              files: revision.files ? revision.files.map(fileFromRevision) : current.files,
              deploy: revision.deploy ?? current.deploy,
            }));
            onNotify(`已把 v${revision.revision} 的内容${revision.files ? "与文件清单" : ""}${revision.deploy ? "与部署计划" : ""}载入编辑器，保存后成为新版本。`);
          }}>
            <span><b>v{revision.revision}</b><small>{new Date(revision.savedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></span>
            <History size={14} />
            <em>{revision.changeNote || "历史快照"}{revision.files?.length ? ` · ${revision.files.length} 个文件` : ""}</em>
          </button>)}</div> : <div className="no-history"><Zap size={17} /> 每次内容或文件路径变更都会归档旧版本（含当时的文件清单），最多保留 20 条。</div>}
        </aside>
      </div>}

      <footer className="editor-footer">
        <span><History size={15} /> {isFileAsset ? `内容或路径变更都会生成新版本${dirtyFiles ? " · 文件清单已修改" : ""}` : "内容变更会生成新版本，最多保留 20 条。"}</span>
        <div>
          <button className="cancel-button" onClick={onClose}>取消</button>
          <button className="save-button" onClick={() => void save()} disabled={isSaving || loading}>{isSaving ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{isSaving ? "保存中…" : id ? "保存新版本" : "创建资产"}<kbd>Ctrl S</kbd></button>
        </div>
      </footer>
    </div>
  </div>;
}
