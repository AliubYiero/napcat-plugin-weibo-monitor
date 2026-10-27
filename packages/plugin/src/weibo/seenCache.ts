/**
 * 已见动态缓存与单轮选择 (纯函数)
 *
 * 取代水位线: 首页每条动态都写入 `seenIds`, 新动态 = 键不在缓存中。
 * 首页与缓存零重叠时静默重建 (薄缓存也重建), 只写缓存、不补发。
 * 置顶动态走独立轨道, 与最新非置顶本人动态比较发布时间。
 */

import type { WeiboContentType } from 'shared';
import {
    classifyPost,
    getPostEventKey,
    isContentEnabled,
    type ClassifiedPost,
} from './predicate';
import { parseWeiboTimeMs } from './time';
import type { WeiboCursor, WeiboPost } from './types';

/** 单 uid 保留的已见键数量 */
export const SEEN_ID_LIMIT = 100;

const LEGACY_LIKE_KEY_RE = /^like:(.+):$/;
const DATED_LIKE_KEY_RE = /^like:(.+):\d{4}-\d{2}-\d{2}$/;

export type SeenCacheReason = 'baseline' | 'zero-overlap' | null;

export interface SeenCacheResult {
    /** 满足置顶条件的新置顶 (新 → 旧) */
    pinned: ClassifiedPost[];
    /** 普通新动态 (旧 → 新) */
    posts: ClassifiedPost[];
    nextSeenIds: string[];
    nextWatermark: string;
    initialized: boolean;
    /** 本轮的静默基线原因; null 表示正常增量 */
    reason: SeenCacheReason;
}

/** 首绑 / 暂停恢复 / 旧游标升级的基线 */
export interface SeenCacheBaseline {
    seenIds: string[];
    watermark: string;
    initialized: true;
}

/**
 * 收集当前页全部去重键 (保持接口顺序, 去重)。
 */
export function collectPageKeys(
    posts: readonly WeiboPost[],
    now: number = Date.now(),
): string[] {
    const seen = new Set<string>();
    const keys: string[] = [];
    for (const post of posts) {
        const key = getPostEventKey(post, now);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        keys.push(key);
    }
    return keys;
}

/**
 * 当前页键在前, 旧缓存补后, 截断到 100。
 *
 * 当前页出现的键会被移到最前, 使最近仍在首页的动态优先保留。
 */
export function mergeSeenIds(
    currentKeys: readonly string[],
    previous: readonly string[],
    limit: number = SEEN_ID_LIMIT,
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of [...currentKeys, ...previous]) {
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(key);
        if (out.length >= limit) break;
    }
    return out;
}

/** 构建首绑 / 恢复基线: 当前页全部条目, 不推送 */
export function buildSeenBaseline(
    posts: readonly WeiboPost[],
    now: number = Date.now(),
): SeenCacheBaseline {
    const seenIds = collectPageKeys(posts, now).slice(
        0,
        SEEN_ID_LIMIT,
    );
    return {
        seenIds,
        watermark: seenIds[0] ?? '',
        initialized: true,
    };
}

/**
 * 把旧版「点赞日期解析失败」留下的空日期键按当前页改写。
 *
 * 旧键形如 `like:<id>:`, 新版相对日标题能解析出日期后, 同一条动态会
 * 算出 `like:<id>:<YYYY-MM-DD>`; 不迁移会让升级首轮重复推送。
 * 当前页找不到该 id、或当前页已不再是点赞时保留旧键; 新旧键并存时去重。
 */
export function migrateLegacyLikeKeys(
    previous: readonly string[],
    posts: readonly WeiboPost[],
    now: number = Date.now(),
): string[] {
    const resolved = new Map<string, string>();
    for (const post of posts) {
        const key = getPostEventKey(post, now);
        const matched = DATED_LIKE_KEY_RE.exec(key);
        if (!matched) continue;
        const id = matched[1];
        if (!resolved.has(id)) resolved.set(id, key);
    }

    const migrated: string[] = [];
    const seen = new Set<string>();
    for (const key of previous) {
        const legacy = LEGACY_LIKE_KEY_RE.exec(key);
        const next = legacy
            ? (resolved.get(legacy[1]) ?? key)
            : key;
        if (!next || seen.has(next)) continue;
        seen.add(next);
        migrated.push(next);
    }
    return migrated;
}

/**
 * 单轮选择。
 *
 * @param posts 原始首页列表, 顺序为「新 → 旧」
 * @param cursor 当前游标; 旧游标应已由 store 归一为 initialized:false
 * @param enabled 内容类型开关
 */
export function resolveSeenCache(
    posts: readonly WeiboPost[],
    uid: string,
    cursor: Pick<WeiboCursor, 'seenIds' | 'initialized' | 'watermark'>,
    enabled: readonly WeiboContentType[],
    now: number = Date.now(),
): SeenCacheResult {
    const currentKeys = collectPageKeys(posts, now);
    const previousKeys = migrateLegacyLikeKeys(
        cursor.seenIds,
        posts,
        now,
    );
    const nextWatermark = currentKeys[0] ?? cursor.watermark;

    if (!cursor.initialized) {
        return {
            pinned: [],
            posts: [],
            nextSeenIds: currentKeys.slice(0, SEEN_ID_LIMIT),
            nextWatermark,
            initialized: true,
            reason: 'baseline',
        };
    }

    const previous = new Set(previousKeys);
    if (
        cursor.seenIds.length > 0 &&
        currentKeys.length > 0 &&
        !currentKeys.some((key) => previous.has(key))
    ) {
        return {
            pinned: [],
            posts: [],
            nextSeenIds: currentKeys.slice(0, SEEN_ID_LIMIT),
            nextWatermark,
            initialized: true,
            reason: 'zero-overlap',
        };
    }

    const nextSeenIds = mergeSeenIds(currentKeys, previousKeys);

    const included: ClassifiedPost[] = [];
    for (const post of posts) {
        const classified = classifyPost(post, uid, now);
        if (classified && isContentEnabled(classified, enabled)) {
            included.push(classified);
        }
    }

    const reference = included.find(
        (item) => !item.isPinned && item.kind !== 'like',
    );
    const referenceMs = reference
        ? parseWeiboTimeMs(reference.post.created_at)
        : null;

    const pinned = included
        .filter(
            (item) =>
                item.isPinned &&
                item.kind !== 'like' &&
                !previous.has(item.key) &&
                shouldPushPinned(item, reference, referenceMs),
        )
        .sort(
            (left, right) =>
                (parseWeiboTimeMs(right.post.created_at) ?? 0) -
                (parseWeiboTimeMs(left.post.created_at) ?? 0),
        );

    const postsToPush = included
        .filter(
            (item) =>
                !(item.isPinned && item.kind !== 'like') &&
                !previous.has(item.key),
        )
        .reverse();

    return {
        pinned,
        posts: postsToPush,
        nextSeenIds,
        nextWatermark,
        initialized: true,
        reason: null,
    };
}

function shouldPushPinned(
    pinned: ClassifiedPost,
    reference: ClassifiedPost | undefined,
    referenceMs: number | null,
): boolean {
    if (!reference) return true;
    if (referenceMs === null) return false;
    const pinnedMs = parseWeiboTimeMs(pinned.post.created_at);
    if (pinnedMs === null) return false;
    return pinnedMs > referenceMs;
}
