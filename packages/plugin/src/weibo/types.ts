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
    /** 头像远程 URL (回退展示与变更检测的来源) */
    avatar: string;
    /** 本地头像副本文件名 (`data/avatar/` 下), 未缓存时缺失 */
    avatarPath?: string;
    /** 本地副本对应的远程 URL, 与 `avatar` 不同即需要重新下载 */
    avatarSource?: string;
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
    /**
     * 暂停标记: 该 uid 的全部推送目标都被禁用时为 true。
     * 重新启用后的首轮只重建水位线、不推送, 随后清除。
     */
    paused?: boolean;
}

/** 浏览器页面内一次接口请求的原始结果 */
export interface ApiFetchResult {
    status: number;
    body: unknown;
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
    pic_id?: string;
    [key: string]: unknown;
}

/** 混合媒体项 (图片可能只在这里携带地址) */
export interface WeiboMixMediaItem {
    type?: string;
    id?: string;
    data?: WeiboPicInfo;
    [key: string]: unknown;
}

/** 混合媒体列表 */
export interface WeiboMixMediaInfo {
    items?: WeiboMixMediaItem[];
    [key: string]: unknown;
}

/** 视频/文章等页面信息 */
export interface WeiboPageInfo {
    type?: string | number;
    object_type?: string | number;
    title?: string;
    content1?: string;
    content2?: string;
    page_title?: string;
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
    isLongText?: boolean | number;
    isTop?: number | boolean;
    isAd?: boolean;
    created_at?: string;
    source?: string;
    region_name?: string;
    text?: string;
    text_raw?: string;
    pic_ids?: string[];
    pic_infos?: Record<string, WeiboPicInfo>;
    mix_media_info?: WeiboMixMediaInfo;
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

/** statuses/show 接口响应 (动态对象在顶层) */
export interface WeiboStatusResponse extends WeiboPost {
    ok?: number;
    message?: string;
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

/** longtext 接口响应 */
export interface WeiboLongTextResponse {
    ok?: number;
    message?: string;
    data?: {
        longTextContent?: string;
        longTextContent_raw?: string;
        isMarkdown?: boolean;
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
    /** 排期口径文案, 如「每小时整点」「每 10 分钟整分」「固定间隔 7 分钟」 */
    scheduleLabel: string;
    lastPollAt: number | null;
    nextPollAt: number | null;
    backoffUntil: number | null;
    lastError: string | null;
    lastErrorAt: number | null;
}

/** Cookie 运行时状态 (不返回 cookie 值, 仅返回名称供掩码展示) */
export interface WeiboCookieStatus {
    configured: boolean;
    /** Cookie 名列表 (值永不出后端) */
    names: string[];
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
    /** 本地读图路由; 未缓存时为 null, 前端回退 `avatar` */
    avatarUrl: string | null;
    targets: Array<WeiboMonitorTarget & { enabled: boolean }>;
}
