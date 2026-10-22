# AGENTS.md — NapCat 插件开发模板

本文件是本仓库对 AI 编程代理的唯一指令来源。范式体系的正文在 `docs/`, 领域术语在 `CONTEXT.md`; 本文件只做导航、速查与高频片段, 不复制范式细节。

技术栈: TypeScript (ESM) + pnpm monorepo。Vite 打包插件后端为 `dist/index.mjs`; React + Vite + Tailwind 构建 WebUI。插件生命周期钩子与 OneBot 11 交互, 类型来自 `napcat-types` (经本地垫片, 见下)。

## 快速导航

先建立"分层 + 生命周期铁律"的全局认知, 再按任务读对应范式。

| 我要做什么 | 读哪篇 |
| --- | --- |
| 全局约束、强度分级、分层、生命周期铁律、ADR 判据 | [docs/development-pattern.md](docs/development-pattern.md) (总纲) |
| 数据持久化、单例 store、延迟实例化、会话级配置承载 | [docs/store-pattern.md](docs/store-pattern.md) |
| 配置数据语义与清洗纪律、运行时读写 | [docs/config-pattern.md](docs/config-pattern.md) |
| 配置声明源、双 UI 派生、WebUI 骨架与 hash 路由 | [docs/webui-config-pattern.md](docs/webui-config-pattern.md) |
| 权限、四档角色推导与线性比较、超管名单 | [docs/permission-pattern.md](docs/permission-pattern.md) |
| 指令接收→分发→执行链路、作用域校验、失败反馈 | [docs/instruction-pattern.md](docs/instruction-pattern.md) |
| 发消息、消息段工厂、@全体成员三重前置校验 | [docs/message-send-pattern.md](docs/message-send-pattern.md) |
| 帮助输出: 权威源 → 生成 → 产物 → 变体选择 | [docs/help-output-pattern.md](docs/help-output-pattern.md) |
| 领域术语 (含 _Avoid_ 反用词)、默认值语义 | [CONTEXT.md](CONTEXT.md) |
| 难逆转的决策记录 | [docs/adr/](docs/adr/) |

推荐阅读顺序: 总纲 → store → permission → config / webui-config / instruction → message-send / help-output。

## 仓库结构

```
packages/plugin   插件后端 (发布物)
  src/index.ts              生命周期入口 (plugin_init 等)
  src/config.ts             DEFAULT_CONFIG + buildConfigSchema(ctx)
  src/onebotEvent.ts        自持的 EventType 枚举 (唯一以「值」用的类型)
  src/core/state.ts         全局状态单例 pluginState
  src/core/admin.ts         权限: 角色推导与线性比较
  src/utils/atBotPrefix.ts  @机器人 触发判定 + CQ 段剥离 (纯函数)
  src/store/                持久化基类与子类 (BaseStore / SessionConfigStore)
  src/services/             业务: sessionConfigService (会话配置单一入口)、apiService (WebUI API 路由)
  src/handlers/messageHandler.ts      接收层 (群启用 → 触发判定 → 切词 → 分发)
  src/handlers/instructionRegistry.ts 指令注册表
  src/handlers/instructionDispatch.ts 分发层 (统一校验、失败反馈不对称)
  src/handlers/commands/              执行层 handler (按模块分目录)
  src/handlers/utils.ts               发送工具 + 消息段工厂
  scripts/generateHelp/               帮助生成脚本 (权威源 cmds/)
  types/napcat-types/                 上游类型垫片 (手工抄录, 勿当业务代码改)
  test/                               vitest 单测 (与 src 纯函数模块一一对应)
packages/webui    React SPA (独立构建)
  public/favicon.*                   站点图标源文件 (恰好一个, 构建期内联)
  scripts/favicon.ts                 图标扫描/内联纯函数 (构建期)
  src/components/configFields/       声明式配置表单控件 (描述符适配器)
  src/components/form/               通用表单控件 (SelectBox / Chip / Toggle / Checkbox)
  src/pages/                         页面 (StatusPage 内嵌配置表单、HelpPage 等)
packages/shared   跨包共享 (单一事实来源)
  src/config.ts             FIELDS / PluginConfig / COMMAND_PREFIX / sanitizeConfig / parseStringList
  src/displayTokens.ts      {{...}} 占位符常量与 resolveDisplayContent
  src/ui.ts                 WebUI 骨架 PAGES / DEFAULT_PAGE
  src/help.ts               帮助面板类型 (与上游手工同步)
docs/             范式文档体系 (入口 docs/index.md)
CONTEXT.md        领域术语表
.example/         NapCat 官方插件开发文档 (外部参考, 勿改)
```

