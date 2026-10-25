import { describe, expect, it } from 'vitest';
import type { WeiboContentType } from 'shared';
import {
    classifyPost,
    findOwnerProfilePost,
    getPostEventKey,
    getPostId,
    getUserUid,
    isContentEnabled,
    selectIncludedPosts,
    selectLatestOwnerPost,
} from '../src/weibo/predicate';
import type { WeiboPost } from '../src/weibo/types';

const UID = '1234567890';
const ALL: readonly WeiboContentType[] = [
    'repost',
    'like',
    'ad',
    'birthday',
];

function post(overrides: Partial<WeiboPost> = {}): WeiboPost {
    return {
        idstr: 'P1',
        mblogtype: 0,
        isTop: 0,
        isAd: false,
        created_at: 'Sat Oct 24 12:00:00 +0800 2026',
        user: { idstr: UID, screen_name: '博主' },
        ...overrides,
    };
}

describe('getPostId / getUserUid', () => {
    it('id 优先 idstr, 依次回退 mid / id', () => {
        expect(getPostId(post())).toBe('P1');
        expect(getPostId({ mid: 'M1', id: 1 })).toBe('M1');
        expect(getPostId({ id: 42 })).toBe('42');
        expect(getPostId({} as WeiboPost)).toBe('');
    });

    it('UID 优先 idstr, 回退 id', () => {
        expect(getUserUid({ user: { idstr: UID, id: 1 } })).toBe(UID);
        expect(getUserUid({ user: { id: 1 } })).toBe('1');
        expect(getUserUid({})).toBe('');
    });
});

describe('classifyPost', () => {
    it('原创动态按作者与 mblogtype 分类', () => {
        const result = classifyPost(post(), UID);
        expect(result).toMatchObject({
            kind: 'original',
            id: 'P1',
            key: 'P1',
            isPinned: false,
            isAd: false,
        });
    });

    it('作者不匹配时淘汰', () => {
        expect(
            classifyPost(post({ user: { idstr: '999' } }), UID),
        ).toBeNull();
    });

    it('mblogtype 非 0 时淘汰', () => {
        expect(classifyPost(post({ mblogtype: 1 }), UID)).toBeNull();
    });

    it('缺少 id 时淘汰', () => {
        expect(
            classifyPost(
                post({
                    idstr: undefined,
                    mid: undefined,
                    id: undefined,
                }),
                UID,
            ),
        ).toBeNull();
    });

    it('点赞条目跳过作者校验并使用日期去重键', () => {
        const result = classifyPost(
            post({
                user: { idstr: '999', screen_name: '原博主' },
                title: { text: '她10-24赞过的微博' },
            }),
            UID,
            Date.UTC(2026, 9, 26),
        );
        expect(result).toMatchObject({
            kind: 'like',
            likeDay: '2026-10-24',
            key: 'like:P1:2026-10-24',
        });
    });

    it('置顶与广告保留在分类结果中, 不直接淘汰', () => {
        expect(
            classifyPost(post({ isTop: 1 }), UID),
        ).toMatchObject({ isPinned: true });
        expect(
            classifyPost(post({ isAd: 'true' }), UID),
        ).toMatchObject({ isAd: true });
    });

    it('生日与转发按来源识别', () => {
        expect(
            classifyPost(post({ source: '生日动态' }), UID)?.kind,
        ).toBe('birthday');
        expect(
            classifyPost(
                post({ retweeted_status: { text: '原动态' } }),
                UID,
            )?.kind,
        ).toBe('repost');
    });
});

