import { birthdayHref, birthdayTitle } from './birthday';
import { buildPostUrl, pickAllPostImages } from './card';
import {
    resolveLikeMoment,
    resolvePostKind,
    resolveRootRetweet,
} from './postKind';
import { sanitizeWeiboText } from './sanitize';
import { formatLikeTime, formatWeiboTime } from './time';
import type {
    WeiboPost,
    WeiboPostIdentity,
    WeiboPostKind,
    WeiboPostRenderContext,
} from './types';

export type PostEvent =
    | '发送了微博'
    | '转发了微博'
    | '发布了视频'
    | '点赞了微博'
    | '发布了生日动态';

export interface PresentationText {
    type: 'text';
    text: string;
}

export interface PresentationImage {
    type: 'image';
    url: string;
}

export type PresentationSegment =
    | PresentationText
    | PresentationImage;

export interface PresentationOptions {
    includeOriginalAttachments?: boolean;
    context?: WeiboPostRenderContext;
    identity?: WeiboPostIdentity;
}

export type TextPresentationOptions = PresentationOptions;

const REPOST_DIVIDER = '────────';
const REPOST_DIVIDER_BLOCK = `\n\n${REPOST_DIVIDER}\n\n`;

export function resolvePostEvent(
    post: WeiboPost,
    kind: WeiboPostKind = resolvePostKind(post),
): PostEvent {
    if (kind === 'like') return '点赞了微博';
    if (kind === 'birthday') return '发布了生日动态';
    if (post.retweeted_status || post.retweeted_status_id) {
        return '转发了微博';
    }
    if (isVideoPost(post)) return '发布了视频';
    return '发送了微博';
}

export function isVideoPost(post: WeiboPost): boolean {
    const page = post.page_info;
    if (!page) return false;
    return (
        Boolean(page.media_info) ||
        String(page.object_type ?? '').toLowerCase() === 'video' ||
        /video/i.test(String(page.page_url ?? '')) ||
        /video/i.test(String(page.type ?? ''))
    );
}

export function buildPushHeader(
    post: WeiboPost,
    options: PresentationOptions = {},
): string {
    const kind = options.context?.kind ?? resolvePostKind(post);
    if (kind === 'like') return buildLikeHeader(post, options);
    if (kind === 'birthday') return buildBirthdayHeader(post);

    const name = post.user?.screen_name ?? '微博用户';
    return `[${formatWeiboTime(post.created_at)}] 「${name}」${resolvePostEvent(post, kind)}`;
}

export function buildTextPresentation(
    post: WeiboPost,
    options: TextPresentationOptions = {},
): PresentationSegment[] {
    const kind = options.context?.kind ?? resolvePostKind(post);
    if (kind === 'like') return buildLikeText(post, options);
    if (kind === 'birthday') return buildBirthdayText(post, options);

    const segments: PresentationSegment[] = [];
    pushText(
        segments,
        `${buildPushHeader(post, options)}\n${buildPostUrl(post)}`,
    );

    const content = buildRichText(post.text ?? post.text_raw ?? '');
    if (content.length > 0) {
        pushText(segments, '\n');
        appendSegments(segments, content);
    }

    const retweet = post.retweeted_status;
    if (retweet) {
        pushText(segments, REPOST_DIVIDER_BLOCK);
        pushText(
            segments,
            `${buildOriginalHeader(retweet)}\n${buildPostUrl(retweet)}`,
        );
        const originalContent = buildRichText(
            retweet.text ?? retweet.text_raw ?? '',
        );
        if (originalContent.length > 0) {
            pushText(segments, '\n');
            appendSegments(segments, originalContent);
        }
    } else if (post.retweeted_status_id) {
        pushText(segments, `${REPOST_DIVIDER_BLOCK}原微博已删除`);
    }

    if (resolvePostEvent(post, kind) === '发布了视频') {
        const cover = pickVideoCover(post);
        if (cover) pushImage(segments, cover);
    }

    const includeOriginalAttachments =
        options.includeOriginalAttachments ?? true;
    for (const url of pickAttachedImages(
        post,
        includeOriginalAttachments,
    )) {
        pushImage(segments, url);
    }

    return segments;
}

export function buildImagePresentation(
    post: WeiboPost,
    cardImage: string | null,
    options: PresentationOptions = {},
): PresentationSegment[] {
    if (!cardImage) {
        return buildTextPresentation(post, {
            ...options,
            includeOriginalAttachments: true,
        });
    }

    const kind = options.context?.kind ?? resolvePostKind(post);
    const segments: PresentationSegment[] = [];
    const href =
        kind === 'birthday'
            ? birthdayHref(post)
            : kind === 'like'
              ? ''
              : buildPostUrl(post);
    const header = buildPushHeader(post, options);
    pushText(segments, href ? `${header}\n${href}` : header);
    pushImage(segments, cardImage);
    return segments;
}

/**
 * 图片模式下单独发送的附图 (仅本条微博, 不含转发原动态)。
 *
 * 卡片已经展示本条附图, 此消息用于补充原图; 点赞 / 生日动态只有卡片,
 * 不产生附图消息。
 */
