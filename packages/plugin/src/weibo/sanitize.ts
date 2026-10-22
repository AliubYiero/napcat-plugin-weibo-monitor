/**
 * 外部输入解析与净化 (纯函数)
 *
 * - Cookie header → Playwright storageState cookies
 * - 微博正文 HTML → 白名单标签 (a / img / br)
 *
 * 这两块都是"外部不可信输入", 必须可单测、无副作用。
 */

import type { StoredCookie } from './types';

/** 微博 Cookie 统一挂到根域 */
const COOKIE_DOMAIN = '.weibo.com';

/**
 * 解析用户粘贴的 Cookie。
 *
 * 支持:
 *   - 浏览器开发者工具复制的 `a=b; c=d`
 *   - 带 `Cookie:` 前缀
 *   - 多行 (每行一条或分号分隔)
 *   - Playwright storageState JSON (`{ cookies: [...] }`)
 *
 * 解析失败返回空数组; 同名 cookie 后者覆盖前者。
 */
export function parseCookieHeader(raw: string): StoredCookie[] {
    const text = raw.trim();
    if (!text) return [];

    const fromJson = parseStorageStateJson(text);
    if (fromJson) return fromJson;

    const withoutPrefix = text.replace(/^cookie\s*:\s*/i, '');
    const map = new Map<string, string>();

    for (const part of withoutPrefix.split(/[;\r\n]+/)) {
        const line = part.trim();
        if (!line || line.startsWith('//')) continue;
        const eq = line.indexOf('=');
        if (eq <= 0) continue;
        const name = line.slice(0, eq).trim();
        const value = line.slice(eq + 1).trim();
        if (!name) continue;
        map.set(name, value);
    }

    return [...map.entries()].map(([name, value]) => ({
        name,
        value,
        domain: COOKIE_DOMAIN,
        path: '/',
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
    }));
}

function parseStorageStateJson(text: string): StoredCookie[] | null {
    if (!text.startsWith('{') && !text.startsWith('[')) return null;
    try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
            return normalizeCookies(parsed);
        }
        if (
            parsed &&
            typeof parsed === 'object' &&
            Array.isArray((parsed as { cookies?: unknown }).cookies)
        ) {
            return normalizeCookies(
                (parsed as { cookies: unknown[] }).cookies,
            );
        }
    } catch {
        return null;
    }
    return null;
}

function normalizeCookies(input: unknown[]): StoredCookie[] {
    const out: StoredCookie[] = [];
    for (const item of input) {
        if (!item || typeof item !== 'object') continue;
        const cookie = item as Record<string, unknown>;
        if (
            typeof cookie.name !== 'string' ||
            typeof cookie.value !== 'string'
        ) {
            continue;
        }
        out.push({
            name: cookie.name,
            value: cookie.value,
            domain:
                typeof cookie.domain === 'string'
                    ? cookie.domain
                    : COOKIE_DOMAIN,
            path: typeof cookie.path === 'string' ? cookie.path : '/',
            expires:
                typeof cookie.expires === 'number'
                    ? cookie.expires
                    : -1,
            httpOnly: cookie.httpOnly === true,
            secure: cookie.secure !== false,
            sameSite:
                cookie.sameSite === 'Strict' ||
                cookie.sameSite === 'None'
                    ? cookie.sameSite
                    : 'Lax',
        });
    }
    return out;
}

// ==================== 正文净化 ====================

