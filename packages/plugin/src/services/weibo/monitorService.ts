/**
 * 订阅业务
 *
 * 指令层与 WebUI 只负责取参与反馈; UID 校验、上限、去重、资料刷新、游标播种
 * 都在这里。WebUI 的批量新增复用同一套规则, 逐目标给出结果。
 */

import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { WeiboCursorStore } from '../../store/WeiboCursorStore';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import type {
    WeiboSubscriptionTargetInput,
    WeiboSubscriptionTargetResult,
    WeiboWriteCode,
} from '../../types';
import {
    filterQualifiedPosts,
    getPostId,
} from '../../weibo/predicate';
import type {
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
    WeiboSubscriptionView,
} from '../../weibo/types';
import { browserService } from '../browser/service';
import { sessionConfigService } from '../sessionConfigService';
import { weiboApiService } from './apiService';
import { weiboAvatarService } from './avatarService';
import { weiboPushService } from './pushService';
import { weiboRuntime } from './runtimeStatus';

export const DEFAULT_GROUP_LIMIT = 1;
export const DEFAULT_PRIVATE_LIMIT = 0;

export interface AddResult {
    monitor: WeiboMonitor;
    seeded: boolean;
}

/** 无法完成新增的目标级原因 */
interface TargetFailure {
    code: WeiboWriteCode;
    message: string;
}

/** 批量新增结果 (seeded 供指令层保留既有返回语义) */
export interface AddManyResult {
    uid: string;
    screenName: string;
    results: WeiboSubscriptionTargetResult[];
    seeded: boolean;
}

type PrepareResult =
    | {
          ok: true;
          screenName: string;
          avatar: string;
          seeded: boolean;
      }
    | { ok: false; failure: TargetFailure };

class WeiboMonitorService {
    private get store(): WeiboMonitorStore {
        return WeiboMonitorStore.getInstance();
    }

    /** 订阅一个博主并为其播种水位线 (不补发历史) */
    async add(
        rawUid: string,
        target: WeiboMonitorTarget,
    ): Promise<AddResult> {
        const outcome = await this.addMany(rawUid, [target]);
        const result = outcome.results[0];
        if (!result?.ok) {
            throw new Error(result?.message ?? '订阅失败');
        }

        const uid = normalizeUid(rawUid);
        const monitor = uid ? this.store.get(uid) : undefined;
        if (!monitor) throw new Error('订阅写入失败');
        return { monitor, seeded: outcome.seeded };
    }

    /**
     * 把一个博主新增到多个推送目标。
     *
     * 资料与动态只拉取一次; 每个目标独立返回结果, 成功项保留, 失败项不阻断其他目标。
     * 预检顺序: UID → Cookie/浏览器 → 会话启用/重复/上限 → 拉取资料与动态。
     */
    async addMany(
        rawUid: string,
        rawTargets: WeiboSubscriptionTargetInput[],
    ): Promise<AddManyResult> {
        const uid = normalizeUid(rawUid);
        const targets = dedupeTargets(rawTargets);
        const results = new Map<string, WeiboSubscriptionTargetResult>();

        const fail = (
            target: WeiboSubscriptionTargetInput,
            failure: TargetFailure,
        ): void => {
            results.set(targetKey(target), {
                type: target.type,
                id: target.id,
                ok: false,
                ...failure,
            });
        };

        const failAll = (failure: TargetFailure): void => {
            for (const target of targets) fail(target, failure);
        };

        if (!uid) {
            failAll({
                code: 'invalid',
                message: 'UID 必须是 3~20 位数字',
            });
            return {
                uid: rawUid,
                screenName: '',
                results: orderedResults(targets, results),
                seeded: false,
            };
        }

        const prerequisite = this.prerequisiteFailure();
        if (prerequisite) {
            failAll(prerequisite);
            return {
                uid,
                screenName: this.store.get(uid)?.screenName ?? '',
                results: orderedResults(targets, results),
                seeded: false,
            };
        }

        const candidates: WeiboMonitorTarget[] = [];
        for (const target of targets) {
            const failure = this.precheckTarget(uid, target);
            if (failure) fail(target, failure);
            else candidates.push(target);
        }

        let screenName = this.store.get(uid)?.screenName ?? '';
        let seeded = false;

        if (candidates.length > 0) {
            const prepared = await this.prepare(uid);
            if (!prepared.ok) {
                for (const target of candidates) {
                    fail(target, prepared.failure);
                }
            } else {
                screenName = prepared.screenName;
                seeded = prepared.seeded;
                for (const target of candidates) {
                    const added = this.store.addTarget(
                        uid,
                        prepared.screenName,
                        prepared.avatar,
                        target,
                    );
                    if (added) {
                        results.set(targetKey(target), {
                            type: target.type,
                            id: target.id,
                            ok: true,
                            message: '已订阅',
                        });
                    } else {
                        fail(target, {
                            code: 'duplicate',
                            message: `本会话已订阅 ${prepared.screenName}`,
                        });
                    }
                }
                // 头像尽力缓存: 失败不影响订阅, 订阅页回退远程 URL
                await weiboAvatarService.ensure(uid, prepared.avatar);
                pluginState.logger.info(
                    `已订阅微博 @${prepared.screenName} (${uid}) → ` +
                        candidates
                            .map((item) => `${item.type}:${item.id}`)
                            .join(', '),
                );
            }
        }

        return {
            uid,
            screenName,
            results: orderedResults(targets, results),
            seeded,
        };
    }

