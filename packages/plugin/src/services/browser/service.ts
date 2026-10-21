/**
 * 共享浏览器会话
 *
 * 所有微博接口调用都在 `https://weibo.com/` 页面内用 `fetch(..., { credentials: 'include' })`
 * 发出, 避免 Node 侧伪造 Cookie / Referer 与签名差异。浏览器惰性启动、任务串行、
 * 空闲 5 分钟关闭。
 */

import type {
    Browser,
    BrowserContext,
    Cookie,
    Page,
} from 'playwright-core';
import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { CARD_WIDTH } from '../../weibo/card';
import type { StoredCookie } from '../../weibo/types';
import { buildUserAgent, launchBrowser } from './launcher';
import { detectBrowserLightweight } from './status';

const WEIBO_HOME = 'https://weibo.com/';
const IDLE_CLOSE_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 30_000;
const IMAGE_WAIT_MS = 15_000;

export interface ApiFetchResult {
    status: number;
    body: unknown;
}

export class BrowserService {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    private queue: Promise<unknown> = Promise.resolve();
    private active = 0;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private version: string | null = null;

    /** 是否具备轻量可用条件 (Cookie 已配置 + 找到浏览器文件) */
    isReady(): boolean {
        const status = detectBrowserLightweight();
        return (
            WeiboCookieStore.getInstance().hasCookies() &&
            status.available
        );
    }

