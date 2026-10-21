/**
 * 轮询状态派生
 *
 * 「状态」是事实的纯函数: 不维护可变副本, 避免显示值落后于事实。
 * 优先级固定为 stopped → unconfigured → invalid → backoff → idle → error
 * → running, 保证同一时刻只有一个答案。
 */

import type { PollingState } from './types';

export interface PollingStateFacts {
    /** 轮询循环是否已启动 */
    started: boolean;
    /** 是否已保存 Cookie */
    hasCookies: boolean;
    /** Cookie 是否被判定为失效 */
    invalid: boolean;
    /** 风控退避截止时间 (毫秒时间戳) */
    backoffUntil: number | null;
    /** 订阅博主数量 */
    subscriptionCount: number;
    /** 整轮失败时的错误文本 */
    lastError: string | null;
}

export function resolvePollingState(
    facts: PollingStateFacts,
    now: number = Date.now(),
): PollingState {
    if (!facts.started) return 'stopped';
    if (!facts.hasCookies) return 'unconfigured';
    if (facts.invalid) return 'invalid';
    if (facts.backoffUntil !== null && facts.backoffUntil > now) {
        return 'backoff';
    }
    if (facts.subscriptionCount === 0) return 'idle';
    if (facts.lastError) return 'error';
    return 'running';
}
