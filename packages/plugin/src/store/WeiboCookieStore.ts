/**
 * 微博 Cookie store (`weibo-cookie.json`)
 *
 * 只保存 Playwright storageState 的 cookies 与健康状态, 不保存用户原始粘贴文本。
 * 失效、保活、探测与告警时间一并持久化, 保证重启后不会重复轰炸私聊。
 */

import { pluginState } from '../core/state';
import type {
    LoginProbeResult,
    StoredCookie,
    WeiboCookieData,
} from '../weibo/types';

const DEFAULT_DATA: WeiboCookieData = {
    cookies: [],
    lastRefreshAt: null,
    lastSuccessAt: null,
    lastValidatedAt: null,
    invalid: false,
    invalidSince: null,
    invalidNotifiedAt: null,
    invalidAlertAttemptAt: null,
    lastKeepAliveAt: null,
    lastKeepAliveAttemptAt: null,
    lastProbeAt: null,
    lastProbeResult: null,
    lastProbeMessage: null,
    keepAliveFailureCount: 0,
    keepAliveInconclusiveCount: 0,
    runtimeAlertAttemptAt: null,
    runtimeAlertedAt: null,
    runtimeRecoveryNotifiedAt: null,
};

export class WeiboCookieStore {
    private static readonly DATA_FILENAME = 'weibo-cookie.json';
    private static instance: WeiboCookieStore | null = null;

    private data: WeiboCookieData;

    private constructor() {
        this.data = this.load();
    }

    static getInstance(): WeiboCookieStore {
        if (!WeiboCookieStore.instance) {
            WeiboCookieStore.instance = new WeiboCookieStore();
        }
        return WeiboCookieStore.instance;
    }

    /** 只读视图 (cookie 值也返回, 调用方不得用于日志) */
    getData(): WeiboCookieData {
        return {
            ...this.data,
            cookies: this.data.cookies.map((cookie) => ({
                ...cookie,
            })),
        };
    }

    getCookies(): StoredCookie[] {
        return this.data.cookies.map((cookie) => ({ ...cookie }));
    }

    hasCookies(): boolean {
        return this.data.cookies.length > 0;
    }

    /** 用户保存新 Cookie: 视为一次刷新, 清除失效标记 */
    saveCookies(cookies: StoredCookie[]): void {
        const now = Date.now();
        this.data = {
            ...this.data,
            cookies: cookies.map((cookie) => ({ ...cookie })),
            lastRefreshAt: now,
            invalid: false,
            invalidSince: null,
            invalidNotifiedAt: null,
            invalidAlertAttemptAt: null,
            lastKeepAliveAttemptAt: now,
            keepAliveFailureCount: 0,
            keepAliveInconclusiveCount: 0,
        };
        this.save();
    }

    /** 接口调用成功后回写浏览器刷新过的 Cookie (只回填, 不算续期) */
    saveRefreshedCookies(
        cookies: StoredCookie[],
        markSuccess = true,
        markRefresh = false,
    ): void {
        const now = Date.now();
        this.data = {
            ...this.data,
            cookies: cookies.map((cookie) => ({ ...cookie })),
            lastRefreshAt: markRefresh
                ? now
                : this.data.lastRefreshAt,
            lastSuccessAt: markSuccess
                ? now
                : this.data.lastSuccessAt,
        };
        this.save();
    }

    /** 保活成功: 写回完整 Cookie 集, 只标记续期, 不擅自解除失效 */
    applyKeepAliveCookies(cookies: StoredCookie[]): void {
        const now = Date.now();
        this.data = {
            ...this.data,
            cookies: cookies.map((cookie) => ({ ...cookie })),
            lastRefreshAt: now,
            lastKeepAliveAt: now,
            lastKeepAliveAttemptAt: now,
            keepAliveFailureCount: 0,
            keepAliveInconclusiveCount: 0,
        };
        this.save();
    }

    markKeepAliveAttempt(): void {
        this.data.lastKeepAliveAttemptAt = Date.now();
        this.save();
    }

    /** 记录一次保活未得到有效结论; 两类计数互斥重置 */
    recordKeepAliveFailure(kind: 'failure' | 'inconclusive'): void {
        if (kind === 'failure') {
            this.data.keepAliveFailureCount += 1;
            this.data.keepAliveInconclusiveCount = 0;
        } else {
            this.data.keepAliveInconclusiveCount += 1;
            this.data.keepAliveFailureCount = 0;
        }
        this.save();
    }

    recordProbe(result: LoginProbeResult, message: string): void {
        this.data.lastProbeAt = Date.now();
        this.data.lastProbeResult = result;
        this.data.lastProbeMessage = message;
        if (result !== 'inconclusive') {
            this.data.keepAliveFailureCount = 0;
            this.data.keepAliveInconclusiveCount = 0;
        }
        this.save();
    }

    markValidated(): void {
        this.data.lastValidatedAt = Date.now();
        this.save();
    }

    markSuccess(): void {
        this.data.lastSuccessAt = Date.now();
        this.save();
    }

    markInvalid(): void {
        this.data.invalid = true;
        if (this.data.invalidSince === null) {
            this.data.invalidSince = Date.now();
        }
        this.save();
    }

    markInvalidAlertAttempt(): void {
        this.data.invalidAlertAttemptAt = Date.now();
        this.save();
    }

    markInvalidNotified(): void {
        const now = Date.now();
        this.data.invalid = true;
        if (this.data.invalidSince === null) {
            this.data.invalidSince = now;
        }
        this.data.invalidNotifiedAt = now;
        this.save();
    }

