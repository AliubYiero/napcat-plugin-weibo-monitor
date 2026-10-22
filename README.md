# napcat-plugin-weibo-monitor

按 UID 订阅微博博主，定时拉取新动态，并渲染为长图或文本推送到 QQ 群 / 私聊的 NapCat 插件。

- 插件 ID：`napcat-plugin-weibo-monitor`
- 显示名：微博动态监听
- 最低 NapCat 版本：4.14.0
- 许可证：MIT

## 功能

- **按 UID 订阅**：同一博主在多个会话间共享一次拉取与一次去重，避免重复请求。
- **双呈现模式**：图片推送渲染为整张卡片长图；文本推送发送标题行、原文链接与正文。
- **动态识别**：区分「发送了微博」「转发了微博」「发布了视频」，转发时展示原动态块。
- **完整内容**：支持长文补拉、附图按序追加、原生视频块、B站 / 外链卡、`@` / `#话题#` / URL 富文本。
- **可靠去重**：以动态水位线判定新动态；首绑只建立基线不补推；水位线失效时静默重建。
- **定时轮询**：间隔可配置；能整除 60 的间隔对齐本地墙钟刻度，其余走固定延迟。
- **异常处理**：Cookie 失效暂停轮询并按冷却策略通知超管；418 / 403 等风控自动退避后重试。
- **会话隔离**：群聊与私聊各自独立启用，默认关闭；订阅上限按会话类型推导。
- **WebUI**：仪表盘、账号、订阅、会话管理、帮助文档五个页面。

## 运行要求

- NapCat 4.14.0 或更高版本。
- 可用的 Chrome / Edge，或允许插件下载 Chrome for Testing（支持 Windows / Linux）。
- 一个可用的微博账号 Cookie（用于调用微博接口）。

## 安装

### 从 Release 安装

