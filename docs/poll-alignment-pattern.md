# NapCat 插件定时轮询与相位对齐范式

本文是适用于任意 NapCat 插件项目的定时轮询通用范式, 覆盖「用户可配间隔」如何映射到实际触发时刻、刻度网格与固定延迟的分流、即时执行与退避的优先级, 以及如何让这套行为可独立测试。各项目遵循此范式时, 应将排期计算抽为一个不依赖全局状态的纯函数模块 (下称"排期模块"), 服务层只保留接线与状态。强度档位 (必须/应该/可以) 见 [development-pattern.md](./development-pattern.md) 的"规范强度分级"。

## 核心约束: 先定义「间隔」的语义

「每 60 分钟跑一次」有两种互不兼容的解释:

| 语义 | 触发时刻 | 长期表现 | 适用场景 |
| --- | --- | --- | --- |
| **时长 (duration)** | 上一轮结束 + 间隔 | 相位随启动时刻漂移; 实际周期 = 间隔 + 耗时 | 单轮耗时不可忽略, 或需要天然错峰 |
| **相位 (phase)** | 本地墙钟的固定刻度 | 相位稳定; 启动时刻只影响第一次等多久 | 用户期待"整点""每 5 分钟整分", 需与其它任务对齐 |

两者没有绝对优劣, 但**同一配置字段只能承载一种语义**。混用会得到「看起来对齐、偶尔漂移」的行为, 状态页也无法解释下一次为什么是 03:06。

由此得出铁律:

1. 【必须】用户可配的分钟间隔在实现前选定语义, 并写进配置描述与状态文案; 相位语义对齐本地墙钟, 时长语义从上一轮结束起算。
2. 【必须】网格判定只有一条整除式: `m % 60 === 0 || 60 % m === 0`。不维护枚举白名单。
3. 【必须】网格原点使用**本地日历分量**, 禁止对 epoch 时间戳取模。
4. 【必须】下一时刻严格晚于当前; 已错过的刻度全部跳过, 不补跑。
5. 【必须】即时执行 (启动、配置变更、事件触发) 与定时执行共用同一条执行路径, 且不改变网格相位。
6. 【必须】退避优先于排期, 等满剩余退避时间; 退避结束后回到网格。禁止 `min(间隔, 剩余退避)`。
7. 【必须】调度策略只在启动与配置变更时选定; 单次执行收尾只问"下一次延迟", 执行路径不做模式分支。
8. 【必须】单飞: 上一轮未结束时不再触发; 固定延迟统一从上一轮结束起算。
9. 【必须】间隔归一为纯函数: 非数字或非有限值回退默认, 小数四舍五入, 结果钳到 `1..1440`, 且不抛错。

## 范式正文

### 1. 把口语需求拆成判定式

需求原话往往已经很像规格, 但真正写代码时会撞上这些空白:

| 歧义 | 不决定会怎样 |
| --- | --- |
| 「整点」按哪个时区 | 容器是 UTC, 用户在北京; 差了 8 小时 |
| 「能被 60 整除」包含 120、1440 吗 | 日间隔落在本地 08:00 还是 00:00 |
| 特殊刻度是枚举, 还是所有 60 的约数 | 1/2/4/6/12 分钟的行为无定义 |
| 启动时「立即跑一轮」还算不算数 | 首轮数据可能迟到一小时 |
| 一轮比间隔还久, 或系统休眠 | 补跑还是跳过, 会改变请求节奏 |
| 退避重试与网格谁优先 | 短间隔下可能把 30 分钟退避架空 |
| 配置允许小数怎么办 | 7.5 分钟落到 `:07:30` 这种刻度 |

**要点**: 表里每一行都会变成一条测试用例与一句配置说明。开工前定完, 比写完后补解释便宜; 尤其「时区」和「补跑」两项, 默认答案常与用户预期相反。

### 2. 网格判定: 一条整除式, 不维护枚举

```ts
function isGridInterval(minutes: number): boolean {
    return minutes % 60 === 0 || 60 % minutes === 0;
}
```

| 条件 | 覆盖 | 网格类型 |
| --- | --- | --- |
| `m % 60 === 0` | 60 / 120 / 720 / 1440 ... | 小时 / 天网格 |
| `60 % m === 0` | 1 / 2 / 3 / 4 / 5 / 6 / 10 / 12 / 15 / 20 / 30 | 分钟网格 |
| 其余 | 7 / 8 / 45 / 90 / 100 ... | 固定延迟 |

