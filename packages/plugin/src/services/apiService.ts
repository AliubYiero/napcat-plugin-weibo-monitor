/**
 * API 服务模块
 * 注册 WebUI API 路由
 *
 * 路由类型说明：
 * ┌─────────────────┬──────────────────────────────────────────────┬─────────────────┐
 * │ 类型            │ 路径前缀                                      │ 注册方法        │
 * ├─────────────────┼──────────────────────────────────────────────┼─────────────────┤
 * │ 需要鉴权 API    │ /api/Plugin/ext/<plugin-id>/                 │ router.get/post │
 * │ 无需鉴权 API    │ /plugin/<plugin-id>/api/                     │ router.getNoAuth│
 * │ 静态文件        │ /plugin/<plugin-id>/files/<urlPath>/         │ router.static   │
 * │ 内存文件        │ /plugin/<plugin-id>/mem/<urlPath>/           │ router.staticOnMem│
 * │ 页面            │ /plugin/<plugin-id>/page/<path>             │ router.page     │
 * └─────────────────┴──────────────────────────────────────────────┴─────────────────┘
 *
 * 一般插件自带的 WebUI 页面使用 NoAuth 路由，因为页面本身已在 NapCat WebUI 内嵌展示。
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { pluginState } from '../core/state';
import { HELP_PANELS } from '../handlers/help/helpData.generated';
import { WeiboCookieStore } from '../store/WeiboCookieStore';
import { WeiboCursorStore } from '../store/WeiboCursorStore';
import { WeiboMonitorStore } from '../store/WeiboMonitorStore';
import type {
    PluginConfig,
    SessionType,
    WeiboSubscriptionTargetInput,
} from '../types';
import {
    getInstallState,
    runInstall,
} from './browser/chrome-installer';
import {
    detectBrowserFull,
    ensureBrowserStatus,
    getBrowserStatus,
    invalidateBrowserStatus,
} from './browser/status';
import { applyConfigSideEffects } from './configEffects';
import { sessionConfigService } from './sessionConfigService';
import { weiboAvatarService } from './weibo/avatarService';
import { weiboCookieService } from './weibo/cookieService';
import {
    MAX_LIMIT,
    MIN_LIMIT,
    weiboLimitService,
} from './weibo/limitService';
import { weiboMonitorService } from './weibo/monitorService';
import { weiboPollingService } from './weibo/pollingService';
import { weiboRuntime } from './weibo/runtimeStatus';

/** 会话类型守卫: 收窄外部输入, 供路由复用 */
function isSessionType(value: unknown): value is SessionType {
    return value === 'group' || value === 'private';
}

/**
 * 注册 API 路由
 */
