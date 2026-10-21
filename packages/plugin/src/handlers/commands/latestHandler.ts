/**
 * 最新动态指令 (`<前缀> latest [UID]`)
 *
 * 只发当前会话一次, 不要求已订阅, 也不推进水位线。
 * 省略 UID 时使用本会话唯一的订阅; 零个或多个订阅时给出引导。
 */

import { weiboMonitorService } from '../../services/weibo/monitorService';
import type { WeiboMonitor } from '../../weibo/types';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export type LatestTarget =
    | { kind: 'uid'; uid: string }
    | { kind: 'none' }
    | { kind: 'ambiguous'; monitors: WeiboMonitor[] };

/**
 * 解析 latest 的目标博主
 *
 * 显式 UID 优先; 省略时只在本会话恰好一个订阅时自动选用,
 * 零个或多个都不猜测 (多订阅需要用户明确选择)。
 */
export function resolveLatestTarget(
    commands: readonly string[],
    monitors: readonly WeiboMonitor[],
): LatestTarget {
    const explicit = commands[0];
    if (explicit) return { kind: 'uid', uid: explicit };
    if (monitors.length === 0) return { kind: 'none' };
    if (monitors.length > 1) {
        return { kind: 'ambiguous', monitors: [...monitors] };
    }
    const only = monitors[0];
    return only ? { kind: 'uid', uid: only.uid } : { kind: 'none' };
}

export const latestHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const target = resolveLatestTarget(
        commands,
        weiboMonitorService.list(userRole.from),
    );

    if (target.kind === 'none') {
        await sendReply(
            ctx,
            event,
            '本会话尚未订阅任何微博博主，发送 #weibo add UID 添加',
        );
        return;
    }
    if (target.kind === 'ambiguous') {
        const lines = target.monitors.map(
            (monitor) => `@${monitor.screenName} (${monitor.uid})`,
        );
        await sendReply(
            ctx,
            event,
            `本会话订阅了多位博主，请指定 UID：\n${lines.join('\n')}`,
        );
        return;
    }

    const uid = target.uid;
    try {
        const post = await weiboMonitorService.latest(uid);
        if (!post) {
            await sendReply(ctx, event, '该博主暂无可用动态');
            return;
        }

        const result = await weiboMonitorService.pushLatest(
            post,
            uid,
            userRole.from,
        );
        if (result.pushed === 0) {
            await sendReply(ctx, event, '发送失败，请稍后重试');
        }
    } catch (error) {
        await sendReply(
            ctx,
            event,
            `获取微博动态失败：${messageOf(error)}`,
        );
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
