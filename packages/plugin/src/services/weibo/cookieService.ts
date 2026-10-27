/**
 * Cookie 生命周期服务
 *
 * 负责: 粘贴文本 → storageState、保存/手动校验、每日保活、登录态探测、
 * 失效告警与运行故障告警。失效期间轮询由 pollingService 暂停, 但保活继续。
 */

import { pluginState } from '../../core/state';
import {
    createTextMessage,
    sendPrivateMessage,
} from '../../handlers/utils';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import {
    type LoginProbeOutcome,
    probeLoginState,
} from '../../weibo/loginProbe';
import { parseCookieHeader } from '../../weibo/sanitize';
import type {
    StoredCookie,
    WeiboCookieData,
} from '../../weibo/types';
import { browserService } from '../browser/service';
import { weiboRuntime } from './runtimeStatus';

const KEEP_ALIVE_AFTER_MS = 20 * 60 * 60 * 1000;
const INVALID_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ALERT_ATTEMPT_RETRY_MS = 5 * 60 * 1000;
const RUNTIME_ALERT_THRESHOLD = 3;
const RUNTIME_ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const ALERT_RETRY_DELAYS_MS = [0, 1000, 2000];
const DAY_MS = 24 * 60 * 60 * 1000;

export interface SaveCookieResult {
    valid: boolean;
    message: string;
}

class WeiboCookieService {
    /** 保存、校验、保活互斥, 避免旧 Cookie 覆盖刚保存的新 Cookie */
    private operationInFlight = false;

    private get store(): WeiboCookieStore {
        return WeiboCookieStore.getInstance();
    }

    /**
     * 保存用户粘贴的 Cookie: 先用临时会话校验候选, 通过后才落盘。
     * 校验失败时 store 与健康状态都不变。
     */
    async save(raw: string): Promise<SaveCookieResult> {
        const cookies = parseCookieHeader(raw);
        if (cookies.length === 0) {
            return {
                valid: false,
                message:
                    '未解析出任何 Cookie, 请粘贴完整 Cookie 字符串',
            };
        }
        if (this.operationInFlight) {
            return {
                valid: false,
                message: '另一个 Cookie 操作正在进行中, 请稍后重试',
            };
        }

        this.operationInFlight = true;
        try {
            return await this.saveChecked(cookies);
        } finally {
            this.operationInFlight = false;
        }
    }

    private async saveChecked(
        cookies: StoredCookie[],
    ): Promise<SaveCookieResult> {
        let checked: {
            result: LoginProbeOutcome;
            cookies: StoredCookie[];
        };
        try {
            checked = await browserService.withCandidateSession(
                cookies,
                async (session) => {
                    const outcome = await probeLoginState(
                        session,
                        this.firstMonitoredUid(),
                    );
                    if (outcome.result === 'valid') {
                        await session.captureCookies();
                    }
                    return outcome;
                },
            );
        } catch (error) {
            return {
                valid: false,
                message:
                    error instanceof Error
                        ? error.message
                        : '浏览器启动失败',
            };
        }

        const outcome = checked.result;
        if (outcome.result !== 'valid') {
            return {
                valid: false,
                message:
                    outcome.result === 'invalid'
                        ? `登录态无效, 未保存: ${outcome.message}`
                        : `暂时无法确认登录态, 未保存: ${outcome.message}`,
            };
        }

        const before = this.store.getData();
        this.store.saveCookies(checked.cookies);
        this.store.markValidated();
        this.store.recordProbe('valid', outcome.message);
        this.store.markSuccess();
        weiboRuntime.recoveryPending = false;
        await browserService.close();
        await this.notifyRuntimeRecoveredIfNeeded();

        if (before.invalid && before.invalidNotifiedAt !== null) {
            void this.notifyRecovered(before.invalidSince);
        }
        return { valid: true, message: 'Cookie 可用, 已保存' };
    }

    /** 手动校验 (不改变已保存的 Cookie) */
    async validate(): Promise<SaveCookieResult> {
        if (!this.store.hasCookies()) {
            return { valid: false, message: '尚未配置 Cookie' };
        }
        if (this.operationInFlight) {
            return {
                valid: false,
                message: '另一个 Cookie 操作正在进行中, 请稍后重试',
            };
        }

        this.operationInFlight = true;
        try {
            const outcome = await this.probeCurrent();
            this.store.markValidated();
            this.store.recordProbe(outcome.result, outcome.message);

            if (outcome.result === 'valid') {
                this.store.markSuccess();
                await this.notifyRuntimeRecoveredIfNeeded();
                await this.markRecovered();
                return { valid: true, message: 'Cookie 可用' };
            }
            if (outcome.result === 'invalid') {
                await this.markInvalidAndNotify(outcome.message);
                return { valid: false, message: outcome.message };
            }
            return {
                valid: false,
                message: `暂时无法确认登录态: ${outcome.message}`,
            };
        } finally {
            this.operationInFlight = false;
        }
    }

    async clear(): Promise<void> {
        this.store.clear();
        weiboRuntime.clearLastError();
        weiboRuntime.recoveryPending = false;
        await browserService.close();
    }

