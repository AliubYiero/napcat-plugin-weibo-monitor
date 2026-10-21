import { describe, expect, it } from 'vitest';
import {
    filterQualifiedPosts,
    getPostId,
    getUserUid,
    isQualifiedPost,
} from '../src/weibo/predicate';
import type { WeiboPost } from '../src/weibo/types';

const UID = '1234567890';

function post(overrides: Partial<WeiboPost> = {}): WeiboPost {
    return {
        idstr: 'P1',
        mblogtype: 0,
        isTop: 0,
        isAd: false,
        user: { idstr: UID },
        ...overrides,
    };
}

describe('getPostId', () => {
    it('优先 idstr, 依次回退 mid / id', () => {
        expect(getPostId(post())).toBe('P1');
        expect(getPostId({ mid: 'M1', id: 1 })).toBe('M1');
        expect(getPostId({ id: 42 })).toBe('42');
        expect(getPostId({} as WeiboPost)).toBe('');
    });
});

describe('getUserUid', () => {
    it('优先 idstr, 回退 id', () => {
        expect(getUserUid({ user: { idstr: UID, id: 1 } })).toBe(UID);
        expect(getUserUid({ user: { id: 1 } })).toBe('1');
        expect(getUserUid({})).toBe('');
    });
});

describe('isQualifiedPost', () => {
    it('原创、非置顶、非广告、作者匹配时合格', () => {
        expect(isQualifiedPost(post(), UID)).toBe(true);
    });

    it('作者不匹配时淘汰', () => {
        expect(
            isQualifiedPost(post({ user: { idstr: '999' } }), UID),
        ).toBe(false);
    });

    it('mblogtype 非 0 时淘汰 (转发/其他类型)', () => {
        expect(isQualifiedPost(post({ mblogtype: 1 }), UID)).toBe(
            false,
        );
    });

    it('置顶与广告淘汰', () => {
        expect(isQualifiedPost(post({ isTop: 1 }), UID)).toBe(false);
        expect(isQualifiedPost(post({ isTop: true }), UID)).toBe(
            false,
        );
        expect(isQualifiedPost(post({ isAd: true }), UID)).toBe(
            false,
        );
    });

    it('缺少 id 时淘汰', () => {
        expect(
            isQualifiedPost(
                post({
                    idstr: undefined,
                    mid: undefined,
                    id: undefined,
                }),
                UID,
            ),
        ).toBe(false);
    });
});

describe('filterQualifiedPosts', () => {
    it('只保留合格动态并保持原顺序', () => {
        const posts = [
            post({ idstr: 'A' }),
            post({ idstr: 'B', isTop: 1 }),
            post({ idstr: 'C' }),
            post({ idstr: 'D', user: { idstr: '999' } }),
        ];
        expect(
            filterQualifiedPosts(posts, UID).map(getPostId),
        ).toEqual(['A', 'C']);
    });
});
