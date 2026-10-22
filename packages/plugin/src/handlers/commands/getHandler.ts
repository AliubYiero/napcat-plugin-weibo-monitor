import {
    type PostReadFailure,
    weiboPostService,
} from '../../services/weibo/postService';
import type { InstructionHandler } from '../instructionRegistry';
import { sendReply } from '../utils';

const GET_USAGE = '用法：#weibo get <动态ID>';
const SEND_FAILED = '发送失败，请稍后重试';

const FAILURE_MESSAGES: Record<PostReadFailure, string> = {
    invalid_id: '动态 ID 格式不正确, 应为纯数字或 mblogid 短链',
    login_required: 'Cookie 已失效, 请先在 WebUI 账号页更新',
    cooldown: '操作过于频繁, 请稍后再试',
    not_found: '动态不存在或已删除, 或当前账号无权查看',
    risk: '读取微博失败, 请稍后重试',
    failed: '读取微博失败, 请稍后重试',
};

export const getHandler: InstructionHandler = async (
    ctx,
    event,
    commands,
    userRole,
) => {
    const id = commands[0];
    if (!id) {
        await sendReply(ctx, event, GET_USAGE);
        return;
    }

    const result = await weiboPostService.read(id, userRole.from);
    if (!result.ok) {
        await sendReply(ctx, event, FAILURE_MESSAGES[result.failure]);
        return;
    }

    const sent = await weiboPostService.deliver(
        result.post,
        userRole.from,
    );
    if (!sent) {
        await sendReply(ctx, event, SEND_FAILED);
    }
};
