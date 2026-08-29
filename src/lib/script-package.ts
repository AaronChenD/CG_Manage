/**
 * 脚本包 / 部署与调用细化 —— 纯数据 + 纯函数，客户端、服务端共用。
 *
 * 解决「一个脚本不是单文件，而是多个文件组成的包 / 模块」的问题：
 *  - 需要安装到 DCC 的脚本目录（如 Maya 的 scripts/、Houdini 的 packages/）
 *  - 需要明确的调用 / 入口方式（shelf 按钮、菜单、命令行、模块导入等）
 */

export type PackageKind = "单文件脚本" | "多文件包 / 模块";

export type InstallTargetDTO = {
  key: string;
  dcc: string;
  label: string;
  /** 例如 Maya 的 scripts/、Houdini 的 packages/、Unreal 的 Python/。安装根路径相对 DCC 用户目录。 */
  dirHint: string;
  /** 这个软件对应的系统变量 / 模块根（例如 MAYA_SCRIPT_PATH、HOUDINI_OTLSCAN_PATH）。 */
  envVar: string;
  /** 首选安装方式。 */
  strategy: "复制目录" | "符号链接" | "包描述文件" | "启动脚本注入";
  description: string;
  icon: string;
};

export type InstallMethodDTO = {
  key: string;
  label: string;
  hint: string;
};

export const INSTALL_METHODS: InstallMethodDTO[] = [
  { key: "copy", label: "复制到脚本目录", hint: "把整个包复制过去，改动后需重新同步" },
  { key: "symlink", label: "符号链接 / junction", hint: "保留单一来源，改动即时生效，需要权限" },
  { key: "package-json", label: "包描述文件（.json）", hint: "Houdini / Blender 等支持 packages 的软件" },
  { key: "env-append", label: "追加环境变量路径", hint: "通过初始化脚本把路径加入 MAYA_SCRIPT_PATH 等" },
  { key: "shelf-inject", label: "shelf / 菜单注入", hint: "注册一个按钮，点击后再导入模块" },
];

/** 各 DCC 的部署目标定义（可按需扩充）。 */
export const INSTALL_TARGETS: InstallTargetDTO[] = [
  {
    key: "maya-scripts",
    dcc: "Maya",
    label: "用户脚本目录 scripts/",
    dirHint: "~/Documents/maya/scripts",
    envVar: "MAYA_SCRIPT_PATH",
    strategy: "复制目录",
    description: "Maya 的 .mel 与 .py 都从这里加载；shelf 按钮放在同级 shelves/ 下。",
    icon: "box",
  },
  {
    key: "maya-modules",
    dcc: "Maya",
    label: "模块目录 modules/",
    dirHint: "~/Documents/maya/modules/*.mod",
    envVar: "MAYA_MODULE_PATH",
    strategy: "符号链接",
    description: "用 .mod 文件把整个模块文件夹挂进 Maya，方便做成团队统一环境。",
    icon: "box",
  },
  {
    key: "houdini-packages",
    dcc: "Houdini",
    label: "packages/*.json",
    dirHint: "~/houdini19.x/packages",
    envVar: "HOUDINI_PATH",
    strategy: "包描述文件",
    description: "用 JSON 声明包的加载路径，可同时注入 Python 与 OTL 环境。",
    icon: "sparkles",
  },
  {
    key: "houdini-python",
    dcc: "Houdini",
    label: "scripts/python2.7libs",
    dirHint: "~/houdini19.x/scripts/python2.7libs",
    envVar: "PYTHONPATH",
    strategy: "复制目录",
    description: "纯 Python 包也可以放进 Houdini 的 python2.7libs 下直接 import。",
    icon: "sparkles",
  },
  {
    key: "blender-addon",
    dcc: "Blender",
    label: "addons/ 插件目录",
    dirHint: "%APPDATA%/Blender Foundation/Blender/4.x/scripts/addons",
    envVar: "BLENDER_USER_SCRIPTS",
    strategy: "复制目录",
    description: "带 bl_info 的插件目录在偏好设置里启用，装载为 add-on。",
    icon: "aperture",
  },
  {
    key: "unreal-python",
    dcc: "Unreal Engine",
    label: "Python 脚本目录",
    dirHint: "<Project>/Content/Python",
    envVar: "UE_PYTHONPATH",
    strategy: "启动脚本注入",
    description: "Editor Python 插件会执行 Content/Python 下的 init_unreal.py 与 startup 脚本。",
    icon: "gamepad",
  },
  {
    key: "nuke-menu",
    dcc: "Nuke",
    label: "menu.py / pak",
    dirHint: "~/.nuke",
    envVar: "NUKE_PATH",
    strategy: "启动脚本注入",
    description: "menu.py 在启动时执行，用于注册菜单与工具集。",
    icon: "aperture",
  },
  {
    key: "houdini-toolbar",
    dcc: "Houdini (Desktop)",
    label: "toolbar/*.shelf",
    dirHint: "~/houdini19.x/toolbar",
    envVar: "HOUDINI_TOOLBAR_PATH",
    strategy: "启动脚本注入",
    description: "注册 shelf 按钮，点击后调用包里的工具。",
    icon: "sparkles",
  },
];