    /** 轮询前检查: 距上次保活尝试超过 20 小时则执行一次 */
    async ensureKeepAlive(): Promise<void> {
        if (!this.store.hasCookies()) return;
        if (!this.store.needsKeepAlive(KEEP_ALIVE_AFTER_MS)) return;
        await this.keepAlive();
    }

    /**
     * 每日保活: 用已存 Cookie 起独立候选会话访问首页, 探测通过后整体写回。
     * 失败时保留旧快照, 绝不写入游客 Cookie。
     */
    async keepAlive(
        options: { manual?: boolean } = {},
    ): Promise<SaveCookieResult> {
        if (!this.store.hasCookies()) {
            return { valid: false, message: '尚未配置 Cookie' };
        }
        if (this.operationInFlight) {
            return {
                valid: false,
                message: '另一个 Cookie 操作正在进行中, 请稍后重试',
            };
        }

        this.operationInFlight = true;
        this.store.markKeepAliveAttempt();
        const uid = this.firstMonitoredUid();

        try {
            const checked = await browserService.withCandidateSession(
                this.store.getCookies(),
                async (session) => {
                    const outcome = await probeLoginState(
                        session,
                        uid,
                    );
                    if (outcome.result === 'valid') {
                        await session.captureCookies();
                    }
                    return outcome;
                },
            );

            const outcome = checked.result;
            this.store.recordProbe(outcome.result, outcome.message);

            if (outcome.result === 'valid') {
                const applied = await this.applyKeepAliveSuccess(
                    checked.cookies,
                    uid !== undefined,
                );
                if (applied === 'skipped') {
                    return {
                        valid: false,
                        message: '保活已取消: Cookie 已被清除',
                    };
                }
                return {
                    valid: true,
                    message:
                        applied === 'pending'
                            ? '保活成功, 等待首轮鉴权确认恢复'
                            : options.manual
                              ? '保活成功, 登录态已续期'
                              : '保活成功',
                };
            }

            if (outcome.result === 'invalid') {
                await this.markInvalidAndNotify(outcome.message);
                return {
                    valid: false,
                    message: `Cookie 已失效: ${outcome.message}`,
                };
            }

            this.store.recordKeepAliveFailure('inconclusive');
            await this.handleRuntimeAlert(
                'inconclusive',
                outcome.message,
            );
            return {
                valid: false,
                message: `保活未得到结论: ${outcome.message}`,
            };
        } catch (error) {
            const message = errorMessage(error);
            this.store.recordProbe(
                'inconclusive',
                `保活执行失败: ${message}`,
            );
            this.store.recordKeepAliveFailure('failure');
            await this.handleRuntimeAlert('failure', message);
            return {
                valid: false,
                message: `保活执行失败: ${message}`,
            };
        } finally {
            this.operationInFlight = false;
        }
    }

    /**
     * 标记失效并按每日冷却私聊全部超管。
     * 系统告警绕过会话启用开关, 直接发私聊。
     */
    async markInvalidAndNotify(signal?: string): Promise<void> {
        this.store.markInvalid();
        if (
            !this.store.canNotifyInvalid(INVALID_NOTIFY_COOLDOWN_MS)
        ) {
            return;
        }
        if (
            !this.store.canAttemptInvalidAlert(ALERT_ATTEMPT_RETRY_MS)
        ) {
            return;
        }

        this.store.markInvalidAlertAttempt();
        const data = this.store.getData();
        const delivered = await this.deliverToAdmins(
            buildInvalidMessage(data, signal),
        );
        if (!delivered) {
            pluginState.logger.warn(
                '微博 Cookie 失效告警投递失败, 稍后重试',
            );
            return;
        }

        this.store.markInvalidNotified();
        pluginState.logger.error(
            '微博 Cookie 已失效, 已暂停轮询并告警',
        );
    }

    /** 恢复后解除标记, 并在曾告警时发送恢复通知 */
    async markRecovered(): Promise<void> {
        const before = this.store.getData();
        this.store.markRecovered();
        weiboRuntime.recoveryPending = false;

        if (!before.invalid) return;
        pluginState.logger.info('微博 Cookie 已恢复');
        if (before.invalidNotifiedAt === null) return;
        await this.notifyRecovered(before.invalidSince);
    }

    private async probeCurrent(): Promise<LoginProbeOutcome> {
        try {
            return await probeLoginState(
                browserService,
                this.firstMonitoredUid(),
            );
        } catch (error) {
            return {
                result: 'inconclusive',
                message: `登录态探测异常: ${errorMessage(error)}`,
            };
        }
    }