**文件命名约定**: 文件名默认小驼峰 (`atBotPrefix.ts` / `messageHandler.ts`); 模块主导出是类 / React 组件 / 常量时用大驼峰 (`BaseStore.ts` / `HelpPage.tsx` / `Icons.tsx`); 入口与桶文件保留 `index.ts`; 生成物保留 `.generated.ts`; 测试保留 `.test.ts`; 目录一律小驼峰 (`configFields/`)。工具配置 (`vite.config.ts` / `tsconfig.json` / `biome.json`) 与 `types/napcat-types/` 按各自生态约定不动。

## 构建 / 验证 / 部署

```bash
pnpm install                 # 安装依赖

pnpm build                   # 构建 webui + plugin (纯构建, 不连调试服务; 输出 dist/)
pnpm test                    # 全部 vitest 单测 (plugin/test 与 webui/test)
pnpm typecheck               # 全部包类型检查 (tsc --noEmit)
pnpm check                   # typecheck + test
pnpm dev:webui               # WebUI 前端开发服务器 (实时预览)
pnpm help:generate           # 重建帮助产物 (产物入库)

pnpm deploy                  # 构建后热部署 + 重载 (需 NapCat 端启用 napcat-plugin-debug)
pnpm deploy:dev              # dev 部署: 以 <name>-dev 新 id 注册, 不覆盖远程正式插件

# 亦可在 packages/plugin 或 packages/webui 目录内单独执行各自的 build / test / typecheck
```

- 验证一律以 **vite build** 与 **vitest** 为准; 改动后至少跑 `pnpm check`。
- 热部署插件只在 `--mode deploy` / `--mode deploy-dev` 下挂载; `build` 与部署是独立链路。
- `deploy:dev` 会改写 `dist/package.json` 的 `name`/`plugin`/`version` 为 `-dev` / `[DEV] ` 标注, 使配置与数据目录按 id 隔离。

**napcat-types 垫片 (重要)**: `napcat-types` 只发布裸 `.ts` (零 `.d.ts`), 不是可独立编译单元, 直接引入会让 `tsc` 深入第三方源码树并大量报错。故 `packages/plugin/tsconfig.json` 用 `paths` 把 `napcat-types/*` 重定向到本地垫片 `packages/plugin/types/napcat-types/` (0.0.16 的信实副本, OneBot 消息类型族退化为 `any`)。垫片手工抄录, 升级 `napcat-types` 时需对照同名文件手动同步; 插件对 `napcat-types` 无运行时/构建依赖 (唯一以「值」使用的 `EventType` 已自持于 `src/onebotEvent.ts`)。

## 硬规则清单 (仅 docs 的「必须」档)

> 通用原则见 [docs/adr/0001-plugin-switch-and-command-prefix.md](docs/adr/0001-plugin-switch-and-command-prefix.md): 配置项只承载需要用户调节的值; 插件级全局启停交宿主 (配置不含 `enabled`), 指令前缀是内部常量 `COMMAND_PREFIX`。

**生命周期与分层** ([总纲](docs/development-pattern.md))
- 【必须】模块加载期 (import 时) 不得触碰 `ctx` / `ctx.dataPath` / `ctx.logger`, 不得文件 IO, 不得调用发送函数。
- 【必须】单例可加载期导出, 但构造期零 IO; 真正的初始化只在 `plugin_init` 之后。
- 【必须】全局状态只能经唯一单例 `pluginState` 访问, 各模块不自行持有 ctx 或逐层传参。
- 【必须】每层只做自己的事 (接收层不认识指令语义、分发层不做业务、store 不含业务规则)。
- 【必须】外部 API 层与业务解耦 (HTTP 封装只管请求/响应, 不做业务判断)。
- 【必须】领域术语以 `CONTEXT.md` 为唯一权威, 新术语定型即写入 (带 _Avoid_)。

