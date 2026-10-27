/**
 * 共享类型定义
 * 插件后端（plugin）与 WebUI 前端（webui）共用的接口和类型。
 * 修改此文件后两端类型同步生效，无需手动维护两份定义。
 */

// 配置单一声明源 (字段描述符 + PluginConfig + 默认值/清洗派生)
export * from './config';
// 展示块占位符 (token 常量 + 解析纯函数)
export * from './displayTokens';
// 帮助面板类型 (与上游 napcat-help-generate 手工同步)
export * from './help';
// 会话能力的单一投影 (宿主会话 + 订阅 + 上限覆盖 + 超管名单)
export * from './sessionCapabilities';
// WebUI 骨架元信息 (页面清单 + PageId)
export * from './ui';
// WebUI 读写契约 (状态 / 会话 / 订阅 / 安装)
export * from './webui';
// 订阅与订阅上限的跨包契约
export * from './weibo';

// ==================== 会话级配置 ====================

/**
 * 会话类型：群聊或私聊，与消息事件的 message_type 同域
 */
export type SessionType = 'private' | 'group';

/**
 * 会话配置项必须携带的定位字段，业务字段由具体 store 的泛型补充。
 * 会话级配置不放在插件配置文件里，而是由 store 承载（见 docs/store-pattern.md）。
 */
export interface SessionConfigBase {
    /** 群号或用户 QQ 号 */
    id: string;
    /** 会话类型 */
    type: SessionType;
}

/**
 * 会话级配置
 *
 * 启用开关为宽松判定取反：默认关闭（严格 `enabled === true` 才启用），
 * 未记录或未写 `enabled` 一律视为禁用。
 */
export interface SessionConfig extends SessionConfigBase {
    /** 是否启用此会话的功能，默认关闭 */
    enabled?: boolean;

    /**
     * 本会话可订阅的微博博主数量上限。
     * 未写入时按默认值推导: 群聊 1, 私聊 0 (超管私聊不设上限)。
     */
    weiboLimit?: number;
}

// ==================== API 响应 ====================

/**
 * 统一 API 响应格式
 */
export interface ApiResponse<T = unknown> {
    /** 状态码，0 表示成功，-1 表示失败 */
    code: number;
    /** 错误信息（仅错误时返回） */
    message?: string;
    /** 响应数据（仅成功时返回） */
    data?: T;
}
