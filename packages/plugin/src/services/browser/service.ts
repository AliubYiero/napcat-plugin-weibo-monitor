import type { Page } from 'playwright-core';
import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import {
    createWeiboBrowserSession,
    type WeiboBrowserSession,
} from '../weibo/browserSession';
import { detectBrowserLightweight } from './status';

export type { ApiFetchResult } from '../weibo/browserSession';

export class BrowserService {
    private session: WeiboBrowserSession | null = null;

    isReady(): boolean {
        const status = detectBrowserLightweight();
        return (
            WeiboCookieStore.getInstance().hasCookies() &&
            status.available
        );
    }

    withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
        return this.ensureSession().withPage(task);
    }

    fetchApi(urlPath: string) {
        return this.ensureSession().fetchApi(urlPath);
    }

    renderHtml(html: string): Promise<Buffer> {
        return this.ensureSession().renderHtml(html);
    }

    async captureCookies(): Promise<void> {
        await this.ensureSession().captureCookies();
    }

    getVersion(): string | null {
        return this.session?.getVersion() ?? null;
    }

    async close(): Promise<void> {
        const session = this.session;
        this.session = null;
        if (session) await session.close();
    }

    dispose(): void {
        const session = this.session;
        this.session = null;
        session?.dispose();
    }

    private ensureSession(): WeiboBrowserSession {
        if (this.session) return this.session;

        const status = detectBrowserLightweight();
        if (!status.available || !status.executablePath) {
            throw new Error(
                status.error ??
                    '未找到可用的浏览器, 请在 WebUI 账号页安装',
            );
        }

        this.session = createWeiboBrowserSession({
            executablePath: status.executablePath,
            cookies: WeiboCookieStore.getInstance().getCookies(),
            logger: pluginState.logger,
            onCookiesRefreshed: (cookies, options) => {
                WeiboCookieStore.getInstance().saveRefreshedCookies(
                    cookies,
                    false,
                    options.refresh,
                );
            },
        });
        return this.session;
    }
}

export const browserService = new BrowserService();
