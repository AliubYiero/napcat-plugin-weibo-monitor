import { buildPostUrl, pickAllPostImages } from './card';
import { sanitizeWeiboText } from './sanitize';
import { formatWeiboTime } from './time';
import type { WeiboPost } from './types';

export type PostEvent = '发送了微博' | '转发了微博' | '发布了视频';

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

export interface TextPresentationOptions {
    includeOriginalAttachments?: boolean;
}

const REPOST_DIVIDER = '────────';
const REPOST_DIVIDER_BLOCK = `\n\n${REPOST_DIVIDER}\n\n`;

export function resolvePostEvent(post: WeiboPost): PostEvent {
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

export function buildPushHeader(post: WeiboPost): string {
    const name = post.user?.screen_name ?? '微博用户';
    return `[${formatWeiboTime(post.created_at)}] 「${name}」${resolvePostEvent(post)}`;
}

export function buildTextPresentation(
    post: WeiboPost,
    options: TextPresentationOptions = {},
): PresentationSegment[] {
    const segments: PresentationSegment[] = [];
    pushText(
        segments,
        `${buildPushHeader(post)}\n${buildPostUrl(post)}`,
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

    if (resolvePostEvent(post) === '发布了视频') {
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
): PresentationSegment[] {
    if (!cardImage) {
        return buildTextPresentation(post, {
            includeOriginalAttachments: true,
        });
    }

    const segments: PresentationSegment[] = [];
    pushText(
        segments,
        `${buildPushHeader(post)}\n${buildPostUrl(post)}`,
    );
    pushImage(segments, cardImage);
    for (const url of pickAttachedImages(post, false)) {
        pushImage(segments, url);
    }
    return segments;
}

export function buildPlainText(post: WeiboPost): string {
    return buildTextPresentation(post, {
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
