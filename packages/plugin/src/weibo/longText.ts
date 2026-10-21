/**
 * 长文判定与响应解析 (纯函数)
 *
 * 列表接口对长微博只返回截断正文; 推送层据此在渲染前补拉完整内容。
 */

import type { WeiboLongTextResponse, WeiboPost } from './types';

const LONG_TEXT_LINK_RE =
    /<a\b[^>]*>\s*(?:全文|展开(?:全文)?)\s*<\/a>/i;

/** 是否需要补拉长文 */
export function needsLongText(post: WeiboPost): boolean {
    if (post.isLongText === true || Number(post.isLongText) === 1) {
        return true;
    }
    const html = post.text ?? post.text_raw ?? '';
    return LONG_TEXT_LINK_RE.test(html);
}

/** 取 longtext 接口所需的 mblogid; 缺失时返回空串 */
export function resolveLongTextId(post: WeiboPost): string {
    return (post.mblogid ?? '').trim();
}

/** 从 longtext 响应中提取完整正文 */
export function extractLongText(body: unknown): string {
    const response = body as WeiboLongTextResponse | null;
    const data = response?.data;
    const primary = data?.longTextContent;
    if (typeof primary === 'string' && primary.trim()) {
        return primary;
    }
    const raw = data?.longTextContent_raw;
    return typeof raw === 'string' ? raw : '';
}

/** 用完整正文替换截断正文; 空文本不覆盖, 并清空补拉标记 */
export function withLongText(
    post: WeiboPost,
    text: string,
): WeiboPost {
    const content = text.trim();
    if (!content) return post;
    return {
        ...post,
        text: content,
        text_raw: content,
        isLongText: false,
    };
}
