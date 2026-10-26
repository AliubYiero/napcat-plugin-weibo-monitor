/**
 * 推送卡片 HTML 构建 (纯函数)
 *
 * 宽度固定 640px, 截图时再按 DPR 2 放大。所有外部文本/URL 都必须经过
 * 转义与白名单净化; 不展示认证标与转评赞。长文由推送服务在渲染前补齐。
 */

import {
    birthdayCover,
    birthdayHref,
    birthdayTitle,
} from './birthday';
import {
    parseLikeDay,
    resolvePostKind,
    resolveRootRetweet,
} from './postKind';
import {
    escapeHtml,
    htmlToText,
    sanitizeWeiboHtml,
} from './sanitize';
import { formatLikeTime, formatWeiboTime } from './time';
import type {
    WeiboMixMediaItem,
    WeiboPageInfo,
    WeiboPicInfo,
    WeiboPost,
    WeiboPostIdentity,
    WeiboPostRenderContext,
    WeiboUser,
} from './types';

/** 卡片 CSS 宽度 */
export const CARD_WIDTH = 640;

/** 卡片网格最多展示的图片张数 */
const MAX_CARD_IMAGES = 9;

/**
 * 从动态中取全部图片 URL。
 *
 * 列表接口对部分动态只返回 `pic_ids` 与 `mix_media_info`，不含 `pic_infos`。
 * 因此逐张图片按 `pic_infos` → `mix_media_info` → pic_id 拼 CDN 地址解析，
 * 顺序始终跟随 `pic_ids`。
 */