export function installTargetOf(dcc: string, key: string) {
  return INSTALL_TARGETS.find((target) => target.key === key) ?? INSTALL_TARGETS.find((target) => target.dcc === dcc) ?? null;
}

export function installTargetsFor(dcc: string): InstallTargetDTO[] {
  return INSTALL_TARGETS.filter((target) => target.dcc === dcc);
}

/**
 * 各软件的调用示例 / 模板。用于在编辑器与详情里给出「怎么触发这个脚本」。
 */
export function invocationSnippet(targetKey: string, moduleName: string, entry: string, language: string): string {
  const m = moduleName || "my_tool";
  const e = entry || "main";
  const target = INSTALL_TARGETS.find((item) => item.key === targetKey);
  const isMel = language.toLowerCase() === "mel";
  switch (targetKey) {
    case "maya-scripts":
    case "houdini-python":
    case "unreal-python":
      if (isMel) return `// Maya 脚本编辑器 / shelf 里调用\nsource "${m}.mel";\n${e}();`;
      return `import ${m}\n${m}.${e}()    # ${target?.dcc ?? "DCC"} 脚本编辑器 / shelf 按钮`;
    case "maya-modules":
      return `# 1) 把 ${m}.mod 放进 modules/ 目录\n# 2) 脚本编辑器调用\nimport ${m}\n${m}.${e}()`;
    case "houdini-packages":
      return `# ${m}.json 已在 packages/ 注册\nimport ${m}\n${m}.${e}()\n# 或在 shelf 按钮里写：\nimport ${m}; ${m}.${e}()`;
    case "blender-addon":
      return `# 偏好设置 → 插件 里启用后即可用\nimport bpy\nbpy.ops.${m.replaceAll("_", ".")}.${e}()`;
    case "nuke-menu":
      return `# 启动时 menu.py 自动注册菜单\nnukescripts.register_sidebar()\n# 或快捷键调用 ${m}.${e}()`;
    case "houdini-toolbar":
      return `# 在 toolbar/${m}.shelf 里新增按钮\nimport ${m}\n${m}.${e}()`;
    default:
      return `import ${m}\n${m}.${e}()`;
  }
}

