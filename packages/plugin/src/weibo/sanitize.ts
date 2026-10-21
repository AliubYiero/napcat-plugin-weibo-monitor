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
            const text = escapeHtml(decodeEntities(token)).replace(
                /\r?\n/g,
                '<br>',
            );
            out += linkHref
                ? `<a href="${linkHref}" target="_blank" rel="noopener noreferrer">${text}</a>`
                : text;
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

function safeLinkUrl(raw: string): string {
    if (!raw || raw.startsWith('javascript:')) return '';
    return safeUrl(raw, (host) => {
        return (
            host === 'weibo.com' ||
            host.endsWith('.weibo.com') ||
            host === 'weibo.cn' ||
            host.endsWith('.weibo.cn') ||
            host === 't.cn' ||
            host.endsWith('.t.cn')
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