    /**
     * 写回保活成功的 Cookie 并关闭轮询会话。
     * 失效状态下有订阅时只设置待确认标记, 等首轮真实鉴权成功再恢复。
     */
    private async applyKeepAliveSuccess(
        cookies: StoredCookie[],
        hasSubscriptions: boolean,
    ): Promise<'applied' | 'pending' | 'skipped'> {
        // 保活期间用户清除了 Cookie: 不把旧凭证写回去
        if (!this.store.hasCookies()) return 'skipped';

        const before = this.store.getData();
        this.store.applyKeepAliveCookies(cookies);
        await browserService.close();
        await this.notifyRuntimeRecoveredIfNeeded();

        if (!before.invalid) return 'applied';
        if (hasSubscriptions) {
            weiboRuntime.recoveryPending = true;
            pluginState.logger.info(
                '微博保活已通过, 等待首轮鉴权接口确认恢复',
            );
            return 'pending';
        }

        await this.markRecovered();
        return 'applied';
    }

    private async handleRuntimeAlert(
        kind: 'failure' | 'inconclusive',
        detail: string,
    ): Promise<void> {
        const data = this.store.getData();
        const count =
            kind === 'failure'
                ? data.keepAliveFailureCount
                : data.keepAliveInconclusiveCount;
        if (count < RUNTIME_ALERT_THRESHOLD) return;
        if (!this.store.canNotifyRuntime(RUNTIME_ALERT_COOLDOWN_MS)) {
            return;
        }
        if (
            !this.store.canAttemptRuntimeAlert(ALERT_ATTEMPT_RETRY_MS)
        ) {
            return;
        }

        this.store.markRuntimeAlertAttempt();
        const delivered = await this.deliverToAdmins(
            buildRuntimeMessage(data, kind, count, detail),
        );
        if (!delivered) return;

        this.store.markRuntimeAlerted();
        pluginState.logger.warn(
            `(；′⌒\`) 微博 Cookie 保活连续 ${count} 次未成功, 已告警`,
        );
    }

    private async notifyRuntimeRecoveredIfNeeded(): Promise<void> {
        if (!this.store.hadRuntimeAlert()) return;
        const delivered = await this.deliverToAdmins(
            '【微博监听】Cookie 保活已恢复\n' +
                '轮询将按原间隔继续。',
        );
        if (delivered) {
            this.store.markRuntimeRecoveryNotified();
        }
    }

    private async notifyRecovered(
        invalidSince: number | null,
    ): Promise<void> {
        await this.deliverToAdmins(
            '【微博监听】Cookie 已恢复\n' +
                `失效时长：${formatDurationSince(invalidSince)}\n` +
                '已恢复轮询。',
        );
    }

    /**
     * 告警投递: 每个收件人最多 3 次短重试,
     * 至少一个收件人成功才算整体投递成功。
     */
    private async deliverToAdmins(message: string): Promise<boolean> {
        const admins = pluginState.config.adminUsers;
        if (admins.length === 0) {
            pluginState.logger.warn(
                '微博告警无法投递: 未配置 adminUsers',
            );
            return false;
        }

        let delivered = false;
        for (const admin of admins) {
            for (const delay of ALERT_RETRY_DELAYS_MS) {
                if (delay > 0) await sleep(delay);
                const ok = await sendPrivateMessage(
                    pluginState.ctx,
                    admin,
                    createTextMessage(message),
                );
                if (ok) {
                    delivered = true;
                    break;
                }
            }
        }
        return delivered;
    }

    private firstMonitoredUid(): string | undefined {
        return WeiboMonitorStore.getInstance().list()[0]?.uid;
    }
}

export const weiboCookieService = new WeiboCookieService();

function buildInvalidMessage(
    data: WeiboCookieData,
    signal?: string,
): string {
    const lastText = data.lastSuccessAt
        ? formatDateTime(data.lastSuccessAt)
        : '从未成功';
    const reason =
        signal || data.lastProbeMessage || '登录态探测未通过';
    return (
        '【微博监听】Cookie 已失效\n' +
        `最后成功：${lastText}\n` +
        `已持续：${formatDurationSince(data.invalidSince)}\n` +
        `判定依据：${reason}\n` +
        '请前往 WebUI → 账号 重新粘贴 Cookie，保存后自动恢复并立即拉取一轮。'
    );
}

function buildRuntimeMessage(
    data: WeiboCookieData,
    kind: 'failure' | 'inconclusive',
    count: number,
    detail: string,
): string {
    const lastText = data.lastSuccessAt
        ? formatDateTime(data.lastSuccessAt)
        : '从未成功';
    const reason =
        kind === 'failure'
            ? `连续 ${count} 次执行失败`
            : `连续 ${count} 次只能得到不确定结果`;
    return (
        '【微博监听】Cookie 保活异常\n' +
        `${reason}\n` +
        `最近原因：${detail}\n` +
        `最后成功：${lastText}\n` +
        '请检查浏览器与网络；如确认 Cookie 已失效，请前往 WebUI → 账号 更新。'
    );
}

function formatDurationSince(timestamp: number | null): string {
    if (timestamp === null) return '未知';
    const elapsed = Math.max(0, Date.now() - timestamp);
    const days = Math.floor(elapsed / DAY_MS);
    if (days >= 1) return `${days} 天`;
    const hours = Math.max(1, Math.floor(elapsed / (60 * 60 * 1000)));
    return `${hours} 小时`;
}

function formatDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
