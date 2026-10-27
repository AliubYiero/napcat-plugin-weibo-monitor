/**
 * 配置清洗: 容错规则
 *
 * 范式: docs/config-pattern.md 的"清洗规则分类表"
 * 两条通用原则: 清洗不抛错; 尊重用户显式选择 (空数组/显式 false 是语义, 不是缺失)。
 *
 * 会话级配置 (群/好友) 已迁出配置文件, 由 store 承载, 不在本测试范围。
 */

import { sanitizeConfig } from 'shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';

describe('sanitizeConfig: 输入整体非法', () => {
    it('非对象输入回退默认配置', () => {
        expect(sanitizeConfig(null)).toEqual(DEFAULT_CONFIG);
        expect(sanitizeConfig('nope')).toEqual(DEFAULT_CONFIG);
        expect(sanitizeConfig([1, 2])).toEqual(DEFAULT_CONFIG);
    });

    it('清洗不抛错, 损坏配置下仍能启动', () => {
        expect(() =>
            sanitizeConfig({
                triggerModes: 123,
                adminUsers: { foo: 1 },
            }),
        ).not.toThrow();
    });
});

describe('sanitizeConfig: 标量', () => {
    it('类型不符时保留默认值', () => {
        const out = sanitizeConfig({ chromeExecutablePath: 123 });
        expect(out.chromeExecutablePath).toBe(
            DEFAULT_CONFIG.chromeExecutablePath,
        );
    });

    it('类型正确时采纳外部值', () => {
        const out = sanitizeConfig({
            chromeExecutablePath: 'C:\\chrome.exe',
        });
        expect(out.chromeExecutablePath).toBe('C:\\chrome.exe');
    });
});

describe('sanitizeConfig: 单选 (推送呈现方式)', () => {
    it('命中 options 时采纳', () => {
        expect(
            sanitizeConfig({ weiboPushRenderMode: 'text' })
                .weiboPushRenderMode,
        ).toBe('text');
        expect(
            sanitizeConfig({ weiboPushRenderMode: 'image' })
                .weiboPushRenderMode,
        ).toBe('image');
    });

    it('非法值回退默认', () => {
        expect(
            sanitizeConfig({ weiboPushRenderMode: 'video' })
                .weiboPushRenderMode,
        ).toBe(DEFAULT_CONFIG.weiboPushRenderMode);
        expect(
            sanitizeConfig({ weiboPushRenderMode: 1 })
                .weiboPushRenderMode,
        ).toBe(DEFAULT_CONFIG.weiboPushRenderMode);
    });
});

describe('sanitizeConfig: 多选 (指令触发方式)', () => {
    it('非数组输入回退默认', () => {
        expect(
            sanitizeConfig({ triggerModes: 'prefix' }).triggerModes,
        ).toEqual(DEFAULT_CONFIG.triggerModes);
    });

    it('过滤非法值', () => {
        expect(
            sanitizeConfig({ triggerModes: ['prefix', 'bogus'] })
                .triggerModes,
        ).toEqual(['prefix']);
    });

    it('空数组是合法语义, 不回退默认', () => {
        expect(
            sanitizeConfig({ triggerModes: [] }).triggerModes,
        ).toEqual([]);
    });
});

describe('sanitizeConfig: 多选 (推送内容类型)', () => {
    it('过滤非法值并保留合法子集', () => {
        expect(
            sanitizeConfig({
                weiboPushContentTypes: ['like', 'bogus', 'birthday'],
            }).weiboPushContentTypes,
        ).toEqual(['like', 'birthday']);
    });

    it('空数组是合法语义 (只推原创)', () => {
        expect(
            sanitizeConfig({ weiboPushContentTypes: [] })
                .weiboPushContentTypes,
        ).toEqual([]);
    });

    it('非数组输入回退默认', () => {
        expect(
            sanitizeConfig({ weiboPushContentTypes: 'like' })
                .weiboPushContentTypes,
        ).toEqual(DEFAULT_CONFIG.weiboPushContentTypes);
    });
});

describe('sanitizeConfig: 字符串列表 (超管名单)', () => {
    it('逗号分隔串 → 去空白去空项的数组', () => {
        expect(
            sanitizeConfig({ adminUsers: ' 10001 , 10002 ,, ' })
                .adminUsers,
        ).toEqual(['10001', '10002']);
    });

    it('数组输入同样容错 (元素转字符串并 trim)', () => {
        expect(
            sanitizeConfig({ adminUsers: [10001, ' 10002 ', ''] })
                .adminUsers,
        ).toEqual(['10001', '10002']);
    });

    it('空数组是合法语义, 不回退默认', () => {
        expect(sanitizeConfig({ adminUsers: [] }).adminUsers).toEqual(
            [],
        );
        expect(
            sanitizeConfig({ adminUsers: ',,,' }).adminUsers,
        ).toEqual([]);
    });

    it('类型不符时保留默认值', () => {
        expect(
            sanitizeConfig({ adminUsers: 123 }).adminUsers,
        ).toEqual(DEFAULT_CONFIG.adminUsers);
    });
});
