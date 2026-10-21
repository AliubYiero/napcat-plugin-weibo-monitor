/**
 * 推送卡片 HTML 构建 (纯函数)
 *
 * 宽度固定 640px, 截图时再按 DPR 2 放大。所有外部文本/URL 都必须经过
 * 转义与白名单净化; 不展示认证标与转评赞。长文由推送服务在渲染前补齐。
 */

import {
    escapeHtml,
    htmlToText,
    sanitizeWeiboHtml,
} from './sanitize';
import { formatWeiboTime } from './time';
import type { WeiboPost, WeiboUser } from './types';

/** 卡片 CSS 宽度 */
export const CARD_WIDTH = 640;

/** 从动态中取全部图片 URL (large → bmiddle) */
export function pickAllPostImages(post: WeiboPost): string[] {
    const infos = post.pic_infos ?? {};
    const ids =
        post.pic_ids && post.pic_ids.length > 0
            ? post.pic_ids
            : Object.keys(infos);

    const urls: string[] = [];
    for (const id of ids) {
        const info = infos[id];
        if (!info) continue;
        const url =
            info.large?.url ??
            info.bmiddle?.url ??
            info.thumbnail?.url ??
            '';
        if (url) urls.push(url);
    }

    if (urls.length === 0) {
        for (const info of Object.values(infos)) {
            const url =
                info.large?.url ??
                info.bmiddle?.url ??
                info.thumbnail?.url ??
                '';
            if (url) urls.push(url);
        }
    }

    return urls;
}

