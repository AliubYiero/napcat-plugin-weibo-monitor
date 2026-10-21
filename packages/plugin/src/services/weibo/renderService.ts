import type { WeiboPost } from '../../weibo/types';
import { weiboReader } from './readerService';

class CardRenderService {
    async render(post: WeiboPost): Promise<string | null> {
        const result = await weiboReader.renderCard(post);
        if (!result.ok || !result.buffer) return null;
        return `base64://${result.buffer.toString('base64')}`;
    }
}

export const cardRenderService = new CardRenderService();
