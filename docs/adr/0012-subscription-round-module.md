# 0012 · 单轮拉取抽为深模块

## 状态

已采纳 (2026-10-27)。细化 [0005](0005-weibo-reader-core.md)、[0008](0008-poll-alignment.md)、[0009](0009-seen-id-cache-and-content-types.md) 在轮询服务内的落点。

## 背景与问题

`pollingService.ts` 同时承担两种尺度的工作:

- `tick` 是轮循层: Cookie 门禁、保活、风控退避、逐 uid 循环、整轮成败统计、失效告警与排期。
- `pollMonitor` 是单轮层: 拉取首页、刷新博主资料、暂停恢复基线、首绑/零重叠判定、条件写游标、按置顶与普通轨道推送。

单轮层的顺序约束只存在于函数体的阅读顺序里: 暂停恢复必须先于增量选择, 游标必须先于推送, 置顶必须先于普通动态。`pollingTimer.test.ts` 为了验证排期, 不得不 mock Cookie、游标、订阅、会话、接口与推送六个模块, 单轮语义本身反而没有测试落点。最近新增的暂停拉取、零重叠重建与点赞去重都落在这段路径上, 继续内联会让每次改动都需要同时理解排期与投递。

## 被放弃的方案与理由

- **继续内联在 `pollingService`**: 接缝不存在, 调用方与测试都只能跨多个 store / 服务 mock; 顺序约束继续靠注释维持。
- **让模块接管整轮循环**: 会把 `started` 检查、uid 间隔、成功计数、`invalid/risk` 中止、退避与告警一起吸进来, 与 [0008](0008-poll-alignment.md) 的「排期只在 tick」冲突, 也让单轮模块依赖 `runtimeStatus`。
- **把暂停筛选留在 tick**: tick 在 `invalid/risk` 提前 `break` 时, 尚未轮到的全禁用 uid 会漏写 `paused`, 重新启用后可能补发禁用期动态。暂停结算必须前置于任何中止。
- **单入口 `poll(monitor)`**: 接口更小, 但暂停标记的批量语义没有归属, 调用方仍要知道「谁该进入本轮」。
- **把意外异常收成单 uid 失败**: 隔离更好, 但改变「意外异常中止整轮」的现状; 属于另一个行为改进, 不在本次重构内。
- **注入 `weiboRuntime` 端口**: 展示状态会重新进入模块; 目标错误可以由返回值驱动, 由 tick 在轮末写回。
- **预留 `preview` / 只取不推**: 今天没有调用方, 会让结果类型与参数变宽; 真实需求出现时再加, 接缝不变。

## 结论

- 新增 `packages/plugin/src/weibo/subscriptionRound.ts`, 导出 `createSubscriptionRound(deps)`; 工厂与 [0005](0005-weibo-reader-core.md) 的读取器同层, 不 import `pluginState`、store、定时器或宿主服务。
- 接口为两个方法:
  - `settlePause()`: 读订阅目录, 对没有任何启用推送目标的 uid 写 `paused=true`, 按原顺序返回其余订阅。轮内不复查会话启用。
  - `poll(subscription)`: 执行一条订阅的一轮, 返回 `{ ok, failure, message }`。失败分类原样透传, 不自行升级为 `invalid/risk`。
- `poll` 的固定顺序: 拉取 → 取一次 `now` → 刷新资料 → 读游标 → 暂停恢复则重建基线并清暂停 → 否则 `resolveSeenCache` → 差异才写游标 → 重读订阅 → 置顶新→旧 → 普通旧→新。游标写先于任何推送; 推送失败不回滚; 轮内订阅被删除则不推送。
- 依赖以窄端口注入: 首页读取、推送、游标读写、订阅目录、会话启用事实; `contentTypes` / `now` / `logger` 作为进程内参数。生产适配器在 `pollingService` 首次 tick 时惰性组装, 不新增 wiring 文件。
- `tick` 保留 Cookie 门禁、保活、退避、循环与 `UID_INTERVAL_MS`、成功/失败计数、`markRecovered` / `markInvalidAndNotify` / `enterBackoff`、整轮 `lastError` 与排期。`pollMonitor` 与 `sameIds` 移出宿主文件。
- 端口抛错冒泡给 `tick` 的既有 `try/catch`, 维持「意外异常中止整轮」。目标错误由 `tick` 在轮末根据 outcome 写回; 拉取成功但推送中途抛错时, 目标行会短暂保留旧错误, 这是本次接受的时序差异。
- 结果不包含推送计数、静默原因或预演数据。推送完成日志与 `recordPush` 仍留在推送适配器内部。
- 测试: 新增 `subscriptionRound.test.ts`, 用内存端口覆盖失败、资料刷新、首绑、暂停恢复、零重叠、增量顺序、条件写游标、先写后推、轮内取消订阅、内容类型过滤与异常冒泡; `pollingTimer.test.ts` 改为替身 `createSubscriptionRound`, 只保留门禁、退避与排期关注点。

## 代价

- 模块本身是编排壳, 真正的算法深度仍在 `seenCache.ts` / `predicate.ts`; 它约束的是顺序与止损, 不是重新实现去重。
- 目标错误的清除从「拉取成功瞬间」延后到「该 uid 一轮结束」; 正常路径不可观察, 仅在推送抛错时可见。
- `poll` 假定传入的订阅已经过 `settlePause`; 直接对全禁用订阅调用会拉取并推进缓存, 这一前提需要写在接口语义里。
- `pollingService` 多了一个惰性工厂字段; 单测通过模块替身跨过它, 生产代码不增加测试专用参数。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「单轮拉取」「暂停拉取」「基线重建」「零重叠重建」「已见缓存」。
- `docs/adr/0005-weibo-reader-core.md`、`0008-poll-alignment.md`、`0009-seen-id-cache-and-content-types.md`。
- `packages/plugin/src/weibo/subscriptionRound.ts` (新增)。
- `packages/plugin/src/services/weibo/pollingService.ts` 的 `tick` / `getRound`。
- `packages/plugin/test/subscriptionRound.test.ts`、`packages/plugin/test/pollingTimer.test.ts`。
