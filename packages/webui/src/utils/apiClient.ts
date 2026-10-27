/**
 * WebUI 类型化客户端
 *
 * 把端点字符串、HTTP 错误与 `code !== 0` 收敛成统一的 Result。
 * `transport` 是唯一适配器接缝: 生产用 `noAuthFetch`, 测试用 fake。
 */

import type {
    AddWeiboSubscriptionRequest,
    AddWeiboSubscriptionResult,
    ApiResponse,
    PluginStatus,
    SessionInfo,
    SessionType,
    SetWeiboLimitRequest,
    WeiboLimitResult,
    WeiboLimitsView,
    WeiboSubscriptionsView,
    WeiboSubscriptionTargetInput,
} from '../types';
import { readApiErrorMessage } from './apiError';

export type ApiResult<T> =
    | { ok: true; code: 0; message: string; data: T }
    | { ok: false; code: number; message: string };

export type ApiTransport = <T>(
    path: string,
    options?: RequestInit,
) => Promise<ApiResponse<T>>;

export interface WebuiApi {
    getStatus(): Promise<ApiResult<PluginStatus>>;
    listSessions(): Promise<ApiResult<SessionInfo[]>>;
    updateSession(
        target: WeiboSubscriptionTargetInput,
        enabled: boolean,
    ): Promise<ApiResult<null>>;
    updateSessions(
        type: SessionType,
        enabled: boolean,
        ids: string[],
    ): Promise<ApiResult<null>>;
    listSubscriptions(): Promise<ApiResult<WeiboSubscriptionsView>>;
    addSubscriptions(
        request: AddWeiboSubscriptionRequest,
    ): Promise<ApiResult<AddWeiboSubscriptionResult>>;
    removeSubscription(
        request: WeiboSubscriptionTargetInput & { uid: string },
    ): Promise<ApiResult<null>>;
    getLimits(): Promise<ApiResult<WeiboLimitsView>>;
    setLimit(
        request: SetWeiboLimitRequest,
    ): Promise<ApiResult<WeiboLimitResult>>;
    clearLimit(
        target: WeiboSubscriptionTargetInput,
    ): Promise<ApiResult<WeiboLimitResult>>;
}

export function createApiClient(transport: ApiTransport): WebuiApi {
    async function request<T>(
        path: string,
        options: RequestInit = {},
    ): Promise<ApiResult<T>> {
        try {
            const response = await transport<T>(path, options);
            if (response.code !== 0) {
                return {
                    ok: false,
                    code: response.code,
                    message: response.message || '请求失败',
                };
            }
            if (response.data === undefined) {
                return {
                    ok: false,
                    code: -1,
                    message: response.message || '响应缺少数据',
                };
            }
            return {
                ok: true,
                code: 0,
                message: response.message ?? '',
                data: response.data,
            };
        } catch (error) {
            return {
                ok: false,
                code: -1,
                message: readApiErrorMessage(error),
            };
        }
    }

    async function requestVoid(
        path: string,
        options: RequestInit = {},
    ): Promise<ApiResult<null>> {
        try {
            const response = await transport<unknown>(path, options);
            if (response.code !== 0) {
                return {
                    ok: false,
                    code: response.code,
                    message: response.message || '请求失败',
                };
            }
            return {
                ok: true,
                code: 0,
                message: response.message ?? '',
                data: null,
            };
        } catch (error) {
            return {
                ok: false,
                code: -1,
                message: readApiErrorMessage(error),
            };
        }
    }

    function postJson(body: unknown): RequestInit {
        return {
            method: 'POST',
            body: JSON.stringify(body),
        };
    }

    return {
        getStatus: () => request<PluginStatus>('/status'),
        listSessions: () => request<SessionInfo[]>('/sessions'),
        updateSession: (target, enabled) =>
            requestVoid(
                `/sessions/${target.type}/${encodeURIComponent(
                    target.id,
                )}/config`,
                postJson({ enabled }),
            ),
        updateSessions: (type, enabled, ids) =>
            requestVoid(
                '/sessions/bulk-config',
                postJson({ type, enabled, ids }),
            ),
        listSubscriptions: () =>
            request<WeiboSubscriptionsView>('/weibo/subscriptions'),
        addSubscriptions: (body) =>
            request<AddWeiboSubscriptionResult>(
                '/weibo/subscriptions/add',
                postJson(body),
            ),
        removeSubscription: (body) =>
            requestVoid(
                '/weibo/subscriptions/remove',
                postJson(body),
            ),
        getLimits: () => request<WeiboLimitsView>('/weibo/limits'),
        setLimit: (body) =>
            request<WeiboLimitResult>(
                '/weibo/limits',
                postJson(body),
            ),
        clearLimit: (target) =>
            request<WeiboLimitResult>(
                `/weibo/limits/${target.type}/${encodeURIComponent(
                    target.id,
                )}`,
                { method: 'DELETE' },
            ),
    };
}
