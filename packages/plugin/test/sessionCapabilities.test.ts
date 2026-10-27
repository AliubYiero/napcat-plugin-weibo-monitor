import {
    type BuildSessionCapabilitiesInput,
    buildSessionCapabilities,
    WEIBO_LIMIT_DEFAULTS,
} from 'shared';
import { describe, expect, it } from 'vitest';

function build(
    input: Partial<BuildSessionCapabilitiesInput> &
        Pick<BuildSessionCapabilitiesInput, 'sessions'>,
) {
    return buildSessionCapabilities({
        subscriptions: [],
        ...input,
    });
}

describe('buildSessionCapabilities', () => {
    it('按会话类型推导默认上限并统计已用', () => {
        const capabilities = build({
            sessions: [
                { type: 'group', id: 'g1', enabled: true },
                { type: 'private', id: 'p1', enabled: true },
            ],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
        });

        expect(WEIBO_LIMIT_DEFAULTS).toEqual({
            group: 1,
            private: 0,
        });
        expect(capabilities[0]).toMatchObject({
            type: 'group',
            id: 'g1',
            used: 1,
            limit: 1,
            unlimited: false,
            remaining: 0,
            selectable: false,
            reason: 'limit_reached',
        });
        expect(capabilities[1]).toMatchObject({
            type: 'private',
            id: 'p1',
            used: 0,
            limit: 0,
            unlimited: false,
            remaining: 0,
            selectable: false,
            reason: 'limit_reached',
        });
    });

    it('超管私聊无上限', () => {
        const [capability] = build({
            sessions: [{ type: 'private', id: '42', enabled: true }],
            adminUsers: ['42'],
        });

        expect(capability).toMatchObject({
            limit: null,
            unlimited: true,
            remaining: null,
            selectable: true,
            reason: null,
        });
    });

    it('超管名单不影响同号群聊', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: '42', enabled: true }],
            adminUsers: ['42'],
        });

        expect(capability).toMatchObject({
            limit: 1,
            unlimited: false,
        });
    });

    it('显式覆盖优先于默认值', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: true }],
            overrides: [{ type: 'group', id: 'g1', limit: 3 }],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
        });

        expect(capability).toMatchObject({
            override: 3,
            limit: 3,
            used: 1,
            remaining: 2,
            selectable: true,
        });
    });

    it('覆盖为 0 时禁止新增', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: true }],
            overrides: [{ type: 'group', id: 'g1', limit: 0 }],
        });

        expect(capability).toMatchObject({
            override: 0,
            limit: 0,
            remaining: 0,
            selectable: false,
            reason: 'limit_reached',
        });
    });

    it('提供 subjectUid 时标记已订阅', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: true }],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
            subjectUid: '123',
        });

        expect(capability).toMatchObject({
            subscribed: true,
            selectable: false,
            reason: 'already_subscribed',
        });
    });

    it('未提供 subjectUid 时不标记已订阅', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: true }],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
            overrides: [{ type: 'group', id: 'g1', limit: 3 }],
        });

        expect(capability).toMatchObject({
            subscribed: false,
            selectable: true,
            reason: null,
        });
    });

    it('会话禁用优先于已订阅与上限', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: false }],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
            overrides: [{ type: 'group', id: 'g1', limit: 0 }],
            subjectUid: '123',
        });

        expect(capability).toMatchObject({
            enabled: false,
            subscribed: true,
            selectable: false,
            reason: 'session_disabled',
        });
    });

    it('群号与 QQ 号同值时按类型分开统计', () => {
        const capabilities = build({
            sessions: [
                { type: 'group', id: '100', enabled: true },
                { type: 'private', id: '100', enabled: true },
            ],
            subscriptions: [
                {
                    uid: '123',
                    targets: [{ type: 'group', id: '100' }],
                },
            ],
            overrides: [{ type: 'private', id: '100', limit: 5 }],
        });

        expect(capabilities[0]).toMatchObject({
            used: 1,
            limit: 1,
            remaining: 0,
        });
        expect(capabilities[1]).toMatchObject({
            used: 0,
            override: 5,
            limit: 5,
            remaining: 5,
        });
    });

    it('已用超过上限时剩余归零', () => {
        const [capability] = build({
            sessions: [{ type: 'group', id: 'g1', enabled: true }],
            overrides: [{ type: 'group', id: 'g1', limit: 2 }],
            subscriptions: [
                {
                    uid: '1',
                    targets: [{ type: 'group', id: 'g1' }],
                },
                {
                    uid: '2',
                    targets: [{ type: 'group', id: 'g1' }],
                },
                {
                    uid: '3',
                    targets: [{ type: 'group', id: 'g1' }],
                },
            ],
        });

        expect(capability).toMatchObject({
            used: 3,
            limit: 2,
            remaining: 0,
            selectable: false,
            reason: 'limit_reached',
        });
    });
});
