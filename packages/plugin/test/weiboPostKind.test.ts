import { describe, expect, it } from 'vitest';
import {
    isAdPost,
    isBirthdayPost,
    isLikePost,
    isPinnedPost,
    normalizeFlag,
    parseLikeDay,
    parseLikeMoment,
    resolveLikeMoment,
    resolvePostKind,
    resolveRootRetweet,
} from '../src/weibo/postKind';
import { formatLikeTime, parseWeiboTimeMs } from '../src/weibo/time';
import type { WeiboPost } from '../src/weibo/types';

const NOW = Date.UTC(2026, 9, 26, 0, 0, 0);

function post(overrides: Partial<WeiboPost> = {}): WeiboPost {
    return { idstr: 'P1', mblogtype: 0, ...overrides };
}

describe('normalizeFlag', () => {
    it('兼容 boolean / number / string', () => {
        expect(normalizeFlag(true)).toBe(true);
        expect(normalizeFlag(1)).toBe(true);
        expect(normalizeFlag('1')).toBe(true);
        expect(normalizeFlag('true')).toBe(true);
        expect(normalizeFlag(false)).toBe(false);
        expect(normalizeFlag(0)).toBe(false);
        expect(normalizeFlag('0')).toBe(false);
        expect(normalizeFlag(undefined)).toBe(false);
    });

    it('广告与置顶都按同一规则归一', () => {
        expect(isAdPost(post({ isAd: '1' }))).toBe(true);
        expect(isPinnedPost(post({ isTop: true }))).toBe(true);
        expect(isAdPost(post({ isAd: 'false' }))).toBe(false);
    });

    it('转发链内嵌的广告同样识别', () => {
        expect(
            isAdPost(
                post({
                    retweeted_status: post({
                        idstr: 'R1',
                        isAd: true,
                    }),
                }),
            ),
        ).toBe(true);
    });
});

describe('isLikePost', () => {
    it('识别 analysis_extra 中的 profile_insert_type', () => {
        expect(
            isLikePost(
                post({
                    analysis_extra:
                        '{"profile_insert_type":"like_status"}',
                }),
            ),
        ).toBe(true);
        expect(
            isLikePost(
                post({
                    analysis_extra: 'profile_insert_type:like_status',
                }),
            ),
        ).toBe(true);
    });

    it('识别标题里的赞过 / 赞了', () => {
        expect(
            isLikePost(
                post({ title: { text: '她10-24赞过的微博' } }),
            ),
        ).toBe(true);
        expect(isLikePost(post({ title: '赞了这条微博' }))).toBe(
            true,
        );
        expect(
            isLikePost(post({ title: { text: '普通标题' } })),
        ).toBe(false);
    });
});

describe('parseLikeMoment', () => {
    it('相对日取北京时间, 可带单位数时分', () => {
        expect(
            parseLikeMoment(
                post({
                    title: { text: '她昨天21:42赞过的微博(3)' },
                }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: '21:42' });
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天0:10赞过的微博(4)' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: '00:10' });
        expect(
            parseLikeMoment(
                post({ title: { text: '她今天6:22赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-26', clock: '06:22' });
        expect(
            parseLikeMoment(
                post({ title: { text: '她前天21:42赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-24', clock: '21:42' });
    });

    it('兼容全角冒号与无时分标题', () => {
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天21：42赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: '21:42' });
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: null });
    });

    it('时分非法时只保留日期', () => {
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天24:10赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: null });
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天21:60赞过的微博' } }),
                NOW,
            ),
        ).toEqual({ day: '2026-10-25', clock: null });
    });

    it('相对日跨月与跨年', () => {
        expect(
            parseLikeMoment(
                post({ title: { text: '她昨天21:42赞过的微博' } }),
                Date.UTC(2026, 0, 1, 0),
            ),
        ).toEqual({ day: '2025-12-31', clock: '21:42' });
        expect(
            parseLikeMoment(
                post({ title: { text: '她前天21:42赞过的微博' } }),
                Date.UTC(2026, 2, 1, 0),
            ),
        ).toEqual({ day: '2026-02-27', clock: '21:42' });
    });
});

describe('resolveLikeMoment', () => {
    const relative = post({
        title: { text: '她昨天21:42赞过的微博(3)' },
    });

    it('上下文未给日期时分时回退标题解析', () => {
        expect(
            resolveLikeMoment(relative, {
                kind: 'like',
                fetchedAt: Date.UTC(2026, 9, 26, 0),
            }),
        ).toEqual({
            day: '2026-10-25',
            clock: '21:42',
        });
    });

    it('上下文日期与时分优先', () => {
        expect(
            resolveLikeMoment(relative, {
                kind: 'like',
                likeDay: '2026-10-20',
                likeClock: '08:05',
            }),
        ).toEqual({ day: '2026-10-20', clock: '08:05' });
    });

    it('上下文只有日期时补标题时分', () => {
        expect(
            resolveLikeMoment(relative, {
                kind: 'like',
                likeDay: '2026-10-20',
            }),
        ).toEqual({ day: '2026-10-20', clock: '21:42' });
    });
});

