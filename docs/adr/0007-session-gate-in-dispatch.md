# 0007 · 会话启用门禁从接收层下沉到分发层

## 状态

已采纳 (2026-10-22)

## 背景与问题

会话级开关默认关闭, 且原先的门禁在消息接收入口 (`handleMessage`) 第一步短路: 未启用的群/私聊里任何消息都被丢弃。这让「在群内开启推送」无法实现——`#weibo enable` 永远走不到执行层, 用户只能先打开 WebUI 才能让指令生效, 形成鸡生蛋问题。

`docs/instruction-pattern.md` 原本把「群启用检查 → 触发判定 → 切词 → 分发」写成不可调换的四步。要支持群内开关, 必须打破其中一步的绝对性。

## 被放弃的方案与理由

- **接收层硬编码 `enable` / `disable` 字符串特判**: 改动最小, 但接收层就此认识指令语义, 与「接收层不认识指令语义」的总纲冲突, 且下一个需要豁免的指令会再打一个补丁。
- **接收层向注册表查询 bootstrap 豁免名单**: 分层上比硬编码干净, 但仍要在门禁之前完成触发判定与切词, 顺序实际已经变了; 而豁免规则属于指令定义, 放在定义上比放在一个独立名单里更难分叉。
- **放宽为「任何消息先切词再判门禁」**: 等价于把门禁从接收层删掉, 但不指明豁免来源, 会让所有指令定义默认穿透门禁, 语义反而更危险。
- **保持门禁在接收层, 只让 WebUI 开关**: 放弃需求本身, 不解决「群内无法自救」。

## 结论

- 指令定义增 `requiresSessionEnabled` (默认 `true`), 由分发层在权限与作用域校验之后执行门禁。仅 `enable` / `disable` 声明 `false`。
- 接收层保留「触发判定 → 切词 → 分发」三步, 不再做会话启用检查; 未启用群里的普通聊天仍在前缀判定处静默, 开销可忽略。
- 门禁命中的反馈不对称: 发送者为 `superAdmin` 时回复「本群未启用微博推送, 发送 #weibo enable 开启」, 其余角色静默。门禁提示排在权限校验之后, 避免向无权限者泄露指令面。
- `help` 不在豁免之列: 只有能让会话通过门禁的指令才配例外, 这比「所有只读指令都豁免」更容易解释。

## 代价

- 被禁用会话的每条消息都会多走一次触发判定与切词 (纯字符串操作, 无 IO)。
- 分发层的纯函数 `resolveDispatch` 需要接收会话启用状态参数; 该状态由 `dispatch` 从 `sessionConfigService` 读取后传入, 纯函数性质与单测覆盖保持不变。
- `docs/instruction-pattern.md` 的四步硬规则与 `AGENTS.md` 的硬规则清单需要同步改写, 否则下一位维护者会把门禁「改回」接收层。

## 该决策约束的文档与代码

- `CONTEXT.md` 的「分发判定」「会话级开关」「会话开关指令」「暂停拉取」。
- `docs/instruction-pattern.md` 的一、接收层与检查清单; `AGENTS.md` 的硬规则清单。
- `packages/plugin/src/handlers/instructionRegistry.ts` 的 `InstructionDefinition.requiresSessionEnabled`。
- `packages/plugin/src/handlers/instructionDispatch.ts` 的 `resolveDispatch` / `dispatch`。
- `packages/plugin/src/handlers/messageHandler.ts` 的四步链路。
