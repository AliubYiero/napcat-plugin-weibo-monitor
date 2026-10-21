/**
 * 微博接口封装
 *
 * 只负责请求与响应解析; 失效 / 风控的处置由轮询与 Cookie 服务决定。
 */

import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { extractLongText } from '../../weibo/longText';
import type {
    WeiboLongTextResponse,
    WeiboMyMblogResponse,
    WeiboPost,
    WeiboProfileResponse,
    WeiboUser,
} from '../../weibo/types';
import { browserService } from '../browser/service';

export type WeiboApiFailure = 'invalid' | 'risk' | null;

export interface MyMblogResult {
    ok: boolean;
    posts: WeiboPost[];
    message: string;
    failure: WeiboApiFailure;
}

export interface ProfileResult {
    ok: boolean;
    user: WeiboUser | null;
    message: string;
    failure: WeiboApiFailure;
}

export interface LongTextResult {
    ok: boolean;
    text: string;
    message: string;
    status: number;
}

/** 从 mymblog 响应中取动态数组 */
export function extractPosts(body: unknown): WeiboPost[] {
    const response = body as WeiboMyMblogResponse | null;
    const list = response?.data?.list;
    return Array.isArray(list) ? list : [];
}

/** 从 profile/info 响应中取用户 */
export function extractUser(body: unknown): WeiboUser | null {
    const response = body as WeiboProfileResponse | null;
    const user = response?.data?.user;
    return user && typeof user === 'object' ? user : null;
}

/**
 * 判定失败类型。
 *
 * - HTTP 418 / 403: 风控
 * - `ok:0` 且提示登录: Cookie 失效
 * - 其它 `ok:0`: 风控退避
 */
export function classifyFailure(
    status: number,
    body: unknown,
): WeiboApiFailure {
    if (status === 418 || status === 403) return 'risk';

    const response = body as { ok?: number; message?: string } | null;
    if (response && response.ok === 0) {
        const message = String(response.message ?? '');
        if (/登录|login|未登录|请先登录/i.test(message)) {
            return 'invalid';
        }
        return 'risk';
    }

    if (status >= 400) return 'risk';
    return null;
}

class WeiboApiService {
    async fetchMyMblog(uid: string): Promise<MyMblogResult> {
        const result = await browserService.fetchApi(
            `/ajax/statuses/mymblog?uid=${encodeURIComponent(uid)}&page=1&feature=0`,
        );
        const posts = extractPosts(result.body);
        const response = result.body as WeiboMyMblogResponse | null;
        const ok = result.status < 400 && response?.ok === 1;
        const failure = ok
            ? null
            : classifyFailure(result.status, result.body);
        if (ok) WeiboCookieStore.getInstance().markSuccess();

        return {
            ok,
            posts,
            message: String(response?.message ?? ''),
            failure,
        };
    }

    /** 按 mblogid 补拉长文; 失败不参与 Cookie 失效/风控判定 */
    async fetchLongText(mblogid: string): Promise<LongTextResult> {
        const result = await browserService.fetchApi(
            `/ajax/statuses/longtext?id=${encodeURIComponent(mblogid)}`,
        );
        const response = result.body as WeiboLongTextResponse | null;
        const text = extractLongText(result.body);
        const ok =
            result.status < 400 &&
            response?.ok === 1 &&
            text.trim() !== '';
        if (ok) WeiboCookieStore.getInstance().markSuccess();

        const message = String(response?.message ?? '');
        const failureMessage =
            message ||
            (result.status >= 400
                ? `HTTP ${result.status}`
                : text.trim()
                  ? ''
                  : '空长文');
        return {
            ok,
            text,
            message: failureMessage,
            status: result.status,
        };
    }

    async fetchProfile(uid: string): Promise<ProfileResult> {
        const result = await browserService.fetchApi(
            `/ajax/profile/info?uid=${encodeURIComponent(uid)}`,
        );
        const user = extractUser(result.body);
        const response = result.body as WeiboProfileResponse | null;
        const ok =
            result.status < 400 &&
            response?.ok === 1 &&
            user !== null;
        const failure = ok
            ? null
            : classifyFailure(result.status, result.body);
        if (ok) WeiboCookieStore.getInstance().markSuccess();

        return {
            ok,
            user,
            message: String(response?.message ?? ''),
            failure,
        };
    }

    /**
     * 校验当前 Cookie 是否可用。
     * 有订阅时用第一个博主做一次真实请求; 无订阅时看首页登录态。
     */
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
