/**
 * WebUI 前端类型
 *
 * 跨进程契约统一来自 shared; 此处只做重导出, 避免与后端各写一份。
 */

export type {
    AddWeiboSubscriptionRequest,
    AddWeiboSubscriptionResult,
    ApiResponse,
    Cmd,
    ContentHelp,
    ContentHelpMethod,
    CookieActionResult,
    Instruction,
    InstructionSet,
    LoginProbeResult,
    PluginConfig,
    PluginStats,
    PluginStatus,
    PollingState,
    Role,
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
