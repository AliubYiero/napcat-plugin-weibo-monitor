/**
 * 指令分发层
 *
 * 范式: docs/instruction-pattern.md
 * - 【必须】校验在分发层统一完成: 角色推导与比较能力由权限模块提供
 *   (docs/permission-pattern.md), 但**校验时机与失败反馈收敛在本模块**
 * - 【必须】校验失败反馈不对称是设计而非偶然:
 *     权限不足 → 静默 (防权限探测, 回复会暴露指令面)
 *     作用域不符 → 回复提示 (可用性信息, 不敏感)
 *     未知指令 → 静默 (同上)
 * - 【必须】handler 内不重复校验
 *
 * `resolveDispatch` 是纯函数 (只读传入的 commands 与 userRole), 因此校验策略
 * 可被单测直接覆盖; `dispatch` 只负责把判定结果落到发送与执行。
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { hasRole, type UserRole } from '../core/admin';
import { pluginState } from '../core/state';
import {
    type InstructionDefinition,
    instructionSetMapper,
    rootInstructionSetMapper,
} from './instructionRegistry';
import { sendReply } from './utils';

/** 分发判定结果 */
export type DispatchDecision =
    /** 静默: 未知指令 / 权限不足 / scopeRules 未命中 */
    | { type: 'silent' }
    /** 作用域不符: 回复固定提示 */
    | { type: 'scopeHint'; message: string }
    /** 执行: 参数已切好, 门槛已通过 */
    | {
          type: 'run';
          definition: InstructionDefinition;
          commands: string[];
      };

const SCOPE_HINT: Record<'group' | 'private', string> = {
    group: '该指令仅限群聊使用',
    private: '该指令仅限私聊使用',
};

/**
 * 解析分发结果 (纯函数)
 *
 * @param commands 去前缀并切词后的参数数组 (`['reminder', 'add', '...']`)
 * @param userRole 入口处推导的角色 (来源会话即 `userRole.from.type`)
 */
export function resolveDispatch(
    commands: string[],
    userRole: UserRole,
): DispatchDecision {
    const arg1 = (commands[0] ?? '').toLowerCase();
    if (!arg1) return { type: 'silent' };

    // 先查二级 (arg1 为模块名、arg2 为子指令名), 未命中再查一级
    let definition: InstructionDefinition | undefined;
    let rest: string[] = [];
    const moduleMap = instructionSetMapper[arg1];
    const arg2 = (commands[1] ?? '').toLowerCase();
    if (moduleMap && arg2 && moduleMap[arg2]) {
        definition = moduleMap[arg2];
        rest = commands.slice(2);
    } else if (rootInstructionSetMapper[arg1]) {
        definition = rootInstructionSetMapper[arg1];
        rest = commands.slice(1);
    }

    // 未知指令: 静默, 不暴露指令面
    if (!definition) return { type: 'silent' };

    let requiredRole = definition.requiredRole;
    let scope = definition.scope;

    // 形态化作用域规则: 命中即用其门槛, 未命中静默 (权限防线闭合, 无穿透路径)
    // 同一参数个数可声明多条按来源会话区分的规则 (群 admin / 私聊超管),
    // 优先取 scope 与当前来源一致者, 其次取未限定 scope 的兜底规则。
    if (definition.scopeRules?.length) {
        const candidates = definition.scopeRules.filter(
            (r) => r.args === rest.length,
        );
        const rule =
            candidates.find(
                (r) => r.scope === userRole.from.type,
            ) ?? candidates.find((r) => !r.scope);
        if (!rule) return { type: 'silent' };
        requiredRole = rule.requiredRole;
        scope = rule.scope;
    }

    // 权限不足: 静默 (放最前, 避免在无权时泄露作用域信息)
    if (requiredRole && !hasRole(userRole, requiredRole))
        return { type: 'silent' };

    // 作用域不符: 回复提示
    if (scope && scope !== userRole.from.type) {
        return { type: 'scopeHint', message: SCOPE_HINT[scope] };
    }

    return { type: 'run', definition, commands: rest };
}

/**
 * 分发入口: 判定 → 反馈或执行
 *
 * 【必须】本函数不吞异常, 由接收层 (messageHandler) 统一 try/catch,
 * 保证任何 handler 异常都不会外抛到插件宿主。
 */
export async function dispatch(
    ctx: NapCatPluginContext,
    event: OB11Message,
    commands: string[],
    userRole: UserRole,
): Promise<void> {
    const decision = resolveDispatch(commands, userRole);

    switch (decision.type) {
        case 'silent':
            return;
        case 'scopeHint':
            await sendReply(ctx, event, decision.message);
            return;
        case 'run':
            // 已受理的指令在此统一计数 (分发层是唯一收口点)
            pluginState.incrementProcessed();
            await decision.definition.handler(
                ctx,
                event,
                decision.commands,
                userRole,
            );
            return;
    }
}
