/**
 * 微博推送呈现与投递
 *
 * 一条动态先准备一次 (长文补拉 / 卡片渲染 / 文本回退), 再按目标逐个投递。
 * 订阅推送、latest 与指定动态读取共用这一层,
 * 长文补拉与卡片降级只在这里发生。
 */

import { pluginState } from '../../core/state';
import {
    createImageMessage,
    createTextMessage,
    sendGroupMessage,
    sendPrivateMessage,
} from '../../handlers/utils';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import {
    buildAttachmentPresentation,
    buildImagePresentation,
    buildPlainText,
    buildTextPresentation,
    type PresentationSegment,
} from '../../weibo/presentation';
import type {
    WeiboMonitorTarget,
    WeiboPost,
    WeiboPostIdentity,
    WeiboPostRenderContext,
} from '../../weibo/types';
import { weiboReader } from './readerService';

const MESSAGE_INTERVAL_MS = 500;

type OutgoingMessage = Parameters<typeof sendPrivateMessage>[2];

export type PostSource = 'timeline' | 'status';

export interface PreparePostOptions {
    source: PostSource;
    context?: WeiboPostRenderContext;
    identity?: WeiboPostIdentity;
}

/** 已渲染的一条动态; 交给 deliver 时不应再改动 */
export interface PreparedPost {
    primary: OutgoingMessage;
    /** 图片模式下单独发送的附图消息; 无附图或文本模式时为 undefined */
    secondary?: OutgoingMessage;
    fallback: string;
}

export interface DeliveryResult {
    pushed: number;
    failed: number;
}

export interface PostDeliveryLogger {
    warn(...args: unknown[]): void;
}

export interface PostDeliveryDeps {
    hydrateTimeline(post: WeiboPost): Promise<WeiboPost>;
    hydrateStatus(post: WeiboPost): Promise<WeiboPost>;
    renderCard(
        post: WeiboPost,
        context?: WeiboPostRenderContext,
        identity?: WeiboPostIdentity,
    ): Promise<string | null>;
    send(
        target: WeiboMonitorTarget,
        message: OutgoingMessage,
    ): Promise<boolean>;
    renderMode(): 'image' | 'text';
    logger: PostDeliveryLogger;
    sleep(ms: number): Promise<void>;
}

export interface PostDelivery {
    prepare(
        post: WeiboPost,
        options: PreparePostOptions,
    ): Promise<PreparedPost>;
    deliver(
        targets: readonly WeiboMonitorTarget[],
        prepared: PreparedPost,
    ): Promise<DeliveryResult>;
}

export function createPostDelivery(
    deps: PostDeliveryDeps,
): PostDelivery {
    return {
        async prepare(post, options) {
            const content =
                options.source === 'status'
                    ? await deps.hydrateStatus(post)
                    : await deps.hydrateTimeline(post);
            const presentation = {
                context: options.context,
                identity: options.identity,
            };
            const fallback = buildPlainText(content, presentation);

            if (deps.renderMode() !== 'image') {
                return {
                    primary: toMessage(
                        buildTextPresentation(content, presentation),
                    ),
                    fallback,
                };
            }

            const cardImage = await deps.renderCard(
                content,
                options.context,
                options.identity,
            );
            if (!cardImage) {
                return {
                    primary: toMessage(
                        buildTextPresentation(content, presentation),
                    ),
                    fallback,
                };
            }

            return {
                primary: toMessage(
                    buildImagePresentation(
                        content,
                        cardImage,
                        presentation,
                    ),
                ),
                secondary: toOptionalMessage(
                    buildAttachmentPresentation(
                        content,
                        presentation,
                    ),
                ),
                fallback,
            };
        },
        async deliver(targets, prepared) {
            let pushed = 0;
            let failed = 0;

            for (let index = 0; index < targets.length; index += 1) {
                const ok = await deliverOne(
                    deps,
                    targets[index],
                    prepared,
                );
                if (ok) {
                    pushed += 1;
                } else {
                    failed += 1;
                }

                if (index < targets.length - 1) {
                    await deps.sleep(MESSAGE_INTERVAL_MS);
                }
            }

            return { pushed, failed };
        },
    };
}

async function deliverOne(
    deps: PostDeliveryDeps,
    target: WeiboMonitorTarget,
    prepared: PreparedPost,
): Promise<boolean> {
    const ok = await deps.send(target, prepared.primary);
    if (!ok) {
        return deps.send(target, prepared.fallback);
    }

    if (prepared.secondary) {
        await deps.sleep(MESSAGE_INTERVAL_MS);
        const secondaryOk = await deps.send(
            target,
            prepared.secondary,
        );
        if (!secondaryOk) {
            deps.logger.warn(
                `微博附图发送失败: ${target.type}:${target.id}`,
            );
        }
    }

    return true;
}

export const weiboPostDelivery = createPostDelivery({
    hydrateTimeline: (post) =>
        hydrateWith(post, (item) => weiboReader.hydrate(item)),
    hydrateStatus: (post) =>
        hydrateWith(post, (item) => weiboReader.hydrateStatus(item)),
    renderCard: async (post, context, identity) => {
        const result = await weiboReader.renderCard(
            post,
            context,
            identity,
        );
        if (!result.ok || !result.buffer) return null;
        return `base64://${result.buffer.toString('base64')}`;
    },
    send: (target, message) => {
        const ctx = pluginState.ctx;
        return target.type === 'group'
            ? sendGroupMessage(ctx, target.id, message)
            : sendPrivateMessage(ctx, target.id, message);
    },
    renderMode: () => pluginState.config.weiboPushRenderMode,
    logger: {
        warn: (...args) => pluginState.logger.warn(...args),
    },
    sleep,
});

async function hydrateWith(
    post: WeiboPost,
    hydrate: (post: WeiboPost) => Promise<WeiboPost>,
): Promise<WeiboPost> {
    const hydrated = await hydrate(post);
    if (hydrated !== post) {
        WeiboCookieStore.getInstance().markSuccess();
    }
    return hydrated;
}

function toMessage(segments: PresentationSegment[]): OutgoingMessage {
    if (segments.length === 1 && segments[0].type === 'text') {
        return segments[0].text;
    }
    return segments.map((segment) =>
        segment.type === 'text'
            ? createTextMessage(segment.text)
            : createImageMessage(segment.url),
    );
}

function toOptionalMessage(
    segments: PresentationSegment[],
): OutgoingMessage | undefined {
    return segments.length > 0 ? toMessage(segments) : undefined;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
