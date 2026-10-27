# 0014 · 会话能力的单一投影

## 状态

已采纳 (2026-10-27)。细化 [0007](0007-session-gate-in-dispatch.md) 的会话启用语义; 不改变门禁位置, 也不改变订阅上限的既有语义。

## 背景与问题

「这个会话还能不能新增订阅这个 uid」在四处各算一遍:

- `AddSubscriptionDialog.rowState`: `usedByKey` 统计订阅目标, 上限读 `/weibo/limits`, 已订阅来自 `subscriptions`, 默认值另写一份。
- `limitService.view`: 用 `effectiveLimit` + `countForTarget` 生成上限页行。
- `monitorService.precheckTarget`: 再算一次启用 / 重复 / 上限, 消息文案另写一套。
- `apiService` 的 `/sessions` 与 `/weibo/limits`: 各自把宿主群 / 好友映射成一份会话投影, 各自调用 `isSessionEnabled`。

结果是同一个 `used` 有三套来源, 同一个 `type:id` 键有四份实现, 默认上限在 shared、`limitService`、`monitorService`、`LimitsTab` 各写一遍。前端认为可选的会话, 后端预检可能拒绝; 后端改了默认值, 前端仍显示旧值。

## 被放弃的方案与理由

- **只把前端 `rowState` 抽成 shared 函数**: 后端预检仍独立推导, 两侧继续漂移。
- **只由后端计算并下发所有会话的能力**: 「是否已订阅某个 uid」依赖当前输入, 为每个 uid 预计算不现实; 每次输入 UID 再拉一次接口会把本地纯判定变成网络往返。
- **把投影放进 `limitService`**: WebUI 不能 import 插件代码, 跨包共享只能落在 `shared`。
- **把投影放进 store**: store 应只承载数据与持久化, 不应知道默认上限、超管名单与「能否新增」。
- **保留 `getWeiboLimit(fallback)` 由各调用方传默认值**: 默认值仍会分散, 本次一并删除。
- **让 `/sessions` 直接返回针对任意 uid 的 `selectable`**: 接口没有 uid 上下文, 也无法穷举所有博主。
- **把 `subscribed` 固定为 false, 让前端自己补**: `already_subscribed` 的优先级与上限判定会再次分叉。

## 结论

- 新增 `packages/shared/src/sessionCapabilities.ts`, 提供纯函数 `buildSessionCapabilities(input)`:
  - 输入 `sessions` (`type` / `id` / `enabled`)、`subscriptions` (`uid` + `targets`)、`overrides` (`type` / `id` / `limit`)、`adminUsers` 与可选的 `subjectUid`。
  - 输出每行 `enabled` / `used` / `override` / `limit` / `unlimited` / `remaining` / `subscribed` / `selectable` / `reason`。
  - `limit` 与 `remaining` 用 `null` 表示无上限; `remaining` 不为负; 覆盖值非法时忽略。
  - `subscribed` 只在提供 `subjectUid` 时可能为 true; 未提供时统一为 false。
  - `reason` 优先级固定为 `session_disabled` → `already_subscribed` → `limit_reached`; `selectable === (reason === null)`。
- shared 同时导出 `WEIBO_LIMIT_DEFAULTS` (群 1 / 私聊 0)、`WEIBO_LIMIT_MIN` (0)、`WEIBO_LIMIT_MAX` (50) 与 `sessionTargetKey`。
- 后端:
  - `limitService.get` / `view` 统一经 `buildSessionCapabilities`; `view` 只把能力行投影成 `WeiboLimitRow`。
  - `monitorService.precheckTarget` 用同一函数判定, 再按 `reason` 生成既有文案。
  - 删除 `monitorService.effectiveLimit`、`WeiboMonitorStore.countForTarget`、`SessionConfigService.getWeiboLimit` 与两份默认值常量。
  - `apiService.loadHostSessions` 成为 `/sessions` 与 `/weibo/limits` 的唯一宿主会话投影。
- WebUI:
  - `AddSubscriptionDialog` 用 `buildSessionCapabilities` 生成每行状态, 删除本地 `usedByKey`、`subscribedKeys` 与 `rowState`; `/weibo/limits` 只用于读取上限覆盖与错误提示。
  - `LimitsTab` 的初始 `EMPTY_VIEW` 使用 shared 常量; 行数据本身来自后端同一投影。
  - `subscriptionView.sessionKey`、`SessionsPage` 与插件侧的会话键统一委托 `sessionTargetKey`。
- 不改变的语义: 群默认 1、私聊默认 0、超管私聊无上限; 上限只约束新增订阅, 不回收既有订阅; 会话启用门禁仍在指令分发层 ([0007](0007-session-gate-in-dispatch.md))。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「会话能力」「订阅上限」「上限覆盖」。
- `packages/shared/src/sessionCapabilities.ts` (新增)。
- `packages/plugin/src/services/weibo/limitService.ts`、`monitorService.ts`、`apiService.ts`。
- `packages/plugin/src/store/WeiboMonitorStore.ts`、`packages/plugin/src/services/sessionConfigService.ts`。
- `packages/webui/src/pages/subscriptions/AddSubscriptionDialog.tsx`、`LimitsTab.tsx`、`packages/webui/src/utils/subscriptionView.ts`。
- `packages/plugin/test/sessionCapabilities.test.ts`。