    /** 串行执行一个页面任务 */
    withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
        return this.runExclusive(async () => {
            const page = await this.ensurePage();
            return task(page);
        });
    }

    /** 在页面内调用微博接口 */
    fetchApi(urlPath: string): Promise<ApiFetchResult> {
        const url = urlPath.startsWith('http')
            ? urlPath
            : `${WEIBO_HOME.replace(/\/$/, '')}${urlPath}`;

        return this.withPage(async (page) => {
            const result = await page.evaluate(async (target) => {
                const response = await fetch(target, {
                    credentials: 'include',
                    headers: {
                        accept: 'application/json, text/plain, */*',
                        'x-requested-with': 'XMLHttpRequest',
                    },
                });
                const text = await response.text();
                let body: unknown = null;
                try {
                    body = JSON.parse(text);
                } catch {
                    body = text;
                }
                return { status: response.status, body };
            }, url);

            // 每次调用后把浏览器刷新过的 Cookie 回写; 成功状态由 API 层按
            // 业务响应判定, 避免 HTTP 200 + ok:0 被误记为成功。
            await this.persistCookies(false);
            return result;
        });
    }

    /** 回写浏览器当前 Cookie (不标记接口成功) */
    async captureCookies(): Promise<void> {
        await this.withPage(async () => {
            await this.persistCookies(false, true);
        });
    }

    /** 渲染 HTML 并截图 (PNG, 全页, DPR 2) */
    renderHtml(html: string): Promise<Buffer> {
        return this.runExclusive(async () => {
            const context = await this.ensureContext();
            const page = await context.newPage();
            try {
                await page.setViewportSize({
                    width: CARD_WIDTH,
                    height: 900,
                });
                await page.setContent(html, {
                    waitUntil: 'load',
                    timeout: NAV_TIMEOUT_MS,
                });
                await waitForImages(page, IMAGE_WAIT_MS);
                return await page.screenshot({
                    fullPage: true,
                    type: 'png',
                    animations: 'disabled',
                });
            } finally {
                await page.close().catch(() => {});
            }
        });
    }

    /** 当前浏览器版本 (完整检测展示用) */
    getVersion(): string | null {
        return this.version;
    }

    /** 关闭浏览器; 不等待上下文优雅收尾 */
    async close(): Promise<void> {
        this.clearIdleTimer();
        const browser = this.browser;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.version = null;
        if (browser) {
            await browser.close().catch(() => {});
        }
    }

    /** 同步触发关闭 (cleanup 用, 不阻塞宿主) */
    dispose(): void {
        this.clearIdleTimer();
        const browser = this.browser;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.version = null;
        if (browser) void browser.close().catch(() => {});
    }

    // ==================== 内部 ====================

    private runExclusive<T>(task: () => Promise<T>): Promise<T> {
        this.active += 1;
        this.clearIdleTimer();

        const run = this.queue.then(task, task);
        this.queue = run.then(
            () => undefined,
            () => undefined,
        );

        return run.finally(() => {
            this.active -= 1;
            this.scheduleIdleClose();
        });
    }

    private async ensureContext(): Promise<BrowserContext> {
        if (this.context) return this.context;
        await this.ensurePage();
        if (!this.context) {
            throw new Error('浏览器上下文初始化失败');
        }
        return this.context;
    }

    private async ensurePage(): Promise<Page> {
        if (this.page && !this.page.isClosed()) return this.page;

        const status = detectBrowserLightweight();
        if (!status.available || !status.executablePath) {
            throw new Error(
                status.error ??
                    '未找到可用的浏览器, 请在 WebUI 账号页安装',
            );
        }

        const cookieStore = WeiboCookieStore.getInstance();
        const cookies = cookieStore.getCookies();
        const browser = await launchBrowser(status.executablePath);

        try {
            const version = browser.version();
            const context = await browser.newContext({
                storageState:
                    cookies.length > 0
                        ? {
                              cookies: cookies.map((cookie) => ({
                                  ...cookie,
                                  sameSite: cookie.sameSite ?? 'Lax',
                              })),
                              origins: [],
                          }
                        : undefined,
                userAgent: buildUserAgent(version),
                viewport: { width: 1280, height: 900 },
                deviceScaleFactor: 2,
                locale: 'zh-CN',
                timezoneId: 'Asia/Shanghai',
            });
            const page = await context.newPage();
            page.setDefaultTimeout(NAV_TIMEOUT_MS);
            page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
            await page.goto(WEIBO_HOME, {
                waitUntil: 'domcontentloaded',
                timeout: NAV_TIMEOUT_MS,
            });

            this.browser = browser;
            this.context = context;
            this.page = page;
            this.version = version;

            browser.on('disconnected', () => {
                this.browser = null;
                this.context = null;
                this.page = null;
                this.version = null;
            });

            pluginState.logger.debug(
                `(｡·ω·｡) 微博浏览器已启动: ${version}`,
            );
            return page;
        } catch (error) {
            await browser.close().catch(() => {});
            throw error;
        }
    }

    private async persistCookies(
        markSuccess: boolean,
        markRefresh = false,
    ): Promise<void> {
        if (!this.context) return;
        const cookies = await this.context.cookies();
        const store = WeiboCookieStore.getInstance();
        store.saveRefreshedCookies(
            cookies.map(toStoredCookie),
            markSuccess,
            markRefresh,
        );
    }

    private scheduleIdleClose(): void {
        if (this.active > 0 || !this.browser) return;
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (this.active === 0) {
                void this.close();
            }
        }, IDLE_CLOSE_MS);
    }

    private clearIdleTimer(): void {
        if (!this.idleTimer) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }
}

export const browserService = new BrowserService();

function toStoredCookie(cookie: Cookie): StoredCookie {
    return {
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path,
        expires: cookie.expires,
        httpOnly: cookie.httpOnly,
        secure: cookie.secure,
        sameSite:
            cookie.sameSite === 'Strict' || cookie.sameSite === 'None'
                ? cookie.sameSite
                : 'Lax',
    };
}

async function waitForImages(
    page: Page,
    timeoutMs: number,
): Promise<void> {
    await page
        .evaluate(async () => {
            const fonts = (
                document as Document & {
                    fonts?: { ready?: Promise<unknown> };
                }
            ).fonts?.ready;
            if (fonts) await fonts;

            await Promise.all(
                Array.from(document.images).map((image) => {
                    if (image.complete) return Promise.resolve();
                    return new Promise<void>((resolve) => {
                        image.addEventListener(
                            'load',
                            () => resolve(),
                            {
                                once: true,
                            },
                        );
                        image.addEventListener(
                            'error',
                            () => resolve(),
                            {
                                once: true,
                            },
                        );
                    });
                }),
            );
        })
        .catch(() => {});

    await withTimeout(
        page.waitForLoadState('networkidle', { timeout: timeoutMs }),
        timeoutMs,
        '页面资源加载超时',
    ).catch(() => {});
}

function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}
