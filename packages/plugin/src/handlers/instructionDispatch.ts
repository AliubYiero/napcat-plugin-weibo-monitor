/**
 * 指令分发层
 *
 * 范式: docs/instruction-pattern.md
 * - 【必须】校验在分发层统一完成: 角色推导与比较能力由权限模块提供
 *   (docs/permission-pattern.md), 但**校验时机与失败反馈收敛在本模块**
 * - 【必须】校验失败反馈不对称是设计而非偶然:
 *     权限不足 → 静默 (防权限探测, 回复会暴露指令面)
 *     作用域不符 → 回复提示 (可用性信息, 不敏感)
 *     会话未启用 → 只提示超管 (唯一能修复的人), 其余静默
 *     未知指令 → 静默 (同上)
 * - 【必须】handler 内不重复校验
 *
 * `resolveDispatch` 是纯函数 (只读传入的 commands / userRole / sessionEnabled),
 * 因此校验策略可被单测直接覆盖; `dispatch` 只负责读取会话状态并把判定结果
 * 落到发送与执行。
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import { hasRole, type UserRole } from '../core/admin';
import { pluginState } from '../core/state';
import { sessionConfigService } from '../services/sessionConfigService';
import {
    type InstructionDefinition,
    instructionSetMapper,
    rootInstructionSetMapper,
} from './instructionRegistry';
import { sendReply } from './utils';

/** 分发判定结果 */
export type DispatchDecision =
    /** 静默: 未知指令 / 权限不足 / scopeRules 未命中 / 非超管的会话门禁命中 */
    | { type: 'silent' }
    /** 作用域不符: 回复固定提示 */
    | { type: 'scopeHint'; message: string }
    /** 会话未启用: 只回复超管, 给出开启指令 */
    | { type: 'sessionHint'; message: string }
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

const SESSION_HINT = '本群未启用微博推送, 发送 #weibo enable 开启';

/**
 * 解析分发结果 (纯函数)
 *
 * 校验顺序固定: 注册表命中 → 形态匹配 → 权限 → 作用域 → 会话门禁。
 * 只要前面的层失败, 就不向后暴露作用域或启用状态。
 *
 * @param commands 去前缀并切词后的参数数组 (`['reminder', 'add', '...']`)
 * @param userRole 入口处推导的角色 (来源会话即 `userRole.from.type`)
 * @param sessionEnabled 来源会话是否已启用 (由调用方从单一查询入口读取)
 */
export function resolveDispatch(
    commands: string[],
    userRole: UserRole,
    sessionEnabled: boolean,
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
        // 无同来源规则时回退到首个规则: 由后续权限校验决定
        // 「无权静默」还是「有权但作用域不符 → 提示」。
        const rule =
            candidates.find((r) => r.scope === userRole.from.type) ??
            candidates.find((r) => !r.scope) ??
            candidates[0];
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

    // 会话启用门禁: 默认生效, 开关类指令显式豁免 (ADR 0007)。
    // 未启用时只提示超管 (唯一能自救的人), 其余静默以不暴露指令面。
    if (
        definition.requiresSessionEnabled !== false &&
        !sessionEnabled
    ) {
        return hasRole(userRole, 'superAdmin')
            ? { type: 'sessionHint', message: SESSION_HINT }
            : { type: 'silent' };
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
    const sessionEnabled = sessionConfigService.isSessionEnabled(
        userRole.from.id,
        userRole.from.type,
    );
    const decision = resolveDispatch(
        commands,
        userRole,
        sessionEnabled,
    );

    switch (decision.type) {
        case 'silent':
            return;
        case 'scopeHint':
        case 'sessionHint':
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
