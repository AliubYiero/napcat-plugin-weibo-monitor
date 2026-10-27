import type { WeiboContentType } from 'shared';
import { describe, expect, it } from 'vitest';
import {
    buildSeenBaseline,
    collectPageKeys,
    mergeSeenIds,
    migrateLegacyLikeKeys,
    resolveSeenCache,
    SEEN_ID_LIMIT,
} from '../src/weibo/seenCache';
import type { WeiboPost } from '../src/weibo/types';

const UID = '1234567890';
const ALL: readonly WeiboContentType[] = [
    'repost',
    'like',
    'ad',
    'birthday',
];
const NOW = Date.UTC(2026, 9, 26, 4, 0, 0);

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

function ids(list: Array<{ id: string }>): string[] {
    return list.map((item) => item.id);
}

describe('collectPageKeys', () => {
    it('按顺序去重, 点赞用日期键', () => {
        const keys = collectPageKeys(
            [
                post('A'),
                post('A'),
                post('B', { title: { text: '10-24赞过的微博' } }),
            ],
            NOW,
        );
        expect(keys).toEqual(['A', 'like:B:2026-10-24']);
    });

    it('相对标题解析后与绝对日期键一致', () => {
        expect(
            collectPageKeys(
                [
                    post('L', {
                        title: { text: '她昨天21:42赞过的微博(3)' },
                    }),
                ],
                NOW,
            ),
        ).toEqual(['like:L:2026-10-25']);
        expect(
            collectPageKeys(
                [
                    post('L', {
                        title: { text: '她10-25赞过的微博(2)' },
                    }),
                ],
                NOW,
            ),
        ).toEqual(['like:L:2026-10-25']);
    });
});

describe('migrateLegacyLikeKeys', () => {
    it('按当前页把空日期键改写为解析后的日期键', () => {
        expect(
            migrateLegacyLikeKeys(
                ['like:L:', 'A'],
                [
                    post('L', {
                        title: { text: '她昨天21:42赞过的微博(3)' },
                    }),
                    post('A'),
                ],
                NOW,
            ),
        ).toEqual(['like:L:2026-10-25', 'A']);
    });

    it('不在当前页或已不再是点赞时保留旧键', () => {
        expect(
            migrateLegacyLikeKeys(['like:M:'], [post('A')], NOW),
        ).toEqual(['like:M:']);
        expect(
            migrateLegacyLikeKeys(
                ['like:A:'],
                [post('A', { title: { text: '普通标题' } })],
                NOW,
            ),
        ).toEqual(['like:A:']);
    });

    it('新旧键并存时去重', () => {
        expect(
            migrateLegacyLikeKeys(
                ['like:L:', 'like:L:2026-10-25'],
                [
                    post('L', {
                        title: { text: '她10-25赞过的微博(2)' },
                    }),
                ],
                NOW,
            ),
        ).toEqual(['like:L:2026-10-25']);
    });
});

describe('mergeSeenIds', () => {
    it('当前页优先, 旧缓存补后并截断', () => {
        expect(mergeSeenIds(['B', 'A'], ['A', 'Z'])).toEqual([
            'B',
            'A',
            'Z',
        ]);
        expect(
            mergeSeenIds(
                Array.from({ length: 5 }, (_, i) => `N${i}`),
                Array.from({ length: 5 }, (_, i) => `O${i}`),
                6,
            ),
        ).toEqual(['N0', 'N1', 'N2', 'N3', 'N4', 'O0']);
    });

    it('默认上限 100', () => {
        const many = Array.from(
            { length: SEEN_ID_LIMIT + 20 },
            (_, i) => `P${i}`,
        );
        expect(mergeSeenIds(many, [])).toHaveLength(SEEN_ID_LIMIT);
    });
});

describe('buildSeenBaseline', () => {
    it('当前页全部条目入库, 不推送且允许空列表', () => {
        const baseline = buildSeenBaseline(
            [post('A'), post('B', { isAd: true })],
            NOW,
        );
        expect(baseline).toEqual({
            seenIds: ['A', 'B'],
            watermark: 'A',
            initialized: true,
        });
        expect(buildSeenBaseline([], NOW)).toEqual({
            seenIds: [],
            watermark: '',
            initialized: true,
        });
    });
});