要点:

- 【必须】先验算再写结论: `60 % 8 = 4`, 所以 8 分钟属于固定延迟, 不是网格。这类算术错误不会让编译失败, 只会让文档与实现悄悄分叉。
- 【应该】用公式而非白名单: 新增间隔自动归类, 不需要同步维护"判定表"和"文案表"两处。
- 【应该】若业务只允许部分约数 (例如下限 5 分钟), 在配置层设下限, 不要把判定式改成枚举。

### 3. 原点: 本地日历, 不是 epoch

最常见的错误写法是对时间戳取模:

```ts
// 错误: 原点是 UTC 零点, 不是本地零点
const base = now - (now % stepMs);
```

它会在两个地方错:

- 间隔 1440 在 UTC+8 机器上落在**本地 08:00**, 而不是 00:00。
- 半小时时区 (UTC+5:30) 连 60 的倍数都会偏。

正确做法是按模式拆开, 用本地日历分量进位, 把时区与夏令时交给 `Date`:

```ts
function nextGridAt(now: number, minutes: number): number {
    const cursor = new Date(now);
    cursor.setSeconds(0, 0);

    if (minutes < 60) {                       // 分钟网格: 本地整分
        const nextMinute =
            (Math.floor(cursor.getMinutes() / minutes) + 1) * minutes;
        cursor.setMinutes(nextMinute);         // Date 自动跨小时进位
        return cursor.getTime();
    }

    const stepHours = minutes / 60;            // 小时网格: 本地零点起
    cursor.setMinutes(0, 0, 0);
    if (cursor.getTime() <= now) {
        cursor.setHours(cursor.getHours() + 1);
    }
    while (cursor.getHours() % stepHours !== 0) {
        cursor.setHours(cursor.getHours() + 1);
    }
    return cursor.getTime();
}
```

要点:

- 【必须】分钟网格先 `setSeconds(0, 0)`, 再按 `floor(当前分钟 / m) + 1` 取整分; `setMinutes` 会自动跨小时, 不需要手动处理进位。
- 【必须】小时/天网格从**当前小时的整点**起步, 先跨过当前小时, 再逐小时前进到 `小时 % (m / 60) === 0`。不要用 `本地零点 + 24h` 做毫秒加法: 夏令时当天的 24 小时不等于一个本地日。
- 【必须】严格未来: 精确站在刻度上时取下一个; 所以分钟网格用 `floor + 1`, 小时网格在 `<= now` 时先加一小时。
- 【必须】错过的刻度不补: 每次从 `now` 重算即可, 不需要记录上一轮落在哪; 这天然满足"休眠后只取未来最近的刻度"。

### 4. 计划器: 工厂选一次, 执行收尾零分支

把「下一次延迟是多少」模式化成一个无状态计划器, 而不是把整个 `setTimeout` 循环塞进工厂:

```ts
interface PollSchedule {
    kind: 'grid' | 'fixed';
    label: string;
    nextAt(now: number): number;
    nextDelay(now: number): number;
}

function createPollSchedule(rawMinutes: unknown): PollSchedule {
    const minutes = normalizePollIntervalMinutes(rawMinutes);
    if (isGridInterval(minutes)) {
        return {
            kind: 'grid',
            label: gridLabel(minutes),
            nextAt: (now) => nextGridAt(now, minutes),
            nextDelay: (now) => nextGridAt(now, minutes) - now,
        };
    }
    return {
        kind: 'fixed',
        label: `固定间隔 ${minutes} 分钟`,
        nextAt: (now) => now + minutes * 60_000,
        nextDelay: () => minutes * 60_000,
    };
}
```

服务侧只在启动与配置变更时重建计划器, 轮询收尾只调用它:

