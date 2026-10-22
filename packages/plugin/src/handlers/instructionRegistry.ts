/**
 * 指令注册表 (装配层, 不含业务逻辑)
 *
 * 范式: docs/instruction-pattern.md
 * - 【必须】新增指令 = 注册表加一行; handler 写成独立文件 (handlers/commands/),
 *   注册表只做装配
 * - 【必须】指令名在分发前统一小写, 指令不区分大小写
 * - 【必须】因此**注册表的键必须全小写**——分发层用小写后的名字查表,
 *   驼峰或大写键永远命中不了 (不会被报错, 只会静默失效)
 * - 【必须】未命中模块/子指令/一级指令时静默返回 (见 instructionDispatch)
 *
 * 两种命名空间形态最终汇入同一个校验终点 (dispatch):
 * - 二级命名空间: 模块 → 子指令, 注册在 instructionSetMapper
 * - 一级命名空间: 无模块前缀的直达指令, 注册在 rootInstructionSetMapper
 */

import type { OB11Message } from 'napcat-types/napcat-onebot';
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { UserRole, UserRoleName } from '../core/admin';
import { addHandler } from './commands/addHandler';
import { disableHandler } from './commands/disableHandler';
import { enableHandler } from './commands/enableHandler';
import { helpHandler } from './commands/helpHandler';
import { latestHandler } from './commands/latestHandler';
import { listHandler } from './commands/listHandler';
import { maxHandler } from './commands/maxHandler';
import { removeHandler } from './commands/removeHandler';

/**
 * 指令 handler
 *
 * 【必须】收到的参数已保证满足角色与作用域要求, handler 内部不再重复校验。
 * 第四个参数 `userRole` 是入口处一次性推导的结果, 不需要时省略该形参即可。
 */
export type InstructionHandler = (
    ctx: NapCatPluginContext,
    event: OB11Message,
    commands: string[],
    userRole: UserRole,
) => void | Promise<void>;

/** 形态化作用域规则: 同一指令按参数个数绑定不同权限/作用域 */
export interface ScopeRule {
    /** 命中的参数个数 */
    args: number;
    /** 允许的会话类型, 缺省不限 */
    scope?: 'group' | 'private';
    /** 执行所需最低角色, 缺省 user */
    requiredRole?: UserRoleName;
}

/** 指令定义: 一个执行函数 + 可选的门槛声明 */
export interface InstructionDefinition {
    handler: InstructionHandler;
    /** 执行所需最低角色; 缺省 user (所有人可用) */
    requiredRole?: UserRoleName;
    /** 允许的会话类型; 缺省不限; 不满足时回复固定提示 */
    scope?: 'group' | 'private';
    /**
     * 是否要求会话已启用 (默认 true, 缺失即禁用)。
     *
     * 【必须】只有能让会话通过门禁的开关指令才声明 false; 豁免声明放在指令定义上,
     * 不在接收层做名单或字符串特判 (见 ADR 0007)。
     */
    requiresSessionEnabled?: boolean;
    /**
     * 形态化作用域规则 (进阶): 声明后按 args 数匹配第一条规则
     * 【必须】未命中任何形态时静默返回, 因此新增参数形态时必须同步补充条目。
     */
    scopeRules?: ScopeRule[];
}

/**
 * 二级命名空间: 模块 → 子指令 → 定义
 *
 * 装配示例 (`#cmd reminder add ...`):
 *
 * ```ts
 * reminder: {
 *     add: { handler: addReminderHandler, requiredRole: 'admin', scope: 'group' },
 *     list: { handler: listReminderHandler, scope: 'group' },
 *     // 形态化: 无参查看是 admin 级, 带参设置是超管级
 *     max: {
 *         handler: setMaxHandler,
 *         scopeRules: [
 *             { args: 0, scope: 'group', requiredRole: 'admin' },
 *             { args: 1, scope: 'group', requiredRole: 'superAdmin' },
 *         ],
 *     },
 * },
 * ```
 */
export const instructionSetMapper: Record<
    string,
    Record<string, InstructionDefinition>
> = {};

/** 一级命名空间: 指令名 → 定义 (无模块前缀的直达指令) */
export const rootInstructionSetMapper: Record<
    string,
    InstructionDefinition
> = {
    help: { handler: helpHandler, scopeRules: [{ args: 0 }] },
    add: {
        handler: addHandler,
        scopeRules: [
            { args: 1, scope: 'group', requiredRole: 'admin' },
            { args: 1, scope: 'private', requiredRole: 'superAdmin' },
        ],
    },
    remove: {
        handler: removeHandler,
        scopeRules: [
            { args: 1, scope: 'group', requiredRole: 'admin' },
            { args: 1, scope: 'private', requiredRole: 'superAdmin' },
        ],
    },
    list: { handler: listHandler, scopeRules: [{ args: 0 }] },
    latest: {
        handler: latestHandler,
        scopeRules: [{ args: 0 }, { args: 1 }],
    },
    max: {
        handler: maxHandler,
        scopeRules: [
            { args: 0, scope: 'group', requiredRole: 'admin' },
            { args: 0, scope: 'private', requiredRole: 'superAdmin' },
            { args: 1, scope: 'group', requiredRole: 'superAdmin' },
        ],
    },
    // 会话开关: 唯一豁免会话启用门禁的指令 (否则未启用的群无法自救)
    enable: {
        handler: enableHandler,
        requiresSessionEnabled: false,
        scopeRules: [
            { args: 0, scope: 'group', requiredRole: 'superAdmin' },
        ],
    },
    disable: {
        handler: disableHandler,
        requiresSessionEnabled: false,
        scopeRules: [
            { args: 0, scope: 'group', requiredRole: 'superAdmin' },
        ],
    },
};
