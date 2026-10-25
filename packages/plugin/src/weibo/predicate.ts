/**
 * 动态分类与内容筛选 (纯函数)
 *
 * 与旧版的区别:
 *   - 点赞插入条目跳过作者校验 (其 user 是原微博作者)
 *   - 置顶不再直接淘汰, 交给 seenCache 的置顶轨道处理
 *   - 广告由配置决定是否过滤, 不是无条件淘汰
 *   - 原动态、转发、点赞、生日共用一套分类结果
 */

import type { WeiboContentType } from 'shared';
import {
    isAdPost,
    isLikePost,
    isPinnedPost,
    parseLikeDay,
    resolvePostKind,
} from './postKind';
import type {
    WeiboPost,
    WeiboPostKind,
} from './types';

/** 分类后的动态 (渲染与去重都从这里取上下文) */
export interface ClassifiedPost {
    post: WeiboPost;
    kind: WeiboPostKind;
    id: string;
    /** 去重键: 非点赞用动态 id, 点赞用 id + 点赞日期 */
    key: string;
    likeDay: string | null;
    isAd: boolean;
    isPinned: boolean;
}

/** 取动态 id 的字符串形式 (优先 idstr / mid, 回退 id) */
export function getPostId(post: WeiboPost): string {
    const candidates = [post.idstr, post.mid, post.id];
    for (const value of candidates) {
        if (
            value !== undefined &&
            value !== null &&
            String(value) !== ''
        ) {
            return String(value);
        }
    }
    return '';
}

/** 取作者 UID 的字符串形式 */
export function getUserUid(post: WeiboPost): string {
    const user = post.user;
    if (!user) return '';
    const candidates = [user.idstr, user.id];
    for (const value of candidates) {
        if (
            value !== undefined &&
            value !== null &&
            String(value) !== ''
        ) {
            return String(value);
        }
    }
    return '';
}

/**
 * 分类一条动态; 不满足硬条件时返回 null。
 *
 * 硬条件: 有动态 id、mblogtype === 0、非点赞条目作者 UID 必须匹配。
 * 内容开关与置顶条件不在这里处理。
 */
export function classifyPost(
    post: WeiboPost,
    uid: string,
    now: number = Date.now(),
): ClassifiedPost | null {
    if (!post) return null;
    const id = getPostId(post);
    if (!id) return null;

    const kind = resolvePostKind(post);
    if (kind !== 'like' && getUserUid(post) !== uid) return null;
    if (Number(post.mblogtype) !== 0) return null;

    const likeDay = kind === 'like' ? parseLikeDay(post, now) : null;
    return {
        post,
        kind,
        id,
        key: kind === 'like' ? `like:${id}:${likeDay ?? ''}` : id,
        likeDay,
        isAd: isAdPost(post),
        isPinned: isPinnedPost(post),
    };
}

/** 内容开关是否允许该动态 */
export function isContentEnabled(
    classified: ClassifiedPost,
    enabled: readonly WeiboContentType[],
): boolean {
    if (classified.isAd && !enabled.includes('ad')) return false;
    if (classified.kind === 'like') return enabled.includes('like');
    if (classified.kind === 'birthday') {
        return enabled.includes('birthday');
    }
    if (classified.kind === 'repost') {
        return enabled.includes('repost');
    }
    return true;
}

/** 取全部符合内容开关的动态 (保持接口原顺序: 新 → 旧) */
export function selectIncludedPosts(
    posts: readonly WeiboPost[],
    uid: string,
    enabled: readonly WeiboContentType[],
    now: number = Date.now(),
): ClassifiedPost[] {
    const out: ClassifiedPost[] = [];
    for (const post of posts) {
        const classified = classifyPost(post, uid, now);
        if (classified && isContentEnabled(classified, enabled)) {
            out.push(classified);
        }
    }
    return out;
}

/**
 * latest 的目标: 最新一条本人原创 / 转发 / 生日。
 *
 * 点赞永不返回, 置顶忽略, 广告/转发/生日按内容开关筛选。
 */
export function selectLatestOwnerPost(
    posts: readonly WeiboPost[],
    uid: string,
    enabled: readonly WeiboContentType[],
    now: number = Date.now(),
): WeiboPost | null {
    for (const post of posts) {
        const classified = classifyPost(post, uid, now);
        if (!classified) continue;
        if (classified.kind === 'like') continue;
        if (classified.isPinned) continue;
        if (!isContentEnabled(classified, enabled)) continue;
        return classified.post;
    }
    return null;
}

/**
 * 取用于更新订阅资料的第一条本人动态。
 *
 * 点赞条目的 user 是原微博作者, 不能用于更新昵称/头像; 其余类型
 * (含广告、置顶、转发、生日) 的 user 都是订阅博主。
 */
export function findOwnerProfilePost(
    posts: readonly WeiboPost[],
    uid: string,
): WeiboPost | null {
    for (const post of posts) {
        if (!post.user) continue;
        if (getUserUid(post) !== uid) continue;
        if (isLikePost(post)) continue;
        return post;
    }
    return null;
}

/**
 * 全部条目的去重键 (不校验作者与内容开关)。
 *
 * 首绑播种与每轮写回都用这个函数: 点赞、广告、置顶、他人推广
 * 条目无论是否推送, 都要进入已见缓存。
 */
export function getPostEventKey(
    post: WeiboPost,
    now: number = Date.now(),
): string {
    const id = getPostId(post);
    if (!id) return '';
    if (!isLikePost(post)) return id;
    const likeDay = parseLikeDay(post, now);
    return `like:${id}:${likeDay ?? ''}`;
}