```ts
class PollingService {
    private started = false;
    private inFlight = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private planner = createPollSchedule(DEFAULT_INTERVAL_MINUTES);

    start(): void {
        if (this.started) return;
        this.started = true;
        this.planner = createPollSchedule(this.intervalMinutes());
        this.schedule(0);                       // 启动立即跑一轮
    }

    reschedule(): void {
        if (!this.started) return;
        this.planner = createPollSchedule(this.intervalMinutes());
        this.schedule(this.nextDelay());
    }

    private schedule(delayMs: number): void {
        if (this.timer) clearTimeout(this.timer);
        if (!this.started) return;
        this.timer = setTimeout(() => void this.tick(), delayMs);
        pluginState.timers.set(
            'poll',
            this.timer as unknown as ReturnType<typeof setInterval>,
        );
    }

    private async tick(): Promise<void> {
        if (!this.started || this.inFlight) return;
        this.inFlight = true;
        try {
            if (this.inBackoff()) return;
            await this.runOnce();
        } finally {
            this.inFlight = false;
            if (this.started) this.schedule(this.nextDelay());
        }
    }

    private nextDelay(now = Date.now()): number {
        const backoff = getBackoffUntil();
        if (backoff !== null && backoff > now) return backoff - now;
        return this.planner.nextDelay(now);
    }
}
```

关键性质:

- **计划器是无状态纯闭包**: 「跳过错过刻度」不需要额外记录, 每次从当前时刻重算就自然满足。
- **即时执行是网格外的 override**: 与计划器正交, 不会污染下一次的相位。
- **退避也是 override**: 且优先于计划器。
- **执行路径没有 `if (kind === ...)`**: 模式判断已经被工厂挪到启动与配置变更处, 新增模式只改工厂。

【必须】不要把整个循环 (启动标志、在途标志、停止检查、定时器注册、重排) 一并封装进工厂。那会把"下一次延迟"这一条纯计算与状态派生耦合在一起, 工厂不再可独立测试, 服务层也难以理解。

### 5. Override 的优先级: 即时执行与退避

一次 tick 的调度优先级如下:

```
退避未到期  →  tick 直接返回, 下一次延迟 = 退避剩余
即时执行    →  把等待压到 0, 但进入 tick 后仍受退避门禁
计划器      →  网格取下一个刻度, 固定档取完整间隔
```

要点:

- 【必须】退避检查放在 tick 内、实际拉取之前; 未到期就返回, 收尾照常重排。这样无论定时器因为什么被提前唤醒, 都不会在退避期打接口。
- 【必须】`nextDelay` 先看退避剩余, 再看计划器。不要写成 `min(间隔, 剩余退避)`: 5 分钟间隔会让 30 分钟退避每 5 分钟重试一次, 退避形同虚设。
- 【必须】退避到期后的新一轮先清空退避, 再实际拉取; 若再次命中风控, 重新计时。收尾用当前时刻重算计划器, 成功时自然回到网格。
- 【必须】即时执行 (`requestImmediate`) 只压缩等待, 不改变相位, 也不能绕过退避门禁。它适用于"启动、保存凭据、新增订阅、启用会话"这类用户显式操作。
- 【应该】即时执行与定时执行复用同一个 `tick`, 不要为"立即"另写一条发送/拉取路径, 否则单飞、退避、错误处理会出现两份。

### 6. 状态与文案: 暴露绝对时刻, 派生口径

【必须】状态里同时暴露 `nextPollAt` (绝对毫秒时间戳) 与派生文案 `label`; 只暴露"间隔 60 分钟"无法回答"下一次到底几点"。

```ts
function gridLabel(minutes: number): string {
    if (minutes === 60) return '每小时整点';
    if (minutes === 1440) return '每天 00:00';
    if (minutes < 60) return `每 ${minutes} 分钟整分`;
    return `每 ${minutes / 60} 小时整点`;
}
```

【应该】文案由公式派生, 只对 60 与 1440 两个最常见档做特判; 不要逐档列举, 否则新增间隔必漏。

参考策略 (以 60 为基准, 当前本地时间 `02:06:30`):

| 间隔 | 模式 | 下一次 | 口径文案 |
| --- | --- | --- | --- |
| 1 / 2 / 3 / 4 / 6 / 12 | 分钟网格 | 02:07 / 02:08 / 02:09 / 02:08 / 02:12 / 02:12 | 每 N 分钟整分 |
| 5 / 10 / 15 / 20 / 30 | 分钟网格 | 02:10 / 02:10 / 02:15 / 02:20 / 02:30 | 每 N 分钟整分 |
| 60 | 小时网格 | 03:00 | 每小时整点 |
| 120 | 小时网格 | 04:00 | 每 2 小时整点 |
| 720 | 小时网格 | 12:00 | 每 12 小时整点 |
| 1440 | 小时网格 | 次日 00:00 | 每天 00:00 |
| 7 / 8 / 45 / 90 / 100 | 固定延迟 | 02:13:30 / 02:14:30 / 02:51:30 / 03:36:30 / 03:46:30 | 固定间隔 N 分钟 |

