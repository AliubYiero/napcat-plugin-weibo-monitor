/**
 * 动态筛选谓词 (纯函数)
 *
 * 只认满足以下全部条件的动态:
 *   - 作者 UID 与订阅 UID 完全一致
 *   - 普通类型 (mblogtype === 0)
 *   - 置顶 (isTop) 与广告 (isAd) 均排除
 *
 * 转发动态的 mblogtype 与原创一样为 0, 不能据此排除;
 * 转发由 retweeted_status / retweeted_status_id 判定。
 */

import type { WeiboPost } from './types';

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

/** 是否为该博主的合格动态 */
export function isQualifiedPost(
    post: WeiboPost,
    uid: string,
): boolean {
    if (!post) return false;
    if (getUserUid(post) !== uid) return false;
    if (Number(post.mblogtype) !== 0) return false;
    if (Number(post.isTop) === 1) return false;
    if (post.isAd === true) return false;
    return getPostId(post) !== '';
}

/** 过滤出合格动态 (保持接口原顺序: 新 → 旧) */
export function filterQualifiedPosts(
    posts: readonly WeiboPost[],
    uid: string,
): WeiboPost[] {
    return posts.filter((post) => isQualifiedPost(post, uid));
}