    /** 取消订阅; 返回是否成功 */
    remove(rawUid: string, target: WeiboMonitorTarget): boolean {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new Error('UID 必须是 3~20 位数字');

        const result = this.store.removeTarget(uid, target);
        if (!result.removed) return false;

        if (result.monitorRemoved) {
            WeiboCursorStore.getInstance().remove(uid);
            weiboAvatarService.remove(uid);
            weiboRuntime.prune(
                new Set(this.store.list().map((m) => m.uid)),
            );
        }
        pluginState.logger.info(
            `已取消订阅微博 ${uid} ← ${target.type}:${target.id}`,
        );
        return true;
    }

    list(target: WeiboMonitorTarget): WeiboMonitor[] {
        return this.store.listForTarget(target);
    }

    get(uid: string): WeiboMonitor | undefined {
        return this.store.get(normalizeUid(uid) ?? uid);
    }

    /** 全部订阅 (WebUI 只读列表) */
    all(): WeiboSubscriptionView[] {
        return this.store.list().map((monitor) => ({
            uid: monitor.uid,
            screenName: monitor.screenName,
            avatar: monitor.avatar,
            avatarUrl: monitor.avatarPath
                ? `/weibo/avatar/${monitor.uid}`
                : null,
            targets: monitor.to.map((target) => ({
                ...target,
                enabled: sessionConfigService.isSessionEnabled(
                    target.id,
                    target.type,
                ),
            })),
        }));
    }

    /** 最新一条合格动态 (不要求已订阅) */
    async latest(rawUid: string): Promise<WeiboPost | null> {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new Error('UID 必须是 3~20 位数字');
        if (!WeiboCookieStore.getInstance().hasCookies()) {
            throw new Error('尚未配置微博 Cookie');
        }
        if (!browserService.isReady()) {
            throw new Error('浏览器不可用');
        }

        const timeline = await weiboApiService.fetchMyMblog(uid);
        if (!timeline.ok) {
            throw new Error(
                timeline.failure === 'invalid'
                    ? 'Cookie 已失效, 请更新后重试'
                    : `读取博主动态失败: ${timeline.message || '未知错误'}`,
            );
        }

        return filterQualifiedPosts(timeline.posts, uid)[0] ?? null;
    }

    /** 把最新动态按卡片推送到当前会话 */
    async pushLatest(
        post: WeiboPost,
        uid: string,
        target: WeiboMonitorTarget,
    ): Promise<{ pushed: number; failed: number }> {
        const existing = this.store.get(uid);
        const monitor: WeiboMonitor = existing ?? {
            uid,
            screenName: post.user?.screen_name ?? `UID ${uid}`,
            avatar: post.user?.avatar_large ?? '',
            to: [target],
        };
        return weiboPushService.pushPost(post, {
            ...monitor,
            to: [target],
        });
    }

    /** 运行前置条件 (Cookie / 浏览器) */
    private prerequisiteFailure(): TargetFailure | null {
        if (!WeiboCookieStore.getInstance().hasCookies()) {
            return {
                code: 'login_required',
                message: '尚未配置微博 Cookie, 请先在 WebUI 账号页填写',
            };
        }
        if (!browserService.isReady()) {
            return {
                code: 'browser_unavailable',
                message: '浏览器不可用, 请先在 WebUI 账号页安装 Chrome',
            };
        }
        return null;
    }