**store / 持久化** ([store-pattern](docs/store-pattern.md))
- 【必须】同一份数据文件全进程唯一读写入口; `private constructor` 且构造期零文件读取。
- 【必须】延迟实例化: 文件只 `export class`, 不导出实例常量; 使用方在方法内 `getInstance()`。
- 【必须】写入统一走立即持久化方法 (不做批量延迟落盘); 不把 `saveToFile` 改成 `public`。
- 【必须】`find` / `getAll` 返回内部引用, 修改一律走 `set` / `update` / `addItem` / `updateItem`。

**配置** ([config-pattern](docs/config-pattern.md) · [webui-config](docs/webui-config-pattern.md))
- 【必须】新增/修改配置项只改共享包的 `FIELDS` 描述符一处 (类型/默认值/清洗/双 UI 随之派生)。
- 【必须】一切外部输入 (磁盘、WebUI、指令) 的配置写回必经 `sanitizeConfig`; `updateConfig` 仅限内部可信调用方。
- 【必须】清洗是纯函数且不抛错 (非法回退默认或丢弃条目); 尊重用户显式选择 (空数组/显式 `false` 是语义)。
- 【必须】每字段声明一个可渲染 base kind 并写 `description`; 描述符键集与 `PluginConfig` 一致 (`satisfies` + 单测)。
- 【必须】描述符是 ctx-free 纯数据; 需要 ctx 的 Schema 映射必须参数注入 (`buildConfigSchema(ctx)`, 禁止静态 import 业务模块)。
- 【必须】运行时数据只允许进入 `display` 展示块, 不得进入可保存配置项。
- 【必须】`FIELDS` 的 `section` 是分隔行 (无 key、不落盘): WebUI 以它切分卡片, 原生面板渲染为分组标题; 被 `scope` 过滤时不可见也不作为边界。
- 【必须】会话级配置不进配置文件 (由 store 承载), 提供单一查询入口; 会话启用门禁由分发层读取该入口后短路, **不得在消息入口短路** (否则会话开关指令无法执行, 见 ADR 0007)。
- 【必须】WebUI 骨架 (页面/菜单/标题) 同样单源; URL 用 hash 且为当前页唯一真相源。

**权限** ([permission-pattern](docs/permission-pattern.md))
- 【必须】推导而非配置 (除 `adminUsers` 外全部从事件推导); 入口一次性推导 `UserRole`, 下游复用。
- 【必须】线性比较 `hasRole(userRole, required)` (即 `ROLE_LEVEL >=`), 不写档位矩阵; 不自行比较角色字符串。
- 【必须】`getUserRole` 短路顺序 superAdmin → privateUser → admin → user, 一票定档。
- 【必须】`isAdmin` 只在群聊分支调用, 非群聊返回 `false`; 发送者与机器人共用 `isGroupAdminRole`。
- 【必须】`isBotAdmin` fail-closed, 且仅用于机器人能力自检 (@全体成员资格以 `can_at_all` 为准)。
- 【必须】`adminUsers` 在 `sanitizeConfig` 一次性解析为 `string[]`, 运行期只做包含检查; 名单无降权指令。
- 【必须】裁剪档位时 `UserRole['role']` 与 `ROLE_LEVEL` 同步收窄。

**指令分发** ([instruction-pattern](docs/instruction-pattern.md))
- 【必须】接收层三步顺序固定 (触发判定 → 切词 → 分发), 整函数包 try/catch。
- 【必须】接收层与 handler 内不做权限校验; 权限、作用域与会话启用校验的时机及失败反馈收敛在分发层。
- 【必须】失败反馈不对称: 权限不足与未知指令静默, 作用域不符回复提示, 会话未启用只提示超管。
- 【必须】会话门禁默认生效 (`requiresSessionEnabled`, 默认 `true`), 只有开关类指令显式声明 `false`; 豁免声明在指令定义上, 不在接收层特判。
- 【必须】`prefix` 与 `atBot` 两种触发方式相互独立 (空数组 = 不触发); 只剥离开头第一个匹配 `selfId` 的 at 段, 剥离后 `trimStart()`。
- 【必须】`selfId` 取自 `pluginState.selfId`, 不硬编码; CQ 大小写不敏感, `qq` 精确等于 `selfId`。
- 【必须】指令名统一 `toLocaleLowerCase()`; 新增指令 = 注册表加一行。
- 【必须】`scopeRules` 未命中即静默 (形态须枚举完备)。

