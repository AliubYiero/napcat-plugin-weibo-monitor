import { describe, expect, it } from 'vitest';
import { getPostId } from '../src/weibo/predicate';
import type { WeiboPost } from '../src/weibo/types';
import {
    MAX_PUSH_PER_ROUND,
    resolveWatermark,
} from '../src/weibo/watermark';

function posts(...ids: string[]): WeiboPost[] {
    return ids.map((id) => ({ idstr: id }));
}

const ids = (list: WeiboPost[]) => list.map(getPostId);

describe('resolveWatermark', () => {
    it('本页为空时保持游标不变', () => {
        const result = resolveWatermark([], {
            watermark: 'A',
            recentIds: ['A'],
        });
        expect(result).toMatchObject({
            posts: [],
            nextWatermark: 'A',
            nextRecentIds: ['A'],
            rebuilt: false,
        });
    });

    it('首次绑定只建立水位线, 不补发历史', () => {
        const result = resolveWatermark(posts('C', 'B', 'A'), {
            watermark: null,
            recentIds: [],
        });
        expect(result.posts).toEqual([]);
        expect(result.nextWatermark).toBe('C');
        expect(result.rebuilt).toBe(true);
    });

    it('水位线精确命中时只推其之前的新动态, 旧→新', () => {
        const result = resolveWatermark(posts('D', 'C', 'B', 'A'), {
            watermark: 'B',
            recentIds: ['B'],
        });
        expect(ids(result.posts)).toEqual(['C', 'D']);
        expect(result.nextWatermark).toBe('D');
        expect(result.rebuilt).toBe(false);
    });

    it('水位线在最新一条时无推送, 且刷新 recentIds', () => {
        const result = resolveWatermark(posts('C', 'B', 'A'), {
            watermark: 'C',
            recentIds: ['C', 'B'],
        });
        expect(result.posts).toEqual([]);
        expect(result.nextWatermark).toBe('C');
        expect(result.nextRecentIds).toEqual(['C', 'B', 'A']);
        expect(result.rebuilt).toBe(false);
    });

    it('水位线丢失但 recentIds 命中锚点时按锚点补发', () => {
        const result = resolveWatermark(posts('D', 'C', 'B', 'A'), {
            watermark: 'Z',
            recentIds: ['B'],
        });
        expect(ids(result.posts)).toEqual(['C', 'D']);
        expect(result.nextWatermark).toBe('D');
        expect(result.rebuilt).toBe(false);
    });

    it('recentIds 锚点即最新一条时判定为无新动态', () => {
        const result = resolveWatermark(posts('C', 'B'), {
            watermark: 'Z',
            recentIds: ['C'],
        });
        expect(result.posts).toEqual([]);
        expect(result.rebuilt).toBe(false);
    });

    it('完全无法定位时静默重建, 不补发', () => {
        const result = resolveWatermark(posts('C', 'B'), {
            watermark: 'Z',
            recentIds: ['Y'],
        });
        expect(result.posts).toEqual([]);
        expect(result.nextWatermark).toBe('C');
        expect(result.rebuilt).toBe(true);
    });

    it('单轮最多推送 MAX_PUSH_PER_ROUND 条', () => {
        const list = posts(
            ...Array.from({ length: 15 }, (_, i) => `P${15 - i}`),
        );
        const result = resolveWatermark(list, {
            watermark: 'P1',
            recentIds: ['P1'],
        });
        expect(result.posts).toHaveLength(MAX_PUSH_PER_ROUND);
    });
});