export function pickAllPostImages(post: WeiboPost): string[] {
    const infos = post.pic_infos ?? {};
    const mixed = collectMixedPictures(post);
    const orderedIds = collectPictureIds(post, infos, mixed);

    const urls: string[] = [];
    const seen = new Set<string>();
    for (const id of orderedIds) {
        const url =
            pickPicUrl(infos[id]) ||
            pickPicUrl(mixed.get(id)) ||
            buildPicUrlFromId(id);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    return urls;
}

function collectPictureIds(
    post: WeiboPost,
    infos: Record<string, WeiboPicInfo>,
    mixed: Map<string, WeiboPicInfo>,
): string[] {
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (id: string): void => {
        if (!id || seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
    };

    for (const id of post.pic_ids ?? []) push(id);
    for (const id of Object.keys(infos)) push(id);
    for (const id of mixed.keys()) push(id);
    return ordered;
}

function collectMixedPictures(
    post: WeiboPost,
): Map<string, WeiboPicInfo> {
    const pictures = new Map<string, WeiboPicInfo>();
    for (const item of post.mix_media_info?.items ?? []) {
        if (!isPictureItem(item)) continue;
        const data = item.data;
        if (!data) continue;
        const id = data.pic_id ?? item.id ?? '';
        if (id) pictures.set(id, data);
    }
    return pictures;
}

function isPictureItem(item: WeiboMixMediaItem): boolean {
    if (item.type && item.type !== 'pic') return false;
    return Boolean(item.data);
}

function pickPicUrl(info: WeiboPicInfo | undefined): string {
    if (!info) return '';
    return (
        info.large?.url ??
        info.bmiddle?.url ??
        info.thumbnail?.url ??
        ''
    );
}

function buildPicUrlFromId(id: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) return '';
    return `https://wx1.sinaimg.cn/large/${id}.jpg`;
}

/** 从动态中取卡片网格图片 URL (最多 9 张) */
export function pickPostImages(post: WeiboPost): string[] {
    return pickAllPostImages(post).slice(0, MAX_CARD_IMAGES);
}

/** 取博主头像 */
export function pickAvatar(user: WeiboUser | undefined): string {
    return (
        user?.avatar_large ??
        user?.avatar_hd ??
        user?.profile_image_url ??
        ''
    );
}

/** 取动态原文链接 */
export function buildPostUrl(post: WeiboPost): string {
    const uid = post.user?.idstr ?? post.user?.id ?? '';
    const mid =
        post.mid ?? post.mblogid ?? post.idstr ?? post.id ?? '';
    if (!mid) return 'https://weibo.com/';
    return `https://weibo.com/${String(uid)}/${String(mid)}`;
}

export interface CardRenderOptions {
    context?: WeiboPostRenderContext;
    identity?: WeiboPostIdentity;
}

/**
 * 构建一张动态卡片。
 *
 * @param post 已通过筛选谓词的动态
 * @param options 分类上下文与外层身份 (点赞事件用订阅博主)
 */
export function buildPostCardHtml(
    post: WeiboPost,
    options: CardRenderOptions = {},
): string {
    const kind = options.context?.kind ?? resolvePostKind(post);
    const identity = kind === 'like' ? options.identity : undefined;
    const user = post.user;
    const screenName =
        identity?.screenName ?? user?.screen_name ?? '微博用户';
    const avatar = identity?.avatar ?? pickAvatar(user);
    const likeDay =
        options.context?.likeDay ?? parseLikeDay(post);
    const rawCreatedAt =
        kind === 'like'
            ? formatLikeTime(likeDay, options.context?.fetchedAt)
            : formatWeiboTime(post.created_at);
    const createdAt =
        kind === 'birthday' && rawCreatedAt === '未知时间' ? '' : rawCreatedAt;
    const source =
        kind === 'like' ? '' : htmlToText(post.source ?? '');
    const region =
        kind === 'like' || kind === 'birthday'
            ? ''
            : (post.region_name ?? '');
    const content =
        kind === 'like' || kind === 'birthday'
            ? ''
            : sanitizeWeiboHtml(post.text ?? post.text_raw ?? '');
    const likeReason =
        kind === 'like' ? buildLikeReason(post) : '';
    const images =
        kind === 'like' || kind === 'birthday'
            ? []
            : pickAllPostImages(post);
    const mainPage =
        kind === 'like' || kind === 'birthday'
            ? undefined
            : post.retweeted_status &&
                isSamePageInfo(
                    post.page_info,
                    post.retweeted_status.page_info,
                )
              ? undefined
              : post.page_info;

    const meta = [
        createdAt,
        kind === 'like' ? '点赞了微博' : '',
        source,
        region,
    ]
        .filter((item) => item.length > 0)
        .map(escapeHtml)
        .join(' <span class="dot">·</span> ');

    const originalBlock =
        kind === 'birthday'
            ? ''
            : kind === 'like'
              ? renderLikeOriginal(post)
              : renderRetweet(post);
    const cardClass = originalBlock ? 'card has-retweet' : 'card';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${CARD_WIDTH}, initial-scale=1" />
<style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; }
    body {
        width: ${CARD_WIDTH}px;
        font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
        color: #1f2329;
        -webkit-font-smoothing: antialiased;
    }
    .card {
        padding: 16px 18px; border: 1px solid rgba(0, 0, 0, .05);
    }
    .card.has-retweet { padding-bottom: 0; }
    .header { display: flex; align-items: flex-start; }
    .avatar {
        width: 52px; height: 52px; border-radius: 50%;
        object-fit: cover; flex: 0 0 auto; background: #f0f0f0;
        border: 1px solid rgba(0, 0, 0, .05); margin-right: 10px;
    }
    .who {
        min-width: 0;
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 6px;
        height: 52px;
    }
    .name {
        font-size: 15px; font-weight: 700; line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .meta { font-size: 13px; color: #8a8f99; line-height: 1.4; }
    .dot { padding: 0 4px; color: #c4c7cc; }
    .body { margin-left: 62px; }
    .content {
        margin-top: 3px; font-size: 15px; line-height: 1.75;
        word-break: break-word; white-space: normal;
    }
    .content a { color: #eb7350; text-decoration: none; }
    img.emoji:has(+a) {
        filter: sepia(100%) saturate(3800%) contrast(75%);
        margin: 0 2px;
        width: 14px;
        height: 14px;
        vertical-align: -1px;
    }
    img.emoji {
        width: 18px; height: 18px; vertical-align: -3px; margin: 0 1px;
    }
    .images { margin-top: 14px; display: grid; gap: 2px; }
    .images.n1 { grid-template-columns: minmax(0, 1fr); }
    .images.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .images.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .images img {
        width: 100%; min-width: 0; display: block; border-radius: 6px;
        object-fit: cover; background: #f4f5f7;
    }
    .images.n2 img, .images.n3 img { aspect-ratio: 1 / 1; }
    .images.n1 img { max-height: 860px; object-fit: contain; }
    .thumb {
        position: relative; display: block; min-width: 0;
        border-radius: 6px; overflow: hidden;
    }
    .more {
        position: absolute; right: 0; bottom: 0; padding: 4px 7px;
        font-size: 13px; line-height: 1; color: #ffffff;
        background: rgba(0, 0, 0, 0.55);
    }
    .retweet {
        margin: 6px -18px; padding: 6px 36px 6px 80px;
        background: #f9f9f9;
    }
    .card.has-retweet .retweet {
        margin-bottom: 0; padding-bottom: 16px;
    }
    .retweet .rt-user {
        font-size: 14px; font-weight: 600; color: #3b6ea5;
        margin-bottom: 6px;
    }
    .retweet .rt-content {
        font-size: 15px; line-height: 1.7; word-break: break-word;
    }
    .retweet .rt-content a { color: #eb7350; text-decoration: none; }
    .retweet .images { margin-top: 10px; }
    .retweet .deleted { color: #8a8f99; font-size: 14px; }
    .retweet .rt-time {
        margin-top: 8px; font-size: 13px; line-height: 1.4;
        color: #939393;
    }
    .birthday-card {
        margin-top: 12px; padding: 10px; display: flex; gap: 12px;
        background: #f7f8fa; border-radius: 6px;
    }
    .birthday-cover {
        width: 160px; height: 90px; flex: 0 0 auto; display: block;
        border-radius: 6px; object-fit: cover; background: #eceff3;
    }
    .birthday-body {
        min-width: 0; flex: 1; display: flex; flex-direction: column;
        justify-content: center; gap: 8px;
    }
    .birthday-title {
        font-size: 15px; line-height: 1.5; font-weight: 600;
        word-break: break-word;
    }
    .birthday-link a {
        font-size: 13px; line-height: 1.4; color: #eb7350;
        text-decoration: none;
    }
    .video {
        position: relative; margin-top: 14px; border-radius: 6px;
        overflow: hidden; background: #000; max-height: 305px;
    }
    .video img {
        width: 100%; max-height: 305px; display: block;
        object-fit: contain;
    }
    .video-shade {
        position: absolute; inset: 0; pointer-events: none;
        background: linear-gradient(
            180deg, rgba(0, 0, 0, 0), rgba(0, 0, 0, .4)
        );
    }
    .video-play {
        position: absolute; top: 50%; left: 50%;
        width: 56px; height: 64px;
        transform: translate(-50%, -50%);
        fill: #ffffff; stroke: #ffffff; stroke-width: 12;
        stroke-linejoin: round;
        filter: drop-shadow(0 0 12px rgba(0, 0, 0, .45));
    }
    .video-count, .video-duration {
        position: absolute; bottom: 10px; font-size: 13px;
        font-weight: 500; line-height: 1.2; color: #ffffff;
        text-shadow: 0 1px 2px rgba(0, 0, 0, .5);
    }
    .video-count {
        left: 20px; max-width: 42%; overflow: hidden;
        white-space: nowrap; text-overflow: ellipsis;
    }
    .video-duration { right: 20px; }
    .link-card {
        margin-top: 14px; display: flex; gap: 12px; padding: 8px;
        background: #f7f8fa; border-radius: 6px;
    }
    .link-cover {
        width: 160px; height: 90px; flex: 0 0 auto; display: block;
        border-radius: 6px; object-fit: cover; background: #eceff3;
    }
    .link-body {
        min-width: 0; flex: 1; display: flex; flex-direction: column;
        justify-content: center;
    }
    .link-title {
        display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
        -webkit-line-clamp: 2; font-size: 15px; line-height: 1.45;
        color: #1f2329; word-break: break-word;
    }
    .link-source {
        margin-top: 6px; font-size: 12px; line-height: 1.4;
        color: #8a8f99;
    }
    .link-desc {
        display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical;
        -webkit-line-clamp: 2; margin-top: 6px; font-size: 13px;
        line-height: 1.4; color: #8a8f99; word-break: break-word;
    }
    .retweet .video, .retweet .link-card { margin-top: 10px; }
    .retweet .link-card { background: #ffffff; }
</style>
</head>
<body>
<div class="${cardClass}">
    <div class="header">
        ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" />` : ''}
        <div class="who">
            <div class="name">${escapeHtml(screenName)}</div>
            ${meta ? `<div class="meta">${meta}</div>` : ''}
        </div>
    </div>
    <div class="body">
        ${
            kind === 'birthday'
                ? renderBirthdayBlock(post)
                : content
                  ? `<div class="content">${content}</div>`
                  : likeReason
                    ? `<div class="content">${likeReason}</div>`
                    : ''
        }
        ${renderImages(images, '')}
        ${renderPageMedia(mainPage)}
    </div>
    ${originalBlock}
</div>
</body>
</html>`;
}

function renderImages(images: string[], extraClass: string): string {
    if (images.length === 0) return '';
    const n = Math.min(images.length, MAX_CARD_IMAGES);
    const hidden = Math.max(0, images.length - n);
    const className = `images n${n <= 1 ? 1 : n === 2 ? 2 : 3}${extraClass}`;
    const items = images
        .slice(0, n)
        .map((url, index) => {
            const img = `<img src="${escapeHtml(url)}" alt="" loading="eager" />`;
            if (hidden === 0 || index !== n - 1) return img;
            return `<span class="thumb">${img}<span class="more">+${hidden}</span></span>`;
        })
        .join('');
    return `<div class="${className}">${items}</div>`;
}

function renderPageMedia(page: WeiboPageInfo | undefined): string {
    if (!page) return '';
    return renderVideo(page) + renderLinkCard(page);
}

function renderVideo(page: WeiboPageInfo): string {
    if (!isNativeVideo(page)) return '';

    const cover = pageCover(page);
    if (!cover) return '';

    const playCount = pickPlayCount(page);
    const duration = formatVideoDuration(page.media_info?.duration);

    return `<div class="video">
        <img src="${escapeHtml(cover)}" alt="" loading="eager" />
        <div class="video-shade"></div>
        <svg class="video-play" viewBox="0 0 56 64" aria-hidden="true"><path d="M 14 10 L 46 32 L 14 54 Z" /></svg>
        ${playCount ? `<span class="video-count">${escapeHtml(playCount)}</span>` : ''}
        ${duration ? `<span class="video-duration">${duration}</span>` : ''}
    </div>`;
}

function pickPlayCount(page: WeiboPageInfo): string {
    const media = page.media_info;
    const onlineUsers = media?.online_users;
    if (typeof onlineUsers === 'string' && onlineUsers.trim()) {
        return onlineUsers.trim();
    }
    if (
        typeof onlineUsers === 'number' &&
        Number.isFinite(onlineUsers) &&
        onlineUsers > 0
    ) {
        return `${onlineUsers}次观看`;
    }

    const raw = page.play_count;
    if (typeof raw === 'number') {
        return Number.isFinite(raw) ? String(raw) : '';
    }
    if (typeof raw === 'string' && raw.trim()) return raw.trim();

    const onlineUsersNumber = media?.online_users_number;
    const numeric =
        typeof onlineUsersNumber === 'number'
            ? onlineUsersNumber
            : typeof onlineUsersNumber === 'string' && onlineUsersNumber.trim()
              ? Number(onlineUsersNumber)
              : Number.NaN;
    return Number.isFinite(numeric) && numeric > 0
        ? `${numeric}次观看`
        : '';
}

/** 秒数 → `m:ss`, 满 1 小时为 `h:mm:ss`; 非法值返回空串 */
export function formatVideoDuration(
    raw: number | string | null | undefined,
): string {
    if (raw === null || raw === undefined || raw === '') return '';
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || value < 0) return '';
    const total = Math.floor(value);
    const seconds = total % 60;
    const minutes = Math.floor(total / 60) % 60;
    const hours = Math.floor(total / 3600);
    if (hours > 0) {
        return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${pad(minutes)}:${pad(seconds)}`;
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}

function renderLinkCard(page: WeiboPageInfo): string {
    if (isNativeVideo(page)) return '';

    const cover = pageCover(page);
    const title = pageTitle(page);
    if (!cover || !title) return '';

    const href = resolvePageHref(page);
    if (!href) return '';

    const internal = isWeiboInternalUrl(href);
    const description = internal ? pageDescription(page) : '';
    if (internal && !description) return '';

    const detail = description
        ? `<div class="link-desc">${escapeHtml(description)}</div>`
        : `<div class="link-source">${escapeHtml(pageSourceLabel(href))}</div>`;

    return `<div class="link-card">
        <img class="link-cover" src="${escapeHtml(cover)}" alt="" loading="eager" />
        <div class="link-body">
            <div class="link-title">${escapeHtml(title)}</div>
            ${detail}
        </div>
    </div>`;
}

function isNativeVideo(page: WeiboPageInfo): boolean {
    const type =
        `${page.type ?? ''} ${page.object_type ?? ''}`.toLowerCase();
    if (type.includes('video') || page.media_info) return true;

    const href = resolvePageHref(page);
    if (!href) return false;
    try {
        const url = new URL(href);
        const host = url.hostname.toLowerCase();
        return (
            host === 'video.weibo.com' ||
            host.endsWith('.video.weibo.com') ||
            url.pathname.startsWith('/tv/')
        );
    } catch {
        return false;
    }
}

function pageTitle(page: WeiboPageInfo): string {
    for (const value of [
        page.title,
        page.content1,
        page.page_title,
        page.content2,
    ]) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

/**
 * 页面简介: 优先 `page_desc`, 回退 `content2`。
 *
 * 站内摘要卡的 `content2` 与标题可能同值 (列表接口只给一份文案),
 * 此时视为无简介, 避免右侧重复展示标题。
 */
function pageDescription(page: WeiboPageInfo): string {
    const title = htmlToText(pageTitle(page));
    for (const value of [page.page_desc, page.content2]) {
        if (typeof value !== 'string') continue;
        const text = htmlToText(value);
        if (!text || text === title) continue;
        return text;
    }
    return '';
}

function pageCover(page: WeiboPageInfo): string {
    return typeof page.page_pic === 'string'
        ? page.page_pic
        : (page.page_pic?.url ?? '');
}

function resolvePageHref(page: WeiboPageInfo): string {
    const raw = (page.page_url ?? '').trim();
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

function isWeiboInternalUrl(href: string): boolean {
    try {
        const host = new URL(href).hostname.toLowerCase();
        return (
            host === 'weibo.com' ||
            host.endsWith('.weibo.com') ||
            host === 'weibo.cn' ||
            host.endsWith('.weibo.cn')
        );
    } catch {
        return true;
    }
}

function pageSourceLabel(href: string): string {
    try {
        const host = new URL(href).hostname
            .toLowerCase()
            .replace(/^www\./, '');
        if (
            host === 'b23.tv' ||
            host.endsWith('.b23.tv') ||
            host === 'bilibili.com' ||
            host.endsWith('.bilibili.com')
        ) {
            return '哔哩哔哩';
        }
        return host;
    } catch {
        return '';
    }
}

function isSamePageInfo(
    a: WeiboPageInfo | undefined,
    b: WeiboPageInfo | undefined,
): boolean {
    if (!a || !b) return false;
    if (a.page_url && b.page_url && a.page_url === b.page_url) {
        return true;
    }
    const aObject = String(a.object_id ?? '');
    const bObject = String(b.object_id ?? '');
    if (aObject && bObject && aObject === bObject) return true;
    const aTitle = pageTitle(a);
    const bTitle = pageTitle(b);
    const aCover = pageCover(a);
    const bCover = pageCover(b);
    return Boolean(
        aTitle &&
            bTitle &&
            aCover &&
            bCover &&
            aTitle === bTitle &&
            aCover === bCover,
    );
}

function renderLikeOriginal(post: WeiboPost): string {
    if (post.retweeted_status || post.retweeted_status_id) {
        return renderOriginalBlock(
            resolveRootRetweet(post),
            post.retweeted_status_id,
        );
    }
    return renderOriginalBlock(post);
}

/**
 * 点赞的原动态本身是转发时, 主文区展示被点赞博主的转发理由。
 *
 * 转发块落到最原始博文后, 这块理由是原动态里唯一无法在块内表达的内容。
 */
function buildLikeReason(post: WeiboPost): string {
    if (!(post.retweeted_status || post.retweeted_status_id)) {
        return '';
    }
    const content = sanitizeWeiboHtml(
        post.text ?? post.text_raw ?? '',
    );
    if (!content.trim()) return '';
    const name = post.user?.screen_name ?? '原博主';
    return `//${buildMentionAnchor(name)}:${content}`;
}

function buildMentionAnchor(name: string): string {
    const href = `https://weibo.com/n/${encodeURIComponent(name)}`;
    return [
        `<a href="${escapeHtml(href)}"`,
        ' target="_blank" rel="noopener noreferrer">',
        `@${escapeHtml(name)}</a>`,
    ].join('');
}

function renderBirthdayBlock(post: WeiboPost): string {
    const cover = birthdayCover(post);
    const title = birthdayTitle(post);
    const href = birthdayHref(post);

    return `<div class="birthday-card">
        ${cover ? `<img class="birthday-cover" src="${escapeHtml(cover)}" alt="" loading="eager" />` : ''}
        <div class="birthday-body">
            <div class="birthday-title">${escapeHtml(title)}</div>
            ${href ? `<div class="birthday-link"><a href="${escapeHtml(href)}">查看生日动态</a></div>` : ''}
        </div>
    </div>`;
}

function renderRetweet(post: WeiboPost): string {
    return renderOriginalBlock(
        post.retweeted_status,
        post.retweeted_status_id,
    );
}

function renderOriginalBlock(
    original: WeiboPost | null | undefined,
    originalId?: string,
): string {
    if (!original && !originalId) return '';

    if (!original) {
        return `<div class="retweet"><div class="deleted">原微博已删除</div></div>`;
    }

    const name = original.user?.screen_name ?? '原博主';
    const time = original.created_at
        ? formatWeiboTime(original.created_at)
        : '';
    const content = sanitizeWeiboHtml(
        original.text ?? original.text_raw ?? '',
    );
    const images = pickAllPostImages(original);

    return `<div class="retweet">
        <div class="rt-user">@${escapeHtml(name)}</div>
        ${content ? `<div class="rt-content">${content}</div>` : ''}
        ${renderImages(images, ' rt-images')}
        ${renderPageMedia(original.page_info)}
        ${time ? `<div class="rt-time">${escapeHtml(time)}</div>` : ''}
    </div>`;
}
