/**
 * 推送服务
 *
 * 一条动态只渲染一次, 再按订阅目标逐个发送。会话未启用时跳过发送,
 * 但已见缓存照常推进 (由轮询层负责), 避免重新启用后补推历史。
 */

import { pluginState } from '../../core/state';
import {
    createImageMessage,
    createTextMessage,
    sendGroupMessage,
    sendPrivateMessage,
} from '../../handlers/utils';
import {
    buildAttachmentPresentation,
    buildImagePresentation,
    buildPlainText,
    buildTextPresentation,
    type PresentationSegment,
} from '../../weibo/presentation';
import type {
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
    WeiboPostIdentity,
    WeiboPostRenderContext,
} from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import { weiboLongTextService } from './longTextService';
import { cardRenderService } from './renderService';
import { weiboRuntime } from './runtimeStatus';

const MESSAGE_INTERVAL_MS = 500;

type OutgoingMessage = Parameters<typeof sendPrivateMessage>[2];

interface RenderedMessage {
    primary: OutgoingMessage;
    /** 图片模式下单独发送的附图消息; 无附图或文本模式时为 undefined */
    secondary?: OutgoingMessage;
    fallback: string;
}

export interface PushResult {
    pushed: number;
    failed: number;
}

class WeiboPushService {
    /** 推送到该博主所有已启用的订阅目标 */
    async pushPost(
        post: WeiboPost,
        monitor: WeiboMonitor,
        context?: WeiboPostRenderContext,
    ): Promise<PushResult> {
        const enabled = monitor.to.filter((target) =>
            sessionConfigService.isSessionEnabled(
                target.id,
                target.type,
            ),
        );
        if (enabled.length === 0) {
            return { pushed: 0, failed: 0 };
        }

        const content = await weiboLongTextService.hydrate(post);
        const identity: WeiboPostIdentity = {
            screenName: monitor.screenName,
            avatar: monitor.avatar,
        };
        const rendered = await this.render(
            content,
            context,
            identity,
        );

        let pushed = 0;
        let failed = 0;

        for (const target of enabled) {
            const ok = await this.deliver(target, rendered);

            if (ok) {
                pushed += 1;
                weiboRuntime.recordPush(monitor.uid);
            } else {
                failed += 1;
            }

            await sleep(MESSAGE_INTERVAL_MS);
        }

        pluginState.logger.info(
            `微博推送完成 @${monitor.screenName} (${monitor.uid}): 成功 ${pushed}, 失败 ${failed}`,
        );
        return { pushed, failed };
    }

    async pushPostTo(
        post: WeiboPost,
        target: WeiboMonitorTarget,
        context?: WeiboPostRenderContext,
    ): Promise<boolean> {
        const rendered = await this.render(post, context);
        return this.deliver(target, rendered);
    }

    private async render(
        post: WeiboPost,
        context?: WeiboPostRenderContext,
        identity?: WeiboPostIdentity,
    ): Promise<RenderedMessage> {
        const mode = pluginState.config.weiboPushRenderMode;
        const options = { context, identity };
        const fallback = buildPlainText(post, options);

        if (mode !== 'image') {
            return {
                primary: toMessage(
                    buildTextPresentation(post, options),
                ),
                fallback,
            };
        }

        const cardImage = await cardRenderService.render(
            post,
            context,
            identity,
        );
        if (!cardImage) {
            // 卡片渲染失败时降级为文本模式单条发送
            return {
                primary: toMessage(
                    buildTextPresentation(post, options),
                ),
                fallback,
            };
        }

        return {
            primary: toMessage(
                buildImagePresentation(post, cardImage, options),
            ),
            secondary: toOptionalMessage(
                buildAttachmentPresentation(post, options),
            ),
            fallback,
        };
    }

    /**
     * 发送已渲染消息: 先发主消息, 失败回退纯文本; 主消息成功后再发附图。
     *
     * 附图发送失败只记日志, 不影响本次推送的成功计数。
     */
    private async deliver(
        target: WeiboMonitorTarget,
        rendered: RenderedMessage,
    ): Promise<boolean> {
        const ok = await this.send(
            target.type,
            target.id,
            rendered.primary,
        );
        if (!ok) {
            return this.send(
                target.type,
                target.id,
                rendered.fallback,
            );
        }

        if (rendered.secondary) {
            await sleep(MESSAGE_INTERVAL_MS);
            const secondaryOk = await this.send(
                target.type,
                target.id,
                rendered.secondary,
            );
            if (!secondaryOk) {
                pluginState.logger.warn(
                    `微博附图发送失败: ${target.type}:${target.id}`,
                );
            }
        }
        return true;
    }

    private async send(
        type: 'group' | 'private',
        id: string,
        message: OutgoingMessage,
    ): Promise<boolean> {
        const ctx = pluginState.ctx;
        return type === 'group'
            ? sendGroupMessage(ctx, id, message)
            : sendPrivateMessage(ctx, id, message);
    }
}

export const weiboPushService = new WeiboPushService();

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
