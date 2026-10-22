/**
 * 轮询服务
 *
 * 启动时与 Cookie 更新后立即拉取; 之后按配置周期执行。单博主失败不影响其它博主,
 * 但 Cookie 失效与风控会中止本轮。
 */

import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { WeiboCursorStore } from '../../store/WeiboCursorStore';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import {
    createPollSchedule,
    normalizePollIntervalMinutes,
    type PollSchedule,
} from '../../weibo/pollSchedule';
import { resolvePollingState } from '../../weibo/pollingState';
import {
    filterQualifiedPosts,
    getPostId,
} from '../../weibo/predicate';
import type { WeiboPollingStatus } from '../../weibo/types';
import { resolveWatermark } from '../../weibo/watermark';
import { sessionConfigService } from '../sessionConfigService';
import type { WeiboApiFailure } from './apiService';
import { weiboApiService } from './apiService';
import { weiboCookieService } from './cookieService';
import { weiboPushService } from './pushService';
import { type TargetRuntime, weiboRuntime } from './runtimeStatus';

const UID_INTERVAL_MS = 1500;
const BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MINUTES = 60;

interface PollOutcome {
    ok: boolean;
    failure: WeiboApiFailure;
    message: string | null;
}

class WeiboPollingService {
    private started = false;
    private inFlight = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** 计划器只在启动与配置变更时重建, tick 收尾只调用它, 不做模式判断 */
    private planner: PollSchedule = createPollSchedule(
        DEFAULT_INTERVAL_MINUTES,
    );

    start(): void {
        if (this.started) return;
        this.started = true;
        weiboRuntime.running = true;
        this.planner = createPollSchedule(this.intervalMinutes());
        pluginState.logger.info(
            `(｡·ω·｡) 微博轮询已启动, 间隔 ${this.intervalMinutes()} 分钟 (${this.planner.label})`,
        );
        this.schedule(0);
    }

    stop(): void {
        this.started = false;
        weiboRuntime.running = false;
        weiboRuntime.nextPollAt = null;
        weiboRuntime.clearLastError();
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        pluginState.timers.delete('weibo_poll');
    }

    /** 立即安排一轮 (Cookie 保存成功后调用) */
    requestImmediate(): void {
        if (!this.started) return;
        this.schedule(0);
    }

    /** 配置变更后按新周期重新排期 */
    reschedule(): void {
        if (!this.started) return;
        this.planner = createPollSchedule(this.intervalMinutes());
        this.schedule(this.nextDelay());
    }

    getStatus(): WeiboPollingStatus {
        const cookie = WeiboCookieStore.getInstance().getData();
        const subscriptionCount =
            WeiboMonitorStore.getInstance().list().length;

        return {
            state: resolvePollingState({
                started: this.started,
                hasCookies: cookie.cookies.length > 0,
                invalid: cookie.invalid,
                backoffUntil: weiboRuntime.backoffUntil,
                subscriptionCount,
                lastError: weiboRuntime.lastError,
            }),
            running: weiboRuntime.running,
            intervalMinutes: this.intervalMinutes(),
            scheduleLabel: createPollSchedule(this.intervalMinutes())
                .label,
            lastPollAt: weiboRuntime.lastPollAt,
            nextPollAt: weiboRuntime.nextPollAt,
            backoffUntil: weiboRuntime.backoffUntil,
            lastError: weiboRuntime.lastError,
            lastErrorAt: weiboRuntime.lastErrorAt,
        };
    }

    getTargetStatus(uid: string): TargetRuntime {
        return weiboRuntime.getTarget(uid);
    }

    private intervalMinutes(): number {
        return normalizePollIntervalMinutes(
            pluginState.config.weiboPollIntervalMinutes,
        );
    }

    private schedule(delayMs: number): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (!this.started) return;

