# NapCat 插件开发模板

一个快速开始 NapCat 插件开发的模板项目，基于实际生产项目架构提炼而成。

## 📁 项目结构

```
napcat-plugin-template/
├── packages/
│   ├── plugin/               # 插件后端（发布物）
│   │   ├── package.json      # 插件元信息（name / napcat 字段等）
│   │   ├── vite.config.ts    # Vite 构建配置（含资源复制插件；--mode deploy 才热部署）
│   │   ├── vitest.config.ts  # 单测配置（只测纯函数，跑 node 环境）
│   │   ├── tsconfig.json
│   │   ├── test/             # 单测（范式里的纯函数模块逐一覆盖）
│   │   └── src/
│   │       ├── index.ts              # 插件入口，导出生命周期函数
│   │       ├── config.ts             # 配置定义和 WebUI Schema
│   │       ├── types.ts              # 类型定义（从 shared 重导出）
│   │       ├── core/
│   │       │   ├── state.ts          # 全局状态管理单例 + 配置清洗
│   │       │   └── admin.ts          # 权限模块：四档角色推导与线性比较
│   │       ├── utils/
│   │       │   └── atBotPrefix.ts    # 指令触发判定 + @机器人 CQ 段剥离（纯函数）
│   │       ├── handlers/
│   │       │   ├── messageHandler.ts       # 接收层：会话启用 → 触发判定 → 切词 → 分发
│   │       │   ├── instructionRegistry.ts  # 指令注册表（两级命名空间）
│   │       │   ├── instructionDispatch.ts  # 分发层：统一校验、失败反馈不对称
│   │       │   ├── utils.ts                # 发送工具 + 消息段工厂
│   │       │   └── commands/               # 执行层：按模块分的指令 handler
│   │       └── services/
│   │           └── apiService.ts     # WebUI API 路由（无认证模式）
│   ├── webui/                # React SPA 前端（独立构建）
│   │   ├── package.json
│   │   ├── index.html
│   │   ├── public/favicon.ico     # 站点图标（替换此文件即可自定义）
│   │   ├── scripts/favicon.ts     # 图标扫描/内联（构建期）
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── App.tsx           # 应用根组件，页面路由
│   │       ├── main.tsx          # React 入口
│   │       ├── index.css         # TailwindCSS + 自定义样式
│   │       ├── types.ts          # 前端类型定义（从 shared 重导出）
│   │       ├── vite-env.d.ts     # Vite 环境声明
│   │       ├── utils/
│   │       │   └── api.ts        # API 请求封装（noAuthFetch / authFetch）
│   │       ├── hooks/
│   │       │   ├── useStatus.ts  # 状态轮询 Hook
│   │       │   ├── useTheme.ts   # 主题切换 Hook
│   │       │   └── useToast.ts   # Toast 通知 Hook
│   │       ├── components/
│   │       │   ├── Sidebar.tsx       # 侧边栏导航
│   │       │   ├── Header.tsx        # 页面头部
│   │       │   ├── ToastContainer.tsx # Toast 通知容器
│   │       │   └── Icons.tsx         # SVG 图标组件
│   │       └── pages/
│   │           ├── StatusPage.tsx  # 仪表盘页面（含插件配置）
│   │           └── SessionsPage.tsx # 会话管理页面（群聊/好友）
│   └── shared/               # 前后端共享类型（单一事实来源）
│       ├── package.json
│       └── src/
│           └── index.ts      # PluginConfig / SessionConfig / ApiResponse 等
├── .github/
│   ├── workflows/
│   │   └── release.yml        # CI/CD 自动构建发布
│   └── prompt/
│       ├── default.md             # 默认 Release Note 模板（回退用）
│       └── ai-release-note.md     # （可选）AI Release Note 自定义 Prompt
├── package.json              # workspace 根（仅编排脚本）
├── pnpm-workspace.yaml
├── tsconfig.base.json        # 基础 TS 配置（各包 extends）
├── biome.json
├── AGENTS.md                 # AI 编程代理指令（唯一权威）
└── README.md
```

## 🚀 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 修改插件信息与包名