describe('isContentEnabled', () => {
    it('原创始终推送', () => {
        const result = classifyPost(post(), UID);
        expect(result && isContentEnabled(result, [])).toBe(true);
    });

    it('转发 / 点赞 / 生日分别受开关控制', () => {
        const repost = classifyPost(
            post({ retweeted_status: { text: '原' } }),
            UID,
        );
        const like = classifyPost(
            post({
                user: { idstr: '999' },
                title: { text: '10-24赞过的微博' },
            }),
            UID,
        );
        const birthday = classifyPost(
            post({ source: '生日动态' }),
            UID,
        );
        expect(repost && isContentEnabled(repost, [])).toBe(false);
        expect(like && isContentEnabled(like, [])).toBe(false);
        expect(
            birthday && isContentEnabled(birthday, []),
        ).toBe(false);
        expect(
            repost && isContentEnabled(repost, ['repost']),
        ).toBe(true);
        expect(like && isContentEnabled(like, ['like'])).toBe(true);
        expect(
            birthday && isContentEnabled(birthday, ['birthday']),
        ).toBe(true);
    });

    it('广告是独立否决项, 关闭时压过其它开关', () => {
        const ad = classifyPost(
            post({
                isAd: true,
                retweeted_status: { text: '原' },
            }),
            UID,
        );
        expect(
            ad && isContentEnabled(ad, ['repost', 'like', 'birthday']),
        ).toBe(false);
        expect(ad && isContentEnabled(ad, ['ad', 'repost'])).toBe(
            true,
        );

        const originalAd = classifyPost(
            post({ isAd: true }),
            UID,
        );
        expect(
            originalAd && isContentEnabled(originalAd, ['ad']),
        ).toBe(true);

        const nestedAd = classifyPost(
            post({
                retweeted_status: post({
                    idstr: 'R2',
                    isAd: true,
                }),
            }),
            UID,
        );
        expect(
            nestedAd && isContentEnabled(nestedAd, ['repost']),
        ).toBe(false);
    });
});

describe('selectIncludedPosts', () => {
    it('保留符合内容开关的动态并维持原顺序', () => {
        const posts = [
            post({ idstr: 'A' }),
            post({ idstr: 'B', isAd: true }),
            post({ idstr: 'C', retweeted_status: {} }),
            post({ idstr: 'D', user: { idstr: '999' } }),
        ];
        expect(
            selectIncludedPosts(posts, UID, ['ad', 'repost']).map(
                (item) => item.id,
            ),
        ).toEqual(['A', 'B', 'C']);
    });
});

describe('selectLatestOwnerPost', () => {
    it('跳过点赞、置顶与关闭的内容类型', () => {
        const posts = [
            post({ idstr: 'L', title: { text: '赞过的微博' } }),
            post({ idstr: 'T', isTop: 1 }),
            post({ idstr: 'R', retweeted_status: {} }),
            post({ idstr: 'A', isAd: true }),
            post({ idstr: 'O' }),
        ];
        expect(
            selectLatestOwnerPost(posts, UID, ['repost'])?.idstr,
        ).toBe('R');
        expect(selectLatestOwnerPost(posts, UID, [])?.idstr).toBe(
            'O',
        );
    });
});

describe('findOwnerProfilePost', () => {
    it('跳过点赞条目的原博主身份', () => {
        const posts = [
            post({
                idstr: 'L',
                user: { idstr: '999', screen_name: '原博主' },
                title: { text: '赞过的微博' },
            }),
            post({ idstr: 'O', user: { idstr: UID, screen_name: '本人' } }),
        ];
        expect(findOwnerProfilePost(posts, UID)?.idstr).toBe('O');
        expect(findOwnerProfilePost([posts[0]], UID)).toBeNull();
    });
});

describe('getPostEventKey', () => {
    it('普通动态用 id, 点赞用 id + 日期', () => {
        expect(getPostEventKey(post())).toBe('P1');
        expect(
            getPostEventKey(
                post({
                    title: { text: '10-24赞过的微博' },
                }),
                Date.UTC(2026, 9, 26),
            ),
        ).toBe('like:P1:2026-10-24');
    });

    it('点赞日期解析失败时仍保留可去重键', () => {
        expect(
            getPostEventKey(post({ title: { text: '赞过的微博' } })),
        ).toBe('like:P1:');
    });
});
