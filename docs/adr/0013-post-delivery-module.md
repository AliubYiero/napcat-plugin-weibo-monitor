# 0013 · 推送呈现与投递收为深模块

## 状态

已采纳 (2026-10-27)。细化 [0004](0004-push-render-mode.md) 与 [0009](0009-seen-id-cache-and-content-types.md) 的推送落点; [0004](0004-push-render-mode.md)、[0005](0005-weibo-reader-core.md) 中指向 `longTextService` / `cardRenderService` 的代码坐标由本决策取代。

## 背景与问题

「把一条微博动态呈现出来并发送到目标」有四条入口函数:

- 订阅轮询的 `pushPost`: 补拉长文 → 渲染 → 投递多个已启用目标 → 返回 `{ pushed, failed }`。
- `latest` 指令的 `pushLatest`: 伪造/复用订阅外壳, 再委托 `pushPost`。
- 单目标投递的 `pushPostTo`: 不补拉长文, 渲染一条 → 返回 `boolean`, 供指定动态读取使用。
- `postService.deliver`: 再包一层 `pushPostTo`, 把异常映射为 `false`。

同一个概念被切成四份: 长文补拉只在其中一条路径发生, 卡片降级与附图顺序写在 `pushService` 内部, 失败映射与结果类型各不相同。

结果是同一个概念被切成四份: 长文补拉只在其中一条路径发生, 卡片降级与附图顺序写在 `pushService` 内部, 失败映射与结果类型各不相同。`longTextService` / `renderService` 只是把 `weiboReader` 的两个调用包了一层, 删除它们不会让复杂度消失, 但会让调用方继续看见「补拉 / 渲染」这两个内部步骤。

## 被放弃的方案与理由

- **保留四条入口, 只抽公共 `render`**: 长文补拉仍由调用方决定是否发生, `pushPostTo` 继续跳过长文; 结果类型仍是三种。
- **把 `longTextService` / `renderService` 直接内联进 `pushService`**: 入口仍有 `pushPost` / `pushPostTo` / `pushLatest` 三种形态, 指定动态仍走另一套流程。
- **让 `PostDelivery` 接管订阅目标过滤、`recordPush` 与汇总日志**: 投递层会反过来依赖订阅语义; `get` / `latest` 的一次性发送也会被误记为订阅推送。
- **所有来源统一用 `needsLongText` 补拉**: 指定动态走 `show?isGetLongText=true` 时已返回完整正文, 却仍保留 `isLongText: true`; 统一规则会重复请求长文接口。
- **所有来源统一用 `hasTruncationSignal`**: 时间线接口的截断未必带「全文 / 展开」链接, 会漏补长文。
- **保留 `pushPostTo` 的「不补拉」特例**: 调用方仍需知道「这条动态是否已经补过」, 正是本次要消除的知识。
- **让 handler 直接调用投递层**: 指令层会看见渲染与发送的重试顺序, 破坏接收/分发/执行分层。

## 结论

- 新增 `packages/plugin/src/services/weibo/postDelivery.ts`, 导出 `createPostDelivery(deps)` 与生产单例 `weiboPostDelivery`。接口只有两个方法:
  - `prepare(post, { source, context?, identity? })`: 按来源补拉长文 (`timeline` 用 `needsLongText`, `status` 用 `hasTruncationSignal`), 再按全局呈现方式渲染卡片或文本, 生成主消息、可选附图消息与纯文本回退。
  - `deliver(targets, prepared)`: 对已解析的目标逐个发送; 主消息失败回退纯文本, 主消息成功后发送附图 (附图失败只记日志, 不影响成功计数); 目标之间保留 500ms 间隔; 返回 `{ pushed, failed }`。
- 目标过滤仍属于订阅语义: `pushPost` 先筛出已启用目标, 无目标时直接返回零计数, 不触发补拉/渲染。`deliver` 假定传入目标已经可用。
- `pushPost` 只负责订阅外壳: 过滤目标 → `prepare(source: 'timeline')` → `deliver` → 有成功时 `recordPush` → 汇总日志。`pushLatest` 继续委托 `pushPost`。
- `postService.read` 不再自行补拉长文; `postService.deliver` 用 `prepare(source: 'status')` + `deliver`, 返回 `DeliveryResult`, 由 `getHandler` 按 `pushed === 0` 提示失败。
- 删除 `longTextService.ts` 与 `renderService.ts`: 长文补拉后的 `markSuccess` 与卡片 buffer 的 `base64://` 转换移入 `PostDelivery` 的生产适配器。
- 语义保持不变: [0004](0004-push-render-mode.md) 的呈现方式、图片模式卡片与附图为两条消息、点赞/生日不产生附图、长文补拉失败保留截断正文。
- 接受的差异: `deliver` 只在目标之间等待, 不再在最后一个目标之后多等 500ms; `read` 返回未补拉的动态, 但唯一调用方会立即 `deliver`; `postService.deliver` 的返回类型由 `boolean` 变为 `DeliveryResult`。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「推送投递」「长文补拉」「推送呈现方式」「附图」。
- `packages/plugin/src/services/weibo/postDelivery.ts` (新增)。
- `packages/plugin/src/services/weibo/pushService.ts`、`postService.ts`、`monitorService.ts`。
- `packages/plugin/src/handlers/commands/getHandler.ts`。
- `packages/plugin/test/postDelivery.test.ts`。
- 删除 `packages/plugin/src/services/weibo/longTextService.ts`、`renderService.ts`。
