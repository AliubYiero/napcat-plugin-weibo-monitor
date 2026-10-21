/**
 * 订阅列表指令 (`<前缀> list`)
 */

import {
    formatLimit,
    weiboLimitService,
} from '../../services/weibo/limitService';
import { weiboMonitorService } from '../../services/weibo/monitorService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

export const listHandler: InstructionHandler = async (
    ctx,
    event,
    _commands,
    userRole,
) => {
    const monitors = weiboMonitorService.list(userRole.from);
    if (monitors.length === 0) {
        await sendReply(ctx, event, '本会话尚未订阅任何微博博主');
        return;
    }

    const view = weiboLimitService.get(userRole.from);
    const lines = monitors.map(
        (monitor, index) =>
            `${index + 1}. @${monitor.screenName} (${monitor.uid})`,
    );
    lines.push(`共 ${view.used}/${formatLimit(view.limit)} 个订阅`);
    await sendReply(ctx, event, lines.join('\n'));
};
