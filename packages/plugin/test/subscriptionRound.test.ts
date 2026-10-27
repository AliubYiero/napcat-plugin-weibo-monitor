import type { WeiboContentType } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import type { MyMblogResult } from '../src/weibo/reader';
import {
    createSubscriptionRound,
    type SubscriptionRoundDeps,
} from '../src/weibo/subscriptionRound';
import type {
    WeiboCursor,
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
    WeiboPostRenderContext,
} from '../src/weibo/types';

const UID = '1234567890';
const TARGET: WeiboMonitorTarget = { type: 'group', id: '10086' };
const ALL: readonly WeiboContentType[] = [
    'repost',
    'like',
    'ad',
    'birthday',
];
const NOW = Date.UTC(2026, 9, 26, 4, 0, 0);

function subscription(
    overrides: Partial<WeiboMonitor> = {},
): WeiboMonitor {
    return {
        uid: UID,
        screenName: '博主',
        avatar: 'avatar',
        to: [TARGET],
        ...overrides,
    };
}

function post(
    id: string,
    overrides: Partial<WeiboPost> = {},
): WeiboPost {
    return {
        idstr: id,
        mblogtype: 0,
        isTop: 0,
        isAd: false,
        created_at: 'Sat Oct 24 12:00:00 +0800 2026',
        user: { idstr: UID, screen_name: '博主' },
        ...overrides,
    };
}

function at(id: string, hour: number, day = 24): WeiboPost {
    return post(id, {
        created_at: `Sat Oct ${day} ${String(hour).padStart(2, '0')}:00:00 +0800 2026`,
    });
}

function pinnedAt(id: string, hour: number, day = 24): WeiboPost {
    return { ...at(id, hour, day), isTop: 1 };
}

function cursor(overrides: Partial<WeiboCursor> = {}): WeiboCursor {
    return {
        watermark: '',
        seenIds: [],
        initialized: false,
        updatedAt: 0,
        ...overrides,
    };
}

function ok(posts: WeiboPost[]): MyMblogResult {
    return { ok: true, posts, message: '', failure: null };
}

function failed(
    message: string,
    failure: MyMblogResult['failure'],
): MyMblogResult {
    return { ok: false, posts: [], message, failure };
}

function targetKey(target: WeiboMonitorTarget): string {
    return `${target.type}:${target.id}`;
}

interface HarnessOptions {
    page?: MyMblogResult;
    subscription?: WeiboMonitor;
    cursor?: WeiboCursor;
    enabledTargets?: WeiboMonitorTarget[];
    contentTypes?: readonly WeiboContentType[];
    removeAfterSet?: string;
}

function createHarness(options: HarnessOptions = {}) {
    const currentSubscription =
        options.subscription ?? subscription();
    const monitors = new Map<string, WeiboMonitor>([
        [currentSubscription.uid, currentSubscription],
    ]);
    const cursors = new Map<string, WeiboCursor>();
    if (options.cursor) {
        cursors.set(currentSubscription.uid, options.cursor);
    }

    const enabled = new Set(
        (options.enabledTargets ?? [TARGET]).map(targetKey),
    );
    const setCalls: Array<{
        uid: string;
        next: Pick<
            WeiboCursor,
            'watermark' | 'seenIds' | 'initialized'
        >;
    }> = [];
    const pauseCalls: Array<{ uid: string; paused: boolean }> = [];
    const metaCalls: Array<{
        uid: string;
        screenName: string;
        avatar: string;
    }> = [];
    const pushes: Array<{
        post: WeiboPost;
        monitor: WeiboMonitor;
        context: WeiboPostRenderContext;
    }> = [];
    const events: string[] = [];
    const logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    const deps: SubscriptionRoundDeps = {
        fetchPage: vi.fn(async () => options.page ?? ok([])),
        pushPost: vi.fn(async (itemPost, monitor, context) => {
            pushes.push({
                post: itemPost,
                monitor,
                context,
            });
            events.push(
                `push:${itemPost.idstr ?? itemPost.id ?? ''}`,
            );
        }),
        cursors: {
            get: (uid) => cursors.get(uid),
            set: (uid, next) => {
                setCalls.push({ uid, next });
                cursors.set(uid, { ...next, updatedAt: NOW });
                events.push(`set:${uid}`);
                if (options.removeAfterSet === uid) {
                    monitors.delete(uid);
                }
            },
            setPaused: (uid, paused) => {
                pauseCalls.push({ uid, paused });
                const current = cursors.get(uid) ?? cursor();
                if (paused) {
                    cursors.set(uid, {
                        ...current,
                        paused: true,
                    });
                } else {
                    const { paused: _paused, ...rest } = current;
                    cursors.set(uid, rest);
                }
                events.push(`pause:${uid}:${paused}`);
            },
        },
        subscriptions: {
            list: () => [...monitors.values()],
            get: (uid) => monitors.get(uid),
            updateMeta: (uid, screenName, avatar) => {
                metaCalls.push({ uid, screenName, avatar });
                const monitor = monitors.get(uid);
                if (monitor) {
                    monitors.set(uid, {
                        ...monitor,
                        screenName,
                        avatar,
                    });
                }
                events.push(`meta:${uid}`);
            },
        },
        isSessionEnabled: (target) => enabled.has(targetKey(target)),
        contentTypes: () => options.contentTypes ?? ALL,
        now: () => NOW,
        logger,
    };

    const round = createSubscriptionRound(deps);

    return {
        round,
        deps,
        monitors,
        cursors,
        setCalls,
        pauseCalls,
        metaCalls,
        pushes,
        events,
        logger,
    };
}

