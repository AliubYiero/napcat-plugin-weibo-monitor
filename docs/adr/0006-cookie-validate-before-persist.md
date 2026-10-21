# 0006 · Cookie 保存先校验候选, 通过才落盘

## 状态

已采纳 (2026-10-22)

## 背景与问题

账号页的「保存并校验」原先走 `WeiboCookieStore.saveCookies()` → 关浏览器 → `validateCookie()`。也就是说校验发生在落盘之后: 用户粘错一段 Cookie 时, 原本还能用的凭证已经被覆盖, 界面再提示「校验未通过」也回不去。UI 改成只读掩码后, 这个问题会被放大——掩码展示的是「已存」的 Cookie, 而它可能已经被一次失败粘贴替换掉了。

于是有一个真实取舍: 要么让 UI 承认「失败也覆盖」, 要么让保存语义变成「校验通过才生效」。

## 被放弃的方案与理由

- **先写 store, 失败回滚旧快照**: 改动最小, 但失败与回滚之间有窗口期; 进程崩溃或断电会留下错误 Cookie, 而「回滚」本身也需要一份临时持久化。
- **候选写临时文件, 校验后替换**: 能把窗口期压到一次 rename, 但 store 单例、路径与清理规则都要为一次性流程开口子, 与 `store-pattern` 的「同一份数据文件全进程唯一读写入口」冲突。
- **环境失败仍落盘 (未真正校验)**: 保留未装浏览器时先存 Cookie 的便利, 但「已保存」不再等于「已验证」, 掩码态会展示一份从未验证过的凭证。

## 结论

- `save()` 改为候选校验: `parseCookieHeader` → `browserService.withCandidateSession(cookies, task)` 起**临时会话** (不读写 store) → 有订阅 uid 用 `reader.fetchFirstPage`, 无 uid 回退读首页 `$CONFIG.uid`。
- 校验通过: 落盘候选会话最终上下文里的完整 Cookie 集 (含 Set-Cookie 续期), 标记 validated/success, 立即关闭旧的 store 会话, 由路由触发一次立即拉取。
- 校验失败: 关闭临时会话, store 与 `invalid` / `lastValidatedAt` / `lastSuccessAt` 零改动, 返回 `{ valid: false, message }`。
- 解析失败与浏览器未就绪都归为 `valid: false` (不再是 500), 前端统一走警告横幅并留在重录态。
- 校验结果横幅由前端加前缀「校验未通过，未保存：」; 这只对保存路径生效, 手动「校验当前」仍显示后端原话。

## 代价

- 保存时多启动一次浏览器, 且与轮询会话短暂并存; 这是「失败不破坏已存凭证」换来的确定性成本。
- `weiboApiService.validateCookie()` 不再隐式 `markSuccess`; 生产校验的成功标记由调用方 (`weiboCookieService`) 显式完成。
- 未安装浏览器时无法先把 Cookie 存下来: 「已保存 = 已验证」是唯一不变量, 安装浏览器成为保存的前置条件。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「Cookie 掩码态」「微博账号」。
- `packages/plugin/src/services/weibo/cookieService.ts` 的 `save()`。
- `packages/plugin/src/services/browser/service.ts` 的 `withCandidateSession()`。
- `packages/plugin/src/services/weibo/apiService.ts` 的 `validateCookieWithSession()`。
