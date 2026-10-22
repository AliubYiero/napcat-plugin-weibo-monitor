/**
 * 会话开关指令 (`<前缀> enable`)
 *
 * 开启当前群聊的微博监听推送。仅 superAdmin 可用, 作用域仅群聊;
 * 它豁免会话启用门禁 (`requiresSessionEnabled: false`), 否则无法在未启用的群里执行。
 * 幂等: 重复开启只回执当前状态, 只有真正发生变更时才触发立即拉取。
 */

import { sessionConfigService } from '../../services/sessionConfigService';
import { weiboPollingService } from '../../services/weibo/pollingService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const enableHandler: InstructionHandler = async (
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
        sessionConfigService.setSessionEnabled(id, type, true);
        if (!alreadyEnabled) weiboPollingService.requestImmediate();

        await sendReply(
            ctx,
            event,
            alreadyEnabled
                ? '本群已启用微博推送'
                : '本群微博推送已开启',
        );
    } catch (error) {
        await sendReply(ctx, event, `开启失败：${messageOf(error)}`);
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
