# NapCat 插件指令分发范式

本文是适用于任意 NapCat 插件项目的指令分发通用范式, 覆盖从消息接收到指令执行的完整链路: 前缀检查、参数切词、注册表分发、作用域校验。各项目遵循此范式时, 应将消息接收入口与指令注册表分别放在独立的 handler 模块中。强度档位 (必须/应该/可以) 见 [development-pattern.md](./development-pattern.md) 的"规范强度分级"。

角色的推导与比较不在本文范围, 已抽离为 [permission-pattern](./permission-pattern.md); 发送消息的工具函数规范见 [message-send-pattern](./message-send-pattern.md)。分发层只负责**何时校验、如何反馈**, 不重复实现角色判定。

## 核心约束

1. 【必须】**四层链路, 各层只做自己的事**: 接收层不认识指令语义, 分发层不做业务, 执行层不再做权限校验。业务 handler 收到的参数已保证满足角色、作用域与会话启用要求, 可直接执行。
2. 【必须】**校验在分发层统一完成**: 角色的推导与比较能力由权限模块提供 (见 [permission-pattern](./permission-pattern.md)), 但**校验时机与失败反馈收敛在分发层**。权限、作用域与会话启用检查散落在接收层或 handler 内会随指令增多而失控。
3. 【必须】**校验失败反馈不对称是设计而非偶然**: 权限不足与未知指令静默 (防权限探测), 作用域不符回复提示 (可用性), 会话未启用只提示超管 (保留自救路径, 不向全群暴露指令面)。
4. 【应该】**接收层按配置判定触发方式**: 触发方式 (`prefix` = 以指令前缀开头, `atBot` = 以 `@机器人` 开头) 由配置的多选声明, 两者独立; 接收层据此判定消息是否触发并取出前缀之后的参数。判定逻辑抽为独立纯函数, 接收层不内联复杂匹配。

## 范式正文

### 一、接收层: handleMessage

接收层职责固定为三步, 顺序不可调换:

1. 【必须】**触发判定**: 按配置的触发方式判定消息是否触发、并取出前缀之后的参数文本; 未命中 (含未启用任何触发方式、前缀不匹配) 一律静默返回。前缀不匹配是绝大多数消息的正常路径, **不回复、不记日志** (见 1.1)。
2. 【必须】**切词**: 参数文本 `trim().split(/\s+/)` 得到参数数组。空串会切出 `['']`, 由分发层的参数检查兜底。
3. 【必须】**分发**: 将参数数组交给分发层。

要点:

- 【必须】整个 `handleMessage` 包在 try/catch 中, 任何异常记日志不外抛——它是所有消息事件的入口, 异常外抛会影响插件宿主。
- 【应该】前缀来自插件内部常量 (固定值); 触发方式读自配置 (运行期生效, 无需重启)。
- 【必须】接收层**不做权限校验, 也不做会话启用检查**。两者都属于指令语义, 由分发层统一处理。
- 【必须】会话启用门禁必须在分发层 (见"三、会话启用门禁"), 不能在接收层最前端短路: 否则「在未启用的会话里开启会话」这类指令永远无法执行 (ADR 0007)。
- 【应该】触发判定抽为独立纯函数, `selfId` 取自 `PluginState.selfId`, 群聊与私聊统一处理; debug 日志只记 @机器人 触发成功与 `selfId` 无效两种情况 (见 1.1)。

#### 1.1 指令触发方式 (triggerModes)

指令有两种触发形态, 由配置项 `triggerModes` (多选) 声明:

- `prefix`: 消息以固定前缀 (`COMMAND_PREFIX`) 开头 —— `指令 参数`;
- `atBot`: 消息以 `@机器人` 开头, 剥离该 at CQ 段后仍以 `COMMAND_PREFIX` 开头 —— `@机器人 指令 参数`。

两者**相互独立**: 可只启用其一、两者, 或都不启用 (空数组 = 任何消息都不触发)。接收层在切词之前做一次**触发判定**, 命中则取出前缀之后的参数文本, 未命中静默返回。

> ⚠️ **行为可变更**: 触发方式由单个布尔开关升级为多选后, 用户可只勾 `atBot` 实现"仅被 @ 时响应", 或全不勾选完全停用触发。插件作者应在更新说明中告知用户。

**配置**

