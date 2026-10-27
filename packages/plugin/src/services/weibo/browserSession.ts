import type {
    Browser,
    BrowserContext,
    Cookie,
    Page,
} from 'playwright-core';
import { CARD_WIDTH } from '../../weibo/card';
import type { ApiFetchResult, StoredCookie } from '../../weibo/types';
import { buildUserAgent, launchBrowser } from '../browser/launcher';

const WEIBO_HOME = 'https://weibo.com/';
const DEFAULT_IDLE_CLOSE_MS = 5 * 60 * 1000;
const NAV_TIMEOUT_MS = 30_000;
const IMAGE_WAIT_MS = 15_000;

export type { ApiFetchResult } from '../../weibo/types';

export interface WeiboBrowserLogger {
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

export interface CookiesRefreshedOptions {
    refresh: boolean;
}

export interface WeiboBrowserSessionOptions {
    executablePath: string;
    cookies?: StoredCookie[];
    logger?: WeiboBrowserLogger;
    onCookiesRefreshed?: (
        cookies: StoredCookie[],
        options: CookiesRefreshedOptions,
    ) => void;
    idleCloseMs?: number;
    headless?: boolean;
}

export interface WeiboBrowserSession {
    withPage<T>(task: (page: Page) => Promise<T>): Promise<T>;
    fetchApi(urlPath: string): Promise<ApiFetchResult>;
    renderHtml(html: string): Promise<Buffer>;
    captureCookies(): Promise<void>;
    getVersion(): string | null;
    close(): Promise<void>;
    dispose(): void;
}

class BrowserSession implements WeiboBrowserSession {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;

    private queue: Promise<unknown> = Promise.resolve();
    private active = 0;
    private idleTimer: ReturnType<typeof setTimeout> | null = null;
    private version: string | null = null;

    constructor(
        private readonly options: WeiboBrowserSessionOptions,
    ) {}

    withPage<T>(task: (page: Page) => Promise<T>): Promise<T> {
        return this.runExclusive(async () => {
            const page = await this.ensurePage();
            return task(page);
        });
    }

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

            await this.persistCookies({ refresh: false });
            return result;
        });
    }

    async captureCookies(): Promise<void> {
        await this.withPage(async () => {
            await this.persistCookies({ refresh: true });
        });
    }

    renderHtml(html: string): Promise<Buffer> {
        return this.runExclusive(async () => {
            const context = await this.ensureContext();
            const page = await context.newPage();
            try {
                await page.setViewportSize({
                    width: CARD_WIDTH,
                    height: 900,
                });
                await page.setExtraHTTPHeaders({
                    Referer: 'https://weibo.com/',
                });
                await page.setContent(html, {
                    waitUntil: 'load',
                    timeout: NAV_TIMEOUT_MS,
                });
                await waitForImages(page, IMAGE_WAIT_MS);
                const rect = await page.evaluate(() => {
                    const card = document.querySelector('.card');
                    const element = card ?? document.body;
                    const box = element.getBoundingClientRect();
                    return {
                        x: box.x,
                        y: box.y,
                        width: box.width,
                        height: box.height,
                    };
                });
                if (rect.width > 0 && rect.height > 0) {
                    await page.setViewportSize({
                        width: CARD_WIDTH,
                        height: Math.max(
                            1,
                            Math.ceil(rect.y + rect.height),
                        ),
                    });
                    return await page.screenshot({
                        clip: rect,
                        type: 'png',
                        animations: 'disabled',
                    });
                }
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

    getVersion(): string | null {
        return this.version;
    }

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

    dispose(): void {
        this.clearIdleTimer();
        const browser = this.browser;
        this.browser = null;
        this.context = null;
        this.page = null;
        this.version = null;
        if (browser) void browser.close().catch(() => {});
    }

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

        const cookies = this.options.cookies ?? [];
        const browser = await launchBrowser(
            this.options.executablePath,
            undefined,
            this.options.headless ?? true,
        );

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

            this.options.logger?.debug(
                `(｡·ω·｡) 微博浏览器已启动: ${version}`,
            );
            return page;
        } catch (error) {
            await browser.close().catch(() => {});
            throw error;
        }
    }

    private async persistCookies(
        options: CookiesRefreshedOptions,
    ): Promise<void> {
        if (!this.context) return;
        const cookies = (await this.context.cookies()).map(
            toStoredCookie,
        );
        this.options.onCookiesRefreshed?.(cookies, options);
    }

    private scheduleIdleClose(): void {
        const idleCloseMs =
            this.options.idleCloseMs ?? DEFAULT_IDLE_CLOSE_MS;
        if (this.active > 0 || !this.browser || idleCloseMs <= 0)
            return;
        this.clearIdleTimer();
        this.idleTimer = setTimeout(() => {
            if (this.active === 0) {
                void this.close();
            }
        }, idleCloseMs);
    }

    private clearIdleTimer(): void {
        if (!this.idleTimer) return;
        clearTimeout(this.idleTimer);
        this.idleTimer = null;
    }
}

export function createWeiboBrowserSession(
    options: WeiboBrowserSessionOptions,
): WeiboBrowserSession {
    return new BrowserSession(options);
}

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
