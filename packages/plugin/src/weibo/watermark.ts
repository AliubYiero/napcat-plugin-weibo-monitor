/**
 * 动态水位线计算 (纯函数)
 *
 * 接口返回顺序为「新 → 旧」。水位线是「最新一条已计入的动态 id」,
 * 因此新动态 = 排在水位线之前的项。
 *
 * 水位线不在本页 / 游标丢失时执行「静默重建」: 只把水位线推到最新一条,
 * 不补发任何历史动态。
 */

import { getPostId } from './predicate';
import type { WeiboPost } from './types';

/** 单轮单博主最多推送条数 */
export const MAX_PUSH_PER_ROUND = 10;

/** 游标中保留的最近 id 数量 */
const RECENT_ID_LIMIT = 20;

export interface WatermarkCursor {
    watermark: string | null;
    recentIds: string[];
}

export interface WatermarkResult {
    /** 待推送动态 (旧 → 新, 最多 MAX_PUSH_PER_ROUND 条) */
    posts: WeiboPost[];
    /** 本轮结束后的水位线 */
    nextWatermark: string;
    /** 本轮结束后的最近 id 集合 */
    nextRecentIds: string[];
    /** 是否发生了静默重建 (true 时不推送) */
    rebuilt: boolean;
}

/**
 * @param posts 已过滤的合格动态, 顺序为「新 → 旧」
 */
export function resolveWatermark(
    posts: readonly WeiboPost[],
    cursor: WatermarkCursor,
): WatermarkResult {
    if (posts.length === 0) {
        return {
            posts: [],
            nextWatermark: cursor.watermark ?? '',
            nextRecentIds: cursor.recentIds,
            rebuilt: false,
        };
    }

    const ids = posts.map(getPostId);
    const newestId = ids[0];
    const nextRecentIds = ids.slice(0, RECENT_ID_LIMIT);

    if (!cursor.watermark) {
        return {
            posts: [],
            nextWatermark: newestId,
            nextRecentIds,
            rebuilt: true,
        };
    }

    const exactIndex = ids.indexOf(cursor.watermark);
    if (exactIndex >= 0) {
        if (exactIndex === 0) {
            return {
                posts: [],
                nextWatermark: newestId,
                nextRecentIds,
                rebuilt: false,
            };
        }

        const fresh = posts.slice(0, exactIndex);
        return {
            posts: toPushOrder(fresh),
            nextWatermark: newestId,
            nextRecentIds: ids.slice(0, exactIndex + 1),
            rebuilt: false,
        };
    }

    const recentSet = new Set(cursor.recentIds);
    const anchorIndex = ids.findIndex((id) => recentSet.has(id));
    if (anchorIndex === 0) {
        return {
            posts: [],
            nextWatermark: newestId,
            nextRecentIds,
            rebuilt: false,
        };
    }
    if (anchorIndex > 0) {
        const fresh = posts.slice(0, anchorIndex);
        return {
            posts: toPushOrder(fresh),
            nextWatermark: newestId,
            nextRecentIds: ids.slice(0, anchorIndex + 1),
            rebuilt: false,
        };
    }

    return {
        posts: [],
        nextWatermark: newestId,
        nextRecentIds,
        rebuilt: true,
    };
}

/** 截取最新 N 条后反转成「旧 → 新」 */
function toPushOrder(posts: readonly WeiboPost[]): WeiboPost[] {
    return posts.slice(0, MAX_PUSH_PER_ROUND).reverse();
}