/** 生成一份目标软件的包描述文件内容（Houdini packages.json / Maya .mod）。 */
export function packageDescriptorSnippet(targetKey: string, moduleName: string, installRoot: string): string {
  const m = moduleName || "my_tool";
  if (targetKey === "houdini-packages") {
    return `${JSON.stringify(
      {
        env: [
          { PYTHONPATH: `\${${dirVar(targetKey)}}/${m}/python` },
          { HOUDINI_OTLSCAN_PATH: `\${${dirVar(targetKey)}}/${m}/otls` },
        ],
      },
      null,
      2,
    )}`;
  }
  if (targetKey === "maya-modules") {
    const root = installRoot || "<公司网络盘>/maya/modules";
    return `+ ${m} 1.0 ${m}\nMAYA_SCRIPT_PATH +:= scripts\nPYTHONPATH +:= python\n`;
  }
  if (targetKey === "blender-addon") {
    return `# ${m}/__init__.py 内必须包含 bl_info\nbl_info = {"name": "${m}", "blender": (4, 0, 0), "category": "Object"}`;
  }
  if (targetKey === "unreal-python") {
    return `# 放入 <Project>/Content/Python/init_unreal.py\nimport unreal\nfrom ${m} import ${m === "init_unreal" ? "register_menu" : "main"}`;
  }
  return `# ${m} 直接放入脚本目录即可\nimport ${m}\n${m}.main()`;
}

function dirVar(targetKey: string) {
  switch (targetKey) {
    case "houdini-packages":
      return "V:/tools";
    case "maya-modules":
      return "V:/maya/modules";
    default:
      return "V:/tools";
  }
}

export const CALL_CONTEXTS = [
  { key: "shelf", label: "Shelf 按钮", hint: "点击工具栏按钮触发" },
  { key: "menu", label: "菜单项", hint: "从主菜单 / 右键菜单调用" },
  { key: "cli", label: "命令行", hint: "终端或批处理调用" },
  { key: "import", label: "模块导入", hint: "import 后在脚本编辑器运行" },
  { key: "batch", label: "批处理 / 后台", hint: "农场或无人值守执行" },
  { key: "startup", label: "启动注入", hint: "软件启动时自动执行" },
  { key: "shelf-startup", label: "启动 + 按钮", hint: "启动注册，按钮触发" },
] as const;

export type CallContext = (typeof CALL_CONTEXTS)[number]["key"];

export function callContextLabel(key: string) {
  return CALL_CONTEXTS.find((context) => context.key === key)?.label ?? key;
}

export type DeployPlanDTO = {
  /** 该脚本包适用的软件（对应目标软件 / 空间）。 */
  dcc: string;
  /** 安装目标 key（INSTALL_TARGETS）。 */
  installTarget: string | null;
  /** 安装后相对 DCC 目录的位置，例如 scripts/my_tool。 */
  installSubpath: string;
  /** 安装方式。 */
  installMethod: string;
  /** 是否已有入口 / main 之类可调用函数。 */
  hasEntry: boolean;
  /** 入口函数名。 */
  entryPoint: string;
  /** 调用触发方式。 */
  callContext: string;
  /** 示例调用代码。 */
  invocation: string;
  createdAt: string;
  updatedAt: string;
};

export function emptyDeployPlan(dcc = ""): DeployPlanDTO {
  const timestamp = "";
  return {
    dcc,
    installTarget: null,
    installSubpath: "",
    installMethod: "copy",
    hasEntry: true,
    entryPoint: "main",
    callContext: "import",
    invocation: "",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export type DeployInput = Partial<DeployPlanDTO>;

/** 构造一个新的部署计划，自动补全入口与调用示例。 */
export function buildDeployPlan(input: DeployInput, moduleName = "", dcc = ""): DeployPlanDTO {
  const plan: DeployPlanDTO = {
    ...emptyDeployPlan(dcc),
    ...input,
    dcc: input.dcc ?? dcc,
    installMethod: input.installMethod ?? "copy",
    hasEntry: input.hasEntry === undefined ? true : input.hasEntry,
    entryPoint: input.entryPoint ?? "main",
    callContext: input.callContext ?? "import",
  };
  plan.invocation = plan.invocation?.trim()
    ? plan.invocation
    : invocationSnippet(plan.installTarget ?? "", moduleName, plan.entryPoint, "python");
  return plan;
}
