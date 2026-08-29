# CG Vault（本地 JSON 版）

面向 CG 技术美术的本地资产库：统一管理 **脚本代码** 与 **CG 文件资产**（FBX / BVH / ABC / USD / 工程文件等），带路径别名、可达性校验、标签搜索与历史版本。

数据全部保存在项目目录的 JSON 文件里，**不需要 PostgreSQL、Drizzle 或任何数据库**。

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

## 两类资产

| 类型 | 用途 | 正文 |
| --- | --- | --- |
| 代码片段 / 可执行脚本 | Python、MEL、VEX、JS、C# 等 | 直接保存代码文本 |
| 参考链接 | 文档、插件下载地址、流程规范 | 保存说明文本 + 链接列表 |
| 文件资产 | FBX、BVH、ABC、USD、DCC 工程文件 | 保存「文件清单 + 路径」，正文作为交付说明 |

文件资产不会把大文件复制进仓库，只登记路径、格式、大小、校验和等信息；实际文件仍留在工程目录或 NAS 上。

## 脚本包 · 部署与调用

Maya / Houdini / Blender 的脚本往往不是单文件，而是「多文件组成的包 / 模块」。CG Vault 为代码类资产单独提供一层细化配置：

- **包形态**：单文件脚本 / 多文件包（模块），后者可像文件资产一样登记 `__init__.py` 等多个组成文件
- **目标软件 + 模块名 + 安装子路径**：例如 `my_rig_tools` → `scripts/my_rig_tools`
- **安装位置**：内置常用部署目标
  - Maya：`~/Documents/maya/scripts`（用户脚本目录）、`modules/*.mod`（模块目录）
  - Houdini：`packages/*.json`、`scripts/python2.7libs`
  - Blender：`addons/`（带 `bl_info` 的插件目录）
  - Unreal：`<Project>/Content/Python`（Editor Python 启动注入）
  - Nuke：`~/.nuke/menu.py`
- **安装方式**：复制目录 / 符号链接（junction）/ 包描述文件 / 环境变量追加 / shelf·菜单注入
- **入口与调用**：是否有入口函数、函数名、调用方式（shelf 按钮 / 菜单 / 命令行 / 模块导入 / 批处理 / 启动注入），自动生成调用示例
- **一键生成描述文件内容**：Houdini `packages.json`、Maya `.mod`、Blender `bl_info` 等模板，可直接复制到对应目录

部署计划与内容、文件清单一样纳入版本历史，改部署配置也会生成新版本、可整体恢复。

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

编辑器里的「校验全部」批量核对；「校验并算 MD5」会对 64 MB 以下的文件计算 MD5 并记录，用作交付一致性凭据。

因此把 CG Vault 部署在能访问 NAS 的机器上（工作站 / 内网服务器 / NAS 本机）最有意义。

## 格式细分

按扩展名自动归类，并可手动覆盖：

- 模型 / 交换：fbx、obj、gltf、glb、ztl
- 动画 / 动捕：bvh、c3d
- 几何缓存：abc、vdb、vrmap
- USD 装配：usd、usda、usdc、usdz
- DCC 工程：ma、mb、hip、hipnc、blend、max
- 贴图 / 序列：png、jpg、tga、exr、tx、tif、sbsar
- 预览影片：mov、mp4、gif

顶部的「格式细分」「状态」两组筛选可与软件空间、资产类型组合使用。

## 技术元数据

文件资产带一组交付核对字段：帧范围、帧率、单位、上轴、LOD 层级、引用策略。
单位与上轴不一致是 DCC 之间模型缩放 / 朝向错误的常见原因，建议交付时填写。

## 版本与并发保护

- 内容或文件清单变更都会把旧版本（含当时的文件清单）写入历史，最多保留 20 条
- 每次保存都会提交 `revision`，服务器版本不一致时拒绝覆盖并提示刷新
- JSON 采用「写临时文件 → fsync → rename」的原子替换，避免中断导致文件损坏
- 单进程内置写入队列；多实例并发写同一目录不保证一致，建议只跑一个服务进程

## 目录浏览导入

编辑器 → 「从目录导入」：选择别名或直接输入目录，可逐级浏览，点击文件即加入当前资产，
并自动折叠回 `$别名/相对路径` 形式（当文件确实位于该别名根目录下时）。

## 主要 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET / POST | `/api/vault` | 快照（含别名）/ 新建资产 |
| GET / PATCH / DELETE | `/api/vault/assets/{id}` | 资产详情与历史 / 保存 / 删除 |
| GET / POST | `/api/vault/path-aliases` | 别名列表 / 新建 |
| PATCH / DELETE | `/api/vault/path-aliases/{id}` | 修改 / 删除别名 |
| POST | `/api/vault/files/check` | 批量路径校验，可选 `withHash` |
| POST | `/api/vault/files/scan` | 目录浏览 |
| POST | `/api/vault/categories` | 新建软件空间 |

## 备份与恢复

停止服务后复制 `config/` 与 `stored_texts/` 即可（`asset_library/` 只是示例文件）。

```powershell
Copy-Item .\config .\backup\config -Recurse
Copy-Item .\stored_texts .\backup\stored_texts -Recurse
```

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

## 后续可选升级

1. 认证与只读分享链接（当前无登录，任何能访问端口的人都能读写）
2. 索引与全文检索加速（资产上千条时考虑 SQLite / FTS）
3. 真正的文件版本库（LFS 或对象存储 + 校验和对比）
4. DCC 插件：Maya / Houdini / Blender 内直接搜索与推送代码、下载文件
5. 本地 Agent：实现「打开所在目录」「启动软件并加载文件」等浏览器做不到的动作
