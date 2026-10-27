/**
 * 插件类型定义
 *
 * 注意：OneBot 相关类型（OB11Message, OB11PostSendMsg 等）
 * 以及插件框架类型（NapCatPluginContext, PluginModule 等）
 * 均来自 napcat-types 包，无需在此重复定义。
 *
 * 与 WebUI 共用的类型（PluginConfig, SessionConfig, ApiResponse）
 * 统一定义在 shared 包，此处仅重导出。
 */
export type {
    AddWeiboSubscriptionRequest,
    AddWeiboSubscriptionResult,
    ApiResponse,
    CookieActionResult,
    LoginProbeResult,
    PluginConfig,
    PluginStats,
    PluginStatus,
    PollingState,
    SessionConfig,
    SessionConfigBase,
    SessionInfo,
    SessionType,
    SetWeiboLimitRequest,
    WeiboBrowserStatus,
    WeiboCookieStatus,
    WeiboInstallState,
    WeiboLimitMeta,
    WeiboLimitResult,
    WeiboLimitRow,
    WeiboLimitsView,
    WeiboPollingStatus,
    WeiboStatus,
    WeiboSubscription,
    WeiboSubscriptionsView,
    WeiboSubscriptionTarget,
    WeiboSubscriptionTargetInput,
    WeiboSubscriptionTargetResult,
    WeiboTargetStatus,
    WeiboWriteCode,
} from 'shared';
