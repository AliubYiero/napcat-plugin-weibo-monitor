/**
 * 订阅与订阅上限的跨包契约
 *
 * 后端 services/weibo 产出, WebUI 直接消费。
 * 只描述视图与写入结果, 不包含 store 结构或 HTTP 细节。
 */

import type { SessionType } from './index';

/** 写入失败原因 */
export type WeiboWriteCode =
    | 'invalid'
    | 'duplicate'
    | 'limit_reached'
    | 'session_disabled'
    | 'login_required'
    | 'browser_unavailable'
    | 'not_found'
    | 'unlimited'
    | 'failed';

/** 写入请求里的推送目标 */
export interface WeiboSubscriptionTargetInput {
    type: SessionType;
    id: string;
}

/** 新增订阅请求 */
export interface AddWeiboSubscriptionRequest {
    uid: string;
    targets: WeiboSubscriptionTargetInput[];
}

/** 单个目标的写入结果 */
export interface WeiboSubscriptionTargetResult
    extends WeiboSubscriptionTargetInput {
    ok: boolean;
    code?: WeiboWriteCode;
    message: string;
}

/** 新增订阅结果 (一个博主 × 多个目标) */
export interface AddWeiboSubscriptionResult {
    uid: string;
    screenName: string;
    results: WeiboSubscriptionTargetResult[];
}

/** 订阅上限元数据 */
export interface WeiboLimitMeta {
    min: number;
    max: number;
    /** 按会话类型推导的默认上限 */
    defaults: Record<SessionType, number>;
}

/** 上限页的会话行 */
export interface WeiboLimitRow extends WeiboSubscriptionTargetInput {
    /** 当前已订阅博主数 */
    used: number;
    /** 显式覆盖值; 缺失表示跟随默认 */
    override?: number;
    /** 生效上限; null 表示无上限 */
    limit: number | null;
    /** 超级管理员私聊无上限 */
    unlimited: boolean;
    /** 会话功能是否启用 (与上限无关, 仅用于标注) */
    enabled: boolean;
}

/** 上限页数据 */
export interface WeiboLimitsView {
    meta: WeiboLimitMeta;
    sessions: WeiboLimitRow[];
}

/** 设置上限请求 */
export interface SetWeiboLimitRequest
    extends WeiboSubscriptionTargetInput {
    max: number;
}

/** 上限写入结果 */
export interface WeiboLimitResult
    extends WeiboSubscriptionTargetInput {
    ok: boolean;
    code?: WeiboWriteCode;
    message: string;
}
