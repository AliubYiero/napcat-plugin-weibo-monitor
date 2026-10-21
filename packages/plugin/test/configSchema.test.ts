/**
 * 原生配置面板 Schema 构建
 *
 * 范式: docs/config-pattern.md 的「分组布局」与 docs/webui-config-pattern.md
 *      的"字段 kind 分类表"与"字段可见范围 (scope)"。
 * 合同: FIELDS 的 section 渲染为分组标题 (含可选副标题, 经 HTML 转义);
 *       存在可见 section 时单份样式块前置, 无 section 时不注入;
 *       首个 display 的下边距为 12px; scope 过滤与 password 引导块不变。
 */

import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin/types';
import type { ConfigField, SectionFieldDescriptor } from 'shared';
import { describe, expect, it } from 'vitest';
import {
    buildConfigSchema,
    buildConfigSchemaFromFields,
    buildSectionHtml,
} from '../src/config';

/** 分组标题项的判定标记 (避免误匹配样式块中的 `.napcat-plugin-section-title`) */
const SECTION_TITLE_MARK = 'class="napcat-plugin-section-title"';

interface FakeItem {
    type: string;
    key?: string;
    label?: string;
    content?: string;
    options?: unknown;
    default?: unknown;
}

function item(
    type: string,
    key: string,
    label: string,
    def?: unknown,
): FakeItem {
    return { type, key, label, default: def };
}

function makeCtx(): NapCatPluginContext {
    const NapCatConfig = {
        boolean: (key: string, label: string, def?: unknown) =>
            item('boolean', key, label, def),
        text: (key: string, label: string, def?: unknown) =>
            item('text', key, label, def),
        number: (key: string, label: string, def?: unknown) =>
            item('number', key, label, def),
        select: (
            key: string,
            label: string,
            options: unknown,
            def?: unknown,
        ) => ({ ...item('select', key, label, def), options }),
        multiSelect: (
            key: string,
            label: string,
            options: unknown,
            def?: unknown,
        ) => ({ ...item('multi-select', key, label, def), options }),
        html: (content: string): FakeItem => ({
            type: 'html',
            content,
        }),
        plainText: (content: string): FakeItem => ({
            type: 'text',
            content,
        }),
        combine: (...items: FakeItem[]): FakeItem[] => items,
    };
    return {
        pluginName: 'test-plugin',
        pluginManager: {
            getPluginInfo: () => ({
                packageJson: {
                    plugin: '测试插件',
                    description: '测试用',
                },
            }),
        },
        NapCatConfig,
    } as unknown as NapCatPluginContext;
}

const schema = buildConfigSchema(makeCtx()) as unknown as FakeItem[];

/** html 项的内容文本 */
const htmlOf = (it: FakeItem) => String(it.content);

describe('buildConfigSchema 分组布局', () => {
    it('首个 schema 项是分组样式块', () => {
        expect(htmlOf(schema[0])).toContain('<style>');
        expect(htmlOf(schema[0])).toContain(
            '.napcat-plugin-section-title',
        );
        expect(htmlOf(schema[0])).toContain(
            '.napcat-plugin-section-desc',
        );
        expect(htmlOf(schema[0])).toContain(
            '[data-theme="dark"] .napcat-plugin-section-title',
        );
    });

    it('两个 section 都渲染为分组标题 HTML', () => {
        const titles = schema
            .filter((it) => htmlOf(it).includes(SECTION_TITLE_MARK))
            .map((it) => htmlOf(it));
        expect(titles).toHaveLength(2);
        expect(titles[0]).toContain('基础配置');
        expect(titles[1]).toContain('微博监听');
    });

    it('分组标题带副标题, 且位于对应字段之前', () => {
        const baseIndex = schema.findIndex((it) =>
            htmlOf(it).includes(SECTION_TITLE_MARK),
        );
        const adminIndex = schema.findIndex(
            (it) => it.key === 'adminUsers',
        );
        expect(baseIndex).toBeGreaterThan(0);
        expect(adminIndex).toBeGreaterThan(baseIndex);

        const demo = schema.find(
            (it) =>
                htmlOf(it).includes(SECTION_TITLE_MARK) &&
                htmlOf(it).includes('微博监听'),
        );
        expect(htmlOf(demo as FakeItem)).toContain(
            'napcat-plugin-section-desc',
        );
        expect(htmlOf(demo as FakeItem)).toContain(
            '轮询周期与浏览器路径',
        );
    });

    it('首个 display 的下边距为 12px', () => {
        const banner = schema.find(
            (it) =>
                it.type === 'html' &&
                it.content?.includes('跳转至拓展页面') === true,
        );
        expect(banner?.content).toContain('margin-bottom: 12px');
        expect(banner?.content).not.toContain('margin-bottom: 20px');
    });

    it('无可见 section 时不注入样式块', () => {
        const fields = [
            {
                key: 'adminUsers',
                kind: 'stringList',
                label: '超级管理员 QQ',
                description: '',
                default: [],
                placeholder: '',
            },
        ] as const satisfies readonly ConfigField[];
        const plain = buildConfigSchemaFromFields(
            makeCtx(),
            fields,
        ) as unknown as FakeItem[];
        expect(
            plain.some((it) => htmlOf(it).includes('<style>')),
        ).toBe(false);
        expect(plain).toHaveLength(1);
    });
});

describe('buildSectionHtml', () => {
    const field: SectionFieldDescriptor = {
        kind: 'section',
        label: '示例分组',
        description: '分组说明',
    };

    it('渲染标题与副标题', () => {
        const html = buildSectionHtml(field);
        expect(html).toContain('napcat-plugin-section-bar');
        expect(html).toContain('示例分组');
        expect(html).toContain('napcat-plugin-section-desc');
        expect(html).toContain('分组说明');
    });

    it('无 description 时不渲染副标题', () => {
        expect(
            buildSectionHtml({ kind: 'section', label: '无说明' }),
        ).not.toContain('napcat-plugin-section-desc');
    });

    it('标题与说明经 HTML 转义', () => {
        const html = buildSectionHtml({
            kind: 'section',
            label: '<b>标题</b>',
            description: '<script>x</script>',
        });
        expect(html).toContain('&lt;b&gt;标题&lt;/b&gt;');
        expect(html).not.toContain('<script>');
    });
});

describe('buildConfigSchema 其余映射', () => {
    it('scope 为 webui 的字段不出现在原生面板', () => {
        expect(schema.some((it) => it.key === 'triggerModes')).toBe(
            false,
        );
    });

    it('微博配置映射为数字框与文本框', () => {
        const byKey = new Map(
            schema
                .filter((it) => it.key !== undefined)
                .map((it) => [it.key, it]),
        );
        expect(
            byKey.get('weiboPollIntervalMinutes')?.type,
        ).toBe('number');
        expect(byKey.get('chromeExecutablePath')?.type).toBe(
            'text',
        );
    });

    it('其余 kind 映射到对应控件', () => {
        const byKey = new Map(
            schema
                .filter((it) => it.key !== undefined)
                .map((it) => [it.key, it]),
        );
        expect(byKey.get('adminUsers')?.type).toBe('text');
    });

    it('display 横幅解析占位符', () => {
        const banner = schema.find(
            (it) =>
                it.type === 'html' &&
                it.content?.includes('跳转至拓展页面') === true,
        );
        expect(banner?.content).toContain('测试插件');
        expect(banner?.content).not.toContain('{{');
    });
});
