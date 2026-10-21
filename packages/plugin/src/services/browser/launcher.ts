/**
 * 浏览器检测与启动
 *
 * 检测顺序固定: 用户显式配置 → 共享安装目录 → 系统 Chrome / Edge。
 * 共享安装目录跨插件复用 (`napcat-chrome`), 避免每个插件各下一份浏览器。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright-core';

export type BrowserSource = 'configured' | 'shared' | 'system';

export interface BrowserInfo {
    path: string;
    source: BrowserSource;
}

export interface DetectOptions {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
    isFile?: (path: string) => boolean;
}

export const SHARED_INSTALL_DIRNAME = 'napcat-chrome';

const SHARED_PACKAGE_DIR: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'chrome-linux64',
    win32: 'chrome-win64',
};

const SHARED_EXECUTABLE_NAME: Partial<
    Record<NodeJS.Platform, string>
> = {
    linux: 'chrome',
    win32: 'chrome.exe',
};

function defaultIsFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function pathFor(platform: NodeJS.Platform) {
    return platform === 'win32' ? path.win32 : path.posix;
}

function resolveOptions(options: DetectOptions) {
    return {
        platform: options.platform ?? process.platform,
        env: options.env ?? process.env,
        homeDir: options.homeDir ?? os.homedir(),
    };
}

export function sharedInstallRoot(
    options: DetectOptions = {},
): string {
    const { platform, env, homeDir } = resolveOptions(options);
    const platformPath = pathFor(platform);

    if (platform === 'win32') {
        const base =
            env.LOCALAPPDATA ||
            platformPath.join(homeDir, 'AppData', 'Local');
        return platformPath.join(base, SHARED_INSTALL_DIRNAME);
    }

    const base =
        env.XDG_DATA_HOME ||
        platformPath.join(homeDir, '.local', 'share');
    return platformPath.join(base, SHARED_INSTALL_DIRNAME);
}

export function sharedExecutablePath(
    options: DetectOptions = {},
): string | null {
    const { platform } = resolveOptions(options);
    const packageDir = SHARED_PACKAGE_DIR[platform];
    const executableName = SHARED_EXECUTABLE_NAME[platform];
    if (!packageDir || !executableName) return null;

    return pathFor(platform).join(
        sharedInstallRoot(options),
        packageDir,
        executableName,
    );
}

export function sharedPackageDir(
    platform: NodeJS.Platform,
): string | null {
    return SHARED_PACKAGE_DIR[platform] ?? null;
}

function sharedCandidates(options: DetectOptions): string[] {
    const candidate = sharedExecutablePath(options);
    return candidate ? [candidate] : [];
}

const LINUX_SYSTEM_PATHS = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/opt/google/chrome/chrome',
];

function windowsSystemPaths(
    env: NodeJS.ProcessEnv,
    homeDir: string,
): string[] {
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const programFilesX86 =
        env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const localAppData =
        env.LOCALAPPDATA ||
        path.win32.join(homeDir, 'AppData', 'Local');

    return [
        path.win32.join(
            programFiles,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
        ),
        path.win32.join(
            programFilesX86,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
        ),
        path.win32.join(
            localAppData,
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
        ),
        path.win32.join(
            programFiles,
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe',
        ),
        path.win32.join(
            programFilesX86,
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe',
        ),
    ];
}

function systemCandidates(options: DetectOptions): string[] {
    const { platform, env, homeDir } = resolveOptions(options);
    if (platform === 'win32') return windowsSystemPaths(env, homeDir);
    if (platform === 'linux') return LINUX_SYSTEM_PATHS;
    return [];
}

/** 找一个可用浏览器; 都没有时返回 null */
export function detectChrome(
    configuredPath: string,
    options: DetectOptions = {},
): BrowserInfo | null {
    const { isFile = defaultIsFile } = options;

    if (configuredPath && isFile(configuredPath)) {
        return { path: configuredPath, source: 'configured' };
    }

    for (const candidate of sharedCandidates(options)) {
        if (isFile(candidate))
            return { path: candidate, source: 'shared' };
    }

    for (const candidate of systemCandidates(options)) {
        if (isFile(candidate))
            return { path: candidate, source: 'system' };
    }

    return null;
}

/** 共享安装目录中是否已有可执行文件 */
export function hasSharedInstall(
    options: DetectOptions = {},
): boolean {
    const candidate = sharedExecutablePath(options);
    return candidate
        ? (options.isFile ?? defaultIsFile)(candidate)
        : false;
}

export { defaultIsFile };

/** 按真实内核版本生成 UA, 避免 HeadlessChrome 被站点拒绝 */
export function buildUserAgent(browserVersion: string): string {
    const major = browserVersion.split('.')[0];
    return (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        `(KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
    );
}

export type BrowserLauncher = (options: {
    executablePath: string;
    headless: boolean;
}) => Promise<Browser>;

const playwrightLauncher: BrowserLauncher = async (options) => {
    const { chromium } = await import('playwright-core');
    return chromium.launch(options);
};

/** 启动浏览器; 必须显式传 executablePath, 不使用 playwright 自带浏览器 */
export async function launchBrowser(
    executablePath: string,
    launcher: BrowserLauncher = playwrightLauncher,
): Promise<Browser> {
    return launcher({ executablePath, headless: true });
}

export function isMissingBrowserError(error: unknown): boolean {
    const message =
        error instanceof Error ? error.message : String(error ?? '');
    return (
        /executable doesn't exist/i.test(message) ||
        /chromium(_headless_shell)?-\d+/i.test(message)
    );
}
