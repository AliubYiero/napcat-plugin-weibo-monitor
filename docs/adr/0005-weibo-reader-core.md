# 0005 · 微博拉取与渲染抽为不依赖 pluginState 的读取器

## 状态

已采纳 (2026-10-22)

## 背景与问题

本地需要一条「真机爬取」链路：用真实 Cookie 拉取博主第一页动态，同时产出文本与卡片图，供人工核对渲染结果。原来的拉取与渲染全部藏在 `services/weibo/*` 中，而这些服务最终都经 `browserService` 触达 `pluginState`（`config.chromeExecutablePath`、`dataPath` 中的 Cookie、logger）。于是本地测试只有两个选择：

- 伪造 `ctx` 并初始化 `pluginState`，测试会读写插件数据目录，并携带整套生命周期；
- 在脚本里另写一份 Playwright 启动、页面内 fetch、长文补拉与截图逻辑，和线上实现形成双份真相。

两者都不可接受：前者让测试依赖宿主，后者让真机验证的恰好不是线上代码。

## 被放弃的方案与理由

- **假 ctx + 初始化 pluginState**：能复用生产服务，但 Cookie、游标、浏览器配置都会落进插件数据目录；脚本还要模拟 `actions.call` 等与爬取无关的上下文。
- **脚本复制一份爬取逻辑**：启动最快，但页面内 fetch 的请求头、Cookie 回写、空闲关闭、长文补拉一旦调整就会漂移。
- **只抽「拉取」不抽浏览器**：`browserService` 仍依赖 `pluginState`，脚本要么继续伪造上下文，要么继续复制浏览器代码。

## 结论

- 新增 `src/weibo/reader.ts`：`createWeiboReader({ fetchApi, renderHtml, logger? })`，负责第一页、资料、长文与卡片编排。它只返回 `ok / failure / message`，**不写 Cookie 健康状态**。
- 新增 `src/services/weibo/browserSession.ts`：`createWeiboBrowserSession({ executablePath, cookies, onCookiesRefreshed?, logger? })`，承载 Playwright 启动、页面内 fetch、截图、串行队列与空闲关闭，同样不认 `pluginState`。
- 生产侧保留原有服务外观：`browserService` 成为 session 适配器，`weiboApiService` / `longTextService` / `cardRenderService` 内部改调 `readerService`；`markSuccess` 等副作用留在调用方。
- 本地脚本直接组装 session + reader，不初始化 `pluginState`，也不读写插件数据目录。

## 代价

- 多一层 `readerService` 组装与 `browserSession` / `browserService` 的命名分层；读代码时要区分「基础设施会话」与「宿主适配器」。
- 生产服务的公开方法签名不变，内部实现被替换，回归面集中在 `services/weibo/*` 与 `services/browser/*`。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「微博读取器」。
- `packages/plugin/src/weibo/reader.ts`、`packages/plugin/src/services/weibo/browserSession.ts`。
- 本地真机测试 `packages/plugin/scripts/weiboTest/` 与根命令 `pnpm weibo:test`。
