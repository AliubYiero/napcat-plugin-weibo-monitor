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
import type { PluginConfig, SessionType } from '../types';
import { sessionConfigService } from './sessionConfigService';
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
import { WeiboCookieStore } from '../store/WeiboCookieStore';
import { WeiboCursorStore } from '../store/WeiboCursorStore';
import { WeiboMonitorStore } from '../store/WeiboMonitorStore';
import { weiboCookieService } from './weibo/cookieService';
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
            pluginState.replaceConfig({
                ...pluginState.config,
                ...body,
            } as PluginConfig);
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
            const [groups, friends] = await Promise.all([
                ctx.actions.call(
                    'get_group_list',
                    {},
                    ctx.adapterName,
                    ctx.pluginManager.config,
                ) as Promise<
                    Array<{
                        group_id: number;
                        group_name: string;
                        member_count: number;
                        max_member_count: number;
                    }>
                >,
                ctx.actions.call(
                    'get_friend_list',
                    {},
                    ctx.adapterName,
                    ctx.pluginManager.config,
                ) as Promise<
                    Array<{
                        user_id: number;
                        nickname: string;
                        remark?: string;
                    }>
                >,
            ]);

            const groupSessions = (groups || []).map((group) => {
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

            const friendSessions = (friends || []).map((friend) => {
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
            const body = req.body as
                | { cookie?: unknown }
                | undefined;
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
        res.json({ code: 0, data: weiboMonitorService.all() });
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

function buildWeiboStatus(): Record<string, unknown> {
    const monitors = WeiboMonitorStore.getInstance().list();
    const cookie = WeiboCookieStore.getInstance().getData();
    const cursorStore = WeiboCursorStore.getInstance();

    return {
        polling: weiboPollingService.getStatus(),
        cookie: {
            configured: cookie.cookies.length > 0,
            invalid: cookie.invalid,
            lastSuccessAt: cookie.lastSuccessAt,
            lastValidatedAt: cookie.lastValidatedAt,
            lastRefreshAt: cookie.lastRefreshAt,
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