export function buildAttachmentPresentation(
    post: WeiboPost,
    options: PresentationOptions = {},
): PresentationImage[] {
    const kind = options.context?.kind ?? resolvePostKind(post);
    if (kind === 'like' || kind === 'birthday') return [];
    return pickAttachedImages(post, false).map((url) => ({
        type: 'image',
        url,
    }));
}

export function buildPlainText(
    post: WeiboPost,
    options: PresentationOptions = {},
): string {
    return buildTextPresentation(post, {
        ...options,
        includeOriginalAttachments: true,
    })
        .filter(
            (segment): segment is PresentationText =>
                segment.type === 'text',
        )
        .map((segment) => segment.text)
        .join('')
        .trim();
}

function buildLikeText(
    post: WeiboPost,
    options: PresentationOptions,
): PresentationSegment[] {
    const segments: PresentationSegment[] = [];
    pushText(segments, buildLikeHeader(post, options));

    const reason = buildLikeReasonText(post);
    if (reason) {
        pushText(segments, '\n');
        pushText(segments, reason);
    }

    pushText(segments, REPOST_DIVIDER_BLOCK);
    const target = resolveLikeOriginal(post);
    if (!target) {
        pushText(segments, '原微博已删除');
        return segments;
    }

    pushText(segments, buildOriginalHeader(target));

    const content = buildRichText(
        target.text ?? target.text_raw ?? '',
    );
    if (content.length > 0) {
        pushText(segments, '\n');
        appendSegments(segments, content);
    }

    if (options.includeOriginalAttachments ?? true) {
        for (const url of pickAllPostImages(target)) {
            pushImage(segments, url);
        }
    }
    return segments;
}

function buildLikeReasonText(post: WeiboPost): string {
    if (!(post.retweeted_status || post.retweeted_status_id)) {
        return '';
    }
    const content = sanitizeWeiboText(
        post.text ?? post.text_raw ?? '',
    );
    if (!content.trim()) return '';
    const name = post.user?.screen_name ?? '原博主';
    return `//@${name}:${content}`;
}

function resolveLikeOriginal(post: WeiboPost): WeiboPost | undefined {
    if (post.retweeted_status || post.retweeted_status_id) {
        return resolveRootRetweet(post);
    }
    return post;
}

function buildBirthdayText(
    post: WeiboPost,
    options: PresentationOptions,
): PresentationSegment[] {
    const segments: PresentationSegment[] = [];
    pushText(segments, buildBirthdayHeader(post, options));
    pushText(segments, `\n${birthdayTitle(post)}`);
    const href = birthdayHref(post);
    if (href) pushText(segments, `\n${href}`);
    return segments;
}

function buildLikeHeader(
    post: WeiboPost,
    options: PresentationOptions,
): string {
    const name = options.identity?.screenName ?? '微博用户';
    const likeMoment = resolveLikeMoment(post, options.context);
    const time = formatLikeTime(
        likeMoment?.day,
        likeMoment?.clock,
        options.context?.fetchedAt,
    );
    return `${time ? `[${time}] ` : ''}「${name}」点赞了微博`;
}

function buildBirthdayHeader(
    post: WeiboPost,
    options?: PresentationOptions,
): string {
    const name =
        options?.identity?.screenName ??
        post.user?.screen_name ??
        '微博用户';
    const time = formatWeiboTime(post.created_at);
    const prefix = time === '未知时间' ? '' : `[${time}] `;
    return `${prefix}「${name}」发布了生日动态`;
}

function buildOriginalHeader(post: WeiboPost): string {
    const name = post.user?.screen_name ?? '原博主';
    return `[${formatWeiboTime(post.created_at)}] 「${name}」`;
}

function pickVideoCover(post: WeiboPost): string {
    const page = post.page_info;
    if (!page) return '';
    const picture = page.page_pic;
    if (typeof picture === 'string') return picture;
    return picture?.url ?? '';
}

function pickAttachedImages(
    post: WeiboPost,
    includeOriginal: boolean,
): string[] {
    const images = [...pickAllPostImages(post)];
    if (includeOriginal && post.retweeted_status) {
        images.push(...pickAllPostImages(post.retweeted_status));
    }
    return images;
}

function buildRichText(html: string): PresentationSegment[] {
    const text = sanitizeWeiboText(html);
    return text ? [{ type: 'text', text }] : [];
}

function appendSegments(
    target: PresentationSegment[],
    source: readonly PresentationSegment[],
): void {
    for (const segment of source) {
        if (segment.type === 'text') {
            pushText(target, segment.text);
        } else {
            pushImage(target, segment.url);
        }
    }
}

function pushText(
    segments: PresentationSegment[],
    text: string,
): void {
    if (!text) return;
    const last = segments[segments.length - 1];
    if (last?.type === 'text') {
        last.text += text;
    } else {
        segments.push({ type: 'text', text });
    }
}

function pushImage(
    segments: PresentationSegment[],
    url: string,
): void {
    if (!url) return;
    segments.push({ type: 'image', url });
}
