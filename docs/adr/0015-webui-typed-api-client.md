# 0015 · WebUI 类型化客户端与统一资源取数

## 状态

已采纳 (2026-10-28)。本轮只收「状态 + 会话 + 订阅 + 上限」; Cookie / 安装 / 帮助 / 配置页仍保留原取数方式, 待接缝形状稳定后再推广。

## 背景与问题

WebUI 的取数分散在每个页面:

- `/status` 有三份客户端副本: `useStatus`、`AccountPage`、`AddSubscriptionDialog`。
- 每个调用点各自写 `fetch → code === 0 → setState`; 非 0 code 有两处静默、两处抛错、一处完全不看、一处只打日志。
- 端点字符串散落; `/weibo/subscriptions` 的 `pendingAvatars` 与 `data` 平级, 只能靠手工交叉类型描述。
- 后端 `/status` 返回 `Record<string, unknown>`, 订阅列表返回插件内部视图; WebUI 另写一份结构相同的类型, 字段漂移无法在编译期发现。
- 同一类 loading / error / stale / 刷新逻辑在每个页面重复。

## 被放弃的方案与理由

- **一次迁移所有页面**: 范围横跨账号、安装、帮助、配置与订阅, 收益大但回归面也大; 先收四组高复用端点验证接缝。
- **让页面直接调用 `fetch` 并共享一个错误解析函数**: 端点字符串与 `code` 判定仍然散落, 错误处理只是从三套变成四套。
- **只做共享类型, 不改取数**: 编译期能抓字段漂移, 但非 0 code、loading / stale 仍由页面各自维护。
- **把客户端放进 shared**: `fetch`、鉴权头与插件名解析都是 WebUI 运行时细节; shared 只承载契约类型。
- **用 `ApiResponse` 直接作为页面结果**: 调用方仍要检查 `code`, 且 HTTP 错误与业务失败是两种分支; 客户端把两者收敛为同一种失败结果。
- **把所有端点塞进一个泛型 `request(path)`**: 端点字符串会重新散落; 客户端接口按领域方法暴露, 路径只出现一次。

## 结论

- 新增 `packages/shared/src/webui.ts`: `SessionInfo`、`WeiboSubscription(sView)`、`PluginStatus` 及其嵌套状态、`WeiboInstallState`、`CookieActionResult`。
- 插件端使用共享契约:
  - `/status` 的 `buildWeiboStatus()` 返回 `WeiboStatus`;
  - `loadHostSessions()` 返回 `SessionInfo[]`;
  - `/weibo/subscriptions` 的 `data` 改为 `{ subscriptions, pendingAvatars }`;
  - 轮询状态、Cookie 状态、浏览器状态、订阅视图与安装状态从 shared 重导出, 不再手写第二份。
- 新增 WebUI 客户端:
  - `utils/apiClient.ts` 暴露 `createApiClient(transport)` 与 `ApiResult<T>`; 生产适配器是 `noAuthFetch`, 测试适配器是 fake。
  - `utils/webuiApi.ts` 只做一次生产适配器绑定。
  - 端点方法覆盖状态、会话读写、订阅读写、上限读写; HTTP 错误、非 0 code、缺失 data 都变成 `{ ok: false, code, message }`。
- 新增 `hooks/useResource.ts`: 统一 `data / loading / error / stale / refresh`, 可选 `refreshMs` 轮询。
- 迁移范围: `useStatus`、`AccountPage` 的状态读取、`useSubscriptions`、`SessionsPage`、`LimitsTab`、`AddSubscriptionDialog`。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「WebUI 契约」。
- `packages/shared/src/webui.ts` (新增)。
- `packages/webui/src/utils/apiClient.ts`、`webuiApi.ts`、`apiError.ts`、`hooks/useResource.ts` (新增)。
- `packages/webui/src/hooks/useStatus.ts`、`useSubscriptions.ts`、`pages/AccountPage.tsx`、`SessionsPage.tsx`、`subscriptions/LimitsTab.tsx`、`subscriptions/AddSubscriptionDialog.tsx`。
- `packages/plugin/src/services/apiService.ts`、`packages/plugin/src/weibo/types.ts`、`packages/plugin/src/services/browser/chrome-installer.ts`。
- `packages/webui/test/utils/apiClient.test.ts`、`packages/webui/test/hooks/useResource.test.tsx`。
