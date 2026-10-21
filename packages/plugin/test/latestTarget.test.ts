/**
 * latest 无参目标解析
 *
 * 三种处境: 零订阅引导添加、唯一订阅直接使用、多订阅要求补参。
 */

import { describe, expect, it } from 'vitest';
import { resolveLatestTarget } from '../src/handlers/commands/latestHandler';
import type { WeiboMonitor } from '../src/weibo/types';

function monitor(
    uid: string,
    screenName = `博主${uid}`,
): WeiboMonitor {
    return {
        uid,
        screenName,
        avatar: '',
        to: [{ type: 'group', id: '10001' }],
    };
}

describe('resolveLatestTarget', () => {
    it('显式 UID 原样使用, 不依赖订阅', () => {
        expect(resolveLatestTarget(['123456'], [])).toEqual({
            kind: 'uid',
            uid: '123456',
        });
    });

    it('零订阅: 引导添加', () => {
        expect(resolveLatestTarget([], [])).toEqual({ kind: 'none' });
    });

    it('唯一订阅: 直接使用该博主', () => {
        expect(resolveLatestTarget([], [monitor('123456')])).toEqual({
            kind: 'uid',
            uid: '123456',
        });
    });

    it('多订阅: 返回候选列表要求补参', () => {
        const monitors = [monitor('1'), monitor('2')];
        expect(resolveLatestTarget([], monitors)).toEqual({
            kind: 'ambiguous',
            monitors,
        });
    });
});
