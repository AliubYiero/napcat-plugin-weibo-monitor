/**
 * 取消订阅指令 (`<前缀> remove <UID>`)
 */

import { weiboMonitorService } from '../../services/weibo/monitorService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const removeHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const uid = commands[0] ?? '';
    try {
        const removed = weiboMonitorService.remove(
            uid,
            userRole.from,
        );
        await sendReply(
            ctx,
            event,
            removed ? `已取消订阅 ${uid}` : '本会话未订阅该博主',
        );
    } catch (error) {
        await sendReply(
            ctx,
            event,
            `取消订阅失败：${messageOf(error)}`,
        );
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