const TOKEN_RE = /<[^>]*>|[^<]+/g;
const ATTR_RE =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
const NAMED_ENTITIES: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: '\u00a0',
};
const CONTENT_URL_RE =
    /https?:\/\/[^\s<>"'，。；：！？、）】》”’]+/gi;
const CONTENT_MENTION_RE =
    /(?<![\w.@])@[\w\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af·-]{1,30}/g;
const CONTENT_TOPIC_RE = /(?<![\w#])#[^#\s<>"']{1,40}#/g;
const URL_TRAILING_PUNCTUATION_RE =
    /[.,;:!?，。；：！？、）】》”’]+$/u;

/**
 * 净化微博正文 HTML: 仅保留 a / img / br。
 *
 * - img 只允许 `face.t.sinajs.cn` 与 `*.sinaimg.cn` (表情图)
 * - a 只允许微博域与 t.cn 短链
 * - 其余标签剥离, 文本保留并转义
 * - 事件属性 / style / script 一律丢弃
 */
export function sanitizeWeiboHtml(html: string): string {
    if (!html) return '';

    const source = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

    let out = '';
    let linkHref = '';
    let linkDepth = 0;

    for (const token of source.match(TOKEN_RE) ?? []) {
        if (!token.startsWith('<')) {
            const decoded = decodeEntities(token);
            if (linkHref) {
                const text = escapeHtml(decoded).replace(
                    /\r?\n/g,
                    '<br>',
                );
                out += `<a href="${linkHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
            } else {
                out += decoded
                    .split(/\r?\n/)
                    .map(linkifyContentLine)
                    .join('<br>');
            }
            continue;
        }

        const tagMatch = /^<\s*\/?\s*([a-zA-Z0-9]+)/.exec(token);
        if (!tagMatch) continue;
        const tag = tagMatch[1].toLowerCase();
        const closing = /^<\s*\//.test(token);

        if (tag === 'br') {
            out += '<br>';
            continue;
        }

        if (tag === 'img') {
            const src = safeImageUrl(getAttr(token, 'src'));
            if (src)
                out += `<img src="${src}" alt="" class="emoji" />`;
            continue;
        }

        if (tag === 'a') {
            if (closing) {
                if (linkDepth > 0) linkDepth -= 1;
                if (linkDepth === 0) linkHref = '';
            } else if (linkDepth === 0) {
                const href = safeLinkUrl(getAttr(token, 'href'));
                if (href) {
                    linkHref = href;
                    linkDepth = 1;
                }
            } else {
                linkDepth += 1;
            }
        }
    }

    return out;
}

interface ContentMatch {
    start: number;
    end: number;
    html: string;
    priority: number;
}

/**
 * 将纯文本里的 URL / @用户 / #话题# 转成链接。
 *
 * 只处理不在现有 `<a>` 内的文本; URL 优先于其内部的 @ / #,
 * 邮箱 (如 `nox@vrp.live`) 不会被误判为 @ 提及。
 */
function linkifyContentLine(line: string): string {
    if (!line) return '';

    const matches: ContentMatch[] = [];
    for (const match of line.matchAll(CONTENT_URL_RE)) {
        const start = match.index ?? 0;
        const raw = match[0].replace(URL_TRAILING_PUNCTUATION_RE, '');
        if (!raw) continue;
        matches.push({
            start,
            end: start + raw.length,
            html: contentAnchor(raw, raw),
            priority: 0,
        });
    }

    for (const match of line.matchAll(CONTENT_MENTION_RE)) {
        const start = match.index ?? 0;
        const raw = match[0];
        const name = raw.slice(1);
        if (!name) continue;
        matches.push({
            start,
            end: start + raw.length,
            html: contentAnchor(
                `https://weibo.com/n/${encodeURIComponent(name)}`,
                raw,
            ),
            priority: 1,
        });
    }

    for (const match of line.matchAll(CONTENT_TOPIC_RE)) {
        const start = match.index ?? 0;
        const raw = match[0];
        if (raw.length < 3) continue;
        matches.push({
            start,
            end: start + raw.length,
            html: contentAnchor(
                `https://s.weibo.com/weibo?q=${encodeURIComponent(raw)}`,
                raw,
            ),
            priority: 2,
        });
    }

    if (matches.length === 0) return escapeHtml(line);

    matches.sort(
        (a, b) =>
            a.start - b.start ||
            a.priority - b.priority ||
            b.end - a.end,
    );

    let out = '';
    let cursor = 0;
    for (const match of matches) {
        if (match.start < cursor) continue;
        out += escapeHtml(line.slice(cursor, match.start));
        out += match.html;
        cursor = match.end;
    }
    out += escapeHtml(line.slice(cursor));
    return out;
}

function contentAnchor(href: string, label: string): string {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

interface TextLinkState {
    href: string;
    text: string;
    hasImage: boolean;
}

export function sanitizeWeiboText(html: string): string {
    if (!html) return '';

    const source = html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

    const links: TextLinkState[] = [];
    let out = '';

    const append = (text: string): void => {
        if (!text) return;
        const link = links[links.length - 1];
        if (link) {
            link.text += text;
        } else {
            out += text;
        }
    };

    for (const token of source.match(TOKEN_RE) ?? []) {
        if (!token.startsWith('<')) {
            append(decodeEntities(token).replace(/\r\n?/g, '\n'));
            continue;
        }

        const tagMatch = /^<\s*\/?\s*([a-zA-Z0-9]+)/.exec(token);
        if (!tagMatch) continue;
        const tag = tagMatch[1].toLowerCase();
        const closing = /^<\s*\//.test(token);

        if (tag === 'br') {
            append('\n');
            continue;
        }

        if (tag === 'img') {
            const src = safeImageUrl(getAttr(token, 'src'));
            if (!src) continue;
            if (isEmojiImageUrl(src)) {
                append(
                    decodeEntities(getAttr(token, 'title')) ||
                        decodeEntities(getAttr(token, 'alt')),
                );
            } else if (links.length > 0) {
                links[links.length - 1].hasImage = true;
            }
            continue;
        }

        if (tag === 'a') {
            if (closing) {
                const link = links.pop();
                if (!link) continue;
                const label = link.text.trim();
                if (!label) continue;
                append(
                    link.hasImage && link.href
                        ? `${label}(${link.href})`
                        : label,
                );
            } else {
                links.push({
                    href: safeLinkUrl(getAttr(token, 'href'), true),
                    text: '',
                    hasImage: false,
                });
            }
        }
    }

    while (links.length > 0) {
        const link = links.pop();
        if (!link) continue;
        const label = link.text.trim();
        if (!label) continue;
        append(
            link.hasImage && link.href
                ? `${label}(${link.href})`
                : label,
        );
    }

    return out.replace(/\u00a0/g, ' ').trim();
}

/** 正文 HTML → 纯文本 (用于来源、alt 等) */
export function htmlToText(html: string): string {
    return decodeEntities(
        html
            .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<[^>]*>/g, ''),
    )
        .replace(/\u00a0/g, ' ')
        .trim();
}

/** 转义文本节点 */
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function decodeEntities(text: string): string {
    return text.replace(
        /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
        (match, entity: string) => {
            if (entity.startsWith('#x') || entity.startsWith('#X')) {
                const code = Number.parseInt(entity.slice(2), 16);
                return safeCodePoint(code, match);
            }
            if (entity.startsWith('#')) {
                const code = Number.parseInt(entity.slice(1), 10);
                return safeCodePoint(code, match);
            }
            return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
        },
    );
}

function safeCodePoint(code: number, fallback: string): string {
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
        return fallback;
    }
    try {
        return String.fromCodePoint(code);
    } catch {
        return fallback;
    }
}

function getAttr(tag: string, name: string): string {
    for (const match of tag.matchAll(ATTR_RE)) {
        if (match[1].toLowerCase() === name) {
            return match[2] ?? match[3] ?? match[4] ?? '';
        }
    }
    return '';
}

function safeImageUrl(raw: string): string {
    return safeUrl(raw, (host) => {
        return (
            host === 'face.t.sinajs.cn' ||
            host === 'sinaimg.cn' ||
            host.endsWith('.sinaimg.cn')
        );
    });
}

function isEmojiImageUrl(raw: string): boolean {
    try {
        return (
            new URL(raw).hostname.toLowerCase() === 'face.t.sinajs.cn'
        );
    } catch {
        return false;
    }
}

function safeLinkUrl(raw: string, allowImageHosts = false): string {
    if (!raw || raw.startsWith('javascript:')) return '';
    return safeUrl(raw, (host) => {
        return (
            host === 'weibo.com' ||
            host.endsWith('.weibo.com') ||
            host === 'weibo.cn' ||
            host.endsWith('.weibo.cn') ||
            host === 't.cn' ||
            host.endsWith('.t.cn') ||
            (allowImageHosts &&
                (host === 'sinaimg.cn' ||
                    host.endsWith('.sinaimg.cn')))
        );
    });
}

function safeUrl(
    raw: string,
    allowHost: (host: string) => boolean,
): string {
    if (!raw) return '';
    try {
        const url = new URL(raw, 'https://weibo.com');
        if (url.protocol !== 'https:' && url.protocol !== 'http:') {
            return '';
        }
        if (!allowHost(url.hostname.toLowerCase())) return '';
        return url.href;
    } catch {
        return '';
    }
}