describe('settlePause', () => {
    it('标记全部目标被禁用的订阅, 返回可拉取的订阅', () => {
        const first = subscription({ uid: '1' });
        const disabled = subscription({
            uid: '2',
            to: [{ type: 'group', id: '20000' }],
        });
        const harness = createHarness({
            subscription: first,
        });
        harness.monitors.set('2', disabled);

        const active = harness.round.settlePause();

        expect(active.map((item) => item.uid)).toEqual(['1']);
        expect(harness.pauseCalls).toEqual([
            { uid: '2', paused: true },
        ]);
    });

    it('没有可拉取订阅时返回空列表', () => {
        const harness = createHarness({
            enabledTargets: [],
        });

        expect(harness.round.settlePause()).toEqual([]);
        expect(harness.pauseCalls).toEqual([
            { uid: UID, paused: true },
        ]);
    });

    it('不主动清除已启用订阅的暂停标记', () => {
        const harness = createHarness({
            cursor: cursor({ paused: true }),
        });

        const active = harness.round.settlePause();

        expect(active.map((item) => item.uid)).toEqual([UID]);
        expect(harness.pauseCalls).toEqual([]);
    });
});

describe('poll', () => {
    it('拉取失败时返回失败分类与文案, 不碰游标', async () => {
        const harness = createHarness({
            page: failed('风控', 'risk'),
        });

        const outcome = await harness.round.poll(subscription());

        expect(outcome).toEqual({
            ok: false,
            failure: 'risk',
            message: '风控',
        });
        expect(harness.cursors.size).toBe(0);
        expect(harness.setCalls).toEqual([]);
        expect(harness.pushes).toEqual([]);
        expect(harness.logger.warn).toHaveBeenCalled();
    });

    it('失败文案为空时回退为分类说明', async () => {
        const harness = createHarness({
            page: failed('', 'invalid'),
        });

        const outcome = await harness.round.poll(subscription());

        expect(outcome.message).toBe('微博接口失败 (invalid)');
    });

    it('资料变化时更新订阅昵称与头像', async () => {
        const harness = createHarness({
            page: ok([
                post('A', {
                    user: {
                        idstr: UID,
                        screen_name: '新昵称',
                        avatar_large: 'new-avatar',
                    },
                }),
            ]),
        });

        await harness.round.poll(subscription());

        expect(harness.metaCalls).toEqual([
            {
                uid: UID,
                screenName: '新昵称',
                avatar: 'new-avatar',
            },
        ]);
    });

    it('资料未变化时不写订阅', async () => {
        const harness = createHarness({
            page: ok([post('A')]),
        });

        await harness.round.poll(subscription());

        expect(harness.metaCalls).toEqual([]);
    });

    it('首轮建立基线, 不推送', async () => {
        const harness = createHarness({
            page: ok([post('B'), post('A')]),
        });

        const outcome = await harness.round.poll(subscription());

        expect(outcome).toEqual({
            ok: true,
            failure: null,
            message: null,
        });
        expect(harness.pushes).toEqual([]);
        expect(harness.setCalls).toEqual([
            {
                uid: UID,
                next: {
                    watermark: 'B',
                    seenIds: ['B', 'A'],
                    initialized: true,
                },
            },
        ]);
        expect(harness.logger.info).toHaveBeenCalledWith(
            expect.stringContaining('首轮建立已见缓存'),
        );
    });

    it('暂停恢复时重建基线并清除暂停标记', async () => {
        const harness = createHarness({
            page: ok([post('B'), post('A')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
                paused: true,
            }),
        });

        const outcome = await harness.round.poll(subscription());

        expect(outcome.ok).toBe(true);
        expect(harness.pushes).toEqual([]);
        expect(harness.setCalls).toHaveLength(1);
        expect(harness.setCalls[0].next).toEqual({
            watermark: 'B',
            seenIds: ['B', 'A'],
            initialized: true,
        });
        expect(harness.pauseCalls).toEqual([
            { uid: UID, paused: false },
        ]);
        expect(harness.logger.info).toHaveBeenCalledWith(
            expect.stringContaining('已恢复推送'),
        );
    });

    it('零重叠时静默重建, 不推送', async () => {
        const harness = createHarness({
            page: ok([post('C'), post('B')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
            }),
        });

        await harness.round.poll(subscription());

        expect(harness.pushes).toEqual([]);
        expect(harness.setCalls[0].next).toEqual({
            watermark: 'C',
            seenIds: ['C', 'B'],
            initialized: true,
        });
        expect(harness.logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('零重叠'),
        );
    });

    it('置顶先于普通动态, 普通动态旧 → 新', async () => {
        const harness = createHarness({
            page: ok([
                pinnedAt('PIN', 12, 26),
                at('NEW', 10, 26),
                at('OLD', 10, 24),
                post('SEEN'),
            ]),
            cursor: cursor({
                watermark: 'SEEN',
                seenIds: ['SEEN'],
                initialized: true,
            }),
        });

        await harness.round.poll(subscription());

        expect(harness.pushes.map((item) => item.post.idstr)).toEqual(
            ['PIN', 'OLD', 'NEW'],
        );
        expect(harness.pushes[0].context).toMatchObject({
            kind: 'original',
            fetchedAt: NOW,
        });
    });

    it('游标未变化时不重复落盘', async () => {
        const harness = createHarness({
            page: ok([post('A'), post('B')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A', 'B'],
                initialized: true,
            }),
        });

        await harness.round.poll(subscription());

        expect(harness.pushes).toEqual([]);
        expect(harness.setCalls).toEqual([]);
    });

    it('先写游标再推送', async () => {
        const harness = createHarness({
            page: ok([post('B'), post('A')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
            }),
        });

        await harness.round.poll(subscription());

        expect(harness.events).toEqual([`set:${UID}`, 'push:B']);
    });

    it('轮内订阅被删除时不再推送', async () => {
        const harness = createHarness({
            page: ok([post('B'), post('A')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
            }),
            removeAfterSet: UID,
        });

        const outcome = await harness.round.poll(subscription());

        expect(outcome.ok).toBe(true);
        expect(harness.setCalls).toHaveLength(1);
        expect(harness.pushes).toEqual([]);
    });

    it('内容类型开关过滤推送但仍写入已见缓存', async () => {
        const harness = createHarness({
            page: ok([post('AD', { isAd: true }), post('B')]),
            cursor: cursor({
                watermark: 'B',
                seenIds: ['B'],
                initialized: true,
            }),
            contentTypes: [],
        });

        await harness.round.poll(subscription());

        expect(harness.pushes).toEqual([]);
        expect(harness.setCalls[0].next.seenIds).toEqual(['AD', 'B']);
    });

    it('无新动态时记 debug 日志', async () => {
        const harness = createHarness({
            page: ok([post('A')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
            }),
        });

        await harness.round.poll(subscription());

        expect(harness.logger.debug).toHaveBeenCalledWith(
            '微博无新动态 @博主',
        );
    });

    it('推送异常冒泡给调用方', async () => {
        const harness = createHarness({
            page: ok([post('B'), post('A')]),
            cursor: cursor({
                watermark: 'A',
                seenIds: ['A'],
                initialized: true,
            }),
        });
        harness.deps.pushPost = vi.fn(async () => {
            throw new Error('boom');
        });

        await expect(
            harness.round.poll(subscription()),
        ).rejects.toThrow('boom');
    });
});
