/**
 * 卡片渲染
 *
 * 渲染失败不让整轮推送失败: 调用方拿到 null 后改用文本消息。
 */

import { pluginState } from '../../core/state';
import { buildPostCardHtml } from '../../weibo/card';
import type { WeiboPost } from '../../weibo/types';
import { browserService } from '../browser/service';

class CardRenderService {
    /** 渲染为 QQ 可用的 `base64://` 图片; 失败返回 null */
    async render(post: WeiboPost): Promise<string | null> {
        try {
            const buffer = await browserService.renderHtml(
                buildPostCardHtml(post),
            );
            return `base64://${buffer.toString('base64')}`;
        } catch (error) {
            pluginState.logger.warn(
                '微博卡片渲染失败, 回退文本:',
                error,
            );
            return null;
        }
    }
}

export const cardRenderService = new CardRenderService();
