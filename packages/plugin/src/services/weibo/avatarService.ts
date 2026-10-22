/**
 * 订阅头像本地缓存
 *
 * 微博 CDN 对浏览器直连有防盗链, 订阅页只能读插件自己的副本:
 * 落盘到 `data/avatar/<uid>.<ext>`, 由 `GET /weibo/avatar/:uid` 提供。
 *
 * 下载是尽力而为: 失败不阻塞订阅与列表接口, 前端回退远程 URL。
 * 模块加载期零 IO, 目录与文件操作只在方法内发生。
 */

import fs from 'node:fs';
import path from 'node:path';
import { pluginState } from '../../core/state';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import {
    avatarFilename,
    avatarNeedsRefresh,
    pickAvatarExtension,
} from '../../weibo/avatar';

const AVATAR_DIR = 'avatar';
const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const REFERER = 'https://weibo.com/';
const USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

interface DownloadedImage {
    buffer: Buffer;
    contentType: string | null;
}

class WeiboAvatarService {
    private readonly inFlight = new Set<string>();

    /** 头像目录绝对路径 (调用时才有 ctx, 不在模块加载期求值) */
    private get dir(): string {
        return pluginState.getDataFilePath(AVATAR_DIR);
    }

    /**
     * 确保本地副本存在且对应最新的远程 URL。
     *
     * @returns 本地副本是否可用 (已存在或本次下载成功)
     */
    async ensure(uid: string, sourceUrl: string): Promise<boolean> {
        if (!uid || !sourceUrl) return false;
        if (this.inFlight.has(uid)) return false;

        const store = WeiboMonitorStore.getInstance();
        const monitor = store.get(uid);
        if (!monitor) return false;
        if (!avatarNeedsRefresh(monitor)) return true;

        this.inFlight.add(uid);
        try {
            const image = await download(sourceUrl);
            if (!image) return false;

            const ext = pickAvatarExtension(image.contentType);
            if (!ext) {
                pluginState.logger.warn(
                    `(；′⌒\`) 头像类型不受支持: ${image.contentType ?? '未知'} (${sourceUrl})`,
                );
                return false;
            }

            const filename = avatarFilename(uid, ext);
            fs.mkdirSync(this.dir, { recursive: true });

            const target = path.join(this.dir, filename);
            const temp = `${target}.tmp`;
            fs.writeFileSync(temp, image.buffer);
            fs.renameSync(temp, target);

            // 扩展名可能随内容类型变化, 清掉同一 uid 的旧文件
            this.removeFiles(uid, filename);
            store.updateAvatar(uid, filename, sourceUrl);
            return true;
        } catch (error) {
            pluginState.logger.warn(
                `(；′⌒\`) 下载头像失败 @${uid}:`,
                error,
            );
            return false;
        } finally {
            this.inFlight.delete(uid);
        }
    }

    /** 后台补拉: 不等待结果, 供列表接口使用 */
    triggerEnsure(uid: string, sourceUrl: string): void {
        if (this.inFlight.has(uid)) return;
        void this.ensure(uid, sourceUrl);
    }

    /** 本地副本是否需要 (重新) 下载, 含文件存在性检查 */
    needsRefresh(uid: string): boolean {
        const monitor = WeiboMonitorStore.getInstance().get(uid);
        if (!monitor) return false;
        if (!avatarNeedsRefresh(monitor)) return false;
        if (!monitor.avatarPath) return true;
        return !fs.existsSync(
            path.join(this.dir, path.basename(monitor.avatarPath)),
        );
    }

    /** 读图路由用: 返回可直接 sendFile 的绝对路径, 不可用返回 null */
    resolveFile(uid: string): string | null {
        const monitor = WeiboMonitorStore.getInstance().get(uid);
        if (!monitor?.avatarPath) return null;
        const file = path.join(
            this.dir,
            path.basename(monitor.avatarPath),
        );
        return fs.existsSync(file) ? file : null;
    }

    /** 删除某个 uid 的全部本地副本 (订阅被清空时调用) */
    remove(uid: string): void {
        try {
            this.removeFiles(uid);
        } catch (error) {
            pluginState.logger.warn(
                `(；′⌒\`) 删除头像失败 @${uid}:`,
                error,
            );
        }
    }

    /** 启动时清扫孤儿文件: 目录里存在但 store 未引用的副本 */
    sweep(): void {
        try {
            if (!fs.existsSync(this.dir)) return;
            const valid = new Set(
                WeiboMonitorStore.getInstance()
                    .list()
                    .map((monitor) => monitor.avatarPath)
                    .filter((name): name is string => Boolean(name)),
            );

            let removed = 0;
            for (const entry of fs.readdirSync(this.dir, {
                withFileTypes: true,
            })) {
                if (!entry.isFile() || valid.has(entry.name))
                    continue;
                fs.unlinkSync(path.join(this.dir, entry.name));
                removed += 1;
            }
            if (removed > 0) {
                pluginState.logger.debug(
                    `已清理 ${removed} 个孤立头像文件`,
                );
            }
        } catch (error) {
            pluginState.logger.warn('清扫头像缓存失败:', error);
        }
    }

    /** 删除 `avatarPath` 之外的同 uid 副本 */
    private removeFiles(uid: string, keep?: string): void {
        if (!fs.existsSync(this.dir)) return;
        const prefix = `${uid}.`;
        for (const name of fs.readdirSync(this.dir)) {
            if (!name.startsWith(prefix) || name === keep) continue;
            fs.unlinkSync(path.join(this.dir, name));
        }
    }
}

async function download(
    url: string,
): Promise<DownloadedImage | null> {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        FETCH_TIMEOUT_MS,
    );
    try {
        const response = await fetch(url, {
            headers: {
                referer: REFERER,
                'user-agent': USER_AGENT,
            },
            signal: controller.signal,
        });
        if (!response.ok) return null;

        const declared = Number(
            response.headers.get('content-length') ?? '0',
        );
        if (declared > MAX_BYTES) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES)
            return null;

        return {
            buffer,
            contentType: response.headers.get('content-type'),
        };
    } finally {
        clearTimeout(timer);
    }
}

export const weiboAvatarService = new WeiboAvatarService();
