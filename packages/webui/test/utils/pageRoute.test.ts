/**
 * WebUI hash 路由: 解析/序列化纯函数
 *
 * 范式: docs/webui-config-pattern.md 的"URL 路由"。
 * 宽容取首段, 空/非法回退默认页; 序列化为 `#/<pageId>`。
 */

import { DEFAULT_PAGE } from 'shared';
import { describe, expect, it } from 'vitest';
import { buildHash, parsePage } from '../../src/utils/pageRoute';

describe('parsePage', () => {
    it('解析合法页面 id', () => {
        expect(parsePage('#/sessions')).toBe('sessions');
        expect(parsePage('#/help')).toBe('help');
        expect(parsePage('#/subscriptions')).toBe('subscriptions');
    });

    it('多余路径段取首段', () => {
        expect(parsePage('#/help/2')).toBe('help');
    });

    it('忽略尾斜杠', () => {
        expect(parsePage('#/sessions/')).toBe('sessions');
    });

    it('未知 id 回退默认页', () => {
        expect(parsePage('#/unknown')).toBe(DEFAULT_PAGE);
    });

    it('空 hash / 裸 # / #/ 回退默认页', () => {
        expect(parsePage('')).toBe(DEFAULT_PAGE);
        expect(parsePage('#')).toBe(DEFAULT_PAGE);
        expect(parsePage('#/')).toBe(DEFAULT_PAGE);
    });
});

describe('buildHash', () => {
    it('序列化为 #/<pageId>', () => {
        expect(buildHash('status')).toBe('#/status');
        expect(buildHash('sessions')).toBe('#/sessions');
    });
});
