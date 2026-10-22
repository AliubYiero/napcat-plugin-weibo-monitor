/** WebUI 前端类型定义 */
import type { ApiResponse, PluginConfig } from 'shared';

export type {
    ApiResponse,
    Cmd,
    ContentHelp,
    ContentHelpMethod,
    Instruction,
    InstructionSet,
    PluginConfig,
    Role,
    SessionConfig,
    SessionConfigBase,
    SessionType,
} from 'shared';

export interface PluginStatus {
    pluginName: string;
    uptime: number;
    uptimeFormatted: string;
    config: PluginConfig;
    stats: {
        processed: number;
        todayProcessed: number;
        lastUpdateDay: string;
    };
    weibo: WeiboStatus;
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
    lastPollAt: number | null;
    nextPollAt: number | null;
    backoffUntil: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}

export interface WeiboCookieStatus {
    configured: boolean;
    /** Cookie 名列表 (值永不出后端) */
    names: string[];
    invalid: boolean;
    lastSuccessAt: number | null;
    lastValidatedAt: number | null;
    lastRefreshAt: number | null;
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

export interface WeiboSubscription {
    uid: string;
    screenName: string;
    /** 远程头像 URL (本地副本缺失时的回退) */
    avatar: string;
    /** 插件本地头像路径; 未缓存时为 null */
    avatarUrl: string | null;
    targets: Array<{
        type: 'group' | 'private';
        id: string;
        enabled: boolean;
    }>;
}

/** GET /weibo/subscriptions 的响应 (后台补拉头像时带 pendingAvatars) */
export type WeiboSubscriptionsResult = ApiResponse<
    WeiboSubscription[]
> & { pendingAvatars?: number };

export interface CookieActionResult {
    valid: boolean;
    message: string;
}

export interface WeiboInstallState {
    running: boolean;
    percent: number;
    message: string;
    error: string | null;
    path: string | null;
}

/**
 * 会话信息（群或好友），对应后端 GET /sessions 的归一化返回
 */
export interface SessionInfo {
    /** 群号或用户 QQ 号 */
    id: string;
    type: 'group' | 'private';
    /** 群名 / 好友备注（无备注时取昵称） */
    name: string;
    enabled: boolean;
    /** 仅群会话提供 */
    memberCount?: number;
    maxMemberCount?: number;
}
