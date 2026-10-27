import { describe, expect, it, vi } from 'vitest';
import type { ApiResponse } from '../../src/types';
import type { ApiTransport } from '../../src/utils/apiClient';
import { createApiClient } from '../../src/utils/apiClient';

type TransportHandler = (
    path: string,
    options?: RequestInit,
) => ApiResponse<unknown>;

function fakeTransport(handler: TransportHandler): ApiTransport {
    return vi.fn(handler) as unknown as ApiTransport;
}

describe('createApiClient', () => {
    it('成功响应解包为 ok + data', async () => {
        const transport = fakeTransport(() => ({
            code: 0,
            data: [{ id: 'g1', type: 'group', name: '群' }],
        }));
        const client = createApiClient(transport);

        const result = await client.listSessions();

        expect(result).toEqual({
            ok: true,
            code: 0,
            message: '',
            data: [{ id: 'g1', type: 'group', name: '群' }],
        });
        expect(transport).toHaveBeenCalledWith('/sessions', {});
    });

    it('非 0 code 不再静默, 返回可读失败', async () => {
        const transport = fakeTransport(() => ({
            code: -1,
            message: '后端拒绝',
        }));
        const client = createApiClient(transport);

        const result = await client.getLimits();

        expect(result).toEqual({
            ok: false,
            code: -1,
            message: '后端拒绝',
        });
    });

    it('成功 code 但缺少 data 视为失败', async () => {
        const transport = fakeTransport(() => ({ code: 0 }));
        const client = createApiClient(transport);

        const result = await client.getStatus();

        expect(result).toEqual({
            ok: false,
            code: -1,
            message: '响应缺少数据',
        });
    });

    it('transport 抛错时从 JSON 响应体提取 message', async () => {
        const transport = fakeTransport(() => {
            throw new Error(
                JSON.stringify({ code: -1, message: 'HTTP 500' }),
            );
        });
        const client = createApiClient(transport);

        const result = await client.getStatus();

        expect(result).toEqual({
            ok: false,
            code: -1,
            message: 'HTTP 500',
        });
    });

    it('会话更新使用编码后的路径与 POST body', async () => {
        const transport = fakeTransport(() => ({ code: 0 }));
        const client = createApiClient(transport);

        const result = await client.updateSession(
            { type: 'group', id: 'a/b' },
            true,
        );

        expect(result.ok).toBe(true);
        expect(transport).toHaveBeenCalledWith(
            '/sessions/group/a%2Fb/config',
            { method: 'POST', body: '{"enabled":true}' },
        );
    });

    it('批量会话更新与上限写入复用同一 Result 包装', async () => {
        const transport = fakeTransport(() => ({
            code: 0,
            data: {
                type: 'group',
                id: 'g1',
                ok: true,
                message: '已更新上限',
            },
        }));
        const client = createApiClient(transport);

        const bulk = await client.updateSessions('group', false, [
            'g1',
            'g2',
        ]);
        const limit = await client.setLimit({
            type: 'group',
            id: 'g1',
            max: 2,
        });

        expect(bulk.ok).toBe(true);
        expect(limit).toEqual({
            ok: true,
            code: 0,
            message: '',
            data: {
                type: 'group',
                id: 'g1',
                ok: true,
                message: '已更新上限',
            },
        });
        expect(transport).toHaveBeenNthCalledWith(
            1,
            '/sessions/bulk-config',
            {
                method: 'POST',
                body: JSON.stringify({
                    type: 'group',
                    enabled: false,
                    ids: ['g1', 'g2'],
                }),
            },
        );
        expect(transport).toHaveBeenNthCalledWith(
            2,
            '/weibo/limits',
            {
                method: 'POST',
                body: JSON.stringify({
                    type: 'group',
                    id: 'g1',
                    max: 2,
                }),
            },
        );
    });

    it('恢复默认上限使用 DELETE 且编码 id', async () => {
        const transport = fakeTransport(() => ({
            code: 0,
            data: {
                type: 'private',
                id: 'a/b',
                ok: true,
                message: '已恢复默认上限',
            },
        }));
        const client = createApiClient(transport);

        const result = await client.clearLimit({
            type: 'private',
            id: 'a/b',
        });

        expect(result.ok).toBe(true);
        expect(transport).toHaveBeenCalledWith(
            '/weibo/limits/private/a%2Fb',
            { method: 'DELETE' },
        );
    });

    it('订阅读写统一走客户端端点', async () => {
        const transport = fakeTransport((path) => {
            if (path === '/weibo/subscriptions') {
                return {
                    code: 0,
                    data: {
                        subscriptions: [],
                        pendingAvatars: 0,
                    },
                };
            }
            if (path === '/weibo/subscriptions/add') {
                return {
                    code: 0,
                    data: {
                        uid: '12345',
                        screenName: '博主',
                        results: [],
                    },
                };
            }
            return { code: 0 };
        });
        const client = createApiClient(transport);

        const list = await client.listSubscriptions();
        const add = await client.addSubscriptions({
            uid: '12345',
            targets: [{ type: 'group', id: 'g1' }],
        });
        const remove = await client.removeSubscription({
            uid: '12345',
            type: 'group',
            id: 'g1',
        });

        expect(list).toEqual({
            ok: true,
            code: 0,
            message: '',
            data: { subscriptions: [], pendingAvatars: 0 },
        });
        expect(add.ok).toBe(true);
        expect(remove.ok).toBe(true);
        expect(transport).toHaveBeenNthCalledWith(
            2,
            '/weibo/subscriptions/add',
            {
                method: 'POST',
                body: JSON.stringify({
                    uid: '12345',
                    targets: [{ type: 'group', id: 'g1' }],
                }),
            },
        );
        expect(transport).toHaveBeenNthCalledWith(
            3,
            '/weibo/subscriptions/remove',
            {
                method: 'POST',
                body: JSON.stringify({
                    uid: '12345',
                    type: 'group',
                    id: 'g1',
                }),
            },
        );
    });
});
