/**
 * 动态分类与点赞日期解析 (纯函数)
 *
 * mymblog 的首页列表同时包含本人动态、点赞插入条目与生日动态。
 * 点赞条目的 `user` 是原微博作者, 不能据此判断作者; 点赞身份由
 * `analysis_extra.profile_insert_type` 或 `title.text` 的「赞过」标记识别。
 */

import type { WeiboPost, WeiboPostKind, WeiboPostTitle } from './types';

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const LIKE_INSERT_RE =
    /profile_insert_type["']?\s*[:=]\s*["']?like_status/i;
const LIKE_TITLE_RE = /赞过|赞了/;
const EXPLICIT_DATE_RE =
    /(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})/;
const MONTH_DAY_RE = /(\d{1,2})\s*[月./-]\s*(\d{1,2})/;

/** 兼容 boolean / number / string 三种布尔标记 */
export function normalizeFlag(value: unknown): boolean {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        const text = value.trim().toLowerCase();
        return text === '1' || text === 'true';
    }
    return false;
}

/** 是否为广告 (含转发链内嵌的广告) */
export function isAdPost(post: WeiboPost): boolean {
    let current: WeiboPost | null | undefined = post;
    for (let depth = 0; current && depth < 5; depth += 1) {
        if (normalizeFlag(current.isAd)) return true;
        current = current.retweeted_status;
    }
    return false;
}

/** 是否为置顶 */
export function isPinnedPost(post: WeiboPost): boolean {
    return normalizeFlag(post.isTop);
}

/** 是否为点赞插入条目 */
export function isLikePost(post: WeiboPost): boolean {
    if (hasLikeInsertFlag(post.analysis_extra)) return true;
    const title = titleText(post.title);
    return title !== '' && LIKE_TITLE_RE.test(title);
}

/** 是否携带转发 (含原动态已被删除、只剩 id 的情况) */
export function isRepostPost(post: WeiboPost): boolean {
    return Boolean(post.retweeted_status || post.retweeted_status_id);
}

/**
 * 沿转发链取最原始的博文。
 *
 * 点赞条目的原动态本身可能也是转发, 卡片需要把转发块落到最深一层。
 * 只有 id 没有正文时返回 undefined, 由调用方渲染「原微博已删除」。
 */
export function resolveRootRetweet(post: WeiboPost): WeiboPost | undefined {
    let current = post.retweeted_status ?? undefined;
    const seen = new Set<WeiboPost>();
    while (current?.retweeted_status) {
        if (seen.has(current)) break;
        seen.add(current);
        current = current.retweeted_status;
    }
    return current;
}

/** 是否为生日动态 (只认 source, 不依赖 page_info) */
export function isBirthdayPost(post: WeiboPost): boolean {
    return String(post.source ?? '').includes('生日动态');
}

/** 分类优先级: 点赞 > 生日 > 转发 > 原创 */
export function resolvePostKind(post: WeiboPost): WeiboPostKind {
    if (isLikePost(post)) return 'like';
    if (isBirthdayPost(post)) return 'birthday';
    if (isRepostPost(post)) return 'repost';
    return 'original';
}

/**
 * 从点赞条目标题解析点赞日期, 返回 `YYYY-MM-DD`。
 *
 * 标题通常只有月日 (如「她10-24赞过的微博」), 年份取北京时间当前年;
 * 若月日落在今天之后, 视为去年。解析失败返回 null。
 */
export function parseLikeDay(
    post: WeiboPost,
    now: number = Date.now(),
): string | null {
    const title = titleText(post.title);
    if (!title) return null;

    const explicit = EXPLICIT_DATE_RE.exec(title);
    if (explicit) {
        const year = Number(explicit[1]);
        const month = Number(explicit[2]);
        const day = Number(explicit[3]);
        return isValidDay(year, month, day)
            ? formatDay(year, month, day)
            : null;
    }

    const monthDay = MONTH_DAY_RE.exec(title);
    if (!monthDay) return null;
    const month = Number(monthDay[1]);
    const day = Number(monthDay[2]);
    if (!isValidDay(2000, month, day)) return null;

    const today = beijingDateParts(now);
    let year = today.year;
    if (
        month > today.month ||
        (month === today.month && day > today.day)
    ) {
        year -= 1;
    }
    return isValidDay(year, month, day)
        ? formatDay(year, month, day)
        : null;
}

function titleText(title: WeiboPost['title']): string {
    if (typeof title === 'string') return title.trim();
    if (!title || typeof title !== 'object') return '';
    const value = (title as WeiboPostTitle).text;
    return typeof value === 'string' ? value.trim() : '';
}

function hasLikeInsertFlag(raw: unknown): boolean {
    if (typeof raw !== 'string' || !raw.trim()) return false;
    if (LIKE_INSERT_RE.test(raw)) return true;
    try {
        return walkLikeFlag(JSON.parse(raw), 0);
    } catch {
        return false;
    }
}

function walkLikeFlag(value: unknown, depth: number): boolean {
    if (depth > 4 || !value || typeof value !== 'object') return false;
    if (Array.isArray(value)) {
        return value.some((item) => walkLikeFlag(item, depth + 1));
    }
    for (const [key, item] of Object.entries(value)) {
        if (
            key === 'profile_insert_type' &&
            String(item).toLowerCase() === 'like_status'
        ) {
            return true;
        }
        if (walkLikeFlag(item, depth + 1)) return true;
    }
    return false;
}

function beijingDateParts(now: number): {
    year: number;
    month: number;
    day: number;
} {
    const date = new Date(now + BEIJING_OFFSET_MS);
    return {
        year: date.getUTCFullYear(),
        month: date.getUTCMonth() + 1,
        day: date.getUTCDate(),
    };
}

function isValidDay(year: number, month: number, day: number): boolean {
    if (month < 1 || month > 12 || day < 1) return false;
    const daysInMonth = new Date(
        Date.UTC(year, month, 0),
    ).getUTCDate();
    return day <= daysInMonth;
}

function formatDay(year: number, month: number, day: number): string {
    return [
        String(year).padStart(4, '0'),
        String(month).padStart(2, '0'),
        String(day).padStart(2, '0'),
    ].join('-');
}
