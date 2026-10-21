/**
 * 订阅上限指令 (`<前缀> max [N]`)
 *
 * 无参查看当前会话上限; 带参设置当前群上限 (仅超管)。
 */

import {
    formatLimit,
    MAX_GROUP_LIMIT,
    weiboLimitService,
} from '../../services/weibo/limitService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const maxHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const raw = commands[0];

    try {
        if (raw === undefined) {
            const view = weiboLimitService.get(userRole.from);
            await sendReply(
                ctx,
                event,
                `本会话订阅上限：${formatLimit(view.limit)}\n` +
                    `当前已订阅：${view.used} 个`,
            );
            return;
        }

        if (!/^\d+$/.test(raw)) {
            await sendReply(ctx, event, '上限必须是非负整数');
            return;
        }

        const value = Number.parseInt(raw, 10);
        weiboLimitService.set(userRole.from, value);
        const view = weiboLimitService.get(userRole.from);
        await sendReply(
            ctx,
            event,
            `本会话订阅上限已设为 ${formatLimit(view.limit)} (最大 ${MAX_GROUP_LIMIT})`,
        );
    } catch (error) {
        await sendReply(ctx, event, `设置失败：${messageOf(error)}`);
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
