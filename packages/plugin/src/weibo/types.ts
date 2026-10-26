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

/** 已见动态缓存 (数据文件 `weibo-cursor.json`) */
export interface WeiboCursor {
    /**
     * 最新一条已计入的动态 id, 仅用于状态页展示。
     * 去重判定只认 `seenIds`, 不再把水位线作为游标锚点。
     */
    watermark: string;
    /** 已见动态去重键 (点赞使用「原微博 id + 点赞日期」), 最多 100 个 */
    seenIds: string[];
    /** 是否已完成首轮基线; false 时只播种、不推送 */
    initialized: boolean;
    /** 最后更新时间 (毫秒时间戳) */
    updatedAt: number;
    /**
     * 暂停标记: 该 uid 的全部推送目标都被禁用时为 true。
     * 重新启用后的首轮只重建已见缓存、不推送, 随后清除。
     */
    paused?: boolean;
}

/** 动态的展示分类 (原创 / 转发 / 点赞 / 生日) */
export type WeiboPostKind =
    | 'original'
    | 'repost'
    | 'like'
    | 'birthday';

/** 渲染时需要的分类上下文 */
export interface WeiboPostRenderContext {
    kind: WeiboPostKind;
    /** 点赞日期 `YYYY-MM-DD`; 仅点赞条目使用 */
    likeDay?: string | null;
    /** 首次拉到该条目的轮询时间 (毫秒), 用于同日点赞补时分秒 */
    fetchedAt?: number;
}

/** 推送外层身份 (点赞事件使用订阅博主, 而不是原动态作者) */
export interface WeiboPostIdentity {
    screenName: string;
    avatar: string;
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
    page_desc?: string;
    page_url?: string;
    page_pic?: string | { url?: string };
    /** 播放量成品文案, 如「3万次播放」 */
    play_count?: string | number;
    /** 生日/活动等卡片信息 (生日动态的封面在这里) */
    card_info?: {
        pic_url?: string;
        page_info?: {
            pic_info?: {
                pic_big?: { url?: string };
            };
        };
        [key: string]: unknown;
    };
    media_info?: {
        stream_url?: string;
        stream_url_hd?: string;
        mp4_720p_mp4?: string;
        /** 视频时长 (秒, 可能为浮点) */
        duration?: number | string;
        /** 桌面接口的播放量成品文案, 如「502次观看」 */
        online_users?: string | number;
        /** 桌面接口的播放量数值 */
        online_users_number?: number | string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** 动态标题 (点赞插入条目在这里标记「赞过的微博」) */
export interface WeiboPostTitle {
    text?: string;
    structs?: unknown[];
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
    isAd?: boolean | number | string;
    created_at?: string;
    source?: string;
    region_name?: string;
    text?: string;
    text_raw?: string;
    title?: WeiboPostTitle | string;
    /** 点赞插入条目的来源标记, 形如 profile_insert_type:like_status */
    analysis_extra?: string;
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