### 7. 归一与边界

```ts
function normalizePollIntervalMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return 60;
    }
    return Math.min(1440, Math.max(1, Math.round(value)));
}
```

- 【必须】归一是纯函数且不抛错: 非法输入回退默认, 小数四舍五入, 结果钳到 `1..1440`。
- 【必须】运行期再归一一次。配置清洗可能已经处理过, 但服务层可能被测试、脚本或旧数据直接调用; 防御性归一比信任上游便宜。
- 【应该】取整后重新判定模式: 7.5 → 8, 而 `60 % 8 = 4`, 所以它落回固定延迟档。若业务要求"归一后必须仍在网格", 应改为归到最近的 60 约数, 但那是另一个决策, 不要顺手改掉四舍五入。
- 【应该】0、负数、`NaN`、字符串都应落到默认值或下限, 不要生成"每 0 分钟"这种除零配置。

### 8. 测试: 纯函数注入 now + 假定时器接线

排期是纯函数, 测试不需要启服务, 也不需要真实等待:

- 【必须】注入 `now`, 不读系统时间。
- 【必须】用**本地日历构造**测试时刻: `new Date(2026, 9, 22, 2, 6, 30).getTime()`; 不要用 `'2026-10-22T02:06:30Z'` 这类字符串, 否则测试随运行机器时区漂移。
- 【必须】断言**绝对时刻**, 不只断言延迟; 延迟换算再单独测一条, 防止两边同时错。
- 【应该】表驱动覆盖每个模式、每个特殊刻度、跨小时进位、精确刻度、错过的刻度、固定延迟、文案与归一。

服务层的接线用假定时器验证:

```ts
vi.useFakeTimers();
vi.setSystemTime(new Date(2026, 9, 22, 2, 6, 30));

await vi.advanceTimersByTimeAsync(53 * 60_000 + 30_000 - 1);
expect(fetchOnce).toHaveBeenCalledTimes(1);   // 还差 1ms 到 03:00
await vi.advanceTimersByTimeAsync(1);
expect(fetchOnce).toHaveBeenCalledTimes(2);   // 03:00 触发
```

【必须】至少覆盖五条接线路径: 跨整点、退避等满后回网格、配置变更重新分发、即时拉取不挪动相位、固定延迟从上轮结束起算。

【必须】每个用例前后重置全局单例状态 (退避、`nextPollAt`、定时器表), 否则用例之间会互相污染。外部依赖 (接口、凭据、store) 全部 mock, 让测试只验证"接线与排期", 不验证真实网络。

**算术提醒**: 从 02:06:30 到 03:00 是 **53 分 30 秒**, 不是 54 分 30 秒。边界断言写错一分钟, 测试会在错误的地方通过或失败, 比没有测试更难查。

### 9. 常见反例

| 反例 | 后果 |
| --- | --- |
| 继续固定延迟, 只在界面解释 | 不解决"下次时间取决于启动时刻"的根因 |
| 时间戳对间隔取模 | 原点是 UTC, 1440 会落在本地 08:00 |
| 用枚举白名单判定网格 | 新增间隔要改两处, 判定与文案容易分叉 |
| 即时拉取推进网格相位 | 下次时间取决于最近一次手动操作, 无法解释 |
| 错过的刻度补跑 | 休眠/长轮转后突发连发, 而增量水位线并不要求一个不落 |
| 整个循环交给工厂 | 启动标志、在途标志、停止检查、定时器注册全被卷进工厂 |
| 退避取 `min(间隔, 剩余)` | 短间隔会让退避每 N 分钟重试一次, 形同虚设 |
| 文案逐档列举 | 每个约数都要写一条, 新间隔必漏 |
| 小数直接回退默认 | 7.5 变成 60 的跨度远大于四舍五入到 8 |
| 只测延迟不测绝对时刻 | 延迟与原点同时错时, 测试仍然通过 |
| 不设单飞 | 任务耗时超过间隔时会并发重叠 |