describe('resolveSeenCache', () => {
    it('未初始化时只基线化、不推送', () => {
        const result = resolveSeenCache(
            [post('C'), post('B'), post('A')],
            UID,
            { seenIds: [], initialized: false, watermark: '' },
            ALL,
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.pinned).toEqual([]);
        expect(result.nextSeenIds).toEqual(['C', 'B', 'A']);
        expect(result.nextWatermark).toBe('C');
        expect(result.initialized).toBe(true);
        expect(result.reason).toBe('baseline');
    });

    it('有交集时推新动态, 旧 → 新', () => {
        const result = resolveSeenCache(
            [post('D'), post('C'), post('B'), post('A')],
            UID,
            {
                seenIds: ['B', 'A'],
                initialized: true,
                watermark: 'B',
            },
            ALL,
            NOW,
        );
        expect(ids(result.posts)).toEqual(['C', 'D']);
        expect(result.nextSeenIds).toEqual(['D', 'C', 'B', 'A']);
        expect(result.reason).toBeNull();
    });

    it('全部已见时无推送', () => {
        const result = resolveSeenCache(
            [post('C'), post('B')],
            UID,
            {
                seenIds: ['C', 'B'],
                initialized: true,
                watermark: 'C',
            },
            ALL,
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.reason).toBeNull();
    });

    it('升级首轮不重复推送已见点赞', () => {
        const result = resolveSeenCache(
            [
                post('L', {
                    title: { text: '她昨天21:42赞过的微博(3)' },
                }),
                post('NEW'),
            ],
            UID,
            {
                seenIds: ['like:L:', 'NEW'],
                initialized: true,
                watermark: 'like:L:',
            },
            ALL,
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.reason).toBeNull();
        expect(result.nextSeenIds).toEqual([
            'like:L:2026-10-25',
            'NEW',
        ]);
    });

    it('只有旧点赞键时零重叠判定不触发', () => {
        const result = resolveSeenCache(
            [
                post('L', {
                    title: { text: '她昨天21:42赞过的微博(3)' },
                }),
            ],
            UID,
            {
                seenIds: ['like:L:'],
                initialized: true,
                watermark: 'like:L:',
            },
            ALL,
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.reason).toBeNull();
    });

    it('首页与缓存零重叠时静默重建 (薄缓存也重建)', () => {
        const result = resolveSeenCache(
            [post('C'), post('B')],
            UID,
            {
                seenIds: ['A'],
                initialized: true,
                watermark: 'A',
            },
            ALL,
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.nextSeenIds).toEqual(['C', 'B']);
        expect(result.nextWatermark).toBe('C');
        expect(result.reason).toBe('zero-overlap');
    });

    it('已初始化但缓存为空时正常推送', () => {
        const result = resolveSeenCache(
            [post('C'), post('B')],
            UID,
            { seenIds: [], initialized: true, watermark: '' },
            ALL,
            NOW,
        );
        expect(ids(result.posts)).toEqual(['B', 'C']);
        expect(result.reason).toBeNull();
    });

    it('不限制单轮推送数量', () => {
        const list = Array.from({ length: 15 }, (_, i) =>
            post(`P${15 - i}`),
        );
        const result = resolveSeenCache(
            list,
            UID,
            { seenIds: ['P1'], initialized: true, watermark: 'P1' },
            ALL,
            NOW,
        );
        expect(result.posts).toHaveLength(14);
    });

    it('内容开关过滤新动态但仍写入见缓存', () => {
        const result = resolveSeenCache(
            [post('C', { isAd: true }), post('B')],
            UID,
            {
                seenIds: ['B'],
                initialized: true,
                watermark: 'B',
            },
            [],
            NOW,
        );
        expect(result.posts).toEqual([]);
        expect(result.nextSeenIds).toEqual(['C', 'B']);
    });

    it('置顶比最新非置顶本人动态新时单独推送', () => {
        const result = resolveSeenCache(
            [
                pinnedAt('PIN', 12, 26),
                at('NEW', 10, 26),
                at('OLD', 10, 24),
            ],
            UID,
            {
                seenIds: ['NEW', 'OLD'],
                initialized: true,
                watermark: 'NEW',
            },
            ALL,
            NOW,
        );
        expect(ids(result.pinned)).toEqual(['PIN']);
        expect(result.posts).toEqual([]);
    });

    it('置顶时间不晚于参照或无法解析时不推', () => {
        const equal = resolveSeenCache(
            [pinnedAt('PIN', 10, 26), at('NEW', 10, 26)],
            UID,
            {
                seenIds: ['NEW'],
                initialized: true,
                watermark: 'NEW',
            },
            ALL,
            NOW,
        );
        expect(equal.pinned).toEqual([]);

        const invalid = resolveSeenCache(
            [
                post('PIN', {
                    isTop: 1,
                    created_at: '无法解析',
                }),
                at('NEW', 10, 26),
            ],
            UID,
            {
                seenIds: ['NEW'],
                initialized: true,
                watermark: 'NEW',
            },
            ALL,
            NOW,
        );
        expect(invalid.pinned).toEqual([]);
    });

    it('多条置顶按时间新 → 旧推送', () => {
        const result = resolveSeenCache(
            [
                pinnedAt('P1', 11, 26),
                pinnedAt('P2', 12, 26),
                at('NEW', 10, 26),
            ],
            UID,
            {
                seenIds: ['NEW'],
                initialized: true,
                watermark: 'NEW',
            },
            ALL,
            NOW,
        );
        expect(ids(result.pinned)).toEqual(['P2', 'P1']);
    });

    it('无参照动态时置顶直接推送', () => {
        const result = resolveSeenCache(
            [pinnedAt('PIN', 12, 26)],
            UID,
            { seenIds: [], initialized: true, watermark: '' },
            ALL,
            NOW,
        );
        expect(ids(result.pinned)).toEqual(['PIN']);
    });

    it('点赞条目即使带置顶标记也走普通轨道', () => {
        const result = resolveSeenCache(
            [
                post('L', {
                    isTop: 1,
                    title: { text: '10-24赞过的微博' },
                    user: { idstr: '999' },
                }),
                at('NEW', 10, 26),
            ],
            UID,
            {
                seenIds: ['NEW'],
                initialized: true,
                watermark: 'NEW',
            },
            ALL,
            NOW,
        );
        expect(result.pinned).toEqual([]);
        expect(ids(result.posts)).toEqual(['L']);
    });
});
