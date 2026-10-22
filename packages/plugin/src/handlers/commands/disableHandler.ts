/**
 * 会话开关指令 (`<前缀> disable`)
 *
 * 关闭当前群聊的微博监听推送。仅 superAdmin 可用, 作用域仅群聊;
 * 它豁免会话启用门禁 (`requiresSessionEnabled: false`), 否则已停用后无法再执行。
 * 关闭只停止推送与拉取, 不删除订阅; 重新开启后按游标重建处理, 不补发期间动态。
 */

import { sessionConfigService } from '../../services/sessionConfigService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const disableHandler: InstructionHandler = async (
    ctx,
    event,
    _commands,
    userRole,
) => {
    const { id, type } = userRole.from;
    try {
        const alreadyEnabled = sessionConfigService.isSessionEnabled(
            id,
            type,
        );
        sessionConfigService.setSessionEnabled(id, type, false);

        await sendReply(
            ctx,
            event,
            alreadyEnabled
                ? '本群微博推送已关闭, 订阅保留; 重新开启后不会补发期间动态'
                : '本群未启用微博推送',
        );
    } catch (error) {
        await sendReply(ctx, event, `关闭失败：${messageOf(error)}`);
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
