/**
 * 微博监听领域类型
 *
 * 仅描述持久化与解析所需的最小字段集。微博接口返回的字段远多于此,
 * 未使用的部分不建模, 避免把上游细节扩散到业务层。
 */

import type { SessionType } from '../types';

/** 订阅目标 (某个已启用会话) */
export interface WeiboMonitorTarget {
    type: SessionType;
    id: string;
}

/** 一个博主及其订阅目标 (数据文件 `weibo-monitors.json`) */
export interface WeiboMonitor {
    /** 博主 UID (纯数字字符串) */
    uid: string;
    /** 博主昵称 */
    screenName: string;
    /** 头像 URL */
    avatar: string;
    /** 订阅该博主的会话 */
    to: WeiboMonitorTarget[];
}

/** 动态水位线 (数据文件 `weibo-cursor.json`) */
export interface WeiboCursor {
    /** 最新一条已计入的动态 id */
    watermark: string;
    /** 最近一次成功轮询中看到的动态 id, 用于水位线不在首页时兜底 */
    recentIds: string[];
    /** 最后更新时间 (毫秒时间戳) */
    updatedAt: number;
}

/** 微博用户 (profile / 动态作者) */
export interface WeiboUser {
    id?: number | string;
    idstr?: string;
    screen_name?: string;
    avatar_large?: string;
    avatar_hd?: string;
    profile_image_url?: string;
    [key: string]: unknown;
}

/** 图片信息 */
export interface WeiboPicInfo {
    large?: { url?: string };
    bmiddle?: { url?: string };
    thumbnail?: { url?: string };
    [key: string]: unknown;
}

/** 视频/文章等页面信息 */
export interface WeiboPageInfo {
    type?: string;
    title?: string;
    content1?: string;
    page_url?: string;
    page_pic?: string | { url?: string };
    media_info?: {
        stream_url?: string;
        stream_url_hd?: string;
        mp4_720p_mp4?: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** 一条微博动态 (只建模卡片需要的字段) */
export interface WeiboPost {
    id?: number | string;
    idstr?: string;
    mid?: string;
    mblogid?: string;
    mblogtype?: number;
    isTop?: number | boolean;
    isAd?: boolean;
    created_at?: string;
    source?: string;
    region_name?: string;
    text?: string;
    text_raw?: string;
    pic_ids?: string[];
    pic_infos?: Record<string, WeiboPicInfo>;
    page_info?: WeiboPageInfo;
    user?: WeiboUser;
    retweeted_status?: WeiboPost | null;
    retweeted_status_id?: string;
    [key: string]: unknown;
}

/** mymblog 接口响应 */
export interface WeiboMyMblogResponse {
    ok?: number;
    message?: string;
    data?: {
        list?: WeiboPost[];
        since_id?: string;
        total?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** profile/info 接口响应 */
export interface WeiboProfileResponse {
    ok?: number;
    message?: string;
    data?: {
        user?: WeiboUser;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** Cookie 持久化 (数据文件 `weibo-cookie.json`) */
export interface WeiboCookieData {
    /** Playwright storageState 的 cookies (origins 不参与微博接口) */
    cookies: StoredCookie[];
    /** 最后一次保存/刷新时间 */
    lastRefreshAt: number | null;
    /** 最后一次接口调用成功时间 */
    lastSuccessAt: number | null;
    /** 最后一次校验时间 */
    lastValidatedAt: number | null;
    /** 是否被判定为失效 */
    invalid: boolean;
    /** 最后一次失效告警时间 (24 小时冷却) */
    invalidNotifiedAt: number | null;
}

/** 序列化后的 cookie (与 Playwright Cookie 同形) */
export interface StoredCookie {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite?: 'Strict' | 'Lax' | 'None';
}

/** 单博主运行时状态 (供状态页展示) */
export interface WeiboTargetStatus {
    uid: string;
    screenName: string;
    lastError: string | null;
    lastPushedAt: number | null;
    watermark: string | null;
}

/**
 * 轮询状态 (当前处境的唯一答案)
 *
 * 由事实纯函数派生, 优先级固定; 状态不是错误记录, 错误另见 `lastError`。
 */
export type PollingState =
    | 'stopped'
    | 'unconfigured'
    | 'invalid'
    | 'backoff'
    | 'idle'
    | 'error'
    | 'running';

/** 轮询运行时状态 */
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

/** Cookie 运行时状态 (不返回 cookie 值) */
export interface WeiboCookieStatus {
    configured: boolean;
    invalid: boolean;
    lastSuccessAt: number | null;
    lastValidatedAt: number | null;
    lastRefreshAt: number | null;
}

/** 浏览器状态 */
export interface BrowserStatus {
    available: boolean;
    source: 'configured' | 'shared' | 'system' | 'none';
    executablePath: string | null;
    version: string | null;
    installed: boolean;
    error: string | null;
}

/** 安装进度 */
export interface InstallState {
    running: boolean;
    percent: number;
    message: string;
    error: string | null;
}

/** API 安全返回的订阅视图 */
export interface WeiboSubscriptionView {
    uid: string;
    screenName: string;
    avatar: string;
    targets: WeiboMonitorTarget[];
}
