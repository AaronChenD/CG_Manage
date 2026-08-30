"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Aperture,
  ArrowDownAZ,
  ArrowUpRight,
  Boxes,
  Check,
  ChevronDown,
  Clock3,
  Code2,
  Copy,
  FileArchive,
  FileCode2,
  Filter,
  FolderCheck,
  FolderOpen,
  FolderPlus,
  FolderTree,
  Gamepad2,
  Globe2,
  Grid2X2,
  HardDrive,
  History,
  Inbox,
  Layers3,
  Link2,
  LoaderCircle,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Ruler,
  ScanLine,
  Search,
  Sparkles,
  Star,
  SunMedium,
  Table2,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  assetTypeLabel,
  formatBytes,
  parsePathTemplate,
  statusTone,
  templateForDisplay,
  type PathAliasDTO,
} from "@/lib/asset-catalog";
import type { AssetDTO, CategoryDTO } from "@/lib/vault";
import AssetEditor from "@/components/asset-editor";
import PathAliasManager from "@/components/path-alias-manager";

type SortMode = "updated" | "name" | "size" | "format";
type ViewMode = "grid" | "table";
type KindFilter = "All" | "Script" | "Reference" | "File";
type StatusFilter = "all" | "present" | "missing" | "unchecked";
type Toast = { message: string; tone: "success" | "error" } | null;

const KIND_FILTERS: { value: KindFilter; label: string }[] = [
  { value: "All", label: "全部类型" },
  { value: "Script", label: "代码/脚本" },
  { value: "Reference", label: "参考链接" },
  { value: "File", label: "文件资产" },
];

function formatToday(now: number) {
  if (!now) return "今日";
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(now));
}

function formatWhen(date: string, now = 0) {
  if (!now) return "刚刚";
  const delta = Math.max(0, now - new Date(date).getTime());
  const minutes = Math.max(1, Math.round(delta / 60000));
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  return days < 8 ? `${days} 天前` : new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(date));
}

function AssetIcon({ category }: { category: string }) {
  const iconClass = "category-icon-symbol";
  if (category === "Houdini") return <Sparkles className={iconClass} />;
  if (category === "Blender") return <Aperture className={iconClass} />;
  if (category === "Unreal Engine") return <Gamepad2 className={iconClass} />;
  if (category === "全局通用") return <Globe2 className={iconClass} />;
  return <Boxes className={iconClass} />;
}

function LanguageMark({ asset }: { asset: AssetDTO }) {
  if (asset.kind === "File") {
    const ext = asset.fileSummary.formats[0] ?? "";
    return <i className={`language-mark ext-${ext}`}>{ext ? ext.toUpperCase().slice(0, 4) : "FILE"}</i>;
  }
  const short = asset.language === "JavaScript" ? "JS" : asset.language === "Python" ? "PY" : asset.language === "Markdown" ? "MD" : asset.language.slice(0, 3).toUpperCase();
  return <span className={`language-mark lang-${asset.language.toLowerCase().replace(/[^a-z]/g, "")}`}>{short}</span>;
}

function StatusPill({ tone, label }: { tone: string; label: string }) {
  return <span className={`status-pill ${tone}`}><i />{label}</span>;
}

function assetStatus(asset: AssetDTO): StatusFilter {
  if (!asset.files.length) return "all";
  if (asset.files.some((file) => file.status.error)) return "missing";
  if (asset.files.every((file) => file.status.exists === true)) return "present";
  if (asset.files.some((file) => file.status.exists === false)) return "missing";
  return "unchecked";
}

