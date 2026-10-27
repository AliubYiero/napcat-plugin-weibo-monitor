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
import { resolvePollingState } from '../../weibo/pollingState';
import {
    createPollSchedule,
    normalizePollIntervalMinutes,
    type PollSchedule,
} from '../../weibo/pollSchedule';
import {
    createSubscriptionRound,
    type SubscriptionRound,
} from '../../weibo/subscriptionRound';
import type { WeiboPollingStatus } from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import type { WeiboApiFailure } from './apiService';
import { weiboApiService } from './apiService';
import { weiboCookieService } from './cookieService';
import { weiboPushService } from './pushService';
import { type TargetRuntime, weiboRuntime } from './runtimeStatus';

const UID_INTERVAL_MS = 1500;
const BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MINUTES = 60;

class WeiboPollingService {
    private started = false;
    private inFlight = false;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private round: SubscriptionRound | null = null;
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
        weiboRuntime.recoveryPending = false;
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
            await weiboCookieService.ensureKeepAlive();

            const cookie = WeiboCookieStore.getInstance().getData();
            if (cookie.cookies.length === 0) {
                weiboRuntime.clearLastError();
                pluginState.logger.debug(
                    '微博轮询跳过: 尚未配置 Cookie',
                );
                return;
            }
            const wasInvalid = cookie.invalid;
            if (cookie.invalid && !weiboRuntime.recoveryPending) {
                weiboRuntime.clearLastError();
                pluginState.logger.debug(
                    '微博轮询跳过: Cookie 已失效, 等待保活恢复或人工更新',
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

            const round = this.getRound();
            const activeMonitors = round.settlePause();
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
                const monitor = activeMonitors[index];
                const outcome = await round.poll(monitor);

                if (outcome.ok) {
                    weiboRuntime.clearTargetError(monitor.uid);
                    succeeded += 1;
                    if (wasInvalid) {
                        await weiboCookieService.markRecovered();
                    }
                } else {
                    const message =
                        outcome.message ??
                        `微博接口失败 (${outcome.failure ?? '未知'})`;
                    weiboRuntime.setTargetError(monitor.uid, message);
                    failureMessage = message;
                }

                if (outcome.failure === 'invalid') {
                    terminalFailure = 'invalid';
                    weiboRuntime.recoveryPending = false;
                    await weiboCookieService.markInvalidAndNotify(
                        outcome.message ?? undefined,
                    );
                    break;
                }
                if (outcome.failure === 'risk') {
                    terminalFailure = 'risk';
                    weiboRuntime.recoveryPending = false;
                    this.enterBackoff();
                    break;
                }
                if (!outcome.ok) {
                    weiboRuntime.recoveryPending = false;
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

    private getRound(): SubscriptionRound {
        if (this.round) return this.round;

        this.round = createSubscriptionRound({
            fetchPage: (uid) => weiboApiService.fetchMyMblog(uid),
            pushPost: async (post, subscription, context) => {
                await weiboPushService.pushPost(
                    post,
                    subscription,
                    context,
                );
            },
            cursors: {
                get: (uid) => WeiboCursorStore.getInstance().get(uid),
                set: (uid, next) =>
                    WeiboCursorStore.getInstance().set(uid, next),
                setPaused: (uid, paused) =>
                    WeiboCursorStore.getInstance().setPaused(
                        uid,
                        paused,
                    ),
            },
            subscriptions: {
                list: () => WeiboMonitorStore.getInstance().list(),
                get: (uid) =>
                    WeiboMonitorStore.getInstance().get(uid),
                updateMeta: (uid, screenName, avatar) =>
                    WeiboMonitorStore.getInstance().updateMeta(
                        uid,
                        screenName,
                        avatar,
                    ),
            },
            isSessionEnabled: (target) =>
                sessionConfigService.isSessionEnabled(
                    target.id,
                    target.type,
                ),
            contentTypes: () =>
                pluginState.config.weiboPushContentTypes,
            now: () => Date.now(),
            logger: {
                debug: (...args) => pluginState.logger.debug(...args),
                info: (...args) => pluginState.logger.info(...args),
                warn: (...args) => pluginState.logger.warn(...args),
            },
        });

        return this.round;
    }
}

export const weiboPollingService = new WeiboPollingService();

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
