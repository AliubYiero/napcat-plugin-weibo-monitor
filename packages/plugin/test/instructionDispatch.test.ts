/**
 * 分发层判定: 未知指令/权限不足静默, 作用域不符回复提示
 *
 * 范式: docs/instruction-pattern.md
 * 校验失败反馈不对称是设计而非偶然——回复"权限不足"会让攻击者枚举出插件的
 * 完整指令面, 因此权限与未知指令静默; 作用域不敏感, 回复提示以保可用性。
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { UserRole, UserRoleName } from '../src/core/admin';
import { resolveDispatch } from '../src/handlers/instructionDispatch';
import {
    type InstructionDefinition,
    instructionSetMapper,
} from '../src/handlers/instructionRegistry';

const noop = () => {};

/**
 * 测试期临时注册的形态, 不改动模板自带的注册表:
 * 覆盖 requiredRole / scope / scopeRules 三种门槛声明。
 */
const FIXTURE_MODULE = 'testfixture';

beforeAll(() => {
    instructionSetMapper[FIXTURE_MODULE] = {
        adminonly: { handler: noop, requiredRole: 'admin' },
        grouponly: { handler: noop, scope: 'group' },
        max: {
            handler: noop,
            scopeRules: [
                { args: 0, requiredRole: 'admin' },
                { args: 1, requiredRole: 'superAdmin' },
            ],
        },
    } satisfies Record<string, InstructionDefinition>;
});

function role(
    name: UserRoleName,
    type: 'group' | 'private' = 'group',
): UserRole {
    return { userId: '1', role: name, from: { id: '1', type } };
}

/** 默认按「会话已启用」调用, 门禁用例显式传 false */
function resolve(
    commands: string[],
    userRole: UserRole,
    sessionEnabled = true,
) {
    return resolveDispatch(commands, userRole, sessionEnabled);
}

describe('resolveDispatch: 注册表命中', () => {
    it('一级指令命中, 参数切掉指令名', () => {
        const decision = resolve(['help'], role('user'));
        expect(decision).toMatchObject({ type: 'run', commands: [] });
    });

    it('二级指令命中, 参数切掉模块名与子指令名', () => {
        const decision = resolve(
            [FIXTURE_MODULE, 'adminonly', 'a', 'b'],
            role('admin'),
        );
        expect(decision).toMatchObject({
            type: 'run',
            commands: ['a', 'b'],
        });
    });

    it('指令名不区分大小写', () => {
        expect(resolve(['HELP'], role('user')).type).toBe('run');
        expect(
            resolve(
                [FIXTURE_MODULE.toUpperCase(), 'ADMINONLY'],
                role('admin'),
            ).type,
        ).toBe('run');
    });

    it('latest 允许无参与带参两种形态', () => {
        expect(resolve(['latest'], role('user'))).toMatchObject({
            type: 'run',
            commands: [],
        });
        expect(
            resolve(['latest', '123456'], role('user')),
        ).toMatchObject({ type: 'run', commands: ['123456'] });
    });
});

describe('resolveDispatch: 静默路径 (防权限探测)', () => {
    it('未知指令静默', () => {
        expect(resolve(['nope'], role('user')).type).toBe('silent');
        expect(
            resolve([FIXTURE_MODULE, 'nope'], role('superAdmin'))
                .type,
        ).toBe('silent');
    });

    it('空指令静默', () => {
        expect(resolve([], role('user')).type).toBe('silent');
        expect(resolve([''], role('user')).type).toBe('silent');
    });

    it('权限不足静默, 不回复"权限不足"', () => {
        expect(
            resolve([FIXTURE_MODULE, 'adminonly'], role('user')).type,
        ).toBe('silent');
    });

    it('scopeRules 未命中形态时静默 (权限防线闭合)', () => {
        // max 只声明了 0 个与 1 个参数的形态
        expect(
            resolve(
                [FIXTURE_MODULE, 'max', 'a', 'b'],
                role('superAdmin'),
            ).type,
        ).toBe('silent');
    });
});

describe('resolveDispatch: 作用域不符回复提示', () => {
    it('仅群聊指令在私聊使用 → 提示', () => {
        expect(
            resolve(
                [FIXTURE_MODULE, 'grouponly'],
                role('user', 'private'),
            ),
        ).toEqual({
            type: 'scopeHint',
            message: '该指令仅限群聊使用',
        });
    });

    it('作用域一致时正常执行', () => {
        expect(
            resolve(
                [FIXTURE_MODULE, 'grouponly'],
                role('user', 'group'),
            ).type,
        ).toBe('run');
    });
});

describe('resolveDispatch: scopeRules 按参数个数分档', () => {
    it('无参形态: admin 可用', () => {
        expect(
            resolve([FIXTURE_MODULE, 'max'], role('admin')).type,
        ).toBe('run');
    });

    it('无参形态: 低于 admin 静默', () => {
        expect(
            resolve([FIXTURE_MODULE, 'max'], role('user')).type,
        ).toBe('silent');
    });

    it('带参形态: 需要超管', () => {
        expect(
            resolve([FIXTURE_MODULE, 'max', '5'], role('admin')).type,
        ).toBe('silent');
        expect(
            resolve([FIXTURE_MODULE, 'max', '5'], role('superAdmin'))
                .type,
        ).toBe('run');
    });
});

describe('resolveDispatch: 会话启用门禁', () => {
    it('未启用时只提示超管', () => {
        expect(resolve(['help'], role('superAdmin'), false)).toEqual({
            type: 'sessionHint',
            message: '本群未启用微博推送, 发送 #weibo enable 开启',
        });
    });

    it('未启用时非超管静默 (含群管理)', () => {
        expect(resolve(['help'], role('admin'), false).type).toBe(
            'silent',
        );
        expect(resolve(['help'], role('user'), false).type).toBe(
            'silent',
        );
    });

    it('只有开关指令豁免门禁', () => {
        expect(
            resolve(['enable'], role('superAdmin'), false).type,
        ).toBe('run');
        expect(
            resolve(['disable'], role('superAdmin'), false).type,
        ).toBe('run');
    });

    it('开关指令仅限超管, 且仅限群聊', () => {
        expect(resolve(['enable'], role('admin')).type).toBe(
            'silent',
        );
        expect(
            resolve(['enable'], role('superAdmin', 'private')),
        ).toEqual({
            type: 'scopeHint',
            message: '该指令仅限群聊使用',
        });
    });

    it('开关指令带多余参数时静默 (形态未声明)', () => {
        expect(
            resolve(['enable', 'now'], role('superAdmin'), false)
                .type,
        ).toBe('silent');
    });
});