export default function VaultDashboard({ initialAssets, initialCategories, initialAliases }: { initialAssets: AssetDTO[]; initialCategories: CategoryDTO[]; initialAliases: PathAliasDTO[] }) {
  const [assets, setAssets] = useState(initialAssets);
  const [categories, setCategories] = useState(initialCategories);
  const [aliases, setAliases] = useState(initialAliases);
  const [activeCategory, setActiveCategory] = useState("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("All");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("updated");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [view, setView] = useState<ViewMode>("grid");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [editor, setEditor] = useState<{ open: boolean; asset: AssetDTO | null }>({ open: false, asset: null });
  const [aliasOpen, setAliasOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState(false);
  const [newCategory, setNewCategory] = useState({ name: "", description: "", color: "#34d399" });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState<{ paths: { path: string; items: { assetTitle: string }[] }[]; checksums: { checksum: string; items: { assetTitle: string; path: string }[] }[] }>({ paths: [], checksums: [] });
  const [trashItems, setTrashItems] = useState<{ assetId: string; deletedAt: string; snapshot: { asset?: { title?: string } } }[]>([]);
  const [clientNow, setClientNow] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => setToast({ message, tone }), []);

  const activeCategoryInfo = categories.find((category) => category.id === activeCategory);
  const fileAssets = useMemo(() => assets.filter((asset) => asset.kind === "File"), [assets]);
  // 代码/脚本现在也可以登记路径，因此可达性统计覆盖所有带路径的资产。
  const trackedFiles = useMemo(() => assets.filter((asset) => asset.files.length > 0).flatMap((asset) => asset.files.map((file) => ({ ...file, assetId: asset.id, assetTitle: asset.title }))), [assets]);
  const presentFiles = trackedFiles.filter((file) => file.status.exists === true).length;
  const missingFiles = trackedFiles.filter((file) => file.status.exists === false || file.status.error).length;
  const totalBytes = trackedFiles.reduce((sum, file) => sum + (file.status.size ?? file.size ?? 0), 0);
  const aliasUsage = useMemo(() => trackedFiles.reduce<Record<string, number>>((counts, file) => {
    if (file.aliasKey) counts[file.aliasKey] = (counts[file.aliasKey] ?? 0) + 1;
    return counts;
  }, {}), [trackedFiles]);
  const categoryCounts = useMemo(() => assets.reduce<Record<string, number>>((counts, asset) => {
    if (asset.categoryId) counts[asset.categoryId] = (counts[asset.categoryId] ?? 0) + 1;
    return counts;
  }, {}), [assets]);

  const filteredAssets = useMemo(() => {
    const query = search.trim().toLowerCase();
    return assets
      .filter((asset) => {
        if (activeCategory !== "all" && asset.categoryId !== activeCategory) return false;
        if (kindFilter !== "All" && asset.kind !== kindFilter) return false;
        if (statusFilter !== "all" && (asset.kind !== "File" || assetStatus(asset) !== statusFilter)) return false;
        if (!query) return true;
        const haystack = [
          asset.title, asset.content, asset.categoryName, asset.language, asset.mediaKind, asset.kind,
          ...asset.tags, ...asset.links.flatMap((link) => [link.label, link.url]),
          ...asset.files.flatMap((file) => [file.name, file.path, file.aliasKey ? `$${file.aliasKey}` : "", file.status.resolvedPath, file.checksum ?? "", file.category, `.${file.ext}`, file.note]),
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (sortMode === "name") return a.title.localeCompare(b.title, "zh-CN");
        if (sortMode === "size") return b.fileSummary.size - a.fileSummary.size;
        if (sortMode === "format") return (a.fileSummary.formats[0] ?? "zzz").localeCompare(b.fileSummary.formats[0] ?? "zzz");
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [activeCategory, assets, kindFilter, search, sortMode, statusFilter]);

  // 筛选 / 排序 / 搜索变化时回到第一页（在渲染期调整状态的官方模式，避免 effect 内 setState）。
  const filterKey = `${activeCategory}|${kindFilter}|${statusFilter}|${search}|${sortMode}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(filteredAssets.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = filteredAssets.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/vault", { cache: "no-store" });
      if (!response.ok) throw new Error("重新载入失败。");
      const result = await response.json();
      setAssets(result.assets);
      setCategories(result.categories);
      if (Array.isArray(result.aliases)) setAliases(result.aliases);
    } catch (error) {
      notify(error instanceof Error ? error.message : "重新载入失败。", "error");
    } finally {
      setIsRefreshing(false);
    }
  }, [notify]);

  useEffect(() => {
    const sync = () => setClientNow(Date.now());
    sync();
    const timer = window.setInterval(sync, 60000);
    return () => window.clearInterval(timer);
  }, []);

  // 移动端（<=860px）侧栏是抽屉：默认收起，避免一进页面就被盖住；
  // 从窄屏切回宽屏时恢复常驻侧栏。
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 860px)");
    const sync = (matches: boolean) => setSidebarOpen(!matches);
    sync(mq.matches);
    const onChange = (event: MediaQueryListEvent) => sync(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const openCreate = useCallback(() => setEditor({ open: true, asset: null }), []);

  const inspectDuplicates = useCallback(async () => {
    try {
      const response = await fetch("/api/vault/duplicates", { cache: "no-store" });
      if (!response.ok) throw new Error("重复检查失败。");
      const result = await response.json() as { paths?: { path: string; items: { assetTitle: string }[] }[]; checksums?: { checksum: string; items: { assetTitle: string; path: string }[] }[] };
      setDuplicateGroups({ paths: result.paths ?? [], checksums: result.checksums ?? [] });
      setDuplicateOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "重复检查失败。", "error");
    }
  }, [notify]);

  const inspectTrash = useCallback(async () => {
    try {
      const response = await fetch("/api/vault/trash", { cache: "no-store" });
      if (!response.ok) throw new Error("回收站读取失败。");
      const result = await response.json() as { items?: { assetId: string; deletedAt: string; snapshot: { asset?: { title?: string } } }[] };
      setTrashItems(result.items ?? []);
      setTrashOpen(true);
    } catch (error) {
      notify(error instanceof Error ? error.message : "回收站读取失败。", "error");
    }
  }, [notify]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, select"));
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (!typing && event.key.toLowerCase() === "n" && !editor.open && !aliasOpen && !categoryDialog) {
        event.preventDefault();
        openCreate();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [aliasOpen, categoryDialog, editor.open, openCreate]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const copy = async (key: string, text: string, label = "已复制到剪贴板。") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      notify(label);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      notify("当前浏览器不允许访问剪贴板。", "error");
    }
  };

  const checkAllMissing = async () => {
    const targets = trackedFiles.filter((file) => file.status.exists !== true);
    if (!targets.length) {
      notify("所有已登记路径都能访问，无需重新校验。");
      return;
    }
    setIsRefreshing(true);
    try {
      await fetch("/api/vault/files/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: targets.map((file) => ({ aliasKey: file.aliasKey, path: file.path })) }),
      });
      await refresh();
      notify("已重新扫描磁盘并刷新路径状态。");
    } catch {
      notify("路径重新校验失败，请确认服务器能访问这些目录。", "error");
    } finally {
      setIsRefreshing(false);
    }
  };

  const saveCategory = async () => {
    if (!newCategory.name.trim()) {
      notify("请先填写软件空间名称。", "error");
      return;
    }
    try {
      const response = await fetch("/api/vault/categories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newCategory) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "创建失败。");
      setCategories((current) => [...current, result.category]);
      setActiveCategory(result.category.id);
      setNewCategory({ name: "", description: "", color: "#34d399" });
      setCategoryDialog(false);
      notify(`软件空间「${result.category.name}」创建成功。`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "创建软件空间失败。", "error");
    }
  };

  const title = activeCategoryInfo ? activeCategoryInfo.name : kindFilter === "File" ? "文件资产" : kindFilter === "Script" ? "代码/脚本" : kindFilter === "Reference" ? "参考链接" : "全部资产";
  const description = activeCategoryInfo
    ? activeCategoryInfo.description
    : kindFilter === "File"
      ? "模型、动画、缓存与 USD 装配等文件的路径登记与可达性校验。"
      : kindFilter === "Script"
        ? "脚本与代码片段：可直接粘贴保存，也可登记单文件或整个文件夹路径。"
        : kindFilter === "Reference"
          ? "文档、检查表与外部资料的说明与链接。"
          : "集中管理脚本、文件路径与技术资料。";

  return (
    <div className={`vault-app ${sidebarOpen ? "" : "is-sidebar-collapsed"}`} data-theme={theme}>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />}
      <aside className={`vault-sidebar ${sidebarOpen ? "is-open" : "is-collapsed"}`}>
        <div className="brand-row">
          <div className="brand-mark"><div className="brand-cube"><span /></div></div>
          {sidebarOpen && <div className="brand-name">CG <strong>VAULT</strong><small>流水线资产库</small></div>}
          <button className="icon-button sidebar-toggle" onClick={() => setSidebarOpen((open) => !open)} aria-label={sidebarOpen ? "收起侧边栏" : "展开侧边栏"} title={sidebarOpen ? "收起侧边栏" : "展开侧边栏"}>
            {sidebarOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
          </button>
        </div>

        <button className="new-asset-button" onClick={openCreate}><Plus size={17} strokeWidth={2.5} /> {sidebarOpen && <span>新建资产</span>}<kbd>N</kbd></button>

        <div className="sidebar-scroll">
          <nav className="side-nav" aria-label="代码库导航">
            <p className="side-heading">资源库</p>
            <button className={`side-nav-row ${activeCategory === "all" && kindFilter === "All" ? "active" : ""}`} onClick={() => { setActiveCategory("all"); setKindFilter("All"); setStatusFilter("all"); setView("grid"); }}>
              <Grid2X2 size={17} /><span>全部资产</span><b>{assets.length}</b>
            </button>
            <button className={`side-nav-row ${kindFilter === "Script" ? "active" : ""}`} onClick={() => { setActiveCategory("all"); setKindFilter("Script"); setStatusFilter("all"); setView("grid"); }}>
              <Code2 size={17} /><span>代码/脚本</span><b>{assets.filter((asset) => asset.kind === "Script").length}</b>
            </button>
            <button className={`side-nav-row ${kindFilter === "Reference" ? "active" : ""}`} onClick={() => { setActiveCategory("all"); setKindFilter("Reference"); setStatusFilter("all"); setView("grid"); }}>
              <Link2 size={17} /><span>参考链接</span><b>{assets.filter((asset) => asset.kind === "Reference").length}</b>
            </button>
            <button className={`side-nav-row ${kindFilter === "File" ? "active" : ""}`} onClick={() => { setActiveCategory("all"); setKindFilter("File"); setView("table"); }}>
              <FileArchive size={17} /><span>文件资产</span><b>{fileAssets.length}</b>
            </button>
          </nav>

          <div className="spaces-section">
            <div className="spaces-heading"><p className="side-heading">软件空间</p><button className="tiny-icon" onClick={() => setCategoryDialog(true)} aria-label="新建软件空间"><Plus size={15} /></button></div>
            <div className="space-list">
              {categories.map((category) => (
                <button key={category.id} className={`space-row ${activeCategory === category.id ? "active" : ""}`} onClick={() => setActiveCategory(category.id)}>
                  <span className="category-dot" style={{ backgroundColor: category.color }}><AssetIcon category={category.name} /></span>
                  <span>{category.name}</span><b>{categoryCounts[category.id] ?? 0}</b>
                </button>
              ))}
            </div>
            <button className="add-space-link" onClick={() => setCategoryDialog(true)}><FolderPlus size={15} /> 新建软件空间</button>
          </div>

          <div className="path-section">
            <p className="side-heading">路径与存储</p>
            <button className="side-nav-row" onClick={() => setAliasOpen(true)}>
              <FolderTree size={17} /><span>路径别名</span><b>{aliases.length}</b>
            </button>
            <button className="side-nav-row" onClick={() => void inspectDuplicates()}>
              <ScanLine size={17} /><span>重复检测</span><b>检查</b>
            </button>
            <button className="side-nav-row" onClick={() => void inspectTrash()}>
              <Inbox size={17} /><span>回收站</span><b>查看</b>
            </button>
            <div className="alias-mini-list">
              {aliases.slice(0, 3).map((alias) => <span key={alias.id} className={`alias-mini ${alias.enabled ? "" : "off"}`} title={alias.root}><i>${alias.key}</i>{parsePathTemplate(`$${alias.key}`).aliasKey}{aliasUsage[alias.key] ? ` · ${aliasUsage[alias.key]}` : ""}</span>)}
              {aliases.length > 3 && <button onClick={() => setAliasOpen(true)}>+{aliases.length - 3} 个别名</button>}
            </div>
            {missingFiles > 0 && <button className="alert-row" onClick={() => void checkAllMissing()}><TriangleAlert size={15} /><span>{missingFiles} 个路径无法访问</span><RefreshCw size={14} className={isRefreshing ? "spin" : ""} /></button>}
          </div>
        </div>

        <div className="sidebar-bottom">
          <div className="sync-status"><span className="online-pulse" /><span>本地 SQLite 已同步</span><small>data/cg-vault.sqlite</small></div>
          <button className="profile-row"><span className="profile-avatar">TA</span>{sidebarOpen && <span><b>陈技术</b><small>技术美术 · 管线组</small></span>}<FolderCheck size={16} /></button>
        </div>
      </aside>

      <section className="vault-workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu sidebar-open-button" onClick={() => setSidebarOpen(true)} aria-label="打开侧边栏" title="展开侧边栏"><Menu size={18} /></button>
          <div className="mobile-brand"><div className="brand-mark"><div className="brand-cube"><span /></div></div><b>CG VAULT</b></div>
          <div className="global-search">
            <Search size={18} />
            <input ref={searchInput} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索标题、代码、标签、文件路径、校验和…" aria-label="搜索代码库" />
            {search && <button className="clear-inline" onClick={() => setSearch("")} aria-label="清空搜索"><X size={14} /></button>}
            <span className="shortcut-key">Ctrl K</span>
          </div>
          <div className="topbar-actions">
            <button className="ghost-button" onClick={() => setAliasOpen(true)}><FolderTree size={15} /> <span>路径管理</span></button>
            <button className="icon-button theme-button" onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))} aria-label="切换主题">{theme === "dark" ? <SunMedium size={18} /> : <Moon size={18} />}</button>
            <button className="quick-add" onClick={openCreate}><Plus size={16} /> <span>新建资产</span></button>
          </div>
        </header>

        <div className="workspace-scroll">
          <section className="welcome-row">
            <div>
              <p className="eyebrow"><span /> CG 流水线知识库 · 代码与资产统一入口</p>
              <h1>{title}</h1>
              <p className="welcome-copy">{description}</p>
            </div>
            <div className="welcome-side">
              <div className="date-chip"><Clock3 size={16} /><span>{formatToday(clientNow)}</span></div>
              <button className="ghost-button" onClick={() => void refresh()} disabled={isRefreshing}>{isRefreshing ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} <span>重新扫描磁盘</span></button>
            </div>
          </section>

          <section className="metric-grid" aria-label="代码库概览">
            <article className="metric-card primary-metric"><div><span className="metric-label">资产总数</span><strong>{assets.length.toString().padStart(2, "0")}</strong><small><ArrowUpRight size={14} /> 脚本 {assets.filter((asset) => asset.kind === "Script").length} · 文件 {fileAssets.length}</small></div><div className="metric-orbit"><Layers3 size={25} /></div></article>
            <article className="metric-card"><div><span className="metric-label">登记路径</span><strong>{trackedFiles.length.toString().padStart(2, "0")}</strong><small><HardDrive size={12} /> {formatBytes(totalBytes)} · {formatBytes(totalBytes / Math.max(1, trackedFiles.length))}/均值</small></div><div className="metric-visual dots-visual">{["fbx", "abc", "usd", "png", "exr"].map((ext, index) => <i key={ext} className={index === 3 ? "hot" : ""} title={`.${ext}`} />)}</div></article>
            <article className={`metric-card ${missingFiles ? "warn-metric" : ""}`}><div><span className="metric-label">路径可达性</span><strong>{presentFiles}<small>/{trackedFiles.length}</small></strong><small>{missingFiles ? <><AlertTriangle size={12} /> {missingFiles} 个缺失或不可访问</> : <><FolderCheck size={12} /> 全部路径可访问</>}</small></div><div className="metric-visual revision-visual">{missingFiles ? <AlertTriangle size={28} /> : <FolderCheck size={28} />}</div></article>
            <article className="activity-card"><div className="activity-top"><span className="metric-label">近 7 天保存</span><span className="activity-note">含路径变更</span></div><div className="activity-bars">{[32, 45, 22, 68, 47, 83, 59].map((height, index) => <i key={index} style={{ height: `${height}%` }} className={index === 5 ? "current" : ""} />)}</div><div className="activity-days"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div></article>
          </section>

          <section className="asset-section">
            <div className="asset-section-top">
              <div><div className="section-title-row"><h2>资产列表</h2><span>{filteredAssets.length} 条结果</span></div><p>卡片适合浏览代码，表格适合管理文件路径与版本。</p></div>
              <div className="view-tools">
                <div className="seg-toggle" role="group" aria-label="视图切换">
                  <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} aria-label="卡片视图"><Grid2X2 size={15} /></button>
                  <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} aria-label="表格视图"><Table2 size={15} /></button>
                </div>
                <button className="sort-button" onClick={() => setSortMode((mode) => (mode === "updated" ? "name" : mode === "name" ? "size" : mode === "size" ? "format" : "updated"))}>
                  <ArrowDownAZ size={16} /> {sortMode === "updated" ? "最近更新" : sortMode === "name" ? "名称 A-Z" : sortMode === "size" ? "文件大小" : "格式"}<ChevronDown size={14} />
                </button>
              </div>
            </div>

            <div className="filter-row">
              <div className="filter-label"><Filter size={15} /> 筛选</div>
              {KIND_FILTERS.map((filter) => <button key={filter.value} className={`filter-chip ${kindFilter === filter.value ? "active" : ""}`} onClick={() => {
                setKindFilter(filter.value);
                // 切到代码/脚本或链接时清掉文件专属筛选，防止隐藏条件继续生效导致“查不到东西”。
                if (filter.value !== "All" && filter.value !== "File") setStatusFilter("all");
              }}>{filter.label}</button>)}
              {(search || activeCategory !== "all" || kindFilter !== "All" || statusFilter !== "all") && <button className="clear-filter" onClick={() => { setSearch(""); setActiveCategory("all"); setKindFilter("All"); setStatusFilter("all"); }}>清除筛选 <X size={13} /></button>}
            </div>

            {/* 可达性只对文件资产有意义，代码/脚本/链接下不展示，避免出现必然为空的筛选结果。 */}
            {(kindFilter === "All" || kindFilter === "File") && <div className="filter-row secondary-filters">
              <div className="filter-label"><ScanLine size={15} /> 路径状态</div>
              {(["all", "present", "missing", "unchecked"] as StatusFilter[]).map((status) => <button key={status} className={`filter-chip tiny ${statusFilter === status ? "active" : ""}`} onClick={() => { setStatusFilter(status); if (status !== "all") setKindFilter("File"); }}>{status === "all" ? "全部" : status === "present" ? "可访问" : status === "missing" ? "缺失" : "未校验"}</button>)}
            </div>}

            {!filteredAssets.length ? <div className="empty-state"><div><Inbox size={28} /></div><h3>没有找到资产</h3><p>换个关键词，或为当前空间新建第一条资产。</p><button className="small-primary" onClick={openCreate}><Plus size={15} /> 新建资产</button></div>
              : view === "grid" ? <div className="asset-grid">
              {pageItems.map((asset) => {
                const status = assetStatus(asset);
                const isFile = asset.kind === "File";
                return <article className={`asset-card ${isFile ? "is-file" : ""}`} key={asset.id} onClick={() => setEditor({ open: true, asset })}>
                  <div className="asset-card-top">
                    <div className="asset-type"><LanguageMark asset={asset} /><span>{assetTypeLabel(asset.kind)}</span>{isFile && asset.mediaKind !== "其他" && <em className="media-tag">{asset.mediaKind}</em>}{!isFile && asset.kind === "Script" && asset.language !== "文本" && <em className="media-tag">{asset.language}</em>}</div>
                    <div className="card-tools">
                      {asset.files.length > 0 && <button className="icon-tiny" title="复制第一条路径的别名写法" onClick={(event) => { event.stopPropagation(); const first = asset.files[0]; void copy(`tpl-${asset.id}`, first ? templateForDisplay(first.aliasKey, first.path) : ""); }}><Copy size={14} /></button>}
                      <button className={`star-button ${asset.isFavorite ? "is-starred" : ""}`} aria-label="收藏资产"><Star size={17} fill={asset.isFavorite ? "currentColor" : "none"} /></button>
                    </div>
                  </div>
                  <h3>{asset.title}</h3>
                  {asset.files.length > 0 ? <div className="file-preview">
                    {asset.files.slice(0, 3).map((file) => {
                      const tone = statusTone(file.status.exists, file.status.error);
                      const isDir = file.status.exists ? file.status.isDirectory : file.isDirectory;
                      return <div className="file-preview-row" key={file.id}>
                        <i className="ext-badge">{isDir ? "DIR" : file.ext || "···"}</i>
                        <code title={file.status.resolvedPath}>{templateForDisplay(file.aliasKey, file.path)}</code>
                        <span className={`status-pill ${tone}`}><i />{tone === "present" ? (isDir ? "目录" : formatBytes(file.status.size)) : tone === "missing" ? "缺失" : "未校验"}</span>
                      </div>;
                    })}
                    {asset.files.length > 3 && <span className="file-more">另有 {asset.files.length - 3} 条路径</span>}
                  </div> : isFile ? <div className="file-preview"><span className="file-more">尚未登记路径，点「管理路径」添加 <code>$别名/相对路径</code>。</span></div> : <pre>{asset.content || "暂无内容。"}</pre>}
                  <div className="asset-tags">{asset.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}{asset.tags.length > 3 && <span>+{asset.tags.length - 3}</span>}</div>
                  <div className="asset-card-bottom">
                    <span className="asset-space"><i style={{ backgroundColor: asset.categoryColor }} /><span>{asset.categoryName}</span></span>
                    <span className="asset-revision"><History size={14} /> v{asset.revision}</span>
                    {asset.files.length > 0 && <span className={`asset-files-count ${status}`}>{asset.fileSummary.present}/{asset.fileSummary.total} 可访问</span>}
                    <button className="copy-button" onClick={(event) => { event.stopPropagation(); if (isFile) setEditor({ open: true, asset }); else void copy(`code-${asset.id}`, asset.content, "代码已复制到剪贴板。"); }}>{isFile ? <FolderOpen size={14} /> : copiedKey === `code-${asset.id}` ? <Check size={14} /> : <Copy size={14} />}{isFile ? "管理路径" : copiedKey === `code-${asset.id}` ? "已复制" : "复制"}</button>
                  </div>
                </article>;
              })}
            </div> : <div className="table-wrap">
              <table className="asset-table">
                <thead><tr><th className="col-asset">资产 / 文件</th><th className="col-kind">语言 / 类别</th><th className="col-fmt">格式</th><th className="col-size">大小</th><th className="col-path">路径（别名 / 相对）</th><th className="col-status">状态</th><th className="col-ver">版本</th><th className="col-act">操作</th></tr></thead>
                <tbody>
                  {pageItems.map((asset) => {
                    const isFile = asset.kind === "File";
                    const open = Boolean(expanded[asset.id]);
                    const primary = asset.files[0];
                    return <Fragment key={asset.id}>
                      <tr className={open ? "is-open" : ""} onClick={() => (asset.files.length > 0 ? setExpanded((current) => ({ ...current, [asset.id]: !current[asset.id] })) : setEditor({ open: true, asset }))}>
                        <td className="col-asset"><div className="table-asset"><span className="table-mark">{isFile ? <FileArchive size={14} /> : asset.kind === "Reference" ? <Link2 size={14} /> : <FileCode2 size={14} />}</span><div><b>{asset.title}</b><small>{isFile ? `${asset.fileSummary.total} 个文件 · ${asset.categoryName}` : `${asset.language} · ${asset.categoryName}`}</small></div></div></td>
                        <td className="col-kind">{isFile ? (asset.mediaKind !== "其他" ? asset.mediaKind : <span className="muted">—</span>) : asset.kind === "Script" && asset.language !== "文本" ? asset.language : <span className="muted">—</span>}</td>
                        <td className="col-fmt">{asset.fileSummary.formats.length ? asset.fileSummary.formats.slice(0, 3).map((ext) => <i className="ext-badge" key={ext}>{ext}</i>) : <span className="muted">—</span>}</td>
                        <td className="col-size">{isFile ? formatBytes(asset.fileSummary.size) : `${asset.content.length} 字符`}</td>
                        <td className="col-path">{primary ? <code title={primary.status.resolvedPath}>{templateForDisplay(primary.aliasKey, primary.path)}</code> : <span className="muted">—</span>}</td>
                        <td className="col-status">{isFile ? (asset.fileSummary.total === 0
                          ? <StatusPill tone="unknown" label="未登记文件" />
                          : <StatusPill
                              tone={statusTone(asset.files.every((file) => file.status.exists === true) ? true : asset.files.some((file) => file.status.exists === false || file.status.error) ? false : null, null)}
                              label={asset.fileSummary.present === asset.fileSummary.total ? "全部可访问" : `${asset.fileSummary.present}/${asset.fileSummary.total}`} />)
                          : <span className="muted">—</span>}</td>
                        <td className="col-ver">v{asset.revision}<small>{formatWhen(asset.updatedAt, clientNow)}</small></td>
                        <td className="col-act" onClick={(event) => event.stopPropagation()}>
                          {primary && <button className="icon-tiny" title="复制别名路径" onClick={() => void copy(`row-${asset.id}`, templateForDisplay(primary.aliasKey, primary.path), "别名路径已复制（可直接粘进 DCC 脚本）。")}><Copy size={14} /></button>}
                          <button className="icon-tiny" title="打开编辑器" onClick={() => setEditor({ open: true, asset })}><Ruler size={14} /></button>
                        </td>
                      </tr>
                      {open && asset.files.length > 0 && <tr className="expand-row"><td colSpan={8}>
                        <div className="expand-inner">
                          <div className="expand-head"><span>路径清单 · {asset.files.length}</span><div><button className="ghost-tiny" onClick={() => void navigator.clipboard.writeText(asset.content).then(() => notify("正文已复制。")).catch(() => notify("剪贴板不可用。", "error"))}>复制正文</button><button className="primary-tiny" onClick={() => setEditor({ open: true, asset })}>编辑路径</button></div></div>
                          {asset.files.map((file) => {
                            const tone = statusTone(file.status.exists, file.status.error);
                            const isDir = file.status.exists ? file.status.isDirectory : file.isDirectory;
                            return <div className="expand-file" key={file.id}>
                              <i className="ext-badge strong">{isDir ? "DIR" : file.ext || "···"}</i>
                              <b className="expand-name">{file.name}</b>
                              <span className="expand-cat">{isDir ? "目录" : file.category}</span>
                              <code title={file.status.resolvedPath}>{templateForDisplay(file.aliasKey, file.path)}</code>
                              <span className="expand-size">{formatBytes(file.status.size ?? file.size)}</span>
                              <StatusPill tone={tone} label={file.status.error ?? (tone === "present" ? (isDir ? "目录存在" : "存在") : tone === "missing" ? "缺失" : "未校验")} />
                              <button className="icon-tiny" title="复制服务器真实路径" onClick={() => void navigator.clipboard.writeText(file.status.resolvedPath).then(() => notify("真实路径已复制。")).catch(() => notify("剪贴板不可用。", "error"))}><Copy size={13} /></button>
                            </div>;
                          })}
                          {asset.content && <pre className="expand-note">{asset.content}</pre>}
                        </div>
                      </td></tr>}
                    </Fragment>;
                  })}
                </tbody>
              </table>
            </div>}

            {filteredAssets.length > 0 && (
              <div className="pagination-bar">
                <div className="pagination-meta">共 {filteredAssets.length} 条 · 第 {currentPage} / {totalPages} 页</div>
                <div className="pagination-controls">
                  <button className="page-button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage <= 1} aria-label="上一页"><ChevronDown size={15} className="rotate-90" /></button>
                  {(() => {
                    const pages: number[] = [];
                    const start = Math.max(1, currentPage - 2);
                    const end = Math.min(totalPages, currentPage + 2);
                    for (let p = start; p <= end; p += 1) pages.push(p);
                    return <>
                      {start > 1 && <><button className="page-button" onClick={() => setPage(1)}>1</button>{start > 2 && <span className="page-ellipsis">…</span>}</>}
                      {pages.map((p) => <button key={p} className={`page-button ${p === currentPage ? "active" : ""}`} onClick={() => setPage(p)} aria-current={p === currentPage ? "page" : undefined}>{p}</button>)}
                      {end < totalPages && <>{end < totalPages - 1 && <span className="page-ellipsis">…</span>}<button className="page-button" onClick={() => setPage(totalPages)}>{totalPages}</button></>}
                    </>;
                  })()}
                  <button className="page-button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage >= totalPages} aria-label="下一页"><ChevronDown size={15} className="rotate-270" /></button>
                </div>
                <select className="page-size-select" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} aria-label="每页条数">
                  {[12, 24, 48, 96].map((size) => <option key={size} value={size}>每页 {size} 条</option>)}
                </select>
              </div>
            )}
          </section>

          <section className="tips-strip">
            <div><FolderTree size={16} /><span><b>路径写法</b> 推荐 <code>$别名/相对路径</code>，换机器或换 Show 只需在「路径管理」里改根路径。</span></div>
            <div><ScanLine size={16} /><span><b>可达性校验</b> CG Vault 会用运行服务器所在机器的文件系统真实 <code>stat</code> 每个路径，因此 NAS 需要先挂载。</span></div>
            <div><History size={16} /><span><b>版本保护</b> 内容或文件清单变更都会存旧版本，旧页面用过期版本号保存会被拒绝。</span></div>
          </section>
        </div>
      </section>

      {editor.open && <AssetEditor
        asset={editor.asset}
        categories={categories}
        aliases={aliases}
        onAliasesChanged={setAliases}
        onSaved={(saved) => {
          setAssets((current) => [saved, ...current.filter((asset) => asset.id !== saved.id)]);
          setEditor({ open: false, asset: null });
        }}
        onDeleted={(deletedId) => {
          setAssets((current) => current.filter((asset) => asset.id !== deletedId));
          setEditor({ open: false, asset: null });
        }}
        onNotify={notify}
        onClose={() => setEditor({ open: false, asset: null })}
      />}

      {aliasOpen && <PathAliasManager
        aliases={aliases}
        usageCount={aliasUsage}
        onClose={() => setAliasOpen(false)}
        onChanged={(next) => {
          setAliases(next);
          // 别名根路径可能已变化，重新拉取快照以刷新文件的“存在/缺失”状态。
          void refresh();
        }}
        onNotify={notify}
      />}

      {duplicateOpen && <div className="modal-layer compact-layer" role="dialog" aria-modal="true" aria-label="重复检测"><div className="category-modal"><header><div><div className="modal-mini-icon"><ScanLine size={18} /></div><h2>重复检测</h2><p>检查登记路径和已保存的 SHA-256。</p></div><button className="icon-button" onClick={() => setDuplicateOpen(false)} aria-label="关闭"><X size={18} /></button></header><div className="trash-list">{!duplicateGroups.paths.length && !duplicateGroups.checksums.length ? <p>未发现重复项目。</p> : <>{duplicateGroups.paths.map((group) => <div className="expand-file" key={`path-${group.path}`}><b className="expand-name">重复路径：{group.path}</b><span>{group.items.map((item) => item.assetTitle).join("、")}</span></div>)}{duplicateGroups.checksums.map((group) => <div className="expand-file" key={`hash-${group.checksum}`}><b className="expand-name">相同 SHA-256：{group.checksum.slice(0, 16)}…</b><span>{group.items.map((item) => item.assetTitle).join("、")}</span></div>)}</>}</div><footer><button className="cancel-button" onClick={() => setDuplicateOpen(false)}>关闭</button></footer></div></div>}

      {trashOpen && <div className="modal-layer compact-layer" role="dialog" aria-modal="true" aria-label="回收站"><div className="category-modal"><header><div><div className="modal-mini-icon"><Inbox size={18} /></div><h2>回收站</h2><p>资产可恢复；永久删除后无法撤回。</p></div><button className="icon-button" onClick={() => setTrashOpen(false)} aria-label="关闭"><X size={18} /></button></header><div className="trash-list">{!trashItems.length ? <p>回收站为空。</p> : trashItems.map((item) => <div className="expand-file" key={item.assetId}><b className="expand-name">{item.snapshot.asset?.title ?? "未命名资产"}</b><span className="expand-cat">{new Date(item.deletedAt).toLocaleString("zh-CN")}</span><button className="ghost-tiny" onClick={async () => { const response = await fetch("/api/vault/trash", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.assetId }) }); if (!response.ok) { notify("恢复失败。", "error"); return; } setTrashItems((items) => items.filter((entry) => entry.assetId !== item.assetId)); await refresh(); notify("资产已恢复。"); }}>恢复</button><button className="ghost-tiny" onClick={async () => { if (!window.confirm("永久删除该资产？")) return; const response = await fetch("/api/vault/trash", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.assetId }) }); if (response.ok) { setTrashItems((items) => items.filter((entry) => entry.assetId !== item.assetId)); notify("资产已永久删除。"); } else notify("永久删除失败。", "error"); }}>永久删除</button></div>)}</div><footer><button className="cancel-button" onClick={() => setTrashOpen(false)}>关闭</button></footer></div></div>}

      {categoryDialog && <div className="modal-layer compact-layer" role="dialog" aria-modal="true" aria-label="新建软件空间">
        <div className="category-modal">
          <header><div><div className="modal-mini-icon"><FolderPlus size={18} /></div><h2>新建软件空间</h2><p>为一款 DCC 软件或流程环节建立独立分类。</p></div><button className="icon-button" onClick={() => setCategoryDialog(false)} aria-label="关闭"><X size={18} /></button></header>
          <label>空间名称<input value={newCategory.name} onChange={(event) => setNewCategory((current) => ({ ...current, name: event.target.value }))} placeholder="例如：Nuke" autoFocus /></label>
          <label>空间说明 <span className="field-hint">可选</span><input value={newCategory.description} onChange={(event) => setNewCategory((current) => ({ ...current, description: event.target.value }))} placeholder="合成工具与节点模板" /></label>
          <div className="color-picker-label"><span>主题色</span><div>{["#34d399", "#60a5fa", "#a78bfa", "#fb923c", "#f87171", "#f472b6", "#fbbf24"].map((color) => <button key={color} onClick={() => setNewCategory((current) => ({ ...current, color }))} className={newCategory.color === color ? "selected" : ""} style={{ backgroundColor: color }} aria-label={`选择颜色 ${color}`}>{newCategory.color === color && <Check size={14} />}</button>)}</div></div>
          <footer><button className="cancel-button" onClick={() => setCategoryDialog(false)}>取消</button><button className="save-button" onClick={() => void saveCategory()}><Plus size={16} /> 创建空间</button></footer>
        </div>
      </div>}

      {toast && <div className={`toast ${toast.tone}`}><span>{toast.tone === "success" ? <Check size={16} /> : <X size={16} />}</span>{toast.message}</div>}
    </div>
  );
}
