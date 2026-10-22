/**
 * 推送服务
 *
 * 一条动态只渲染一次, 再按订阅目标逐个发送。会话未启用时跳过发送,
 * 但水位线照常推进 (由轮询层负责), 避免重新启用后补推历史。
 */

import { pluginState } from '../../core/state';
import {
    createImageMessage,
    createTextMessage,
    sendGroupMessage,
    sendPrivateMessage,
} from '../../handlers/utils';
import {
    buildImagePresentation,
    buildPlainText,
    buildTextPresentation,
    type PresentationSegment,
} from '../../weibo/presentation';
import type {
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
} from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import { weiboLongTextService } from './longTextService';
import { cardRenderService } from './renderService';
import { weiboRuntime } from './runtimeStatus';

const MESSAGE_INTERVAL_MS = 500;

type OutgoingMessage = Parameters<typeof sendPrivateMessage>[2];

interface RenderedMessage {
    primary: OutgoingMessage;
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
        const { primary, fallback } = await this.render(content);

        let pushed = 0;
        let failed = 0;

        for (const target of enabled) {
            let ok = await this.send(target.type, target.id, primary);
            if (!ok) {
                ok = await this.send(
                    target.type,
                    target.id,
                    fallback,
                );
            }

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
    ): Promise<boolean> {
        const { primary, fallback } = await this.render(post);
        const ok = await this.send(target.type, target.id, primary);
        if (ok) return true;
        return this.send(target.type, target.id, fallback);
    }

    private async render(post: WeiboPost): Promise<RenderedMessage> {
        const mode = pluginState.config.weiboPushRenderMode;
        const cardImage =
            mode === 'image'
                ? await cardRenderService.render(post)
                : null;

        return {
            primary: toMessage(
                mode === 'image'
                    ? buildImagePresentation(post, cardImage)
                    : buildTextPresentation(post),
            ),
            fallback: buildPlainText(post),
        };
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

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