- 【应该】提供 `triggerModes` 配置项, 类型多选 (`multiSelect`), 候选取自 `TRIGGER_MODE_OPTIONS` (`prefix` / `atBot`), 默认全选, 经 `sanitizeConfig` 清洗后运行期生效。空数组是合法语义 (不触发任何消息)。
- 若插件不提供该配置项, 则等价于仅启用 `prefix`。

**触发判定规则**

- 【必须】两种方式相互独立: 只启用 `atBot` 时, 不含 `@机器人` 的普通前缀消息**不触发** (不能因"剥离后仍带前缀"而顺带命中)。
- 【必须】`prefix` 命中条件: 消息 `trim()` 后以 `COMMAND_PREFIX` 开头。
- 【必须】`atBot` 命中条件: 消息 `trim()` 后剥离开头匹配 `selfId` 的 at 段**成功剥离**, 且剥离结果 `trimStart()` 后以 `COMMAND_PREFIX` 开头。
- 【必须】命中返回**前缀之后的参数文本** (交接收层切词); 未命中返回 `null`。
- 【必须】只剥离开头**第一个**匹配 `selfId` 的 at CQ 段; 其他 at 段保留不动。
- 【必须】`selfId` 来自 `PluginState.selfId`, 不硬编码机器人 QQ 号; 缺失/为空时 `atBot` 无法命中, 不抛异常。
- 【必须】群聊与私聊统一处理, 不额外判断会话类型。

**剥离匹配的容忍度**

- 【必须】`CQ` 标记大小写不敏感; `qq` 值可带单引号、双引号或无引号; 属性顺序不限; 允许额外属性 (如 `name=...`); `qq` 值必须精确等于 `selfId` 的字符串形式。
- 【必须】剥离后执行 `trimStart()`, 避免 `[CQ:at,qq=...] #cmd` 因前导空格导致前缀判定失败。

**实现建议**

- 【应该】将判定逻辑抽为独立纯函数模块, 例如 `atBotPrefix.ts`, 导出:

  ```ts
  function stripAtBotPrefix(rawMessage: string, selfId: string): string
  function resolveTriggerCommand(
      rawMessage: string,
      selfId: string,
      modes: readonly TriggerMode[],
  ): string | null
  ```

- 【应该】`stripAtBotPrefix` 只负责剥离 (不整体 `trim()`、不 `trimStart()`、无日志副作用); `resolveTriggerCommand` 在其上编排 `trim()` → 剥离 → `trimStart()` → 前缀判定, 返回参数文本或 `null`。
- 【应该】接收层负责调用与 debug 日志。

**debug 日志**

- 【应该】仅在启用 `atBot` 且以下情况记录 debug 日志: @机器人 触发成功时 (记录原始 `rawMessage`); `selfId` 缺失或无效时 (记录一次)。
- 【必须】普通前缀不匹配、权限不足、未知指令仍保持静默, 不记日志。

**最小示例**

```text
配置:          ['prefix', 'atBot']

原始:          [CQ:at,qq=268491285] #cmd help
trim 后:       [CQ:at,qq=268491285] #cmd help
剥离后:         #cmd help
trimStart 后:  #cmd help
前缀判定通过, 返回参数文本 "help", 进入切词与分发。
```

> 示例中的 `268491285` 仅为示例值, 实际应使用 `PluginState.selfId`。

**边界说明**

- 【必须】`@机器人` 但未跟指令时, 仍按普通消息静默, 不回复"请输入指令"。
- 【必须】只启用 `atBot` 时, 普通前缀消息不触发; 只启用 `prefix` 时, `@机器人` 开头的消息不触发。

### 二、分发层: 注册表工厂

#### 指令命名空间

指令支持一级与二级两种命名空间形态:

- **二级命名空间**: `模块 → 子指令` (如 `#mybot reminder add`), 注册在两级字典 `instructionSetMapper` 中。
- **一级命名空间**: 无模块前缀的直达指令 (如 `#mybot help`), 注册在单级字典 `rootInstructionSetMapper` 中。

【必须】分发时先查二级 (`arg1` 为模块名、`arg2` 为子指令名), 未命中再查一级 (`arg1` 为指令名, `arg2` 起为参数)。两种形态最终汇入同一个 `dispatch` 校验终点。

