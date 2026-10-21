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
import { buildPostText } from '../../weibo/card';
import type { WeiboMonitor, WeiboPost } from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import { cardRenderService } from './renderService';
import { weiboRuntime } from './runtimeStatus';

const MESSAGE_INTERVAL_MS = 500;

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

        const image = await cardRenderService.render(post);
        const text = image ? '' : buildPostText(post);
        let pushed = 0;
        let failed = 0;

        for (const target of enabled) {
            const ok = image
                ? await this.send(
                      target.type,
                      target.id,
                      createImageMessage(image),
                  )
                : await this.send(
                      target.type,
                      target.id,
                      createTextMessage(text),
                  );

            if (ok) {
                pushed += 1;
                weiboRuntime.recordPush(monitor.uid);
            } else if (image) {
                const fallbackOk = await this.send(
                    target.type,
                    target.id,
                    createTextMessage(buildPostText(post)),
                );
                if (fallbackOk) {
                    pushed += 1;
                    weiboRuntime.recordPush(monitor.uid);
                } else {
                    failed += 1;
                }
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

    private async send(
        type: 'group' | 'private',
        id: string,
        message: Parameters<typeof sendPrivateMessage>[2],
    ): Promise<boolean> {
        const ctx = pluginState.ctx;
        return type === 'group'
            ? sendGroupMessage(ctx, id, message)
            : sendPrivateMessage(ctx, id, message);
    }
}

export const weiboPushService = new WeiboPushService();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
