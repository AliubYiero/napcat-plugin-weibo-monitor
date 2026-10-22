/**
 * 头像缓存的纯函数部分
 *
 * 微博 CDN 有防盗链, 浏览器直连会拿不到图, 因此订阅页头像一律优先走插件自己的
 * 本地副本。本模块只做文件名/类型判定, 不做 IO。
 */

/** 允许缓存的内容类型 → 文件扩展名 */
const MIME_EXTENSION: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
};

/**
 * 从 `Content-Type` 取扩展名; 非图片或未知类型返回 `null`。
 *
 * 只认白名单类型, 避免把 HTML 错误页当成头像落盘。
 */
export function pickAvatarExtension(
    contentType: string | null,
): string | null {
    if (!contentType) return null;
    const mime = contentType.split(';')[0].trim().toLowerCase();
    return MIME_EXTENSION[mime] ?? null;
}

/** 本地头像文件名 (按 uid 定位, 扩展名随内容类型变化) */
export function avatarFilename(uid: string, ext: string): string {
    return `${uid}.${ext}`;
}

/** 判断某个 uid 的本地副本是否需要 (重新) 下载 */
export function avatarNeedsRefresh(monitor: {
    avatar: string;
    avatarPath?: string;
    avatarSource?: string;
}): boolean {
    if (!monitor.avatar) return false;
    if (!monitor.avatarPath) return true;
    return monitor.avatarSource !== monitor.avatar;
}