```ts
// 二级: 模块 -> 子指令 -> 定义
const instructionSetMapper: Record<
    string,
    Record<string, InstructionDefinition>
> = {
    reminder: {
        add: { handler: addReminderHandler },
        list: { handler: listReminderHandler, scope: 'group' },
        // ...
    },
    // ...
};

// 一级: 指令名 -> 定义
const rootInstructionSetMapper: Record<string, InstructionDefinition> = {
    // help: { handler: helpHandler },
};
```

要点:

- 【必须】**新增指令 = 注册表加一行**。handler 写成独立文件按模块分目录 (如 `handlers/reminder/`), 注册表只做装配, 不含业务逻辑。
- 【必须】指令名在分发前统一 `toLocaleLowerCase()`, 指令不区分大小写。
- 【必须】未命中模块/子指令/一级指令时**静默返回**。未知指令不回复提示, 防止机器人被任意文本触发刷屏。

#### 指令定义 (InstructionDefinition)

```ts
interface InstructionDefinition {
    handler: InstructionHandler;
    /** 执行所需最低角色, 缺省 user (所有人可用) */
    requiredRole?: UserRole['role'];
    /** 允许的会话类型, 缺省不限 */
    scope?: 'group' | 'private';
    /** 形态化作用域规则 (进阶, 见下文) */
    scopeRules?: ScopeRule[];
}
```

【必须】一个定义 = 一个执行函数 + 可选的门槛声明。分发层在调用 `handler` 前完成全部校验, handler 内部**不再重复校验**。

要点:

- 【必须】`requiredRole` 的取值即权限模块的 `UserRole['role']`; 判定用 `hasRole(userRole, requiredRole)` 的线性比较, 不写档位矩阵。角色的推导与比较见 [permission-pattern](./permission-pattern.md)。
- 【必须】分发层从消息事件推导角色的动作**只发生一次** (入口处), 之后 `UserRole` 对象在分发层与 handler 间传递; 不要在每个校验点重复调用 `getUserRole`。

### 三、作用域校验: scope 与 scopeRules

#### 指令级 scope

【应该】`scope: 'group' | 'private'` 声明指令允许的会话类型, 缺省不限。作用域不满足时回复固定提示 ("该指令仅限群聊使用"/"该指令仅限私聊使用") 后返回。

#### scopeRules: 按参数个数分形态 (进阶)

同一指令不同参数个数可以绑定不同权限/作用域 (如 `max`: 无参查看是 admin 级、带参设置是超管级):

```ts
max: {
    handler: setLimitHandler,
    scopeRules: [
        { args: 0, scope: 'group', requiredRole: 'admin' },
        { args: 1, scope: 'group', requiredRole: 'superAdmin' },
        { args: 3, scope: 'private', requiredRole: 'superAdmin' },
    ],
},
```

⚠️ 【必须】**未命中即静默**: `scopeRules` 命中逻辑是"按 `args` 数匹配第一条规则", **未命中任何形态时静默返回**, 不进入 handler。这确保权限防线闭合——不存在"分发层未校验、handler 又未设防"的穿透路径; 代价是形态枚举必须完备, 漏写形态会导致该参数个数的合法调用被静默吞掉。新增参数形态时必须同步补充 `scopeRules` 条目。

### 四、会话启用门禁 (requiresSessionEnabled)

【必须】指令定义默认受会话启用门禁约束: 分发层在权限与作用域校验之后、调用 handler 之前, 检查 `userRole.from` 对应会话是否 `enabled === true` (严格判定, 缺失即禁用)。未启用时:

- 发送者为 `superAdmin` → 回复固定提示, 给出开启指令的自救路径;
- 其他角色 → 静默。与「权限不足静默」同源: 不向全群暴露指令面。

【必须】只有能让会话通过门禁的开关指令才声明 `requiresSessionEnabled: false`。只读指令 (如 `help`) 不豁免——一旦「只读就不受门禁」成立, 例外会比规则多, 且用户在未启用会话里执行 add/remove 仍然静默, 语义反而割裂。

【必须】豁免声明在指令定义上, 不在接收层的名单或字符串特判里: 它是指令语义的一部分, 必须与 handler、`requiredRole`、`scope` 放在同一处。

【必须】门禁状态由 `dispatch` 从会话配置的单一查询入口读取后传给纯函数 `resolveDispatch`, 纯函数本身不做 IO。

