/**
 * 订阅推送入口
 *
 * 过滤已启用的会话目标, 交给 PostDelivery 准备与投递;
 * 这里只负责订阅语义 (启用目标 / 推送计数 / 运行时记录 / 汇总日志)。
 */

import { pluginState } from '../../core/state';
import type {
    WeiboMonitor,
    WeiboPost,
    WeiboPostRenderContext,
} from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import {
    type DeliveryResult,
    weiboPostDelivery,
} from './postDelivery';
import { weiboRuntime } from './runtimeStatus';

class WeiboPushService {
    /** 推送到该博主所有已启用的订阅目标 */
    async pushPost(
        post: WeiboPost,
        monitor: WeiboMonitor,
        context?: WeiboPostRenderContext,
    ): Promise<DeliveryResult> {
        const enabled = monitor.to.filter((target) =>
            sessionConfigService.isSessionEnabled(
                target.id,
                target.type,
            ),
        );
        if (enabled.length === 0) {
            return { pushed: 0, failed: 0 };
        }

        const prepared = await weiboPostDelivery.prepare(post, {
            source: 'timeline',
            context,
            identity: {
                screenName: monitor.screenName,
                avatar: monitor.avatar,
            },
        });
        const result = await weiboPostDelivery.deliver(
            enabled,
            prepared,
        );

        if (result.pushed > 0) {
            weiboRuntime.recordPush(monitor.uid);
        }
        pluginState.logger.info(
            `微博推送完成 @${monitor.screenName} (${monitor.uid}): 成功 ${result.pushed}, 失败 ${result.failed}`,
        );
        return result;
    }
}

export const weiboPushService = new WeiboPushService();
