/**
 * 订阅指令 (`<前缀> add <UID>`)
 *
 * 群管理员与私聊超管可用; 门槛由注册表的 scopeRules 声明。
 */

import {
    formatLimit,
    weiboLimitService,
} from '../../services/weibo/limitService';
import { weiboMonitorService } from '../../services/weibo/monitorService';
import { weiboPollingService } from '../../services/weibo/pollingService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const addHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const uid = commands[0] ?? '';
    try {
        const { monitor } = await weiboMonitorService.add(
            uid,
            userRole.from,
        );
        const view = weiboLimitService.get(userRole.from);
        await sendReply(
            ctx,
            event,
            `已订阅 @${monitor.screenName} (${monitor.uid})。\n` +
                `本会话订阅数：${view.used}/${formatLimit(view.limit)}`,
        );
        weiboPollingService.requestImmediate();
    } catch (error) {
        await sendReply(ctx, event, `订阅失败：${messageOf(error)}`);
    }
};

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
