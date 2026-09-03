# CG Vault（本地 SQLite 版）

面向 CG 技术美术的本地资产库：统一管理 **脚本代码** 与 **CG 文件资产**（FBX / BVH / ABC / USD / 工程文件等），带路径别名、可达性校验、标签搜索、全文检索与历史版本。

数据以 **JSON 文档** 的形式保存在本地 SQLite 数据库 `data/cg-vault.sqlite` 里，**不需要 PostgreSQL 或 Drizzle**。历史遗留的 `config/*.json` 与 `stored_texts/*.json` 会在首次运行时自动导入 SQLite，之后以数据库为准。

## 本地 Windows 运行

1. 安装 Node.js 20 LTS 或更高版本。
2. 在项目根目录（`package.json` 所在目录）打开 PowerShell。
3. 安装依赖并启动：

```powershell
npm install
npm run dev
```

4. 浏览器访问 `http://localhost:3000`。

首次访问会自动生成：

```text
config/cg_manager_config.json   # 软件空间 + 资产元数据（含文件清单）
config/path_aliases.json        # 路径别名（$SHOW、$PUB、$TEX …）
stored_texts/*.json             # 每个资产的正文与历史版本
asset_library/                  # 示例资产文件（可删除，仅用于演示可达性校验）
```

## 出现的报错：`DATABASE_URL is required`

说明本地仍是旧数据库版或 `.next` 缓存过期。运行修复脚本：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\repair-json-storage.ps1
npm install
npm run dev
```

## 三类资产

| 类型 | 用途 | 正文 |
| --- | --- | --- |
| 代码/脚本 | Python、MEL、VEX、JS 等；可直接粘贴，也可登记路径 | 代码文本或用法说明 |
| 参考链接 | 文档、插件下载地址、流程规范 | 说明文本 + 链接列表 |
| 文件资产 | FBX、BVH、ABC、USD、DCC 工程文件 | 保存「路径清单」，正文作为交付说明 |

核心字段就是 **标题、标签、描述、路径、软件空间、类型** 六个；其余信息（模型类型、帧范围、安装方式等）直接写进描述即可，不再单独细分。

文件资产不会把大文件复制进仓库，只登记路径、格式、大小、校验和等信息；实际文件仍留在工程目录或 NAS 上。

## 路径：单文件 / 文件夹

每条路径都可以是**单个文件**或**整个文件夹**（切换「文件 / 目录」即可）：

- 单文件：`$PUB/model/hero_body.fbx`
- 文件夹：`$SHOW/tools/my_rig_tools`（工具包、插件目录整目录登记）

「代码/脚本」类型的路径是可选的——纯粘贴的片段可以没有路径；多文件工具包登记一条文件夹路径即可，也可以添加多条路径。脚本语言按第一条可识别扩展名的路径自动推断（`.py` → Python、`.vex` → VEX……）。

## 路径写法与别名

推荐统一写成 `$别名/相对路径`：

```text
$PUB/model/hero_body.fbx
$TEX/hero_body_basecolor.png
$SHOW/character/hero_rig.ma
```

也支持 `${PUB}/model/x.fbx` 与绝对路径（`D:\Show\...`、`\\server\share\...`、`/show/...`）。

好处：换机器、换 Show、盘符变化时，只需在「路径管理」里改一条别名根路径，所有资产路径自动跟着变。

别名可「启用 / 停用」；停用的别名会让相关路径显示为无法解析，便于临时下线某块存储。
删除仍被引用的别名会被服务端拒绝（返回引用数量）。

## 可达性校验

CG Vault 会用**运行服务的那台机器**的文件系统真实执行 `stat`：

- 存在 → 显示真实大小与磁盘修改时间
- 缺失 → 标记「路径缺失」，侧栏汇总缺失数量，可一键「重新扫描磁盘」
- 无权限或网络盘未挂载 → 标记「无法访问」并给出原因

编辑器里的「校验全部」批量核对；「校验并算 SHA-256」会对 64 MB 以下的文件计算 SHA-256 并记录，用作交付一致性凭据；历史 MD5 记录仍可读取。

**文件变更状态**：登记了 size 或 SHA-256 的文件，服务端会把磁盘实况与登记基线对比——

- 磁盘大小与登记不一致 → 标记「已变更」并给出原因；
- 「校验并算 SHA-256」时会做校验和级对比，发现哈希漂移即报「校验和已变化」；
- 首页卡片 / 表格 / 编辑器都会显示「已变更」徽标，便于发现交付物被悄悄改动。

因此把 CG Vault 部署在能访问 NAS 的机器上（工作站 / 内网服务器 / NAS 本机）最有意义。

## 格式与筛选

格式按扩展名自动识别（fbx、abc、usd、ma、png……），用于徽标与搜索；无需手动归类，细节写进描述即可。

顶部的「资产类型」与「路径状态」筛选可与软件空间组合使用；搜索框支持标题、标签、正文、路径与校验和。

## SQLite 全文索引与分页

资产数据会派生到 SQLite 的关系表（`assets` / `asset_files` / `categories` / `path_aliases` / `asset_revisions`）与 **FTS5 全文索引**（trigram 分词，兼顾英文与中文子串检索）中，这些表可随时重建、不含权威数据：

- `GET /api/vault?q=…&kind=…&categoryId=…&page=…&pageSize=…`：服务端全文检索 + 过滤 + 分页，只水合当前页，适合上千条资产的大库。
- 不足 3 个字符的查询（trigram 无法命中）自动回退到 `LIKE` 子串匹配，保证中文 1–2 字词也能搜到。
- `GET /api/vault/report`：关系表聚合报告（别名引用、分类/格式统计、缺失校验和、重复项）。
- 首页的资产列表自带分页控件（每页条数、页码、上一页/下一页），筛选或搜索后自动回到第一页。

## 版本与并发保护

- 内容或文件清单变更都会把旧版本（含当时的文件清单）写入历史，最多保留 20 条
- 每次保存都会提交 `revision`，服务器版本不一致时拒绝覆盖并提示刷新
- JSON 采用「写临时文件 → fsync → rename」的原子替换，避免中断导致文件损坏
- 单进程内置写入队列；多实例并发写同一目录不保证一致，建议只跑一个服务进程

## 目录浏览导入

编辑器 → 「从目录导入」：选择别名或直接输入目录，可逐级浏览。点击文件即加入当前资产；文件夹可点「加入目录」整目录登记，
并自动折叠回 `$别名/相对路径` 形式（当文件确实位于该别名根目录下时）。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/api/vault` | 快照（含别名）/ 新建资产 |
| GET / PATCH / DELETE | `/api/vault/assets/{id}` | 资产详情与历史 / 保存 / 删除 |
| GET / POST | `/api/vault/path-aliases` | 别名列表 / 新建 |
| PATCH / DELETE | `/api/vault/path-aliases/{id}` | 修改 / 删除别名 |
| POST | `/api/vault/files/check` | 批量路径校验，可选 `withHash`；带登记基线时可检测「文件变更」 |
| POST | `/api/vault/files/scan` | 目录浏览 |
| POST | `/api/vault/categories` | 新建软件空间 |
| GET | `/api/vault/report` | 关系表聚合报告（SQL 关联查询） |

