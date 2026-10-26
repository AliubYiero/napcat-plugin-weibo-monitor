import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import {
    type LoginProbeSession,
    probeLoginState,
} from '../../weibo/loginProbe';
import type {
    LongTextResult,
    MyMblogResult,
    ProfileResult,
    StatusResult,
    WeiboApiFailure,
} from '../../weibo/reader';
import { browserService } from '../browser/service';
import { weiboReader } from './readerService';

export type {
    LongTextResult,
    MyMblogResult,
    ProfileResult,
    StatusResult,
    WeiboApiFailure,
    WeiboStatusFailure,
} from '../../weibo/reader';
export {
    classifyFailure,
    classifyStatusFailure,
    extractPosts,
    extractStatus,
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

    async fetchStatus(id: string): Promise<StatusResult> {
        const result = await weiboReader.fetchStatus(id);
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

        return validateCookieWithSession(browserService, uid);
    }
}

export const weiboApiService = new WeiboApiService();

/**
 * 用指定会话校验 Cookie。
 *
 * 生产校验传 `browserService`, 保存候选 Cookie 时传临时会话;
 * 本函数不写 Cookie 健康状态, 成功与否由调用方决定。
 */
export async function validateCookieWithSession(
    session: LoginProbeSession,
    uid?: string,
): Promise<{
    valid: boolean;
    message: string;
    failure: WeiboApiFailure;
}> {
    const outcome = await probeLoginState(session, uid);
    return {
        valid: outcome.result === 'valid',
        message: outcome.message,
        failure:
            outcome.result === 'invalid'
                ? 'invalid'
                : outcome.result === 'inconclusive'
                  ? 'risk'
                  : null,
    };
}
