import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import type {
    LongTextResult,
    MyMblogResult,
    ProfileResult,
    WeiboApiFailure,
} from '../../weibo/reader';
import { browserService } from '../browser/service';
import { weiboReader } from './readerService';

export type {
    LongTextResult,
    MyMblogResult,
    ProfileResult,
    WeiboApiFailure,
} from '../../weibo/reader';
export {
    classifyFailure,
    extractPosts,
    extractUser,
} from '../../weibo/reader';

class WeiboApiService {
    async fetchMyMblog(uid: string): Promise<MyMblogResult> {
        const result = await weiboReader.fetchFirstPage(uid);
        if (result.ok) WeiboCookieStore.getInstance().markSuccess();
        return result;
    }

    async fetchLongText(mblogid: string): Promise<LongTextResult> {
        const result = await weiboReader.fetchLongText(mblogid);
        if (result.ok) WeiboCookieStore.getInstance().markSuccess();
        return result;
    }

    async fetchProfile(uid: string): Promise<ProfileResult> {
        const result = await weiboReader.fetchProfile(uid);
        if (result.ok) WeiboCookieStore.getInstance().markSuccess();
        return result;
    }

    async validateCookie(uid?: string): Promise<{
        valid: boolean;
        message: string;
        failure: WeiboApiFailure;
    }> {
        if (!browserService.isReady()) {
            return {
                valid: false,
                message: 'Cookie 或浏览器未就绪',
                failure: null,
            };
        }

        if (uid) {
            const result = await this.fetchMyMblog(uid);
            if (result.ok) {
                return {
                    valid: true,
                    message: 'Cookie 可用',
                    failure: null,
                };
            }
            return {
                valid: false,
                message: result.message || '微博接口暂不可用',
                failure: result.failure,
            };
        }

        const logged = await browserService.withPage(async (page) => {
            return page.evaluate(() => {
                const config = (
                    window as unknown as {
                        $CONFIG?: { uid?: string | number };
                    }
                ).$CONFIG;
                const uid = config?.uid ? String(config.uid) : '';
                return uid !== '' && uid !== '0';
            });
        });

        return logged
            ? { valid: true, message: 'Cookie 可用', failure: null }
            : {
                  valid: false,
                  message: '未能识别登录态',
                  failure: 'invalid',
              };
    }
}

export const weiboApiService = new WeiboApiService();
