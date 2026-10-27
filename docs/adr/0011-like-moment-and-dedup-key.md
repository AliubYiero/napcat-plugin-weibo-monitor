# 0011 · 点赞时刻解析与去重键

## 状态

已采纳 (2026-10-27)。修订 [0009](0009-seen-id-cache-and-content-types.md) 中关于点赞日期解析与展示的部分。

## 背景与问题

微博首页的点赞条目标题不止一种形态。真实数据里同时出现过:

- `她10-24赞过的微博(4)`
- `她昨天21:42赞过的微博(3)`
- `她昨天0:10赞过的微博(4)`

旧解析只认完整日期与「月-日」, 相对日标题直接返回 `null`; 表现为卡片信息栏只剩「点赞了微博」、推送标题行没有时间括号。

更隐蔽的问题是去重键。旧键为 `like:<原微博id>:<YYYY-MM-DD>`, 日期解析失败时日期段留空。同一条点赞在「昨天」阶段写入 `like:<id>:`, 标题变成 `10-25` 后又算出 `like:<id>:2026-10-25`, 于是同一条点赞会被当成新动态再推一次。

## 被放弃的方案与理由

- **只修展示、不修解析**: 相对标题仍无时间, 且去重键继续在标题格式切换时漂移。
- **以被赞微博 `created_at` 为相对日基准**: `created_at` 是被赞微博的发布时间, 可能比点赞日早很多天; `昨天` 是微博在本次拉取时生成的相对描述。
- **保留「昨天 21:42」原样展示**: 聊天记录放置一天后语义就会过期。
- **把时分纳入去重键**: 标题从相对写法变成绝对日期时键会变, 反而制造重复推送; 同一天重复赞同一微博也不再天然去重。
- **升级时接受一次性重复推送**: 用户会收到已经看过的点赞; 值得用一次幂等迁移避免。
- **升级时清空已见缓存重建基线**: 不重复推, 但会静默吞掉升级窗口内的真正新动态。
- **永久认旧空日期键**: 会让同一条原微博在升级后的跨日重复点赞一直被误判为已见。

## 结论

- 新增 `parseLikeMoment`, 返回 `{ day, clock }`: `day` 为北京日历日 `YYYY-MM-DD`, `clock` 为标题给出的 `HH:mm` 或 `null`。
- 标题支持完整日期、`今天` / `昨天` / `前天` (可带 `H:mm`) 与仅月日。相对日以首次拉取时间为基准, 固定北京时间; 时分非法时只保留日期。
- `parseLikeDay` 保留为取 `day` 的包装; 去重键仍是 `like:<原微博id>:<YYYY-MM-DD>`, 时分不进入键。
- 展示统一为绝对时间 `YYYY/MM/DD HH:mm`。标题给出时分时优先; 其余情况沿用旧规则: 与拉取同日补拉取时分秒, 异日只显示日期, 解析失败省略时间括号。
- 卡片信息栏与推送标题行共用 `resolveLikeMoment`, 不再各自二次解析。
- 旧版 `like:<id>:` 空日期键由 `seenCache` 的纯函数按当前页幂等改写: 当前页该 id 仍解析为点赞日期则改写; 不在当前页或已不是点赞则保留; 新旧键并存时去重。跨升级边界的同一条原微博再次被点赞, 接受首轮静默一次。
- `profile_insert_type:comment_status` 的评论插入条目不在本次范围内。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「点赞日期」「点赞时刻」「点赞动态」「已见缓存」「推送标题行」「推送卡片」。
- `packages/plugin/src/weibo/postKind.ts`、`time.ts`、`predicate.ts`、`card.ts`、`presentation.ts`、`seenCache.ts`、`types.ts`。
- `packages/plugin/src/services/weibo/pollingService.ts`、`packages/plugin/scripts/weiboTest/index.ts`。
- `packages/plugin/test/weiboPostKind.test.ts`、`weiboCard.test.ts`、`weiboPresentation.test.ts`、`weiboSeenCache.test.ts`。
