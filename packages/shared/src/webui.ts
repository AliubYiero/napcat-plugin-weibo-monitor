/**
 * WebUI 读写契约
 *
 * 插件后端产出、WebUI 直接消费的视图类型。只描述跨进程可见的字段,
 * 不包含 store 结构或 HTTP 细节。
 */

import type { PluginConfig } from './config';
import type { SessionType } from './index';
import type { WeiboSubscriptionTargetInput } from './weibo';

/** 会话信息 (群或好友), 对应 GET /sessions */
export interface SessionInfo {
    /** 群号或用户 QQ 号 */
    id: string;
    type: SessionType;
    /** 群名 / 好友备注 (无备注时取昵称) */
    name: string;
    enabled: boolean;
    /** 仅群会话提供 */
    memberCount?: number;
    maxMemberCount?: number;
}

/** 订阅视图里的推送目标 */
export interface WeiboSubscriptionTarget
    extends WeiboSubscriptionTargetInput {
    /** 会话功能是否启用 (与订阅是否存在无关) */
    enabled: boolean;
}

/** GET /weibo/subscriptions 的单条订阅 */
export interface WeiboSubscription {
    uid: string;
    screenName: string;
    /** 远程头像 URL (本地副本缺失时的回退) */
    avatar: string;
    /** 插件本地头像路径; 未缓存时为 null */
    avatarUrl: string | null;
    targets: WeiboSubscriptionTarget[];
}

/** GET /weibo/subscriptions 的 data */
export interface WeiboSubscriptionsView {
    subscriptions: WeiboSubscription[];
    /** 后端正在补拉头像的数量 */
    pendingAvatars: number;
}

/** 轮询状态 (与后端派生枚举一一对应) */
export type PollingState =
    | 'stopped'
    | 'unconfigured'
    | 'invalid'
    | 'backoff'
    | 'idle'
    | 'error'
    | 'running';

export interface WeiboPollingStatus {
    state: PollingState;
    running: boolean;
    intervalMinutes: number;
    /** 排期口径文案, 如「每小时整点」「每 10 分钟整分」「固定间隔 7 分钟」 */
    scheduleLabel: string;
    lastPollAt: number | null;
    nextPollAt: number | null;
    backoffUntil: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}

export type LoginProbeResult = 'valid' | 'invalid' | 'inconclusive';

export interface WeiboCookieStatus {
    configured: boolean;
    /** Cookie 名列表 (值永不出后端) */
    names: string[];
    invalid: boolean;
    invalidSince: number | null;
    lastSuccessAt: number | null;
    lastValidatedAt: number | null;
    lastRefreshAt: number | null;
    lastKeepAliveAt: number | null;
    lastProbeAt: number | null;
    lastProbeResult: LoginProbeResult | null;
    lastProbeMessage: string | null;
    invalidNotifiedAt: number | null;
    keepAliveFailureCount: number;
    keepAliveInconclusiveCount: number;
    runtimeAlertedAt: number | null;
}

export interface WeiboBrowserStatus {
    available: boolean;
    source: 'configured' | 'shared' | 'system' | 'none';
    executablePath: string | null;
    version: string | null;
    installed: boolean;
    error: string | null;
}

export interface WeiboTargetStatus {
    uid: string;
    screenName: string;
    subscribers: number;
    watermark: string | null;
    lastError: string | null;
    lastPushedAt: number | null;
}

export interface WeiboStatus {
    polling: WeiboPollingStatus;
    cookie: WeiboCookieStatus;
    browser: WeiboBrowserStatus;
    subscriptions: number;
    targets: WeiboTargetStatus[];
}

export interface PluginStats {
    processed: number;
    todayProcessed: number;
    lastUpdateDay: string;
}

/** GET /status 的 data */
export interface PluginStatus {
    pluginName: string;
    uptime: number;
    uptimeFormatted: string;
    config: PluginConfig;
    stats: PluginStats;
    weibo: WeiboStatus;
}

/** Chrome 安装进度 */
export interface WeiboInstallState {
    running: boolean;
    percent: number;
    message: string;
    error: string | null;
    path: string | null;
}

/** Cookie 写入/校验结果 */
export interface CookieActionResult {
    valid: boolean;
    message: string;
}
