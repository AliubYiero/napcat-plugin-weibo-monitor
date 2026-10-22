import { describe, expect, it } from 'vitest';
import type {
    SessionInfo,
    WeiboSubscription,
} from '../../src/types';
import {
    buildSessionNameMap,
    filterSubscriptions,
    isValidLimitValue,
    limitText,
    matchesSessionRow,
    sessionKey,
    sessionNameOf,
    sortSessionRows,
} from '../../src/utils/subscriptionView';

const sessions: SessionInfo[] = [
    { id: '100', type: 'group', name: '测试群', enabled: true },
    { id: '200', type: 'private', name: '好友甲', enabled: false },
    { id: '300', type: 'group', name: '另一个群', enabled: true },
];

const subscriptions: WeiboSubscription[] = [
    {
        uid: '12345',
        screenName: 'Alice',
        avatar: '',
        avatarUrl: null,
        targets: [
            { type: 'group', id: '100', enabled: true },
            { type: 'private', id: '200', enabled: false },
        ],
    },
    {
        uid: '67890',
        screenName: 'Bob',
        avatar: '',
        avatarUrl: null,
        targets: [{ type: 'group', id: '300', enabled: true }],
    },
];

describe('sessionKey', () => {
    it('区分同号的群与好友', () => {
        expect(sessionKey('group', '100')).toBe('group:100');
        expect(sessionKey('private', '100')).toBe('private:100');
    });
});

describe('buildSessionNameMap', () => {
    it('按类型与号码建立名称映射', () => {
        const names = buildSessionNameMap(sessions);
        expect(names.size).toBe(3);
        expect(sessionNameOf(names, 'group', '100')).toBe('测试群');
        expect(sessionNameOf(names, 'private', '200')).toBe('好友甲');
    });

    it('未命中返回空串', () => {
        const names = buildSessionNameMap(sessions);
        expect(sessionNameOf(names, 'group', '999')).toBe('');
    });
});

describe('filterSubscriptions', () => {
    const names = buildSessionNameMap(sessions);

    it('空关键词返回原数组', () => {
        expect(filterSubscriptions(subscriptions, names, '  ')).toBe(
            subscriptions,
        );
    });

    it('按博主昵称匹配 (大小写不敏感)', () => {
        expect(
            filterSubscriptions(subscriptions, names, 'alice'),
        ).toEqual([subscriptions[0]]);
    });

    it('按 UID 匹配', () => {
        expect(
            filterSubscriptions(subscriptions, names, '678'),
        ).toEqual([subscriptions[1]]);
    });

    it('按推送会话名匹配并保留整行', () => {
        expect(
            filterSubscriptions(subscriptions, names, '另一个'),
        ).toEqual([subscriptions[1]]);
    });

    it('按推送会话号匹配', () => {
        expect(
            filterSubscriptions(subscriptions, names, '200'),
        ).toEqual([subscriptions[0]]);
    });

    it('无命中返回空数组', () => {
        expect(
            filterSubscriptions(subscriptions, names, '不存在'),
        ).toEqual([]);
    });
});

describe('matchesSessionRow', () => {
    const names = buildSessionNameMap(sessions);

    it('匹配会话名或号码', () => {
        expect(
            matchesSessionRow(
                { type: 'group', id: '100' },
                names,
                '测试',
            ),
        ).toBe(true);
        expect(
            matchesSessionRow(
                { type: 'group', id: '100' },
                names,
                '100',
            ),
        ).toBe(true);
        expect(
            matchesSessionRow(
                { type: 'group', id: '100' },
                names,
                '另一个',
            ),
        ).toBe(false);
    });
});

describe('limitText', () => {
    it('null 显示无上限', () => {
        expect(limitText(null)).toBe('∞');
    });

    it('数值原样输出', () => {
        expect(limitText(0)).toBe('0');
        expect(limitText(50)).toBe('50');
    });
});

describe('isValidLimitValue', () => {
    it('接受闭区间内的整数', () => {
        expect(isValidLimitValue(0, 0, 50)).toBe(true);
        expect(isValidLimitValue(50, 0, 50)).toBe(true);
    });

    it('拒绝越界与非整数', () => {
        expect(isValidLimitValue(-1, 0, 50)).toBe(false);
        expect(isValidLimitValue(51, 0, 50)).toBe(false);
        expect(isValidLimitValue(1.5, 0, 50)).toBe(false);
    });
});

describe('sortSessionRows', () => {
    it('按会话名排序且不修改原数组', () => {
        const names = new Map([
            ['group:1', 'beta'],
            ['group:2', 'alpha'],
        ]);
        const rows = [
            { type: 'group' as const, id: '1' },
            { type: 'group' as const, id: '2' },
        ];
        expect(
            sortSessionRows(rows, names).map((row) => row.id),
        ).toEqual(['2', '1']);
        expect(rows.map((row) => row.id)).toEqual(['1', '2']);
    });
});
