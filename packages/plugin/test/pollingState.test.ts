/**
 * 轮询状态派生
 *
 * 状态是事实的纯函数: 严格优先级保证同一时刻只有一个答案,
 * 尤其「无订阅」必须压过陈旧的 lastError (曾经的 bug 来源)。
 */

import { describe, expect, it } from 'vitest';
import {
    type PollingStateFacts,
    resolvePollingState,
} from '../src/weibo/pollingState';

const NOW = 1_000_000;

const BASE: PollingStateFacts = {
    started: true,
    hasCookies: true,
    invalid: false,
    backoffUntil: null,
    subscriptionCount: 1,
    lastError: null,
};

function state(
    patch: Partial<PollingStateFacts> = {},
    now = NOW,
): string {
    return resolvePollingState({ ...BASE, ...patch }, now);
}

describe('resolvePollingState: 优先级', () => {
    it('未启动优先于其它事实', () => {
        expect(state({ started: false, hasCookies: false })).toBe(
            'stopped',
        );
    });

    it('未配置 Cookie 优先于失效与无订阅', () => {
        expect(
            state({
                hasCookies: false,
                invalid: true,
                subscriptionCount: 0,
            }),
        ).toBe('unconfigured');
    });

    it('失效优先于退避与无订阅', () => {
        expect(
            state({
                invalid: true,
                backoffUntil: NOW + 1,
                subscriptionCount: 0,
            }),
        ).toBe('invalid');
    });

    it('退避只在截止时间之前生效', () => {
        expect(state({ backoffUntil: NOW + 1 })).toBe('backoff');
        expect(state({ backoffUntil: NOW })).toBe('running');
        expect(state({ backoffUntil: NOW - 1 })).toBe('running');
    });

    it('无订阅优先于异常 (陈旧的 lastError 不再展示)', () => {
        expect(
            state({
                subscriptionCount: 0,
                lastError: '未配置 Cookie',
            }),
        ).toBe('idle');
    });

    it('有订阅且整轮失败为异常', () => {
        expect(state({ lastError: '微博接口失败' })).toBe('error');
    });

    it('有订阅且无错误为运行中', () => {
        expect(state()).toBe('running');
    });
});