### 10. 已知限制

- **非网格间隔仍会漂移**: 7/45/90/100 从上一轮结束起算, 相位随启动时刻变化; 这是明确保留的时长语义, 不是缺陷。
- **时区变更/夏令时**: 已排定的那一轮可能偏差一次, 下一轮自动回到新时区的网格; 未做跨时区迁移的特殊处理。
- **整点撞车**: 对齐意味着多个实例/任务可能同时触发, 失去固定延迟的天然错峰; 若下游有配额, 需要额外的抖动策略。
- **归一后可能落出网格**: 7.5 → 8 → 固定延迟。若业务强要求"归一后必须进网格", 应改为归到最近的 60 约数。
- **集成测试的边界**: 假定时器用例 mock 掉外部依赖, 只验证接线与排期; 不覆盖真实网络、真实浏览器与夏令时行为, 这些仍需真机验证。

## 标准范式清单

实现一个周期性任务时按以下步骤:

- [ ] 【必须】选定间隔语义 (时长 / 相位), 并写入配置描述与状态文案。
- [ ] 【必须】用整除式判定网格, 不维护枚举白名单; 写结论前先验算 (`60 % 8 = 4`)。
- [ ] 【必须】网格原点用本地日历分量, 禁止 epoch 取模; 小时/天网格逐小时进位, 不跨夏令时做毫秒加法。
- [ ] 【必须】`nextAt` / `nextDelay` 严格未来, 错过的刻度跳过不补。
- [ ] 【必须】计划器只在 `start` / `reschedule` 重建, 执行收尾只问"下一次延迟"。
- [ ] 【必须】即时执行与定时执行共用同一条 `tick`, 不改变相位, 不绕过退避门禁。
- [ ] 【必须】退避优先且等满剩余, 禁止 `min(间隔, 剩余)`; 到期后回到网格。
- [ ] 【必须】单飞; 固定延迟从上一轮结束起算。
- [ ] 【必须】间隔归一是纯函数: 非法回退默认, 小数四舍五入, 钳 `1..1440`, 不抛错。
- [ ] 【必须】定时器注册进全局 `timers` 表, `stop` / 清理钩子中清除。
- [ ] 【应该】状态暴露 `nextPollAt` (绝对时刻) 与派生 `label`, 不只暴露间隔。
- [ ] 【应该】纯函数测试注入 `now` 并用本地日历构造时刻; 集成测试用假定时器覆盖跨刻度、退避恢复、配置重排、即时不挪相位、固定延迟起点。
- [ ] 【应该】每个用例重置全局单例状态, 外部依赖全部 mock。

## 与其他范式的关系

- 与**生命周期铁律**的关系: 排期模块是纯函数, 可以在模块加载期安全导出; 轮询服务单例的构造期零 IO, 定时器只在 `plugin_init` 之后注册, 并登记到 `pluginState.timers` 供 `plugin_cleanup` 统一清理。见 [development-pattern](./development-pattern.md) 与 [store-pattern](./store-pattern.md)。
- 与**配置范式**的关系: 间隔来自配置时, 先经配置清洗, 再在运行期经 `normalizePollIntervalMinutes` 归一并钳范围; 配置变更后由统一入口触发 `reschedule`, 不要在服务里另开一条监听。见 [config-pattern](./config-pattern.md)。
- 与**指令分发范式**的关系: "立即执行一次"若由指令触发, 走同一个 `tick`, 权限与作用域仍由分发层负责, 服务层不重复校验。见 [instruction-pattern](./instruction-pattern.md)。
- 与**消息发送范式**的关系: 定时任务内的推送统一走发送工具; 发送失败按工具函数的约定返回 `false`, 需要退避时由业务层决定, 不要在发送工具里写轮询策略。见 [message-send-pattern](./message-send-pattern.md)。

## 参考实现

本模板: 排期纯函数见 `packages/plugin/src/weibo/pollSchedule.ts`, 服务接线见 `packages/plugin/src/services/weibo/pollingService.ts`; 测试见 `packages/plugin/test/pollSchedule.test.ts` 与 `packages/plugin/test/pollingTimer.test.ts`; 决策记录见 `docs/adr/0008-poll-alignment.md`; 术语见 `CONTEXT.md` 的「轮询对齐」「刻度网格」「风控退避」。