    /** 恢复登录态: 清除失效与运行故障计数 */
    markRecovered(): void {
        this.data.invalid = false;
        this.data.invalidSince = null;
        this.data.invalidNotifiedAt = null;
        this.data.invalidAlertAttemptAt = null;
        this.data.keepAliveFailureCount = 0;
        this.data.keepAliveInconclusiveCount = 0;
        this.save();
    }

    markRuntimeAlertAttempt(): void {
        this.data.runtimeAlertAttemptAt = Date.now();
        this.save();
    }

    markRuntimeAlerted(): void {
        this.data.runtimeAlertedAt = Date.now();
        this.save();
    }

    markRuntimeRecoveryNotified(): void {
        this.data.runtimeRecoveryNotifiedAt = Date.now();
        this.save();
    }

    /** 是否需要执行保活 (按上次尝试时间, 避免失败后逐轮重试) */
    needsKeepAlive(maxAgeMs: number): boolean {
        const last =
            this.data.lastKeepAliveAttemptAt ??
            this.data.lastRefreshAt ??
            0;
        return Date.now() - last > maxAgeMs;
    }

    /** 失效告警是否已过每日冷却 */
    canNotifyInvalid(cooldownMs: number): boolean {
        const last = this.data.invalidNotifiedAt ?? 0;
        return Date.now() - last > cooldownMs;
    }

    /** 失效告警投递失败后的短重试节流 */
    canAttemptInvalidAlert(retryMs: number): boolean {
        const last = this.data.invalidAlertAttemptAt ?? 0;
        return Date.now() - last > retryMs;
    }

    canNotifyRuntime(cooldownMs: number): boolean {
        const last = this.data.runtimeAlertedAt ?? 0;
        return Date.now() - last > cooldownMs;
    }

    canAttemptRuntimeAlert(retryMs: number): boolean {
        const last = this.data.runtimeAlertAttemptAt ?? 0;
        return Date.now() - last > retryMs;
    }

    /** 存在尚未发送恢复通知的运行故障告警 */
    hadRuntimeAlert(): boolean {
        if (this.data.runtimeAlertedAt === null) return false;
        return (
            this.data.runtimeRecoveryNotifiedAt === null ||
            this.data.runtimeRecoveryNotifiedAt <
                this.data.runtimeAlertedAt
        );
    }

    clear(): void {
        this.data = { ...DEFAULT_DATA, cookies: [] };
        this.save();
    }

    private load(): WeiboCookieData {
        const raw = pluginState.loadDataFile<unknown>(
            WeiboCookieStore.DATA_FILENAME,
            DEFAULT_DATA,
        );
        if (!isRecord(raw)) return { ...DEFAULT_DATA, cookies: [] };

        return {
            cookies: normalizeCookies(raw.cookies),
            lastRefreshAt: numberOrNull(raw.lastRefreshAt),
            lastSuccessAt: numberOrNull(raw.lastSuccessAt),
            lastValidatedAt: numberOrNull(raw.lastValidatedAt),
            invalid: raw.invalid === true,
            invalidSince: numberOrNull(raw.invalidSince),
            invalidNotifiedAt: numberOrNull(raw.invalidNotifiedAt),
            invalidAlertAttemptAt: numberOrNull(
                raw.invalidAlertAttemptAt,
            ),
            lastKeepAliveAt: numberOrNull(raw.lastKeepAliveAt),
            lastKeepAliveAttemptAt: numberOrNull(
                raw.lastKeepAliveAttemptAt,
            ),
            lastProbeAt: numberOrNull(raw.lastProbeAt),
            lastProbeResult: probeResultOrNull(raw.lastProbeResult),
            lastProbeMessage: stringOrNull(raw.lastProbeMessage),
            keepAliveFailureCount: nonNegativeInt(
                raw.keepAliveFailureCount,
            ),
            keepAliveInconclusiveCount: nonNegativeInt(
                raw.keepAliveInconclusiveCount,
            ),
            runtimeAlertAttemptAt: numberOrNull(
                raw.runtimeAlertAttemptAt,
            ),
            runtimeAlertedAt: numberOrNull(raw.runtimeAlertedAt),
            runtimeRecoveryNotifiedAt: numberOrNull(
                raw.runtimeRecoveryNotifiedAt,
            ),
        };
    }

    private save(): void {
        pluginState.saveDataFile(
            WeiboCookieStore.DATA_FILENAME,
            this.data,
        );
    }
}

function normalizeCookies(value: unknown): StoredCookie[] {
    if (!Array.isArray(value)) return [];
    const out: StoredCookie[] = [];
    for (const item of value) {
        if (!isRecord(item)) continue;
        if (
            typeof item.name !== 'string' ||
            typeof item.value !== 'string'
        ) {
            continue;
        }
        out.push({
            name: item.name,
            value: item.value,
            domain:
                typeof item.domain === 'string'
                    ? item.domain
                    : '.weibo.com',
            path: typeof item.path === 'string' ? item.path : '/',
            expires:
                typeof item.expires === 'number' ? item.expires : -1,
            httpOnly: item.httpOnly === true,
            secure: item.secure !== false,
            sameSite:
                item.sameSite === 'Strict' || item.sameSite === 'None'
                    ? item.sameSite
                    : 'Lax',
        });
    }
    return out;
}

function numberOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value)
        ? value
        : null;
}

function stringOrNull(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function nonNegativeInt(value: unknown): number {
    return typeof value === 'number' &&
        Number.isFinite(value) &&
        value > 0
        ? Math.floor(value)
        : 0;
}

function probeResultOrNull(value: unknown): LoginProbeResult | null {
    return value === 'valid' ||
        value === 'invalid' ||
        value === 'inconclusive'
        ? value
        : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}
