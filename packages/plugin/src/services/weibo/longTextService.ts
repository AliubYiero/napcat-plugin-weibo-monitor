import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import type { WeiboPost } from '../../weibo/types';
import { weiboReader } from './readerService';

class WeiboLongTextService {
    async hydrate(post: WeiboPost): Promise<WeiboPost> {
        const hydrated = await weiboReader.hydrate(post);
        if (hydrated !== post) {
            WeiboCookieStore.getInstance().markSuccess();
        }
        return hydrated;
    }
}

export const weiboLongTextService = new WeiboLongTextService();