### 五、校验失败的反馈策略

【必须】分发层对三类校验失败采取**不对称**策略, 这是有意设计而非偶然:

| 失败类型 | 行为 | 理由 |
| --- | --- | --- |
| 权限不足 | **静默忽略** | 防权限探测。若回复"权限不足", 攻击者可通过枚举指令名区分"指令存在但无权"与"指令不存在", 映射出插件的完整指令面 |
| 作用域不符 | **回复提示** | 可用性。作用域不是敏感信息 (指令是否支持群聊对用户无攻击价值), 静默反而让用户误以为指令无效 |
| 会话未启用 | **仅提示超管** | 超管是唯一能修复的人, 提示即自救路径; 对其他人静默, 避免向全群暴露指令面 |
| 未知指令 | **静默返回** | 同权限不足, 不暴露指令面 |

校验顺序固定为: 注册表命中 → 形态匹配 (`scopeRules`) → 权限 → 作用域 → 会话门禁。失败反馈只对通过的层给提示, 避免向无权限者泄露作用域或启用状态。

## 标准范式清单

新增一个指令时:

- [ ] 【必须】在 `handlers/<模块>/xxxHandler.ts` 写业务 handler, 函数签名 `(ctx, event, commands) => void`, 内部不做权限/作用域校验。
- [ ] 【必须】在 `instructionSetMapper` 对应模块下注册: `{ handler }`, 按需声明 `requiredRole` / `scope`; 默认继承会话启用门禁, 只有开关类指令显式声明 `requiresSessionEnabled: false`。
- [ ] 【应该】参数形态绑定不同权限时才用 `scopeRules`, 并确认所有形态已枚举完备 (未命中形态会被静默吞掉)。
- [ ] 【应该】需要调整角色档位或推导规则时改权限模块, 不改分发层 (见 [permission-pattern](./permission-pattern.md))。
- [ ] 【必须】回复一律走发送工具模块, 不直接调 `ctx.actions.call`。

配置指令触发方式时:

- [ ] 【应该】接收层已按 `triggerModes` 触发判定 (`resolveTriggerCommand`) 决定消息是否触发; 判定逻辑抽为独立纯函数, 接收层不内联复杂匹配。
- [ ] 【应该】提供 `triggerModes` 多选配置 (`TRIGGER_MODE_OPTIONS`), 默认全选, 经 `sanitizeConfig` 清洗, 运行期生效; 空数组合法 (不触发任何消息)。

## 与其他范式的关系

- 与**生命周期铁律**的关系: 注册表与 handler 均为纯装配 (构造期零 IO), 可模块加载期导出; 消息事件只在运行期到达。见 [development-pattern](./development-pattern.md)。
- 与**权限范式**的关系: 分发层消费 `hasRole(UserRole, requiredRole)` 的判定结果, 但不实现角色推导——推导与比较属于权限模块。见 [permission-pattern](./permission-pattern.md)。
- 与**配置范式**的关系: 前缀为插件内部常量 (固定值); `triggerModes` 读自配置 (经 `sanitizeConfig` 清洗后使用)。会话启用状态来自会话配置 store, 由分发层经单一查询入口读取并在门禁处短路——**不在接收层短路**, 否则会话开关指令无法在未启用会话中执行 (ADR 0007)。见 [config-pattern](./config-pattern.md)。
- 与**消息发送范式**的关系: 所有回复走发送工具模块。见 [message-send-pattern](./message-send-pattern.md)。
- 与**帮助输出范式**的关系: 帮助指令按"角色 + 会话类型"选输出版本 (而非仅按角色), 版本档位与权限档位不是一一对应。见 [help-output-pattern](./help-output-pattern.md)。

## 参考实现

消息接收入口见 `packages/plugin/src/handlers/messageHandler.ts`, 指令注册表与分发见同目录指令模块; 示例业务 handler 为 live 模块的 `addLiveHandler` / `mentionLiveHandler` / `maxLiveHandler`。权限模块的实例索引见 [permission-pattern](./permission-pattern.md)。指令触发判定与 @机器人 CQ 段剥离见 `packages/plugin/src/utils/atBotPrefix.ts` (`resolveTriggerCommand` / `stripAtBotPrefix`)。
