/**
 * 轮询排期
 *
 * 「轮询对齐」的行为契约: 能整除 60 的间隔锚定本地日历刻度, 其余走固定延迟;
 * 下一时刻严格晚于当前时刻, 已错过的刻度不补跑。
 */

import { describe, expect, it } from 'vitest';
import {
    createPollSchedule,
    normalizePollIntervalMinutes,
} from '../src/weibo/pollSchedule';

/** 以本地日历构造时刻, 避免测试依赖运行机器时区 */
function at(
    day: number,
    hour: number,
    minute: number,
    second = 0,
    ms = 0,
): number {
    return new Date(2026, 9, day, hour, minute, second, ms).getTime();
}

function nextAt(minutes: number, now: number): number {
    return createPollSchedule(minutes).nextAt(now);
}

describe('normalizePollIntervalMinutes', () => {
    it('四舍五入为整数分钟', () => {
        expect(normalizePollIntervalMinutes(7.5)).toBe(8);
        expect(normalizePollIntervalMinutes(60.4)).toBe(60);
    });

    it('钳到 1..1440', () => {
        expect(normalizePollIntervalMinutes(0)).toBe(1);
        expect(normalizePollIntervalMinutes(-3)).toBe(1);
        expect(normalizePollIntervalMinutes(9999)).toBe(1440);
    });

    it('非法输入回退默认 60', () => {
        expect(normalizePollIntervalMinutes(Number.NaN)).toBe(60);
        expect(normalizePollIntervalMinutes('60')).toBe(60);
        expect(normalizePollIntervalMinutes(null)).toBe(60);
    });
});

describe('createPollSchedule: 模式选择', () => {
    it('能整除 60 的间隔走刻度网格', () => {
        for (const minutes of [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 60]) {
            expect(createPollSchedule(minutes).kind).toBe('grid');
        }
    });

    it('60 的倍数同样走网格', () => {
        for (const minutes of [120, 180, 720, 1440]) {
            expect(createPollSchedule(minutes).kind).toBe('grid');
        }
    });

    it('其余间隔走固定延迟', () => {
        for (const minutes of [7, 8, 45, 90, 100]) {
            expect(createPollSchedule(minutes).kind).toBe('fixed');
        }
    });
});

describe('createPollSchedule: 口径文案', () => {
    it('常见档特判', () => {
        expect(createPollSchedule(60).label).toBe('每小时整点');
        expect(createPollSchedule(1440).label).toBe('每天 00:00');
    });

    it('其余档按公式派生', () => {
        expect(createPollSchedule(5).label).toBe('每 5 分钟整分');
        expect(createPollSchedule(30).label).toBe('每 30 分钟整分');
        expect(createPollSchedule(120).label).toBe('每 2 小时整点');
        expect(createPollSchedule(7).label).toBe('固定间隔 7 分钟');
    });
});

describe('createPollSchedule: 分钟网格', () => {
    it.each([
        [5, '02:10'],
        [10, '02:10'],
        [15, '02:15'],
        [20, '02:20'],
        [30, '02:30'],
    ])('%i 分钟间隔锚定本地整分', (minutes, expected) => {
        const [hour, minute] = expected.split(':').map(Number);
        expect(nextAt(minutes, at(22, 2, 6, 30))).toBe(
            at(22, hour, minute),
        );
    });

    it('跨小时时进位到下一整分刻度', () => {
        expect(nextAt(5, at(22, 2, 59, 10))).toBe(at(22, 3, 0));
        expect(nextAt(30, at(22, 2, 59, 10))).toBe(at(22, 3, 0));
    });

    it('精确落在刻度上时取下一个刻度', () => {
        expect(nextAt(5, at(22, 2, 10, 0, 0))).toBe(at(22, 2, 15));
        expect(nextAt(1, at(22, 2, 6, 0, 0))).toBe(at(22, 2, 7));
    });

    it('已错过的刻度跳过, 不补跑', () => {
        expect(nextAt(5, at(22, 2, 17, 30))).toBe(at(22, 2, 20));
    });
});

describe('createPollSchedule: 小时网格', () => {
    it('60 分钟按本地整点对齐', () => {
        expect(nextAt(60, at(22, 2, 6, 30))).toBe(at(22, 3, 0));
        expect(nextAt(60, at(22, 2, 0, 0, 0))).toBe(at(22, 3, 0));
    });

    it('非 1 小时倍数按本地零点起算', () => {
        expect(nextAt(120, at(22, 3, 6))).toBe(at(22, 4, 0));
        expect(nextAt(120, at(22, 4, 0, 0, 0))).toBe(at(22, 6, 0));
        expect(nextAt(720, at(22, 13, 0))).toBe(at(23, 0, 0));
    });

    it('1440 分钟落在本地零点', () => {
        expect(nextAt(1440, at(22, 2, 6))).toBe(at(23, 0, 0));
        expect(nextAt(1440, at(22, 0, 0, 0, 0))).toBe(at(23, 0, 0));
    });
});

describe('createPollSchedule: 固定延迟', () => {
    it('下一时刻为当前时刻加一个间隔', () => {
        expect(nextAt(7, at(22, 2, 6, 30))).toBe(at(22, 2, 13, 30));
        expect(nextAt(45, at(22, 2, 6))).toBe(at(22, 2, 51));
        expect(nextAt(90, at(22, 2, 6))).toBe(at(22, 3, 36));
    });

    it('nextDelay 恒等于间隔毫秒数', () => {
        expect(createPollSchedule(7).nextDelay(at(22, 2, 6))).toBe(
            7 * 60_000,
        );
    });
});

describe('createPollSchedule: 延迟换算', () => {
    it('网格档的延迟等于下次时刻减当前时刻', () => {
        const now = at(22, 2, 6, 30);
        const schedule = createPollSchedule(60);
        expect(schedule.nextDelay(now)).toBe(
            schedule.nextAt(now) - now,
        );
        expect(schedule.nextDelay(now)).toBe(54 * 60_000 - 30_000);
    });
});
