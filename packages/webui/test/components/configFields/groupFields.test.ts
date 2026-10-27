/**
 * groupFields 纯函数行为
 *
 * 范式: docs/config-pattern.md 的 section 分组语义。
 * 合同: section 是扁平 FIELDS 中的分隔行; 首个 section 前归入「基础配置」;
 *       空组跳过; 被 scope 过滤的 section 不作为分组边界; display 跟随当前组。
 */

import type { ConfigField } from 'shared';
import { describe, expect, it } from 'vitest';
import { groupFields } from '../../../src/components/configFields/groupFields';

const admin: ConfigField = {
    key: 'adminUsers',
    kind: 'stringList',
    label: '超级管理员 QQ',
    default: [],
};

const booleanField: ConfigField = {
    key: 'weiboPollIntervalMinutes',
    kind: 'number',
    label: '轮询间隔',
    default: 60,
};

const display: ConfigField = {
    kind: 'display',
    content: '<span>展示块</span>',
};

const section = (
    label: string,
    description?: string,
): ConfigField => ({ kind: 'section', label, description });

/** 取分组标题, 便于断言顺序 */
const labels = (fields: readonly ConfigField[]) =>
    groupFields(fields).map((group) => group.label);

/** 取每组内的字段 key (布局字段记作 null) */
const keys = (fields: readonly ConfigField[]) =>
    groupFields(fields).map((group) =>
        group.fields.map((field) =>
            'key' in field ? field.key : null,
        ),
    );

describe('groupFields section 分隔语义', () => {
    it('首个 section 前的字段归入基础配置', () => {
        expect(
            labels([
                admin,
                section('直播监听配置'),
                booleanField,
                section('动态监听配置'),
                admin,
            ]),
        ).toEqual(['基础配置', '直播监听配置', '动态监听配置']);
    });

    it('每个 section 开启新组, 后续字段归属该组', () => {
        expect(
            keys([
                section('基础配置'),
                admin,
                section('示例字段'),
                booleanField,
            ]),
        ).toEqual([['adminUsers'], ['weiboPollIntervalMinutes']]);
    });

    it('display 跟随当前组, 不单独成组也不打断分组', () => {
        expect(
            keys([admin, display, section('示例字段'), booleanField]),
        ).toEqual([
            ['adminUsers', null],
            ['weiboPollIntervalMinutes'],
        ]);
    });

    it('section 的 description 透传给分组', () => {
        const groups = groupFields([
            section('基础配置', '全局配置'),
            admin,
        ]);
        expect(groups[0]?.description).toBe('全局配置');
    });

    it('无 description 时分组不携带该字段', () => {
        const groups = groupFields([section('基础配置'), admin]);
        expect(groups[0]?.description).toBeUndefined();
    });
});

describe('groupFields 边界情况', () => {
    it('没有字段时返回空数组', () => {
        expect(groupFields([])).toEqual([]);
    });

    it('连续 section 不产生空卡片', () => {
        expect(
            labels([
                section('空分组 A'),
                section('空分组 B'),
                booleanField,
            ]),
        ).toEqual(['空分组 B']);
    });

    it('末尾没有字段的 section 不渲染', () => {
        expect(
            labels([section('基础配置'), admin, section('尾部空组')]),
        ).toEqual(['基础配置']);
    });

    it('首个 section 之前无字段时不渲染基础配置卡片', () => {
        expect(labels([section('示例字段'), booleanField])).toEqual([
            '示例字段',
        ]);
    });
});

describe('groupFields scope 过滤', () => {
    it('过滤 panel 专属 section, 且不将其作为边界', () => {
        const panelSection: ConfigField = {
            kind: 'section',
            label: '仅面板分组',
            scope: 'panel',
        };
        expect(labels([admin, panelSection, booleanField])).toEqual([
            '基础配置',
        ]);
    });

    it('过滤后的字段仍归入前一个可见分组', () => {
        const panelOnly: ConfigField = {
            kind: 'display',
            content: '<span>仅面板</span>',
            scope: 'panel',
        };
        expect(keys([admin, panelOnly, booleanField])).toEqual([
            ['adminUsers', 'weiboPollIntervalMinutes'],
        ]);
    });
});
