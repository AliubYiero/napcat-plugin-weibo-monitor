/**
 * 配置副作用差异判定
 *
 * 两个配置入口共用同一份判定, 避免自建 WebUI 与原生面板分叉。
 */

import { getDefaultConfig } from 'shared';
import { describe, expect, it } from 'vitest';
import { resolveConfigEffects } from '../src/services/configEffects';

const BASE = getDefaultConfig();

describe('resolveConfigEffects', () => {
    it('配置未变化时不触发副作用', () => {
        expect(
            resolveConfigEffects(BASE, getDefaultConfig()),
        ).toEqual({
            restartBrowser: false,
            reschedulePolling: false,
        });
    });

    it('Chrome 路径变化: 只重启浏览器', () => {
        expect(
            resolveConfigEffects(BASE, {
                ...BASE,
                chromeExecutablePath: 'C:\\chrome.exe',
            }),
        ).toEqual({ restartBrowser: true, reschedulePolling: false });
    });

    it('轮询间隔变化: 只重排轮询', () => {
        expect(
            resolveConfigEffects(BASE, {
                ...BASE,
                weiboPollIntervalMinutes: 5,
            }),
        ).toEqual({ restartBrowser: false, reschedulePolling: true });
    });

    it('其它字段变化不触发副作用', () => {
        expect(
            resolveConfigEffects(BASE, {
                ...BASE,
                adminUsers: ['10001'],
                triggerModes: ['prefix'],
            }),
        ).toEqual({
            restartBrowser: false,
            reschedulePolling: false,
        });
    });
});
