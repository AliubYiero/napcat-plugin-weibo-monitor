/** 通用格式化工具 */

export function formatTime(timestamp: number | null): string {
    if (!timestamp) return '暂无';
    const date = new Date(timestamp);
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

export function formatRelative(timestamp: number | null): string {
    if (!timestamp) return '暂无';
    const diff = Date.now() - timestamp;
    if (diff < 60_000) return '刚刚';
    if (diff < 3_600_000)
        return `${Math.floor(diff / 60_000)} 分钟前`;
    if (diff < 86_400_000)
        return `${Math.floor(diff / 3_600_000)} 小时前`;
    return formatTime(timestamp);
}

export function formatSource(
    source: 'configured' | 'shared' | 'system' | 'none',
): string {
    switch (source) {
        case 'configured':
            return '配置指定';
        case 'shared':
            return '共享安装目录';
        case 'system':
            return '系统浏览器';
        default:
            return '未检测到';
    }
}
