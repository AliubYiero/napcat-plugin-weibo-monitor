/**
 * 消息接收入口 (接收层)
 *
 * 范式: docs/instruction-pattern.md 的 "一、接收层: handleMessage"
 * 职责固定为三步, 顺序不可调换:
 *   1. 触发判定 (规范化 + 前缀检查) → 2. 切词 → 3. 分发
 *
 * 【必须】接收层不认识指令语义, 也**不做权限校验与会话启用检查**——它们属于指令语义,
 * 由分发层统一处理 (见 instructionDispatch)。会话门禁若在此处短路, 未启用的群
 * 就永远无法执行「开启本群」的指令 (ADR 0007)。
 * 【必须】整个函数包在 try/catch 中, 异常记日志不外抛: 它是所有消息事件的入口,
 * 异常外抛会影响插件宿主。
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { getUserRole } from '../core/admin';
import { pluginState } from '../core/state';
import {
    resolveTriggerCommand,
    stripAtBotPrefix,
} from '../utils/atBotPrefix';
import { dispatch } from './instructionDispatch';

/** selfId 缺失的 debug 日志只记一次, 避免每条消息刷屏 */
let warnedMissingSelfId = false;

/**
 * 消息处理主函数
 *
 * 各步的静默约定: 未命中触发方式、未知指令、权限不足、会话未启用 (非超管)
 * 一律静默且不记日志; 只有 @机器人 触发成功与 selfId 无效两种情况记 debug 日志。
 */
export async function handleMessage(
    ctx: NapCatPluginContext,
    event: OB11Message,
): Promise<void> {
    try {
        const rawMessage = event.raw_message || '';

        // 1. 触发判定: 按配置的触发方式 (prefix / atBot) 判定并取出前缀后的参数文本;
        //    两种方式都未命中 (含都未启用) 一律静默返回。
        //    注意: 此处不做会话启用检查, 门禁由分发层负责 (ADR 0007)。
        const triggerModes = pluginState.config.triggerModes;
        const args = resolveTriggerCommand(
            rawMessage,
            pluginState.selfId,
            triggerModes,
        );
        if (args === null) return;

        // debug: 只记 @机器人 触发相关 (仅 atBot 方式启用时); 普通前缀不匹配仍保持静默
        if (triggerModes.includes('atBot')) {
            if (!pluginState.selfId) {
                if (!warnedMissingSelfId) {
                    warnedMissingSelfId = true;
                    pluginState.logger.debug(
                        '机器人 QQ 号未知, 已跳过 @机器人 触发判定',
                    );
                }
            } else {
                const trimmed = rawMessage.trim();
                if (
                    stripAtBotPrefix(trimmed, pluginState.selfId) !==
                    trimmed
                ) {
                    pluginState.logger.debug(
                        `经 @机器人 触发: "${trimmed}"`,
                    );
                }
            }
        }

        // 2. 切词: 前缀后的参数文本按空白切分, 空串会切出 [''], 由分发层的参数检查兜底
        const commands = args.trim().split(/\s+/);

        // 3. 分发: 角色在入口一次性推导, 分发层与 handler 复用同一个 UserRole
        await dispatch(ctx, event, commands, getUserRole(event));
    } catch (error) {
        pluginState.logger.error('处理消息时出错:', error);
    }
}