## 备份与恢复

SQLite 数据库位于 `data/cg-vault.sqlite`。建议使用内置命令备份（`asset_library/` 只是示例文件）：

```powershell
npm run backup
npm run restore -- data/backups/cg-vault-xxxx.sqlite
```

恢复前会自动保留当前数据库为 `cg-vault.sqlite.before-restore.bak`。

> 注意：数据现在以 SQLite 数据库为准，首次写入后 `config/` 与 `stored_texts/` 里的 JSON 文件不再同步更新，手动复制这两个目录无法得到最新数据。请统一使用 `npm run backup` / `npm run restore`。

## 重置为初始示例数据

```powershell
Remove-Item .\config\*.json -ErrorAction SilentlyContinue
Remove-Item .\stored_texts\*.json -ErrorAction SilentlyContinue
```

然后刷新页面，系统会重新生成中文示例资产与示例文件。

## 关于 Hydration / 注水警告

若控制台出现 `trancy-version="7.9.1"` 之类的提示，通常是翻译类浏览器扩展在注水前修改了 `<html>` 属性。
`src/app/layout.tsx` 已在 `<html>` 上加 `suppressHydrationWarning`（只作用于该层属性）。
本项目也避免在渲染期直接使用 `Date.now()` 与区域化时间格式，时间均在客户端挂载后计算。

## 访问权限与备份

默认情况下，运行服务的本机拥有读写权限，其他机器只能读取和搜索，所有写入 API 会返回 403。反向代理部署时必须正确传递 `x-forwarded-for` 或 `x-real-ip`；仅在明确受信任的内网环境中才设置 `CG_ALLOW_REMOTE_WRITE=true` 放开远程写入。

每次修改 JSON 前会在同目录保留上一份 `.bak` 文件。建议定期复制 `config/` 与 `stored_texts/` 到独立备份位置。
