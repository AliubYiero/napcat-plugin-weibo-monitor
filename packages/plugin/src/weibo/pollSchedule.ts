/**
 * 轮询排期
 *
 * 「轮询对齐」的纯函数实现: 能整除 60 的整数分钟间隔锚定在本地日历刻度上
 * (分钟网格落在本地整分, 小时网格落在本地零点起每 N 小时), 其余间隔退回
 * 「上轮结束 + 间隔」的固定延迟。工厂只在启动与配置变更时调用一次; tick 收尾
 * 只调用计划器产出的 nextDelay, 模式判断不进入轮询路径。
 */

const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 1440;
const DEFAULT_INTERVAL_MINUTES = 60;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

export type PollScheduleKind = 'grid' | 'fixed';

export interface PollSchedule {
    kind: PollScheduleKind;
    /** 面向状态页与启动日志的口径文案 */
    label: string;
    /** 严格未来的下一次轮询时刻 (毫秒时间戳) */
    nextAt(now: number): number;
    /** 传给 setTimeout 的延迟毫秒数 */
    nextDelay(now: number): number;
}

/**
 * 运行期归一: 四舍五入到整数分钟并钳到 1..1440。
 * 非法输入回退默认值, 与配置清洗的「非法回退默认」纪律一致。
 */
export function normalizePollIntervalMinutes(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_INTERVAL_MINUTES;
    }
    return Math.min(
        MAX_INTERVAL_MINUTES,
        Math.max(MIN_INTERVAL_MINUTES, Math.round(value)),
    );
}

export function createPollSchedule(rawMinutes: unknown): PollSchedule {
    const minutes = normalizePollIntervalMinutes(rawMinutes);
    const intervalMs = minutes * MS_PER_MINUTE;

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
        nextAt: (now) => now + intervalMs,
        nextDelay: () => intervalMs,
    };
}

/** 能整除 60 (分钟网格) 或能被 60 整除 (小时网格) 的间隔才进网格 */
function isGridInterval(minutes: number): boolean {
    return (
        minutes % MINUTES_PER_HOUR === 0 ||
        MINUTES_PER_HOUR % minutes === 0
    );
}

function gridLabel(minutes: number): string {
    if (minutes === MINUTES_PER_HOUR) return '每小时整点';
    if (minutes === MAX_INTERVAL_MINUTES) return '每天 00:00';
    if (minutes < MINUTES_PER_HOUR) {
        return `每 ${minutes} 分钟整分`;
    }
    return `每 ${minutes / MINUTES_PER_HOUR} 小时整点`;
}

function nextGridAt(now: number, minutes: number): number {
    const cursor = new Date(now);
    cursor.setSeconds(0, 0);

    if (minutes < MINUTES_PER_HOUR) {
        // 分钟网格: 直接跳到本小时后第一个 N 分钟整分 (Date 自动进位跨小时)
        const nextMinute =
            (Math.floor(cursor.getMinutes() / minutes) + 1) *
            minutes;
        cursor.setMinutes(nextMinute);
        return cursor.getTime();
    }

    // 小时网格: 以本地日历为原点逐小时前进, 不让 epoch 取模把原点挪到 UTC
    const stepHours = minutes / MINUTES_PER_HOUR;
    cursor.setMinutes(0, 0, 0);
    if (cursor.getTime() <= now) {
        cursor.setHours(cursor.getHours() + 1);
    }
    while (cursor.getHours() % stepHours !== 0) {
        cursor.setHours(cursor.getHours() + 1);
    }
    return cursor.getTime();
}