        weiboRuntime.nextPollAt = Date.now() + delayMs;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.tick();
        }, delayMs);
        pluginState.timers.set(
            'weibo_poll',
            this.timer as unknown as ReturnType<typeof setInterval>,
        );
    }

    private async tick(): Promise<void> {
        if (!this.started || this.inFlight) return;
        this.inFlight = true;

        try {
            await weiboCookieService.ensureFresh();

            const cookie = WeiboCookieStore.getInstance().getData();
            if (cookie.cookies.length === 0) {
                weiboRuntime.clearLastError();
                pluginState.logger.debug(
                    '微博轮询跳过: 尚未配置 Cookie',
                );
                return;
            }
            if (cookie.invalid) {
                weiboRuntime.clearLastError();
                pluginState.logger.debug(
                    '微博轮询跳过: Cookie 已失效, 等待更新',
                );
                return;
            }

            if (
                weiboRuntime.backoffUntil &&
                Date.now() < weiboRuntime.backoffUntil
            ) {
                return;
            }
            weiboRuntime.backoffUntil = null;

            const monitors = WeiboMonitorStore.getInstance().list();
            if (monitors.length === 0) {
                weiboRuntime.clearLastError();
                return;
            }

            // 暂停拉取: 全部推送目标都被禁用的 uid 本轮不请求, 并持久化标记。
            // 重新启用后的首轮由 pollMonitor 走「游标重建」, 不补发禁用期动态。
            const cursorStore = WeiboCursorStore.getInstance();
            const activeMonitors = monitors.filter((monitor) => {
                const enabled = monitor.to.some((target) =>
                    sessionConfigService.isSessionEnabled(
                        target.id,
                        target.type,
                    ),
                );
                if (!enabled)
                    cursorStore.setPaused(monitor.uid, true);
                return enabled;
            });
            if (activeMonitors.length === 0) {
                weiboRuntime.clearLastError();
                return;
            }

            let succeeded = 0;
            let failureMessage: string | null = null;
            let terminalFailure: WeiboApiFailure = null;

            for (
                let index = 0;
                index < activeMonitors.length;
                index += 1
            ) {
                if (!this.started) break;
                const outcome = await this.pollMonitor(
                    activeMonitors[index],
                );

                if (outcome.ok) {
                    succeeded += 1;
                } else if (outcome.message) {
                    failureMessage = outcome.message;
                }

                if (outcome.failure === 'invalid') {
                    terminalFailure = 'invalid';
                    await weiboCookieService.markInvalidAndNotify();
                    break;
                }
                if (outcome.failure === 'risk') {
                    terminalFailure = 'risk';
                    this.enterBackoff();
                    break;
                }

                if (index < activeMonitors.length - 1) {
                    await sleep(UID_INTERVAL_MS);
                }
            }

            // 「异常」只在整轮没有任何博主成功时成立; 失效与退避各有专属状态
            if (succeeded > 0) {
                weiboRuntime.clearLastError();
            } else if (terminalFailure === null && failureMessage) {
                weiboRuntime.setLastError(failureMessage);
            }
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);
            weiboRuntime.setLastError(message);
            pluginState.logger.error('微博轮询异常:', error);
        } finally {
            weiboRuntime.lastPollAt = Date.now();
            this.inFlight = false;
            if (this.started) {
                this.schedule(this.nextDelay());
            }
        }
    }

    private nextDelay(now: number = Date.now()): number {
        const backoff = weiboRuntime.backoffUntil;
        if (backoff !== null && backoff > now) {
            // 退避允许脱离网格: 等满剩余时间再试, 不被短间隔提前打断
            return backoff - now;
        }
        return this.planner.nextDelay(now);
    }

    private enterBackoff(): void {
        weiboRuntime.backoffUntil = Date.now() + BACKOFF_MS;
        pluginState.logger.warn(
            '(；′⌒`) 微博接口触发风控, 退避 30 分钟',
        );
    }

    /** @returns 是否成功、失败类型与错误文案 */
    private async pollMonitor(monitor: {
        uid: string;
        screenName: string;
        avatar: string;
    }): Promise<PollOutcome> {
        const result = await weiboApiService.fetchMyMblog(
            monitor.uid,
        );

        if (!result.ok) {
            const message =
                result.message ||
                `微博接口失败 (${result.failure ?? '未知'})`;
            weiboRuntime.setTargetError(monitor.uid, message);
            pluginState.logger.warn(
                `微博拉取失败 @${monitor.screenName} (${monitor.uid}): ${message}`,
            );
            return { ok: false, failure: result.failure, message };
        }

        weiboRuntime.clearTargetError(monitor.uid);

        const qualified = filterQualifiedPosts(
            result.posts,
            monitor.uid,
        );
        const newest = qualified[0];
        if (newest?.user) {
            const name =
                newest.user.screen_name ?? monitor.screenName;
            const avatar =
                newest.user.avatar_large ??
                newest.user.avatar_hd ??
                newest.user.profile_image_url ??
                monitor.avatar;
            if (
                name !== monitor.screenName ||
                avatar !== monitor.avatar
            ) {
                WeiboMonitorStore.getInstance().updateMeta(
                    monitor.uid,
                    name,
                    avatar,
                );
            }
        }

        const cursorStore = WeiboCursorStore.getInstance();
        const cursor = cursorStore.get(monitor.uid);

        // 暂停后重新启用的首轮: 只把水位线推到最新一条, 不推送任何动态。
        // 与「游标重建」同语义——止损, 不补发禁用期的历史。
        if (cursor?.paused) {
            const newest = qualified[0];
            if (newest) {
                cursorStore.set(
                    monitor.uid,
                    getPostId(newest),
                    qualified.slice(0, 20).map(getPostId),
                );
            }
            cursorStore.setPaused(monitor.uid, false);
            pluginState.logger.info(
                `博主 ${monitor.uid} 已恢复推送, 水位线已重建 (不补发期间动态)`,
            );
            return { ok: true, failure: null, message: null };
        }

        const selection = resolveWatermark(qualified, {
            watermark: cursor?.watermark ?? null,
            recentIds: cursor?.recentIds ?? [],
        });

        if (selection.rebuilt) {
            pluginState.logger.warn(
                `(；′⌒\`) 博主 ${monitor.uid} 的水位线已失效, 已静默重建`,
            );
        }

        if (
            selection.nextWatermark &&
            (selection.nextWatermark !== (cursor?.watermark ?? '') ||
                !sameIds(
                    selection.nextRecentIds,
                    cursor?.recentIds ?? [],
                ))
        ) {
            cursorStore.set(
                monitor.uid,
                selection.nextWatermark,
                selection.nextRecentIds,
            );
        }

        const currentMonitor = WeiboMonitorStore.getInstance().get(
            monitor.uid,
        );
        if (!currentMonitor) {
            return { ok: true, failure: null, message: null };
        }

        for (const post of selection.posts) {
            await weiboPushService.pushPost(post, currentMonitor);
        }

        if (selection.posts.length === 0) {
            pluginState.logger.debug(
                `微博无新动态 @${currentMonitor.screenName}`,
            );
        }

        return { ok: true, failure: null, message: null };
    }
}

export const weiboPollingService = new WeiboPollingService();

function sameIds(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
