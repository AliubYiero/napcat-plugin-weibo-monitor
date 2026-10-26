# 0002 · 微博接口调用统一走 Playwright 页面

## 状态

已采纳 (2026-10-21); 其中「连续 7 天无成功调用时访问首页续期」的条款由 [0010](0010-daily-cookie-keepalive.md) 取代。

## 背景与问题

微博的 `mymblog` / `profile/info` 接口在未登录或风控时会返回 `ok: 0`，且对 UA、Referer 与 Cookie 的组合敏感。插件又必须用 Playwright 渲染推送卡片，浏览器已经是硬依赖。于是「接口用 Node `fetch` 还是用浏览器页面」成为一个真实取舍：

- Node `fetch` 启动快、内存低，但 Cookie 续期只能靠解析 `Set-Cookie`，且请求特征与真实前端不同；
- 浏览器页面天然携带同源 Cookie、UA 与 Referer，Cookie 续期也随响应自动发生，但每轮都要付出启动/页面开销。

## 被放弃的方案与理由

- **Node `fetch` + 手写 UA/Referer**：Cookie 的 `SUB/SUBP` 续期依赖响应头，解析与回写链路要自己维护；请求特征仍与页面请求有差异。
- **`page.goto(apiUrl)` 直接导航到接口**：每次调用都执行站点脚本、可能被重定向或触发页面级行为，且拿不到结构化错误。
- **`context.request.get`**：共享 Cookie 但绕过页面语义，Referer/UA 与真实前端不一致，风控特征反而更明显。

## 结论

- 所有微博接口调用统一在 `https://weibo.com/` 的页面内用 `page.evaluate(fetch(..., { credentials: 'include' }))` 完成；不引入 Node `fetch` 直连接口的旁路。
- Cookie 以 Playwright `storageState` 持久化；每次成功调用后读取 `context.cookies()` 回写。连续 7 天无成功调用时，额外访问一次 `weibo.com` 首页触发续期。
- 浏览器生命周期：惰性启动的共享实例 + 串行任务队列，空闲 5 分钟关闭，`plugin_cleanup` 强制关闭不等待。
- 代价：插件必须自带浏览器获取方案（内联 `playwright-core` + 共享 `napcat-chrome` + 系统浏览器探测），且每小时轮询都要付一次浏览器启动成本。这是为「Cookie 自动续期 + 请求特征一致」付出的确定性成本。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「Cookie 失效」「风控退避」。
- 浏览器服务的生命周期与串行队列。
- `vite.config.ts` 的 playwright 内联打包配置（`browsers.json`、`__dirname`/`require` shim、`inspector` 桩、可选原生模块 external）。