1. 从 [Releases](https://github.com/AliubYiero/napcat-plugin-weibo-monitor/releases) 下载最新 zip。
2. 解压到 NapCat 的 `plugins` 目录，确保目录结构为 `plugins/napcat-plugin-weibo-monitor/`。
3. 在 NapCat WebUI 中启用插件并重载。

### 从源码构建

```bash
pnpm install
pnpm build
```

将 `packages/plugin/dist/` 下的内容复制到 NapCat 的 `plugins/napcat-plugin-weibo-monitor/` 目录。

## 首次使用

1. 打开 NapCat WebUI 左侧的「微博动态监听」页面。
2. 在「账号」页检测浏览器；未找到时可直接点击安装 Chrome for Testing。
3. 从浏览器开发者工具复制微博 Cookie，粘贴保存。保存前会先校验，校验通过才落盘。
4. 在「会话管理」页开启需要接收推送的群聊或私聊（默认全部关闭）。
5. 在「订阅」页或群聊中发送 `#weibo add <UID>` 添加博主。首绑只记录基线，不会补推历史动态。

## 指令

指令前缀固定为 `#weibo`。触发方式由配置项 `triggerModes` 决定：

- `prefix`：`#weibo <子指令> [参数]`
- `atBot`：`@机器人 #weibo <子指令> [参数]`

两种方式相互独立，可同时启用。除 `enable` / `disable` 外，所有指令都要求当前会话已启用。

| 指令 | 说明 | 权限 |
| --- | --- | --- |
| `#weibo help` | 显示帮助 | 所有人 |
| `#weibo list` | 查看本会话已订阅的博主 | 所有人 |
| `#weibo latest [UID]` | 获取博主最新一条微博；不填 UID 时使用本会话唯一的订阅 | 所有人 |
| `#weibo get <动态ID>` | 按动态 ID 获取单条微博（数字或 mblogid 短链） | 所有人 |
| `#weibo add <UID>` | 订阅博主（UID 为数字） | 群聊管理员 / 私聊超管 |
| `#weibo remove <UID>` | 取消订阅博主 | 群聊管理员 / 私聊超管 |
| `#weibo max` | 查看本会话订阅上限 | 群聊管理员 / 私聊超管 |
| `#weibo max <N>` | 设置本会话订阅上限（0-50） | 超管 |
| `#weibo enable` | 开启本群微博推送 | 群聊超管 |
| `#weibo disable` | 关闭本群微博推送（订阅保留） | 群聊超管 |

说明：

- 会话级启用开关默认关闭，且严格按 `enabled === true` 判定。
- `enable` / `disable` 是唯一豁免会话启用门禁的指令，否则未开启的群无法自救。
- 私聊只能通过 WebUI 开启；私聊增删订阅仅超管可用。

## 配置

配置的唯一声明源是 `packages/shared/src/config.ts`。

| 配置项 | 默认值 | 可见范围 | 说明 |
| --- | --- | --- | --- |
| `adminUsers` | `[]` | 双端 | 超级管理员 QQ 号名单，标签输入 |
| `triggerModes` | `['prefix', 'atBot']` | WebUI | 指令触发方式，全不勾选则任何消息都不触发 |
| `weiboPollIntervalMinutes` | `60` | 双端 | 轮询间隔（分钟），范围 1-1440 |
| `weiboPushRenderMode` | `image` | WebUI | `image` 整卡图片 / `text` 文本推送 |
| `chromeExecutablePath` | `''` | WebUI | 手动指定 Chrome / Edge 路径，留空自动探测 |

会话级配置由独立数据文件承载，不进入插件配置：

- 会话启用开关：默认关闭。
- 订阅上限：群聊默认 1，私聊默认 0，超管本人私聊无上限；显式设置范围 0-50，只约束新增订阅，不回收既有订阅。

## WebUI 页面

| 页面 | 内容 |
| --- | --- |
| 仪表盘 | 运行状态、轮询状态、Cookie / 浏览器状态与数据概览 |
| 账号 | 微博 Cookie 掩码展示、重录与校验；浏览器检测与安装 |
| 订阅 | 查看全部订阅、新增 / 移除订阅、调整会话订阅上限 |
| 会话管理 | 群聊与好友列表，批量启用 / 禁用 |
| 帮助文档 | 按角色过滤后的完整指令说明 |

## 项目结构

```text
packages/
├── plugin/                     # 插件后端（发布物）
│   ├── src/
│   │   ├── index.ts            # 生命周期入口
│   │   ├── config.ts           # 配置 Schema 与面板展示
│   │   ├── core/               # 全局状态单例、权限
│   │   ├── handlers/           # 接收层、分发层、指令 handler、帮助产物
│   │   ├── services/           # WebUI API、轮询、微博、浏览器
│   │   ├── store/              # 数据持久化 store
│   │   ├── weibo/              # 读取器、渲染、去重、轮询对齐等纯逻辑
│   │   └── utils/              # 触发判定、帮助消息
│   ├── scripts/
│   │   ├── generateHelp/       # 帮助产物生成（权威源 cmds/）
│   │   └── weiboTest/          # 真机拉取测试
│   └── test/                   # vitest 单测
├── webui/                      # React SPA 前端
│   └── src/
│       ├── pages/              # 仪表盘 / 账号 / 订阅 / 会话 / 帮助
│       ├── components/         # 通用组件与配置表单控件
│       └── hooks/              # 状态轮询、主题、Toast 等
└── shared/                     # 跨包共享（单一事实来源）
    └── src/
        ├── config.ts           # FIELDS / PluginConfig / 清洗
        ├── ui.ts               # WebUI 页面骨架
        └── help.ts             # 帮助面板类型
```

分层与开发规范见 `AGENTS.md`、`docs/` 与 `CONTEXT.md`。

## 开发

```bash
pnpm install                 # 安装依赖
pnpm build                   # 构建 WebUI + 插件后端（输出 dist/）
pnpm dev:webui               # WebUI 开发服务器
pnpm test                    # 全部 vitest 单测
pnpm typecheck               # 全部包类型检查
pnpm check                   # typecheck + test
pnpm help:generate           # 重建帮助产物
```

### 真机拉取测试

在仓库根目录 `.env` 填写：

```dotenv
WEIBO_COOKIE="浏览器开发者工具复制的 Cookie 或 Playwright storageState JSON"
WEIBO_TEST_UID=1234567890
# 可选：指定 Chrome / Edge 路径
WEIBO_CHROME_PATH=
```

然后运行：

```bash
pnpm weibo:test
```

脚本会拉取该 UID 的第一页动态、博主资料与长文，并在 `packages/plugin/.weibo-test/<uid>/<timestamp>/` 下产出：

```text
index.html          # 卡片图与文本并排的汇总页
manifest.json       # 每条元信息与汇总
posts.raw.json      # 原始动态数据
001-<mblogid>.txt   # 文本推送内容
001-<mblogid>.png   # Chromium 卡片截图
images/             # 主动态与原动态附图
```

只有第一页拉取失败会以非零码退出；其余失败会降级并在汇总页标注。

### 热部署

需要 NapCat 端安装并启用 `napcat-plugin-debug`，并在 `.env` 配置：

```dotenv
WS_URL=ws://127.0.0.1:8998
TOKEN=your-token
```

```bash
pnpm deploy                  # 构建并部署正式插件
pnpm deploy:dev              # 以 <name>-dev 身份部署，不覆盖正式插件
```

`build` 与部署是独立链路：`pnpm build` 只构建，不连接调试服务。

## 发布

推送 `v*` 格式的 tag 即可触发 GitHub Actions 自动构建并创建 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

工作流会依次执行 `pnpm check`、`pnpm build`，打包 `dist/` 中的运行文件并附加到 Release。也支持在 Actions 页面手动触发。

## 数据文件

插件数据保存在 NapCat 分配给该插件的 `dataPath` 下：

| 文件 | 内容 |
| --- | --- |
| `session-config.json` | 会话启用状态与订阅上限覆盖 |
| `weibo-cookie.json` | 微博 Cookie |
| `weibo-cursor.json` | 各博主的动态水位线 |
| `weibo-monitors.json` | 微博订阅与推送目标 |
| `avatar/` | 已订阅博主的本地头像副本 |

## 许可证

MIT License