**消息发送** ([message-send-pattern](docs/message-send-pattern.md))
- 【必须】所有发送走 `handlers/utils.ts` 的四个工具函数, 禁止业务代码直接 `ctx.actions.call('send_msg' | ...)`。
- 【必须】范围内容器消息段一律用 `createXxxMessage` 工厂构造, 禁止手写字面量 (范围外类型须过 `OB11MessageData` 类型检查)。
- 【必须】四个发送函数统一返回 `Promise<boolean>`, 内部 try/catch、失败记日志、不抛出。
- 【必须】混合字符串与消息段时统一升级为消息段数组。
- 【必须】@全体成员 三项前置检查缺一不可, 顺序固定: 会话类型 → 发起人 admin → 机器人 `can_at_all` 与配额; 不额外自查 `isBotAdmin`。

**帮助输出** ([help-output-pattern](docs/help-output-pattern.md))
- 【必须】内容有唯一权威源, 产物一律由脚本生成 (文件头标注禁止手改); 变体按"角色 + 会话类型"决定。
- 【必须】图片优先、文本回退; `isAdmin`/`isSuperAdmin` 互斥, `onlyPrivate`/`onlyGroup` 互斥。
- 【必须】权限过滤: User 看无标记, Admin 看无标记 + `isAdmin`, SuperAdmin 看全部。
- 【必须】`HelpVariant` 与 PNG 文件名、`HELP_TEXT_MAP` 键一一对应。

## 代码片段

**状态与日志**
```ts
import { pluginState } from '../core/state';

pluginState.config.triggerModes;      // 读配置
pluginState.logger.info('处理消息');  // 日志 (等价 ctx.logger)
const ctx = pluginState.ctx;          // init 后可用, 未初始化访问会抛错
const selfId = pluginState.selfId;    // 机器人 QQ (init 时异步获取)
```

**配置: 声明源与写回**
```ts
// packages/shared/src/config.ts 是唯一声明源: PluginConfig 加字段 + FIELDS 加同 key 描述符。
// 默认值 / 清洗 / 双 UI 均由 FIELDS 派生, 不要在其他文件重复罗列字段。

import { sanitizeConfig } from 'shared'; // 亦经 '../core/state' re-export

pluginState.replaceConfig(rawConfig);    // 外部输入统一入口, 内部已 sanitizeConfig
pluginState.updateConfig(partial);       // 仅限内部可信调用方 (字段已被上游清洗)
```

**消息发送与消息段工厂**
```ts
import {
    sendReply, sendGroupMessage, sendPrivateMessage, sendForwardMsg,
    createTextMessage, createReplyMessage, createImageMessage,
    createAtMessageWithSeparator, createForwardNode,
} from '../handlers/utils';

await sendReply(ctx, event, '纯文本直接传字符串');          // 有 event 用 sendReply
await sendGroupMessage(ctx, groupId, [createTextMessage('推送')]); // 无 event 按目标选

await sendReply(ctx, event, [
    createReplyMessage(replyId),
    ...createAtMessageWithSeparator(qq),   // [at, text], 避免 @ 后挤压
    createTextMessage('已绑定'),
]);
```

**会话配置 (群/好友)**
```ts
import { sessionConfigService } from '../services/sessionConfigService';

sessionConfigService.isSessionEnabled(id, 'group'); // 单一查询入口; 默认关闭 (严格 enabled === true)
sessionConfigService.setSessionEnabled(id, 'group', true);
```

**业务数据持久化 (非会话配置)**
```ts
const data = pluginState.loadDataFile<MyData>('my-data.json', { items: [] });
pluginState.saveDataFile('my-data.json', data);
pluginState.getDataFilePath('cache.json'); // 数据文件存于 ctx.dataPath 下
```

**定时器**
```ts
const timer = setInterval(() => { /* ... */ }, 60_000);
pluginState.timers.set('my_job', timer);
// pluginState.cleanup() 会遍历 timers 全部 clearInterval, 无需手动逐个清理
```

**OneBot Action 调用 (四参模式)**
```ts
const groups = await ctx.actions.call(
    'get_group_list',
    {},                       // 无参 Action 传 {} 而非 void 0
    ctx.adapterName,
    ctx.pluginManager.config,
);
```

