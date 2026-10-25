/**
 * 生日动态的封面 / 标题 / 链接 (纯函数)
 *
 * 生日动态由 `source` 识别, `page_info` 只负责展示。页面链接必须
 * 绕过卡片对微博站内链接的抑制 (生日页常落在 weibo.com 或 vip 域名)。
 */

import type { WeiboPost } from './types';

const DEFAULT_TITLE = '生日动态';

/** 生日卡片封面 */
export function birthdayCover(post: WeiboPost): string {
    const info = post.page_info?.card_info;
    return (
        info?.pic_url ??
        info?.page_info?.pic_info?.pic_big?.url ??
        ''
    );
}

/** 生日标题; 缺失时回退固定文案 */
export function birthdayTitle(post: WeiboPost): string {
    const info = post.page_info?.card_info;
    const cardTitle =
        info && typeof info === 'object'
            ? (info as { title?: unknown }).title
            : undefined;
    if (typeof cardTitle === 'string' && cardTitle.trim()) {
        return cardTitle.trim();
    }

    const page = post.page_info;
    for (const value of [
        page?.title,
        page?.content1,
        page?.content2,
        page?.page_title,
    ]) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return DEFAULT_TITLE;
}

/** 生日页链接 (不做站内链接过滤) */
export function birthdayHref(post: WeiboPost): string {
    const raw = (post.page_info?.page_url ?? '').trim();
    if (!raw) return '';
    if (/^sinaweibo:\/\//i.test(raw)) {
        try {
            const outer = new URL(raw);
            if (outer.hostname.toLowerCase() !== 'browser') return '';
            const target = outer.searchParams.get('url');
            return target ? normalizeHttpUrl(target) : '';
        } catch {
            return '';
        }
    }
    return normalizeHttpUrl(raw);
}

function normalizeHttpUrl(raw: string): string {
    try {
        const url = new URL(raw, 'https://weibo.com');
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return '';
        }
        return url.href;
    } catch {
        return '';
    }
}
