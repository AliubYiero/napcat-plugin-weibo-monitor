/**
 * Chrome for Testing 多源下载安装器
 *
 * 官方源不可达时逐个回退到 npmmirror 镜像。安装到共享目录, 跨插件复用。
 * 不使用 playwright 自带 registry: 内联打包后磁盘上没有它的 cli.js。
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WeiboInstallState } from 'shared';
import {
    type DetectOptions,
    sharedExecutablePath,
    sharedInstallRoot,
    sharedPackageDir,
} from './launcher';

export const DEFAULT_CHROME_VERSION = '153.0.8010.47';

const DOWNLOAD_PLATFORM: Partial<Record<NodeJS.Platform, string>> = {
    linux: 'linux64',
    win32: 'win64',
};

export interface InstallSource {
    name: string;
    url: string;
}

export function downloadSources(
    version: string,
    platform: NodeJS.Platform,
): InstallSource[] {
    const downloadPlatform = DOWNLOAD_PLATFORM[platform];
    const packageDir = sharedPackageDir(platform);
    if (!downloadPlatform || !packageDir) return [];

    const tail = `${version}/${downloadPlatform}/${packageDir}.zip`;

    return [
        {
            name: 'Google',
            url: `https://storage.googleapis.com/chrome-for-testing-public/${tail}`,
        },
        {
            name: 'npmmirror CDN',
            url: `https://cdn.npmmirror.com/binaries/chrome-for-testing/${tail}`,
        },
        {
            name: 'npmmirror Registry',
            url: `https://registry.npmmirror.com/-/binary/chrome-for-testing/${tail}`,
        },
    ];
}

export interface InstallProgress {
    phase: 'downloading' | 'extracting' | 'done';
    percent: number;
    source: string | null;
    message: string;
}

export interface InstallResult {
    path: string;
    source: string;
    version: string;
}

export interface InstallDeps extends DetectOptions {
    version?: string;
    download?: (
        source: InstallSource,
        onProgress: (received: number, total: number) => void,
    ) => Promise<Buffer>;
    extract?: (archive: Buffer, targetDir: string) => Promise<void>;
    onProgress?: (progress: InstallProgress) => void;
}

/** 多源逐个回退; 全部失败时逐条列出原因 */
export async function installChrome(
    deps: InstallDeps = {},
): Promise<InstallResult> {
    const platform = deps.platform ?? process.platform;
    const version = deps.version ?? DEFAULT_CHROME_VERSION;

    const executablePath = sharedExecutablePath(deps);
    if (!executablePath) {
        throw new Error(`不支持的平台：${platform}`);
    }

    const targetDir = sharedInstallRoot(deps);
    const download = deps.download ?? defaultDownload;
    const extract = deps.extract ?? defaultExtract;
    const failures: string[] = [];

    for (const source of downloadSources(version, platform)) {
        try {
            deps.onProgress?.({
                phase: 'downloading',
                percent: 0,
                source: source.name,
                message: `正在从 ${source.name} 下载…`,
            });

            const archive = await download(
                source,
                (received, total) => {
                    deps.onProgress?.({
                        phase: 'downloading',
                        percent: total > 0 ? received / total : 0,
                        source: source.name,
                        message: `正在从 ${source.name} 下载…`,
                    });
                },
            );

            deps.onProgress?.({
                phase: 'extracting',
                percent: 1,
                source: source.name,
                message: '正在解压…',
            });

            await extract(archive, targetDir);

            deps.onProgress?.({
                phase: 'done',
                percent: 1,
                source: source.name,
                message: '安装完成',
            });

            return {
                path: executablePath,
                source: source.name,
                version,
            };
        } catch (error) {
            failures.push(`${source.name}：${messageOf(error)}`);
        }
    }

    throw new Error(
        `Chrome 安装失败，所有下载源都不可用：\n${failures
            .map((line) => `- ${line}`)
            .join('\n')}`,
    );
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export type InstallState = WeiboInstallState;

let state: InstallState = idleState();

function idleState(): InstallState {
    return {
        running: false,
        percent: 0,
        message: '',
        error: null,
        path: null,
    };
}

export const installerDeps = {
    install: installChrome as (
        deps?: InstallDeps,
    ) => Promise<InstallResult>,
};

export function getInstallState(): InstallState {
    return state;
}

export function resetInstallState(): void {
    state = idleState();
}

/** 后台跑安装: 调用方不必 await, WebUI 轮询进度 */
export async function runInstall(
    deps: InstallDeps = {},
): Promise<InstallResult> {
    state = {
        running: true,
        percent: 0,
        message: '准备安装…',
        error: null,
        path: null,
    };

    try {
        const result = await installerDeps.install({
            ...deps,
            onProgress: (progress) => {
                state = {
                    ...state,
                    percent: progress.percent,
                    message: progress.message,
                };
                deps.onProgress?.(progress);
            },
        });

        state = {
            running: false,
            percent: 1,
            message: '安装完成',
            error: null,
            path: result.path,
        };

        return result;
    } catch (error) {
        state = {
            running: false,
            percent: state.percent,
            message: '安装失败',
            error: messageOf(error),
            path: null,
        };
        throw error;
    }
}

async function defaultDownload(
    source: InstallSource,
    onProgress: (received: number, total: number) => void,
): Promise<Buffer> {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error('响应没有内容');

    const total = Number(response.headers.get('content-length') ?? 0);
    const chunks: Uint8Array[] = [];
    let received = 0;

    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
        received += chunk.length;
        onProgress(received, total);
    }

    return Buffer.concat(chunks);
}

async function defaultExtract(
    archive: Buffer,
    targetDir: string,
): Promise<void> {
    const archivePath = path.join(
        os.tmpdir(),
        `napcat-chrome-${process.pid}.zip`,
    );
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(archivePath, archive);

    try {
        await extractWithSystemTool(archivePath, targetDir);
    } finally {
        fs.rmSync(archivePath, { force: true });
    }
}

async function extractWithSystemTool(
    archivePath: string,
    targetDir: string,
): Promise<void> {
    const attempts: Array<[string, string[]]> =
        process.platform === 'win32'
            ? [['tar', ['-xf', archivePath, '-C', targetDir]]]
            : [
                  [
                      'unzip',
                      ['-o', '-q', archivePath, '-d', targetDir],
                  ],
                  ['tar', ['-xf', archivePath, '-C', targetDir]],
              ];

    const errors: string[] = [];

    for (const [command, args] of attempts) {
        try {
            await run(command, args);
            return;
        } catch (error) {
            errors.push(`${command}：${messageOf(error)}`);
        }
    }

    throw new Error(`解压失败：${errors.join('；')}`);
}

function run(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { stdio: 'ignore' });
        child.on('error', reject);
        child.on('close', (code) =>
            code === 0
                ? resolve()
                : reject(new Error(`${command} 退出码 ${code}`)),
        );
    });
}