**路由注册**
```ts
ctx.router.getNoAuth('/status', handler);  // 插件自带 WebUI 页面调用 → 无鉴权
ctx.router.get('/endpoint', handler);      // 需 NapCat WebUI 登录鉴权
ctx.router.static('/static', 'webui');     // 静态文件
ctx.router.page({                          // 页面 (侧边栏入口)
    path: 'dashboard',
    title: '插件控制台',
    htmlFile: 'webui/index.html',
});
```

**事件类型判断**
```ts
import { EventType } from '../onebotEvent';

if (event.post_type !== EventType.MESSAGE) return;  // 只处理消息事件
```

## 注意事项

- **日志**: 统一 `pluginState.logger` / `ctx.logger`, 方法为 `log`/`debug`/`info`/`warn`/`error`。
- **WebUI 表单项复用**: 其它页面/组件需要表单控件时, 优先复用 `components/form/` 的通用控件 (`SelectBox` / `Chip` / `Toggle` / `Checkbox`); 描述符绑定的 `configFields/XxxField` 只作 `ConfigForm` 的 kind 适配器, 不直接用于业务页面。
- **配置持久化**: `pluginState.replaceConfig` (外部输入, 会清洗) / `updateConfig` (内部可信)。
- **业务数据**: `pluginState.loadDataFile` / `saveDataFile`; 会话级配置走 `sessionConfigService`。
- **资源清理**: `plugin_cleanup` 必须清理定时器与连接; `pluginState.cleanup()` 已自动清理 `timers` 与保存配置。
- **禁止 emoji**: 代码中不使用 Unicode emoji 字符 (如各种彩色符号)。需要装饰性输出时用颜文字, 例如:
  ```ts
  ctx.logger.info('(｡･ω･｡) 插件初始化完成');
  ctx.logger.warn('(；′⌒`) 配置项缺失, 使用默认值');  // 注: 该颜文字含反引号, 见下条
  ```
- **模板字符串反引号安全**: 模板字符串内禁止出现未转义的反引号 (部分颜文字含 `` ` ``), 否则会提前闭合字符串。含反引号的文本用字符串拼接或转义:
  ```ts
  ctx.logger.warn("(；′⌒`) 任务 " + jobId + ' 已移除');   // 拼接
  ctx.logger.warn(`(；′⌒\`) 任务 ${jobId} 已移除`);        // 转义
  // 错误: ctx.logger.warn(`(；′⌒`) 任务 ${jobId} 已移除`);
  ```
- **图标**: 前端用 SVG 组件 (参考 `packages/webui/src/components/Icons.tsx`), 不用 emoji。
- **站点图标**: 源文件为 `packages/webui/public/favicon.*` (支持 svg/png/ico/jpg/jpeg/webp/gif/avif, 目录内只能有一个), 构建期内联为 data URI; 超过 64KB 警告, 超过 256KB 构建失败。NapCat 默认以 iframe 嵌入插件页, 因此 favicon 只在独立打开或新窗口时生效, 不改变宿主标签页图标。默认图标取自 NapCatQQ (`packages/napcat-webui-frontend/public/favicon.ico`, Copyright © 2024 Mlikiowa), 原样未修改。
- **WebUI 风格**: 主题色粉色 `#FB7299` (`bg-primary` / `text-primary`); 卡片用 `.card`; 激活态 `bg-primary text-white`; 暗色用 `dark:bg-[#1e1e20]`。禁止使用 CSS 渐变 (`linear-gradient` 等), 改用纯色。新增页面/组件须延续现有设计语言。
- **开新项目**: 删除 `packages/shared/src/config.ts` 中 `FIELDS` 的 `example*` 示例字段与 `PluginConfig` 对应键; 修改 `packages/plugin/package.json` 的 `name` (必须以 `napcat-plugin-` 开头) / `plugin` / `description` / `author`; 替换 `packages/webui/public/favicon.*` (保持唯一文件, 换格式时先删除旧文件)。

## 参考

- 范式索引与阅读顺序: [docs/index.md](docs/index.md)
- 总纲 (强度分级 / 生命周期铁律 / 分层 / ADR 纪律): [docs/development-pattern.md](docs/development-pattern.md)
- 架构决策记录: [docs/adr/](docs/adr/)
- 领域术语与默认值语义: [CONTEXT.md](CONTEXT.md)
- NapCat 官方插件开发文档: [.example/plugin/](.example/plugin/) (`api/`、`mechanism.md`、`structure.md` 等)
- OneBot 11 API 手册: https://napcat.apifox.cn/
