/**
 * 浏览器状态缓存
 *
 * 检测与查询分离: WebUI 轮询只读缓存, 完整检测 (真正起进程验证) 只能由
 * `/chrome/detect` 或安装完成后触发。
 */

import { pluginState } from '../../core/state';
import type { BrowserStatus } from '../../weibo/types';
import {
    type DetectOptions,
    detectChrome,
    launchBrowser,
} from './launcher';

const VERIFY_TIMEOUT_MS = 5000;

const UNKNOWN_STATUS: BrowserStatus = {
    available: false,
    source: 'none',
    executablePath: null,
    version: null,
    installed: false,
    error: null,
};

let cache: BrowserStatus | null = null;

/** 只读缓存; 每 5 秒被 WebUI 轮询的入口 */
export function getBrowserStatus(): BrowserStatus {
    return cache ?? UNKNOWN_STATUS;
}

/** 缓存为空时补一次轻量检测 (只查文件, 不起进程) */
export function ensureBrowserStatus(
    deps: DetectOptions = {},
): BrowserStatus {
    return cache ?? detectBrowserLightweight(deps);
}

/** 配置变更后清空缓存 */
export function invalidateBrowserStatus(): void {
    cache = null;
}

export function detectBrowserLightweight(
    deps: DetectOptions = {},
): BrowserStatus {
    const found = detectChrome(
        pluginState.config.chromeExecutablePath ?? '',
        deps,
    );

    cache = found
        ? {
              available: true,
              source: found.source,
              executablePath: found.path,
              version: null,
              installed: true,
              error: null,
          }
        : {
              available: false,
              source: 'none',
              executablePath: null,
              version: null,
              installed: false,
              error: '未找到可用的浏览器',
          };

    return cache;
}

interface LaunchedBrowser {
    version(): string;
    close(): Promise<void>;
}

export interface VerifyDeps extends DetectOptions {
    launch?: (executablePath: string) => Promise<LaunchedBrowser>;
}

/** 完整检测: 轻量检查通过后再启动一次验证版本 */
export async function detectBrowserFull(
    deps: VerifyDeps = {},
): Promise<BrowserStatus> {
    const lightweight = detectBrowserLightweight(deps);
    if (!lightweight.available || !lightweight.executablePath) {
        return lightweight;
    }

    const launch =
        deps.launch ??
        ((executablePath: string) => launchBrowser(executablePath));

    try {
        const browser = await withTimeout(
            launch(lightweight.executablePath),
            VERIFY_TIMEOUT_MS,
            `启动验证超时（${VERIFY_TIMEOUT_MS}ms）`,
        );

        const version = browser.version();
        await browser.close().catch(() => {});

        cache = {
            ...lightweight,
            version,
            error: null,
        };
    } catch (error) {
        cache = {
            ...lightweight,
            available: false,
            version: null,
            error:
                error instanceof Error
                    ? error.message
                    : String(error),
        };
    }

    return cache;
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
