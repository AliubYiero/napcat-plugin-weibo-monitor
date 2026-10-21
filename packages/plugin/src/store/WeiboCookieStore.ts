/**
 * 微博 Cookie store (`weibo-cookie.json`)
 *
 * 只保存 Playwright storageState 的 cookies 与健康状态, 不保存用户原始粘贴文本。
 * 失效标记与告警时间一并持久化, 保证重启后不会重复轰炸私聊。
 */

import { pluginState } from '../core/state';
import type { StoredCookie, WeiboCookieData } from '../weibo/types';

const DEFAULT_DATA: WeiboCookieData = {
    cookies: [],
    lastRefreshAt: null,
    lastSuccessAt: null,
    lastValidatedAt: null,
    invalid: false,
    invalidNotifiedAt: null,
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
            invalidNotifiedAt: null,
        };
        this.save();
    }

    /** 接口调用成功后回写浏览器刷新过的 Cookie */
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
            invalid: markSuccess ? false : this.data.invalid,
        };
        this.save();
    }

    markValidated(): void {
        this.data.lastValidatedAt = Date.now();
        this.save();
    }

    markSuccess(): void {
        this.data.lastSuccessAt = Date.now();
        this.data.invalid = false;
        this.save();
    }

    markInvalid(): void {
        this.data.invalid = true;
        this.save();
    }

    markInvalidNotified(): void {
        this.data.invalidNotifiedAt = Date.now();
        this.data.invalid = true;
        this.save();
    }

    /** 是否需要刷新 (默认 7 天未成功调用) */
    needsRefresh(maxAgeMs: number): boolean {
        const last = this.data.lastRefreshAt ?? 0;
        return Date.now() - last > maxAgeMs;
    }

    /** 失效告警是否已过冷却期 */
    canNotifyInvalid(cooldownMs: number): boolean {
        const last = this.data.invalidNotifiedAt ?? 0;
        return Date.now() - last > cooldownMs;
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
            invalidNotifiedAt: numberOrNull(raw.invalidNotifiedAt),
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}