本模板是 pnpm monorepo，共三个包，各自 `package.json` 的 `name` 字段如下：

| 包 | 路径 | 当前 `name` | 说明 |
|----|------|-------------|------|
| 插件后端（发布物） | `packages/plugin` | `napcat-plugin-template` | 插件唯一 ID，**必须**以 `napcat-plugin-` 开头；决定部署后的插件目录名与 WebUI 访问路径 |
| WebUI 前端 | `packages/webui` | `webui` | 内部包（`private`），仅本地构建使用 |
| 共享类型 | `packages/shared` | `shared` | 内部包（`private`），前后端类型单一事实来源 |

**推荐做法**：把占位符 `template` 换成自己的插件名，例如 `napcat-plugin-your-name`。至少要修改插件包的字段：

```json
{
    "name": "napcat-plugin-your-name",
    "plugin": "你的插件显示名",
    "description": "你的插件描述",
    "author": "你的名字"
}
```

> ⚠️ **为什么 `name` 必须以 `napcat-plugin-` 开头**：NapCat 以该字段作为插件唯一 ID 来定位插件目录与 WebUI 路由（`/plugin/<name>/`）。若使用 `@scope/name` 这类不符合规范的名字，插件索引校验会失败，部署后 WebUI 页面也将无法访问（访问 `/plugin/@scope/name/` 会 404）。

**若同时重命名内部包**（`webui` / `shared`）：这两个是 `private` 的 workspace 包，改名后必须同步更新以下引用，否则 `pnpm install` 将无法解析 workspace 依赖：

- 根 `package.json` 里所有 `pnpm --filter <name>` 的过滤包名；
- 各包 `package.json` 的 `devDependencies`（`"webui": "workspace:*"` / `"shared": "workspace:*"`）；
- 源码 import：`packages/plugin/src/types.ts` 与 `packages/webui/src/types.ts` 中的 `from 'shared'`；
- 最后重新执行 `pnpm install` 刷新 `pnpm-lock.yaml`。

通常无需改动内部包名，只改插件包 `name` 即可。

### 2.1 替换站点图标（可选）

