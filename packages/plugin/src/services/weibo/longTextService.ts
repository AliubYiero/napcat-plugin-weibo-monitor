/**
 * 长文补拉
 *
 * 推送前把主动态与原动态的截断正文替换为完整正文; 失败只降级, 不阻断推送。
 */

import { pluginState } from '../../core/state';
import {
    needsLongText,
    resolveLongTextId,
    withLongText,
} from '../../weibo/longText';
import type { WeiboPost } from '../../weibo/types';
import { weiboApiService } from './apiService';

class WeiboLongTextService {
    /** 补拉主动态及其原动态 */
    async hydrate(post: WeiboPost): Promise<WeiboPost> {
        const main = await this.hydrateOne(post);
        const retweet = main.retweeted_status;
        if (!retweet) return main;

        const original = await this.hydrateOne(retweet);
        if (original === retweet) return main;
        return { ...main, retweeted_status: original };
    }

    private async hydrateOne(post: WeiboPost): Promise<WeiboPost> {
        if (!needsLongText(post)) return post;

        const mblogid = resolveLongTextId(post);
        if (!mblogid) {
            pluginState.logger.debug(
                '微博长文缺少 mblogid, 跳过补拉',
            );
            return post;
        }

        try {
            const result =
                await weiboApiService.fetchLongText(mblogid);
            if (!result.ok || !result.text.trim()) {
                pluginState.logger.warn(
                    `微博长文补拉失败 ${mblogid}: ` +
                        (result.message || `HTTP ${result.status}`),
                );
                return post;
            }
            return withLongText(post, result.text);
        } catch (error) {
            pluginState.logger.warn(
                `微博长文补拉异常 ${mblogid}:`,
                error,
            );
            return post;
        }
    }
}

export const weiboLongTextService = new WeiboLongTextService();
