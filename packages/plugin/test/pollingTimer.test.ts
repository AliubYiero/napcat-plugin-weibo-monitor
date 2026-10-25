/**
 * 轮询定时器接线 (假定时器集成测试)
 *
 * 排期纯函数由 pollSchedule.test.ts 覆盖; 这里只验证服务层的接线:
 * 跨整点时下一次真的排在整点、退避结束后回到网格、配置变更触发重新分发、
 * 即时拉取不挪动网格、固定延迟档从上轮结束起算。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { weiboRuntime } from '../src/services/weibo/runtimeStatus';

const mocks = vi.hoisted(() => ({
    fetchMyMblog: vi.fn(),
    ensureFresh: vi.fn(async () => {}),
    markInvalidAndNotify: vi.fn(async () => {}),
    pushPost: vi.fn(async () => {}),
    cursorGet: vi.fn(() => undefined),
    cursorSet: vi.fn(),
    cursorSetPaused: vi.fn(),
    isSessionEnabled: vi.fn(() => true),
    updateMeta: vi.fn(),
    config: {
        weiboPollIntervalMinutes: 60,
        weiboPushContentTypes: [
            'repost',
            'like',
            'ad',
            'birthday',
        ] as const,
    },
    logger: {
        log: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
    timers: new Map<string, unknown>(),
    monitor: {
        uid: '1234567890',
        screenName: '博主',
        avatar: 'https://example.com/avatar.jpg',
        to: [{ id: '10086', type: 'group' }],
    },
}));

vi.mock('../src/core/state', () => ({
    pluginState: {
        config: mocks.config,
        logger: mocks.logger,
        timers: mocks.timers,
    },
}));

vi.mock('../src/store/WeiboCookieStore', () => ({
    WeiboCookieStore: {
        getInstance: () => ({
            getData: () => ({
                cookies: [{ name: 'SUB', value: 'token' }],
                invalid: false,
            }),
        }),
    },
}));

vi.mock('../src/store/WeiboMonitorStore', () => ({
    WeiboMonitorStore: {
        getInstance: () => ({
            list: () => [mocks.monitor],
            get: (uid: string) =>
                uid === mocks.monitor.uid
                    ? mocks.monitor
                    : undefined,
            updateMeta: mocks.updateMeta,
        }),
    },
}));

vi.mock('../src/store/WeiboCursorStore', () => ({
    WeiboCursorStore: {
        getInstance: () => ({
            get: mocks.cursorGet,
            set: mocks.cursorSet,
            setPaused: mocks.cursorSetPaused,
        }),
    },
}));

vi.mock('../src/services/sessionConfigService', () => ({
    sessionConfigService: {
        isSessionEnabled: mocks.isSessionEnabled,
    },
}));

vi.mock('../src/services/weibo/cookieService', () => ({
    weiboCookieService: {
        ensureFresh: mocks.ensureFresh,
        markInvalidAndNotify: mocks.markInvalidAndNotify,
    },
}));

vi.mock('../src/services/weibo/apiService', () => ({
    weiboApiService: { fetchMyMblog: mocks.fetchMyMblog },
}));

vi.mock('../src/services/weibo/pushService', () => ({
    weiboPushService: { pushPost: mocks.pushPost },
}));

const { weiboPollingService } = await import(
    '../src/services/weibo/pollingService'
);

/** 以本地日历构造时刻, 与排期单测保持同一口径 */
function at(
    day: number,
    hour: number,
    minute: number,
    second = 0,
): number {
    return new Date(2026, 9, day, hour, minute, second).getTime();
}

function nextPollAt(): number | null {
    return weiboRuntime.nextPollAt;
}

function okResult() {
    return { ok: true, posts: [], message: '', failure: null };
}

async function startAndSettle(): Promise<void> {
    weiboPollingService.start();
    await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 2, 6, 30));

    mocks.fetchMyMblog.mockReset();
    mocks.fetchMyMblog.mockResolvedValue(okResult());
    mocks.cursorGet.mockReset();
    mocks.cursorGet.mockReturnValue(undefined);
    mocks.cursorSet.mockReset();
    mocks.cursorSetPaused.mockReset();
    mocks.updateMeta.mockReset();
    mocks.config.weiboPollIntervalMinutes = 60;
    mocks.timers.clear();

    weiboRuntime.running = false;
    weiboRuntime.lastPollAt = null;
    weiboRuntime.nextPollAt = null;
    weiboRuntime.backoffUntil = null;
    weiboRuntime.lastError = null;
    weiboRuntime.lastErrorAt = null;
});

afterEach(() => {
    weiboPollingService.stop();
    vi.useRealTimers();
});

describe('轮询定时器接线', () => {
    it('跨整点: 02:06:30 即时拉取后, 下一次落在 03:00', async () => {
        await startAndSettle();
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(1);
        expect(nextPollAt()).toBe(at(22, 3, 0));

        await vi.advanceTimersByTimeAsync(53 * 60_000 + 30_000 - 1);
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(1);
        expect(nextPollAt()).toBe(at(22, 3, 0));

        await vi.advanceTimersByTimeAsync(1);
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(2);
        expect(nextPollAt()).toBe(at(22, 4, 0));
    });

    it('风控退避等满 30 分钟后重试, 恢复后回到网格', async () => {
        mocks.fetchMyMblog
            .mockReset()
            .mockResolvedValueOnce({
                ok: false,
                posts: [],
                message: '风控',
                failure: 'risk',
            })
            .mockResolvedValue(okResult());

        await startAndSettle();
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(1);
        expect(weiboRuntime.backoffUntil).toBe(at(22, 2, 36, 30));
        expect(nextPollAt()).toBe(at(22, 2, 36, 30));

        await vi.advanceTimersByTimeAsync(30 * 60_000);
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(2);
        expect(weiboRuntime.backoffUntil).toBeNull();
        expect(nextPollAt()).toBe(at(22, 3, 0));
    });

    it('配置变更重新分发计划器, 立即按新网格排期', async () => {
        await startAndSettle();
        expect(nextPollAt()).toBe(at(22, 3, 0));

        mocks.config.weiboPollIntervalMinutes = 5;
        weiboPollingService.reschedule();
        expect(nextPollAt()).toBe(at(22, 2, 10));

        await vi.advanceTimersByTimeAsync(3.5 * 60_000);
        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(2);
        expect(nextPollAt()).toBe(at(22, 2, 15));
    });

    it('即时拉取不挪动网格相位', async () => {
        await startAndSettle();
        expect(nextPollAt()).toBe(at(22, 3, 0));

        weiboPollingService.requestImmediate();
        await vi.advanceTimersByTimeAsync(0);

        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(2);
        expect(nextPollAt()).toBe(at(22, 3, 0));
    });

    it('固定延迟档从上轮结束起算', async () => {
        mocks.config.weiboPollIntervalMinutes = 7;
        await startAndSettle();

        expect(mocks.fetchMyMblog).toHaveBeenCalledTimes(1);
        expect(nextPollAt()).toBe(at(22, 2, 13, 30));
    });
});
