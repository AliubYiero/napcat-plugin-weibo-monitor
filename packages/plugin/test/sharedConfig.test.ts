import type { ConfigField } from 'shared';
import {
    COMMAND_PREFIX,
    FIELDS,
    getDefaultConfig,
    parseStringList,
    sanitizeConfig,
} from 'shared';
import { describe, expect, it } from 'vitest';

const EXPECTED_KEYS = [
    'adminUsers',
    'triggerModes',
    'weiboPollIntervalMinutes',
    'chromeExecutablePath',
];

type ValueField = Extract<(typeof FIELDS)[number], { key: string }>;

const FIELDS_ALL: readonly ConfigField[] = FIELDS;

describe('FIELDS 声明源', () => {
    it('有值字段键集与 PluginConfig 一致', () => {
        const keys = FIELDS.filter(
            (field): field is ValueField => 'key' in field,
        ).map((field) => field.key);
        expect([...keys].sort()).toEqual([...EXPECTED_KEYS].sort());
    });

    it('每个有值字段都声明了可渲染的 base kind 与默认值', () => {
        const valueKinds = [
            'boolean',
            'text',
            'password',
            'number',
            'select',
            'multiSelect',
            'stringList',
        ];
        for (const field of FIELDS) {
            if (!('key' in field)) continue;
            expect(valueKinds).toContain(field.kind);
            expect(field).toHaveProperty('default');
        }
    });

    it('布局/展示字段不带 key, 且 scope 取值合法', () => {
        for (const field of FIELDS_ALL) {
            if ('key' in field) continue;
            expect(['section', 'display']).toContain(field.kind);
            if (field.scope) {
                expect(['webui', 'panel', 'both']).toContain(
                    field.scope,
                );
            }
        }
    });

    it('指令前缀为 #weibo', () => {
        expect(COMMAND_PREFIX).toBe('#weibo');
    });
});

describe('getDefaultConfig: 从 FIELDS 派生', () => {
    it('返回值正确, 且每次新建 (数组不共享)', () => {
        const a = getDefaultConfig();
        const b = getDefaultConfig();
        expect(a).toEqual({
            adminUsers: [],
            triggerModes: ['prefix', 'atBot'],
            weiboPollIntervalMinutes: 60,
            chromeExecutablePath: '',
        });
        expect(a).not.toBe(b);
        expect(a.adminUsers).not.toBe(b.adminUsers);
        expect(a.triggerModes).not.toBe(b.triggerModes);
    });
});

describe('parseStringList codec', () => {
    it('逗号 / 换行分隔 → 去空白去空项', () => {
        expect(parseStringList(' 10001 , 10002 ,, ')).toEqual([
            '10001',
            '10002',
        ]);
        expect(parseStringList('10001\n10002\r\n10003')).toEqual([
            '10001',
            '10002',
            '10003',
        ]);
        expect(parseStringList(',,,')).toEqual([]);
    });
});

describe('sanitizeConfig: 从 kind 派生', () => {
    it('整体非法回退默认', () => {
        expect(sanitizeConfig(null)).toEqual(getDefaultConfig());
        expect(sanitizeConfig([1, 2])).toEqual(getDefaultConfig());
    });

    it('stringList: 逗号与数组容错, 空数组合法, 类型不符回退默认', () => {
        expect(
            sanitizeConfig({ adminUsers: '1, 2' }).adminUsers,
        ).toEqual(['1', '2']);
        expect(
            sanitizeConfig({ adminUsers: [1, ' 2 '] }).adminUsers,
        ).toEqual(['1', '2']);
        expect(sanitizeConfig({ adminUsers: [] }).adminUsers).toEqual(
            [],
        );
        expect(
            sanitizeConfig({ adminUsers: 123 }).adminUsers,
        ).toEqual([]);
    });

    it('number: 越界钳制, 非法回退默认', () => {
        expect(
            sanitizeConfig({ weiboPollIntervalMinutes: 0 })
                .weiboPollIntervalMinutes,
        ).toBe(1);
        expect(
            sanitizeConfig({ weiboPollIntervalMinutes: 9999 })
                .weiboPollIntervalMinutes,
        ).toBe(1440);
        expect(
            sanitizeConfig({ weiboPollIntervalMinutes: '60' })
                .weiboPollIntervalMinutes,
        ).toBe(60);
    });

    it('已移除的字段 (enabled/commandPrefix) 被丢弃', () => {
        const out = sanitizeConfig({
            enabled: true,
            commandPrefix: '#bot',
        }) as unknown as Record<string, unknown>;
        expect(out).not.toHaveProperty('enabled');
        expect(out).not.toHaveProperty('commandPrefix');
    });
});
