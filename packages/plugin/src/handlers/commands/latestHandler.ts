/**
 * 最新动态指令 (`<前缀> latest <UID>`)
 *
 * 只发当前会话一次, 不要求已订阅, 也不推进水位线。
 */

import { weiboMonitorService } from '../../services/weibo/monitorService';
import { buildPostText, buildPostUrl } from '../../weibo/card';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const latestHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const uid = commands[0] ?? '';
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
            await sendReply(
                ctx,
                event,
                `发送失败，原文链接：${buildPostUrl(post)}\n${buildPostText(post)}`,
            );
        }
    } catch (error) {
        await sendReply(
            ctx,
            event,
            `获取最新动态失败：${messageOf(error)}`,
        );
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