默认使用 NapCat 官方图标（来源: [NapCatQQ](https://github.com/NapNeko/NapCatQQ) `packages/napcat-webui-frontend/public/favicon.ico`, Copyright © 2024 Mlikiowa, 原样未修改）。

替换 `packages/webui/public/favicon.*` 即可，支持 `svg / png / ico / jpg / jpeg / webp / gif / avif`，目录内只能保留一个 favicon 文件（换格式时先删除旧文件）。构建时图标会内联为 data URI 写入 `index.html`：超过 64KB 给出警告，超过 256KB 构建失败。

> NapCat 默认以 iframe 嵌入插件页，因此 favicon 只在独立打开或新窗口时生效，不会改变宿主标签页图标。

### 3. 开发你的功能

- **添加配置项**: 编辑 `packages/shared/src/index.ts`（前后端类型同步生效）和 `packages/plugin/src/config.ts`
- **消息处理**: 编辑 `packages/plugin/src/handlers/messageHandler.ts`
- **API 路由**: 编辑 `packages/plugin/src/services/apiService.ts`
- **状态管理**: 编辑 `packages/plugin/src/core/state.ts`
- **WebUI 页面**: 编辑 `packages/webui/src/pages/` 下的页面组件

### 4. 构建 & 开发

```bash
# 完整构建（webui 前端 + 插件后端 + 资源复制，一步完成）
# 只产出 dist/，不会连接调试服务，可以安全地在任意环境执行
pnpm run build

# 单元测试（范式里的纯函数模块：配置清洗 / @机器人剥离 / 权限推导 / 消息段工厂 / 分发判定）
pnpm run test

# 仅构建 WebUI 前端（不构建后端）
pnpm --filter webui build

# WebUI 前端开发服务器（实时预览，推荐纯前端开发时使用）
pnpm run dev:webui

# 类型检查（全部包）
pnpm run typecheck
```

### 4.1 真机爬取测试

在仓库根目录 `.env` 填写两项（文件已被 gitignore）：

```dotenv
WEIBO_COOKIE="浏览器开发者工具复制的 Cookie 或 Playwright storageState JSON"
WEIBO_TEST_UID=1234567890
# 可选: 指定 Chrome/Edge 路径
WEIBO_CHROME_PATH=
```

```bash
pnpm weibo:test
```

脚本会用真实 Cookie 拉取该 UID 的第一页动态、博主资料与长文，逐条产出：

```
packages/plugin/.weibo-test/<uid>/<timestamp>/
├── index.html          # 卡片图 + 文本并排，带合格/被筛、长文、错误标记
├── manifest.json       # 每条元信息与汇总
├── posts.raw.json      # 第一页原始动态
├── 001-<mblogid>.txt   # 推送文本（图片位置写 [图片] <url>）
├── 001-<mblogid>.png   # 真实 Chromium 卡片截图
└── images/             # 主动态与原动态附图
```

只有第一页拉取失败才以非零码退出；profile、长文、截图、附图失败都会降级并在汇总页标注。产物目录已加入 `.gitignore`。

### 5. 调试 & 热重载

项目通过 Vite 插件 `napcatHmrPlugin` 集成了热重载能力，需要在 NapCat 端安装 `napcat-plugin-debug` 插件并启用。

```bash
# 一键部署：构建 → 自动复制到远程插件目录 → 自动重载
pnpm run deploy

# dev 部署：以 -dev 新 id 部署为独立插件，不覆盖远程正在运行的正式插件
pnpm run deploy:dev
```

> 热部署插件只在 `--mode deploy` / `--mode deploy-dev` 下挂载，因此 `build` 与部署是独立链路：
> `build` = `vite build`（纯构建）  
> `deploy` = `vite build --mode deploy`（构建完成时 Vite 插件自动部署+重载）  
> `deploy:dev` = `vite build --mode deploy-dev`（同上，但注册为独立 dev 插件）  
> `build` / `deploy` / `deploy:dev` 在仓库根目录与 `packages/plugin` 目录下都可用。

> **dev 部署身份**：`deploy:dev` 会在生成 `dist/package.json` 时改写元信息，令 NapCat 将其识别为**另一个插件**，从而与正在运行的正式插件并存：
> - id：`<name>-dev`（例如 `napcat-plugin-template-dev`）
> - 显示名：`[DEV] <plugin 显示名>`
> - 版本：`<version>-dev`
>
> 由于插件 id 不同，`removeDir` / `reloadPlugin` 只作用于 dev 插件，且其配置与数据目录（`ctx.configPath` / `ctx.dataPath`）与正式插件相互隔离。内嵌 WebUI 侧边栏仍显示正式名称与版本（WebUI 按正式身份构建）。

> **注意**：`pnpm run deploy` / `pnpm run deploy:dev` 均为一次性构建部署，不会监听文件变化。修改 WebUI 前端代码后，需先重新构建 WebUI（`pnpm --filter webui build`），再重跑部署命令即可随插件一起部署。
>
> 如果只开发 WebUI 前端，推荐使用 `pnpm run dev:webui` 启动前端开发服务器，可实时预览。

`packages/plugin/vite.config.ts` 中的 `copyAssetsPlugin` 会在构建时复制 WebUI 构建产物（由根 `pnpm run build` / `deploy` / `deploy:dev` 先行构建）；`napcatHmrPlugin()` 只在 `--mode deploy` / `--mode deploy-dev` 下挂载，会自动连接调试服务 → 复制 dist/ 到远程 → 调用 reloadPlugin。

如需自定义调试服务地址或 token：

```typescript
// vite.config.ts
napcatHmrPlugin({
  wsUrl: 'ws://192.168.1.100:8998',
  token: 'mySecret',
})
```

**CLI 交互模式（可选）：**

```bash
# 独立运行 CLI，进入交互模式（REPL）
npx napcat-debug

# 交互命令
debug> list              # 列出所有插件
debug> deploy            # 部署当前目录插件
debug> reload <id>       # 重载指定插件
debug> status            # 查看服务状态
```

构建产物在 `dist/` 目录下：

```
dist/
├── index.mjs           # 插件主入口（Vite 打包）
├── package.json        # 清理后的 package.json
└── webui/              # React SPA 构建产物
    └── index.html      # 单文件 SPA（vite-plugin-singlefile）
```

## 📖 架构说明

### 分层架构

```mermaid
graph TD
    Entry["index.ts (入口)<br/>生命周期钩子 + WebUI 路由/静态资源注册 + 事件分发"]
    Entry --> Handlers["Handlers<br/>消息处理入口"]
    Entry --> Services["Services<br/>业务逻辑"]
    Entry --> WebUI["WebUI<br/>前端界面"]
    Handlers --> State["core/state<br/>全局状态单例"]
    Services --> State
```

### 核心设计模式

| 模式 | 实现位置 | 说明 |
|------|----------|------|
| 单例状态 | `packages/plugin/src/core/state.ts` | `pluginState` 全局单例，持有 ctx、config、logger |
| 服务分层 | `packages/plugin/src/services/*.ts` | 按职责拆分业务逻辑 |
| 共享类型 | `packages/shared` | 前后端类型单一事实来源 |
| 配置校验 | `sanitizeConfig()` | 类型安全的运行时配置验证 |
| CD 冷却 | `cooldownMap` | `Map<groupId:command, expireTimestamp>` |

## 🔧 生命周期函数

| 导出 | 说明 |
|------|------|
| `plugin_init` | 插件初始化，加载配置、注册路由 |
| `plugin_onmessage` | 消息事件处理 |
| `plugin_cleanup` | 插件卸载，清理资源 |
| `plugin_config_ui` | WebUI 配置 Schema |
| `plugin_get_config` | 获取配置 |
| `plugin_set_config` | 设置配置 |
| `plugin_on_config_change` | 配置变更回调 |

## 🌐 WebUI API 路由

模板使用 **无认证路由**（`router.getNoAuth` / `router.postNoAuth`），适用于插件自带的 WebUI 页面调用。

> NapCat 路由器提供两种注册方式：
> - `router.get` / `router.post`：需要 NapCat WebUI 登录认证
> - `router.getNoAuth` / `router.postNoAuth`：无需认证，插件 WebUI 页面可直接调用

### 内置 API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/info` | 获取插件信息 |
| GET | `/status` | 获取运行状态、配置、统计 |
| GET | `/config` | 获取当前配置 |
| POST | `/config` | 保存配置（合并更新） |
| GET | `/sessions` | 获取会话列表（群 + 好友，含启用状态） |
| POST | `/sessions/:type/:id/config` | 更新单个会话配置（`type` 为 `group` / `private`） |
| POST | `/sessions/bulk-config` | 批量更新会话配置 |

### 前端调用方式

```javascript
// 无认证 API 请求
const url = `/api/plugin/${PLUGIN_NAME}${path}`;
const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
});
```

## 📝 编码约定

### ESM 模块规范

- `package.json` 中 `type: "module"`
- 构建目标 `ESNext`，输出 `.mjs`

### 状态访问模式

```typescript
import { pluginState } from '../core/state';

// 读取配置
const config = pluginState.config;

// 记录日志（三级别）
pluginState.log('info', '消息内容');
pluginState.log('warn', '警告内容');
pluginState.log('error', '错误内容', error);
pluginState.logDebug('调试信息'); // 仅 debug 模式输出

// 配置操作
pluginState.updateConfig({ key: value });          // 合并更新
pluginState.replaceConfig(fullConfig);             // 完整替换

// 会话级配置（群/好友）不在配置文件里，由独立 service 承载（默认关闭）
import { sessionConfigService } from '../services/sessionConfigService';
sessionConfigService.setSessionEnabled(id, type, enabled); // type: 'group' | 'private'
sessionConfigService.isSessionEnabled(id, type);           // 检查会话启用状态

// 调用 OneBot API
await pluginState.callApi('send_group_msg', { group_id, message });

// 统计
pluginState.incrementProcessedCount();
```

### 消息发送模式

```typescript
import {
    sendGroupMessage, sendPrivateMessage, sendGroupForwardMsg,
    setMsgEmojiLike, uploadGroupFile,
    textSegment, imageSegment, atSegment, replySegment, buildForwardNode
} from '../handlers/messageHandler';

// 发送群消息（带回复）
await sendGroupMessage(ctx, groupId, [
    replySegment(messageId),
    textSegment('消息内容')
]);

// 合并转发消息
const nodes = [
    buildForwardNode('10001', 'Bot', [textSegment('第一条')]),
    buildForwardNode('10001', 'Bot', [textSegment('第二条')]),
];
await sendGroupForwardMsg(ctx, groupId, nodes);

// 表情回复
await setMsgEmojiLike(ctx, messageId, '76');

// 上传群文件
await uploadGroupFile(ctx, groupId, '/path/to/file.zip', 'file.zip');
```

### API 响应格式

```typescript
// 成功响应
res.json({ code: 0, data: { ... } });

// 错误响应
res.status(500).json({ code: -1, message: '错误描述' });
```

## 🤖 AI 辅助开发

本仓库在根目录提供 [`AGENTS.md`](./AGENTS.md) 作为 AI 编程代理的唯一指令来源：快速导航、仓库结构、构建 / 验证 / 部署命令、硬规则清单与高频代码片段。支持 AGENTS.md 的 AI 助手（如 opencode、Codex、Cursor 等）会自动读取该文件。

### 使用方式

1. 用支持 AGENTS.md 的 AI 助手打开本项目，代理会自动加载根目录的 `AGENTS.md`
2. 结合 `docs/` 中的范式文档与 `CONTEXT.md` 领域术语进行开发
3. 需要查询 OneBot 11 API 接口时，参见 [napcat.apifox.cn](https://napcat.apifox.cn/) 或 `.example/plugin/api/`

## 🚀 CI/CD 自动发布

项目内置了自动构建发布工作流：

### 自动构建发布（`release.yml`）

推送 `v*` 格式的 tag 即可自动构建并创建 GitHub Release。

```bash
git tag v1.0.0
git push origin v1.0.0
```

也可在 GitHub Actions 页面手动触发，可选填版本号。

**基础自定义：**
- 修改 `release.yml` 中的 `PLUGIN_NAME` 为你的插件名称
- 默认 Release Note 模板位于 `.github/prompt/default.md`

#### 🤖 AI 生成 Release Note（可选）

支持接入任意兼容 OpenAI 格式的 AI API，自动根据 git commit 记录生成结构化的 Release Note。

**配置方式：** 在插件仓库 **Settings > Secrets and variables > Actions** 中添加以下 Secrets：

| Secret | 必填 | 说明 |
|--------|------|------|
| `AI_API_URL` | ✅ | 兼容 OpenAI 格式的 API 地址（如 `https://api.openai.com/v1/chat/completions`） |
| `AI_API_KEY` | ✅ | 对应的 API 密钥 |
| `AI_MODEL` | ❌ | 模型名称，默认 `gpt-4o-mini` |

**工作逻辑：**
- ✅ 配置了 `AI_API_URL` + `AI_API_KEY` → 自动调用 AI 生成 Release Note
- ❌ 未配置或 AI 调用失败 → 自动回退到默认模板（`.github/prompt/default.md`）或 commit log
- AI 调用失败不会阻断发布流程，始终保证 Release 正常创建

**自定义 AI Prompt：** 创建 `.github/prompt/ai-release-note.md` 文件即可覆盖默认的 system prompt，支持 `{VERSION}` 占位符。

> 💡 不配置任何 AI 相关的 Secret，发布流程与之前完全一致，无任何影响。

## 📦 部署

### 方式一：一键部署（推荐开发时使用）

确保 NapCat 端已安装并启用 `napcat-plugin-debug` 插件，然后：

```bash
pnpm run deploy
```

这会自动构建，`napcatHmrPlugin` 在构建完成后自动复制 `dist/` 到远程插件目录并触发热重载。

### 方式二：手动部署

将 `dist/` 目录的内容复制到 NapCat 的插件目录即可。

> 💡 使用 CI/CD 自动发布后，可直接从 GitHub Release 下载 zip 包解压到 `plugins` 目录。

## 📄 许可证

MIT License