export function registerApiRoutes(ctx: NapCatPluginContext): void {
    const router = ctx.router;

    // ==================== 插件信息（无鉴权）====================

    /** 获取插件状态 */
    router.getNoAuth('/status', (_req, res) => {
        res.json({
            code: 0,
            data: {
                pluginName: ctx.pluginName,
                uptime: pluginState.getUptime(),
                uptimeFormatted: pluginState.getUptimeFormatted(),
                config: pluginState.config,
                stats: pluginState.stats,
                weibo: buildWeiboStatus(),
            },
        });
    });

    // ==================== 配置管理（无鉴权）====================

    /** 获取配置 */
    router.getNoAuth('/config', (_req, res) => {
        res.json({ code: 0, data: pluginState.config });
    });

    /** 保存配置 */
    router.postNoAuth('/config', async (req, res) => {
        try {
            const body = req.body as
                | Record<string, unknown>
                | undefined;
            if (!body) {
                return res
                    .status(400)
                    .json({ code: -1, message: '请求体为空' });
            }
            // 【必须】WebUI 提交属于外部输入, 走 replaceConfig 统一清洗后再落盘
            const prev = pluginState.config;
            pluginState.replaceConfig({
                ...prev,
                ...body,
            } as PluginConfig);
            await applyConfigSideEffects(prev, pluginState.config);
            ctx.logger.info('配置已保存');
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('保存配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 会话管理（无鉴权）====================

    /** 获取会话列表（群 + 好友，附带各会话启用状态） */
    router.getNoAuth('/sessions', async (_req, res) => {
        try {
            const { groups, friends } =
                await fetchNapCatSessions(ctx);

            const groupSessions = groups.map((group) => {
                const id = String(group.group_id);
                return {
                    id,
                    type: 'group' as const,
                    name: group.group_name,
                    enabled: sessionConfigService.isSessionEnabled(
                        id,
                        'group',
                    ),
                    memberCount: group.member_count,
                    maxMemberCount: group.max_member_count,
                };
            });

            const friendSessions = friends.map((friend) => {
                const id = String(friend.user_id);
                return {
                    id,
                    type: 'private' as const,
                    name: friend.remark || friend.nickname,
                    enabled: sessionConfigService.isSessionEnabled(
                        id,
                        'private',
                    ),
                };
            });

            res.json({
                code: 0,
                data: [...groupSessions, ...friendSessions],
            });
        } catch (e) {
            ctx.logger.error('获取会话列表失败:', e);
            res.status(500).json({ code: -1, message: String(e) });
        }
    });

    /** 更新单个会话配置 */
    router.postNoAuth(
        '/sessions/:type/:id/config',
        async (req, res) => {
            try {
                const type = req.params?.type;
                const id = req.params?.id;
                if (!isSessionType(type)) {
                    return res.status(400).json({
                        code: -1,
                        message: '非法的会话类型',
                    });
                }
                if (!id) {
                    return res
                        .status(400)
                        .json({ code: -1, message: '缺少会话 ID' });
                }

                const body = req.body as
                    | Record<string, unknown>
                    | undefined;
                const enabled = Boolean(body?.enabled);
                sessionConfigService.setSessionEnabled(
                    id,
                    type,
                    enabled,
                );
                ctx.logger.info(
                    `会话 ${type}:${id} 配置已更新: enabled=${enabled}`,
                );
                res.json({ code: 0, message: 'ok' });
            } catch (err) {
                ctx.logger.error('更新会话配置失败:', err);
                res.status(500).json({
                    code: -1,
                    message: String(err),
                });
            }
        },
    );

    /** 批量更新会话配置 */
    router.postNoAuth('/sessions/bulk-config', async (req, res) => {
        try {
            const body = req.body as
                | Record<string, unknown>
                | undefined;
            const { type, enabled, ids } = body || {};

            if (!isSessionType(type)) {
                return res
                    .status(400)
                    .json({ code: -1, message: '非法的会话类型' });
            }
            if (typeof enabled !== 'boolean' || !Array.isArray(ids)) {
                return res
                    .status(400)
                    .json({ code: -1, message: '参数错误' });
            }

            sessionConfigService.setSessionsEnabled(
                ids.map(String),
                type,
                enabled,
            );

            ctx.logger.info(
                `批量更新会话配置完成 | type=${type}, 数量: ${ids.length}, enabled=${enabled}`,
            );
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('批量更新会话配置失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 帮助文档（无鉴权）====================

    /** 获取全部帮助面板 (未做权限过滤, 等同于超级管理员视图) */
    router.getNoAuth('/help', (_req, res) => {
        res.json({ code: 0, data: HELP_PANELS });
    });

    // ==================== 微博账号与订阅（无鉴权）====================

    /** 保存 Cookie 并校验; 成功后立即恢复轮询 */
    router.postNoAuth('/weibo/cookie', async (req, res) => {
        try {
            const body = req.body as { cookie?: unknown } | undefined;
            if (typeof body?.cookie !== 'string' || !body.cookie) {
                return res
                    .status(400)
                    .json({ code: -1, message: 'Cookie 不能为空' });
            }

            const result = await weiboCookieService.save(body.cookie);
            if (result.valid) {
                weiboPollingService.requestImmediate();
            }
            res.json({ code: 0, data: result });
        } catch (err) {
            ctx.logger.error('保存微博 Cookie 失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 校验当前 Cookie */
    router.postNoAuth('/weibo/cookie/validate', async (_req, res) => {
        try {
            const result = await weiboCookieService.validate();
            res.json({ code: 0, data: result });
        } catch (err) {
            ctx.logger.error('校验微博 Cookie 失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 立即执行一次完整保活, 成功后写回并补拉一轮 */
    router.postNoAuth(
        '/weibo/cookie/keepalive',
        async (_req, res) => {
            try {
                const result = await weiboCookieService.keepAlive({
                    manual: true,
                });
                if (result.valid) {
                    weiboPollingService.requestImmediate();
                }
                res.json({ code: 0, data: result });
            } catch (err) {
                ctx.logger.error('微博 Cookie 保活失败:', err);
                res.status(500).json({
                    code: -1,
                    message: String(err),
                });
            }
        },
    );

    /** 清除 Cookie */
    router.deleteNoAuth('/weibo/cookie', async (_req, res) => {
        try {
            await weiboCookieService.clear();
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('清除微博 Cookie 失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 全部订阅 (WebUI 只读列表) */
    router.getNoAuth('/weibo/subscriptions', (_req, res) => {
        const data = weiboMonitorService.all();
        // 历史数据与头像 URL 变更项在后台补拉; 前端据 pendingAvatars 再取一次
        let pendingAvatars = 0;
        for (const item of data) {
            if (!weiboAvatarService.needsRefresh(item.uid)) continue;
            pendingAvatars += 1;
            weiboAvatarService.triggerEnsure(item.uid, item.avatar);
        }

        res.json({ code: 0, data, pendingAvatars });
    });

    /** 本地头像副本 (无鉴权: WebUI 的 img 无法携带 Bearer) */
    router.getNoAuth('/weibo/avatar/:uid', (req, res) => {
        const uid = req.params?.uid ?? '';
        if (!/^\d{3,20}$/.test(uid)) {
            return res
                .status(400)
                .json({ code: -1, message: '非法的博主 UID' });
        }

        const file = weiboAvatarService.resolveFile(uid);
        if (!file) {
            return res
                .status(404)
                .json({ code: -1, message: '头像未缓存' });
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.sendFile(file);
    });

    /** 从指定会话移除订阅 */
    router.postNoAuth('/weibo/subscriptions/remove', (req, res) => {
        try {
            const body = req.body as
                | { uid?: unknown; type?: unknown; id?: unknown }
                | undefined;
            if (
                typeof body?.uid !== 'string' ||
                !isSessionType(body.type) ||
                typeof body.id !== 'string' ||
                !body.id
            ) {
                return res
                    .status(400)
                    .json({ code: -1, message: '参数错误' });
            }

            const removed = weiboMonitorService.remove(body.uid, {
                type: body.type,
                id: body.id,
            });
            if (!removed) {
                return res
                    .status(404)
                    .json({ code: -1, message: '订阅不存在' });
            }
            res.json({ code: 0, message: 'ok' });
        } catch (err) {
            ctx.logger.error('移除微博订阅失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 新增订阅 (可多目标; 逐目标结果, 成功项保留) */
    router.postNoAuth(
        '/weibo/subscriptions/add',
        async (req, res) => {
            try {
                const body = req.body as
                    | { uid?: unknown; targets?: unknown }
                    | undefined;
                if (
                    !body ||
                    typeof body.uid !== 'string' ||
                    !Array.isArray(body.targets)
                ) {
                    return res
                        .status(400)
                        .json({ code: -1, message: '参数错误' });
                }

                const targets: WeiboSubscriptionTargetInput[] = [];
                for (const raw of body.targets) {
                    if (!raw || typeof raw !== 'object') {
                        return res
                            .status(400)
                            .json({ code: -1, message: '参数错误' });
                    }
                    const item = raw as {
                        type?: unknown;
                        id?: unknown;
                    };
                    if (
                        !isSessionType(item.type) ||
                        typeof item.id !== 'string' ||
                        !item.id
                    ) {
                        return res
                            .status(400)
                            .json({ code: -1, message: '参数错误' });
                    }
                    targets.push({ type: item.type, id: item.id });
                }

                if (targets.length === 0) {
                    return res.status(400).json({
                        code: -1,
                        message: '请至少选择一个推送会话',
                    });
                }

                const outcome = await weiboMonitorService.addMany(
                    body.uid,
                    targets,
                );
                if (outcome.results.some((item) => item.ok)) {
                    weiboPollingService.requestImmediate();
                }

                res.json({
                    code: 0,
                    data: {
                        uid: outcome.uid,
                        screenName: outcome.screenName,
                        results: outcome.results,
                    },
                });
            } catch (err) {
                ctx.logger.error('新增微博订阅失败:', err);
                res.status(500).json({
                    code: -1,
                    message: String(err),
                });
            }
        },
    );

    /** 全部现有会话的订阅上限 */
    router.getNoAuth('/weibo/limits', async (_req, res) => {
        try {
            const { groups, friends } =
                await fetchNapCatSessions(ctx);
            const sessions = [
                ...groups.map((group) => {
                    const id = String(group.group_id);
                    return {
                        type: 'group' as const,
                        id,
                        enabled:
                            sessionConfigService.isSessionEnabled(
                                id,
                                'group',
                            ),
                    };
                }),
                ...friends.map((friend) => {
                    const id = String(friend.user_id);
                    return {
                        type: 'private' as const,
                        id,
                        enabled:
                            sessionConfigService.isSessionEnabled(
                                id,
                                'private',
                            ),
                    };
                }),
            ];
            res.json({
                code: 0,
                data: weiboLimitService.view(sessions),
            });
        } catch (err) {
            ctx.logger.error('读取会话订阅上限失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 设置某会话的订阅上限 */
    router.postNoAuth('/weibo/limits', (req, res) => {
        const body = req.body as
            | { type?: unknown; id?: unknown; max?: unknown }
            | undefined;
        if (
            !body ||
            !isSessionType(body.type) ||
            typeof body.id !== 'string' ||
            !body.id
        ) {
            return res
                .status(400)
                .json({ code: -1, message: '参数错误' });
        }
        if (
            typeof body.max !== 'number' ||
            !Number.isInteger(body.max) ||
            body.max < MIN_LIMIT ||
            body.max > MAX_LIMIT
        ) {
            return res.status(400).json({
                code: -1,
                message: `上限必须是 ${MIN_LIMIT}~${MAX_LIMIT} 的整数`,
            });
        }

        try {
            weiboLimitService.set(
                { type: body.type, id: body.id },
                body.max,
            );
            ctx.logger.info(
                `WebUI 设置订阅上限: ${body.type}:${body.id}=${body.max}`,
            );
            res.json({
                code: 0,
                data: {
                    type: body.type,
                    id: body.id,
                    ok: true,
                    message: '已更新上限',
                },
            });
        } catch (err) {
            res.status(400).json({
                code: -1,
                message:
                    err instanceof Error ? err.message : String(err),
            });
        }
    });

    /** 恢复某会话的默认订阅上限 */
    router.deleteNoAuth('/weibo/limits/:type/:id', (req, res) => {
        const type = req.params?.type;
        const id = req.params?.id;
        if (!isSessionType(type) || !id) {
            return res
                .status(400)
                .json({ code: -1, message: '参数错误' });
        }

        try {
            weiboLimitService.clear({ type, id });
            ctx.logger.info(`WebUI 恢复默认订阅上限: ${type}:${id}`);
            res.json({
                code: 0,
                data: {
                    type,
                    id,
                    ok: true,
                    message: '已恢复默认上限',
                },
            });
        } catch (err) {
            ctx.logger.error('恢复默认订阅上限失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    // ==================== 浏览器（无鉴权）====================

    /** 只读缓存, 零副作用 (WebUI 每 5 秒轮询) */
    router.getNoAuth('/chrome/status', (_req, res) => {
        res.json({ code: 0, data: ensureBrowserStatus() });
    });

    /** 完整检测 (会启动一次浏览器) */
    router.postNoAuth('/chrome/detect', async (_req, res) => {
        try {
            const status = await detectBrowserFull();
            res.json({ code: 0, data: status });
        } catch (err) {
            ctx.logger.error('浏览器检测失败:', err);
            res.status(500).json({ code: -1, message: String(err) });
        }
    });

    /** 后台安装浏览器 */
    router.postNoAuth('/chrome/install', (_req, res) => {
        if (getInstallState().running) {
            return res
                .status(409)
                .json({ code: -1, message: '安装已在进行中' });
        }

        void runInstall()
            .then(() => {
                invalidateBrowserStatus();
                ensureBrowserStatus();
                ctx.logger.info('Chrome 安装完成');
            })
            .catch((err) => {
                ctx.logger.error('Chrome 安装失败:', err);
            });

        res.json({ code: 0, message: '安装已开始' });
    });

    /** 安装进度 */
    router.getNoAuth('/chrome/install/progress', (_req, res) => {
        res.json({ code: 0, data: getInstallState() });
    });

    ctx.logger.debug('API 路由注册完成');
}

interface NapCatGroupInfo {
    group_id: number;
    group_name: string;
    member_count: number;
    max_member_count: number;
}

interface NapCatFriendInfo {
    user_id: number;
    nickname: string;
    remark?: string;
}

/** 拉取宿主的群/好友列表 (会话页与上限页共用) */
async function fetchNapCatSessions(
    ctx: NapCatPluginContext,
): Promise<{
    groups: NapCatGroupInfo[];
    friends: NapCatFriendInfo[];
}> {
    const [groups, friends] = await Promise.all([
        ctx.actions.call(
            'get_group_list',
            {},
            ctx.adapterName,
            ctx.pluginManager.config,
        ) as Promise<NapCatGroupInfo[]>,
        ctx.actions.call(
            'get_friend_list',
            {},
            ctx.adapterName,
            ctx.pluginManager.config,
        ) as Promise<NapCatFriendInfo[]>,
    ]);
    return { groups: groups || [], friends: friends || [] };
}

function buildWeiboStatus(): Record<string, unknown> {
    const monitors = WeiboMonitorStore.getInstance().list();
    const cookie = WeiboCookieStore.getInstance().getData();
    const cursorStore = WeiboCursorStore.getInstance();

    return {
        polling: weiboPollingService.getStatus(),
        cookie: {
            configured: cookie.cookies.length > 0,
            names: cookie.cookies.map((item) => item.name),
            invalid: cookie.invalid,
            invalidSince: cookie.invalidSince,
            lastSuccessAt: cookie.lastSuccessAt,
            lastValidatedAt: cookie.lastValidatedAt,
            lastRefreshAt: cookie.lastRefreshAt,
            lastKeepAliveAt: cookie.lastKeepAliveAt,
            lastProbeAt: cookie.lastProbeAt,
            lastProbeResult: cookie.lastProbeResult,
            lastProbeMessage: cookie.lastProbeMessage,
            invalidNotifiedAt: cookie.invalidNotifiedAt,
            keepAliveFailureCount: cookie.keepAliveFailureCount,
            keepAliveInconclusiveCount:
                cookie.keepAliveInconclusiveCount,
            runtimeAlertedAt: cookie.runtimeAlertedAt,
        },
        browser: getBrowserStatus(),
        subscriptions: monitors.length,
        targets: monitors.map((monitor) => {
            const runtime = weiboRuntime.getTarget(monitor.uid);
            return {
                uid: monitor.uid,
                screenName: monitor.screenName,
                subscribers: monitor.to.length,
                watermark:
                    cursorStore.get(monitor.uid)?.watermark ?? null,
                lastError: runtime.lastError,
                lastPushedAt: runtime.lastPushedAt,
            };
        }),
    };
}