/** 从动态中取卡片网格图片 URL (最多 9 张) */
export function pickPostImages(post: WeiboPost): string[] {
    return pickAllPostImages(post).slice(0, 9);
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

/**
 * 构建一张动态卡片。
 *
 * @param post 已通过筛选谓词的动态
 */
export function buildPostCardHtml(post: WeiboPost): string {
    const user = post.user;
    const screenName = user?.screen_name ?? '微博用户';
    const avatar = pickAvatar(user);
    const createdAt = formatWeiboTime(post.created_at);
    const source = htmlToText(post.source ?? '');
    const region = post.region_name ?? '';
    const content = sanitizeWeiboHtml(
        post.text ?? post.text_raw ?? '',
    );
    const images = pickPostImages(post);
    const postUrl = buildPostUrl(post);

    const meta = [createdAt, source, region]
        .filter((item) => item.length > 0)
        .map(escapeHtml)
        .join(' <span class="dot">·</span> ');

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
    .card { padding: 24px 24px 20px; }
    .header { display: flex; align-items: center; gap: 12px; }
    .avatar {
        width: 52px; height: 52px; border-radius: 50%;
        object-fit: cover; flex: 0 0 auto; background: #f0f0f0;
    }
    .who { min-width: 0; flex: 1; }
    .name {
        font-size: 17px; font-weight: 700; line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .meta {
        margin-top: 4px; font-size: 13px; color: #8a8f99;
        line-height: 1.4;
    }
    .dot { padding: 0 4px; color: #c4c7cc; }
    .content {
        margin-top: 16px; font-size: 16px; line-height: 1.75;
        word-break: break-word; white-space: normal;
    }
    .content a { color: #eb7350; text-decoration: none; }
    .content img.emoji {
        width: 20px; height: 20px; vertical-align: -3px; margin: 0 1px;
    }
    .images { margin-top: 14px; display: grid; gap: 4px; }
    .images.n1 { grid-template-columns: minmax(0, 1fr); }
    .images.n2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .images.n3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .images img {
        width: 100%; min-width: 0; display: block; border-radius: 6px;
        object-fit: cover; background: #f4f5f7;
    }
    .images.n2 img, .images.n3 img { aspect-ratio: 1 / 1; }
    .images.n1 img { max-height: 860px; object-fit: contain; }
    .retweet {
        margin-top: 14px; padding: 14px 16px; border-radius: 8px;
        background: #f7f8fa; border-left: 3px solid #eb7350;
    }
    .retweet .rt-user {
        font-size: 14px; font-weight: 600; color: #3b6ea5;
        margin-bottom: 6px;
    }
    .retweet .rt-content {
        font-size: 15px; line-height: 1.7; word-break: break-word;
    }
    .retweet .rt-content a { color: #eb7350; text-decoration: none; }
    .retweet .rt-content img.emoji {
        width: 18px; height: 18px; vertical-align: -3px;
    }
    .retweet .images { margin-top: 10px; }
    .retweet .deleted { color: #8a8f99; font-size: 14px; }
    .video {
        margin-top: 14px; border-radius: 8px; overflow: hidden;
        background: #f7f8fa; border: 1px solid #eceef1;
    }
    .video img { width: 100%; display: block; }
    .video .video-title {
        padding: 10px 12px; font-size: 14px; line-height: 1.5;
        color: #3f444d;
    }
    .footer {
        margin-top: 18px; padding-top: 14px; border-top: 1px solid #eef0f3;
        font-size: 13px; color: #8a8f99; display: flex;
        justify-content: space-between; align-items: center;
    }
    .footer a { color: #3b6ea5; text-decoration: none; }
</style>
</head>
<body>
<div class="card">
    <div class="header">
        ${avatar ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="" />` : ''}
        <div class="who">
            <div class="name">${escapeHtml(screenName)}</div>
            ${meta ? `<div class="meta">${meta}</div>` : ''}
        </div>
    </div>
    ${content ? `<div class="content">${content}</div>` : ''}
    ${renderImages(images, '')}
    ${renderVideo(post)}
    ${renderRetweet(post)}
    <div class="footer">
        <span>微博动态</span>
        <a href="${escapeHtml(postUrl)}">查看原文</a>
    </div>
</div>
</body>
</html>`;
}

function renderImages(images: string[], extraClass: string): string {
    if (images.length === 0) return '';
    const n = Math.min(images.length, 9);
    const className = `images n${n <= 1 ? 1 : n === 2 ? 2 : 3}${extraClass}`;
    const items = images
        .slice(0, n)
        .map(
            (url) =>
                `<img src="${escapeHtml(url)}" alt="" loading="eager" />`,
        )
        .join('');
    return `<div class="${className}">${items}</div>`;
}

function renderVideo(post: WeiboPost): string {
    const page = post.page_info;
    if (!page) return '';
    const type = String(page.type ?? '').toLowerCase();
    const isVideo =
        type.includes('video') ||
        Boolean(page.media_info) ||
        /video/i.test(String(page.page_url ?? ''));
    if (!isVideo) return '';

    const cover =
        typeof page.page_pic === 'string'
            ? page.page_pic
            : (page.page_pic?.url ?? '');
    const title = page.title ?? page.content1 ?? '视频';
    if (!cover && !title) return '';

    return `<div class="video">
        ${cover ? `<img src="${escapeHtml(cover)}" alt="" />` : ''}
        <div class="video-title">${escapeHtml(title)}</div>
    </div>`;
}

function renderRetweet(post: WeiboPost): string {
    const retweet = post.retweeted_status;
    const retweetId = post.retweeted_status_id;
    if (!retweet && !retweetId) return '';

    if (!retweet) {
        return `<div class="retweet"><div class="deleted">原微博已删除</div></div>`;
    }

    const rtName = retweet.user?.screen_name ?? '原博主';
    const rtContent = sanitizeWeiboHtml(
        retweet.text ?? retweet.text_raw ?? '',
    );
    const rtImages = pickPostImages(retweet);

    return `<div class="retweet">
        <div class="rt-user">@${escapeHtml(rtName)}</div>
        ${rtContent ? `<div class="rt-content">${rtContent}</div>` : ''}
        ${renderImages(rtImages, ' rt-images')}
    </div>`;
}
