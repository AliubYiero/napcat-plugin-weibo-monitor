/**
 * Cookie 生命周期服务
 *
 * 负责: 粘贴文本 → storageState、保存后校验、失效告警 (24h 冷却)、
 * 7 天无成功调用时访问首页续期。失效状态下轮询由 pollingService 暂停。
 */

import { pluginState } from '../../core/state';
import {
    createTextMessage,
    sendPrivateMessage,
} from '../../handlers/utils';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import { parseCookieHeader } from '../../weibo/sanitize';
import type { StoredCookie } from '../../weibo/types';
import { browserService } from '../browser/service';
import {
    validateCookieWithSession,
    weiboApiService,
} from './apiService';
import { weiboRuntime } from './runtimeStatus';

const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const INVALID_NOTIFY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface SaveCookieResult {
    valid: boolean;
    message: string;
}

class WeiboCookieService {
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

        let checked: {
            result: SaveCookieResult;
            cookies: StoredCookie[];
        };
        try {
            checked = await browserService.withCandidateSession(
                cookies,
                (session) =>
                    validateCookieWithSession(
                        session,
                        this.firstMonitoredUid(),
                    ),
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

        if (!checked.result.valid) return checked.result;

        this.store.saveCookies(checked.cookies);
        this.store.markValidated();
        this.store.markSuccess();
        await browserService.close();
        return checked.result;
    }

    /** 手动校验 (不改变已保存的 Cookie) */
    async validate(): Promise<SaveCookieResult> {
        if (!this.store.hasCookies()) {
            return { valid: false, message: '尚未配置 Cookie' };
        }
        const result = await weiboApiService.validateCookie(
            this.firstMonitoredUid(),
        );
        this.store.markValidated();
        if (result.valid) {
            this.store.markSuccess();
        } else if (result.failure === 'invalid') {
            this.store.markInvalid();
        }
        return { valid: result.valid, message: result.message };
    }

    async clear(): Promise<void> {
        this.store.clear();
        weiboRuntime.clearLastError();
        await browserService.close();
    }

    /** 7 天未成功调用时访问一次首页, 让服务端刷新会话 */
    async ensureFresh(): Promise<void> {
        if (!this.store.hasCookies()) return;
        if (!this.store.needsRefresh(REFRESH_AFTER_MS)) return;
        try {
            await browserService.withPage(async (page) => {
                await page.goto('https://weibo.com/', {
                    waitUntil: 'domcontentloaded',
                    timeout: 30_000,
                });
            });
            await browserService.captureCookies();
            pluginState.logger.debug('微博 Cookie 已续期');
        } catch (error) {
            pluginState.logger.warn('微博 Cookie 续期失败:', error);
        }
    }

    /**
     * 标记失效并按冷却期私聊全部超管。
     * 系统告警绕过会话启用开关, 直接发私聊。
     */
    async markInvalidAndNotify(): Promise<void> {
        this.store.markInvalid();
        if (
            !this.store.canNotifyInvalid(INVALID_NOTIFY_COOLDOWN_MS)
        ) {
            return;
        }

        const admins = pluginState.config.adminUsers;
        if (admins.length === 0) {
            pluginState.logger.warn(
                '微博 Cookie 失效, 但未配置 adminUsers, 无法发送告警',
            );
            return;
        }

        const lastSuccess = this.store.getData().lastSuccessAt;
        const lastText = lastSuccess
            ? formatDateTime(lastSuccess)
            : '从未成功';
        const message =
            '【微博监听】Cookie 已失效，已暂停轮询。\n' +
            `最后成功：${lastText}\n` +
            '请前往 WebUI → 账号 更新 Cookie，保存后自动恢复并立即拉取一轮。';

        for (const admin of admins) {
            await sendPrivateMessage(
                pluginState.ctx,
                admin,
                createTextMessage(message),
            );
        }
        this.store.markInvalidNotified();
        pluginState.logger.error(
            '微博 Cookie 已失效, 已暂停轮询并告警',
        );
    }

    /** 恢复后静默解除标记 */
    markRecovered(): void {
        this.store.markSuccess();
    }

    private firstMonitoredUid(): string | undefined {
        return WeiboMonitorStore.getInstance().list()[0]?.uid;
    }
}

export const weiboCookieService = new WeiboCookieService();

function formatDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}