describe('parseLikeDay', () => {
    it('只有月日时取当前年', () => {
        expect(
            parseLikeDay(
                post({ title: { text: '她10-24赞过的微博' } }),
                NOW,
            ),
        ).toBe('2026-10-24');
    });

    it('未来月日回退到去年', () => {
        expect(
            parseLikeDay(
                post({ title: { text: '她12-31赞过的微博' } }),
                NOW,
            ),
        ).toBe('2025-12-31');
    });

    it('显式年份优先, 非法日期返回 null', () => {
        expect(
            parseLikeDay(
                post({ title: { text: '2024年2月29日赞过' } }),
                NOW,
            ),
        ).toBe('2024-02-29');
        expect(
            parseLikeDay(
                post({ title: { text: '2025-02-29 赞过' } }),
                NOW,
            ),
        ).toBeNull();
        expect(
            parseLikeDay(
                post({ title: { text: '赞过的微博' } }),
                NOW,
            ),
        ).toBeNull();
    });
});

describe('resolvePostKind', () => {
    it('点赞 > 生日 > 转发 > 原创', () => {
        expect(
            resolvePostKind(
                post({
                    source: '生日动态',
                    title: { text: '赞过的微博' },
                }),
            ),
        ).toBe('like');
        expect(
            resolvePostKind(
                post({
                    source: '生日动态',
                    retweeted_status: {},
                }),
            ),
        ).toBe('birthday');
        expect(resolvePostKind(post({ retweeted_status: {} }))).toBe(
            'repost',
        );
        expect(resolvePostKind(post())).toBe('original');
        expect(isBirthdayPost(post({ source: '生日动态' }))).toBe(
            true,
        );
    });
});

describe('resolveRootRetweet', () => {
    it('无转发时返回 undefined', () => {
        expect(resolveRootRetweet(post())).toBeUndefined();
        expect(
            resolveRootRetweet(post({ retweeted_status_id: 'R1' })),
        ).toBeUndefined();
    });

    it('单层与多层转发都返回最原始博文', () => {
        const root = post({ idstr: 'ROOT', text: '最原始正文' });
        const middle = post({
            idstr: 'MIDDLE',
            text: '中间转发理由',
            retweeted_status: root,
        });

        expect(
            resolveRootRetweet(post({ retweeted_status: root })),
        ).toBe(root);
        expect(
            resolveRootRetweet(post({ retweeted_status: middle })),
        ).toBe(root);
    });

    it('循环引用不会死循环', () => {
        const first = post({ idstr: 'A' });
        const second = post({ idstr: 'B' });
        first.retweeted_status = second;
        second.retweeted_status = first;

        expect([first, second]).toContain(resolveRootRetweet(first));
    });
});

describe('formatLikeTime', () => {
    it('标题时分优先, 同日无时分补拉取时间, 异日只显示日期', () => {
        expect(formatLikeTime('2026-10-25', '21:42', NOW)).toBe(
            '2026/10/25 21:42',
        );
        expect(formatLikeTime('2026-10-26', null, NOW)).toBe(
            '2026/10/26 08:00:00',
        );
        expect(formatLikeTime('2026-10-23', null, NOW)).toBe(
            '2026/10/23',
        );
    });

    it('缺失或非法日期返回空串, 非法时分回退', () => {
        expect(formatLikeTime(null, null, NOW)).toBe('');
        expect(formatLikeTime('2026-13-01', null, NOW)).toBe('');
        expect(formatLikeTime('2026-10-26', '25:00', NOW)).toBe(
            '2026/10/26 08:00:00',
        );
    });
});

describe('parseWeiboTimeMs', () => {
    it('按北京时间解析并支持比较', () => {
        const older = parseWeiboTimeMs(
            'Sat Oct 24 12:00:00 +0800 2026',
        );
        const newer = parseWeiboTimeMs(
            'Sun Oct 25 12:00:00 +0800 2026',
        );
        expect(older).not.toBeNull();
        expect(newer).not.toBeNull();
        expect((newer ?? 0) > (older ?? 0)).toBe(true);
        expect(parseWeiboTimeMs('无法解析')).toBeNull();
    });
});