    /** 单目标预检: 会话启用 / 重复订阅 / 订阅上限 */
    private precheckTarget(
        uid: string,
        target: WeiboMonitorTarget,
    ): TargetFailure | null {
        if (
            !sessionConfigService.isSessionEnabled(
                target.id,
                target.type,
            )
        ) {
            return {
                code: 'session_disabled',
                message: '会话未启用, 请先在会话管理页开启',
            };
        }

        const existing = this.store.get(uid);
        if (existing?.to.some((item) => sameTarget(item, target))) {
            return {
                code: 'duplicate',
                message: `本会话已订阅 ${existing.screenName}`,
            };
        }

        const limit = effectiveLimit(target);
        const used = this.store.countForTarget(target);
        if (used >= limit) {
            return {
                code: 'limit_reached',
                message: `本会话最多订阅 ${formatLimit(limit)} 个博主, 当前已订阅 ${used} 个`,
            };
        }

        return null;
    }

    /** 拉取博主资料与首页动态, 并播种水位线 */
    private async prepare(uid: string): Promise<PrepareResult> {
        const profile = await weiboApiService.fetchProfile(uid);
        if (!profile.ok || !profile.user) {
            if (profile.failure === 'invalid') {
                return {
                    ok: false,
                    failure: {
                        code: 'login_required',
                        message: 'Cookie 已失效, 请更新后重试',
                    },
                };
            }
            if (profile.ok) {
                return {
                    ok: false,
                    failure: {
                        code: 'not_found',
                        message: '未找到该博主',
                    },
                };
            }
            return {
                ok: false,
                failure: {
                    code: 'failed',
                    message: `获取博主信息失败: ${profile.message || '未知错误'}`,
                },
            };
        }

        const screenName =
            profile.user.screen_name ?? `UID ${uid}`;
        const avatar =
            profile.user.avatar_large ??
            profile.user.avatar_hd ??
            profile.user.profile_image_url ??
            '';

        const timeline = await weiboApiService.fetchMyMblog(uid);
        if (!timeline.ok) {
            return {
                ok: false,
                failure:
                    timeline.failure === 'invalid'
                        ? {
                              code: 'login_required',
                              message: 'Cookie 已失效, 请更新后重试',
                          }
                        : {
                              code: 'failed',
                              message: `读取博主动态失败: ${timeline.message || '未知错误'}`,
                          },
            };
        }

        const seeded = this.seedCursor(uid, timeline.posts);
        return { ok: true, screenName, avatar, seeded };
    }

    /** 用首页动态播种水位线; 已有游标时不覆盖 */
    private seedCursor(uid: string, posts: WeiboPost[]): boolean {
        const cursorStore = WeiboCursorStore.getInstance();
        if (cursorStore.get(uid)) return false;

        const qualified = filterQualifiedPosts(posts, uid);
        const watermark = qualified[0] ? getPostId(qualified[0]) : '';
        if (!watermark) return false;

        cursorStore.set(
            uid,
            watermark,
            qualified.slice(0, 20).map(getPostId),
        );
        return true;
    }
}

export const weiboMonitorService = new WeiboMonitorService();

export function normalizeUid(raw: string): string | null {
    const uid = raw.trim();
    return /^\d{3,20}$/.test(uid) ? uid : null;
}

export function sameTarget(
    left: WeiboMonitorTarget,
    right: WeiboMonitorTarget,
): boolean {
    return left.type === right.type && left.id === right.id;
}

/** 会话的有效订阅上限; 超管私聊无上限 */
export function effectiveLimit(target: WeiboMonitorTarget): number {
    if (
        target.type === 'private' &&
        pluginState.config.adminUsers.includes(target.id)
    ) {
        return Number.POSITIVE_INFINITY;
    }
    const fallback =
        target.type === 'group'
            ? DEFAULT_GROUP_LIMIT
            : DEFAULT_PRIVATE_LIMIT;
    return sessionConfigService.getWeiboLimit(
        target.id,
        target.type,
        fallback,
    );
}

function targetKey(target: WeiboSubscriptionTargetInput): string {
    return `${target.type}:${target.id}`;
}

/** 去重并丢弃空 ID (路由层已校验类型) */
function dedupeTargets(
    targets: WeiboSubscriptionTargetInput[],
): WeiboMonitorTarget[] {
    const seen = new Set<string>();
    const result: WeiboMonitorTarget[] = [];
    for (const target of targets) {
        if (!target.id) continue;
        const key = targetKey(target);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ type: target.type, id: target.id });
    }
    return result;
}

function orderedResults(
    targets: WeiboMonitorTarget[],
    results: Map<string, WeiboSubscriptionTargetResult>,
): WeiboSubscriptionTargetResult[] {
    return targets.map(
        (target) =>
            results.get(targetKey(target)) ?? {
                type: target.type,
                id: target.id,
                ok: false,
                code: 'failed',
                message: '未处理',
            },
    );
}

function formatLimit(limit: number): string {
    return Number.isFinite(limit) ? String(limit) : '无上限';
}
