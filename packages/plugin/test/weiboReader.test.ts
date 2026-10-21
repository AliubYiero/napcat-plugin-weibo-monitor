import { describe, expect, it, vi } from 'vitest';
import {
    classifyFailure,
    createWeiboReader,
    extractPosts,
    type WeiboReaderDeps,
} from '../src/weibo/reader';
import type { WeiboPost } from '../src/weibo/types';

function createDeps(
    overrides: Partial<WeiboReaderDeps> = {},
): WeiboReaderDeps {
    return {
        fetchApi: async () => ({ status: 200, body: { ok: 1 } }),
        renderHtml: async () => Buffer.from('png'),
        logger: {
            debug: () => {},
            warn: () => {},
        },
        ...overrides,
    };
}

describe('classifyFailure', () => {
    it('418 / 403 判定为风控', () => {
        expect(classifyFailure(418, null)).toBe('risk');
        expect(classifyFailure(403, null)).toBe('risk');
    });

    it('登录提示判定为失效', () => {
        expect(
            classifyFailure(200, {
                ok: 0,
                message: '请登录后使用',
            }),
        ).toBe('invalid');
        expect(
            classifyFailure(200, {
                ok: 0,
                message: '请先登录',
            }),
        ).toBe('invalid');
    });

    it('其它 ok:0 与 HTTP 错误判定为风控', () => {
        expect(
            classifyFailure(200, { ok: 0, message: '系统错误' }),
        ).toBe('risk');
        expect(classifyFailure(500, null)).toBe('risk');
    });

    it('成功响应返回 null', () => {
        expect(classifyFailure(200, { ok: 1 })).toBeNull();
    });
});

describe('extractPosts', () => {
    it('取出 data.list', () => {
        expect(
            extractPosts({
                ok: 1,
                data: { list: [{ idstr: '1' }] },
            }),
        ).toEqual([{ idstr: '1' }]);
    });

    it('非法结构回退空数组', () => {
        expect(extractPosts(null)).toEqual([]);
        expect(extractPosts({ data: {} })).toEqual([]);
    });
});

describe('weibo reader', () => {
    it('fetchFirstPage 请求第一页并解析成功结果', async () => {
        const fetchApi = vi.fn(async () => ({
            status: 200,
            body: { ok: 1, data: { list: [{ idstr: '1' }] } },
        }));
        const reader = createWeiboReader(createDeps({ fetchApi }));

        const result = await reader.fetchFirstPage('123');

        expect(fetchApi).toHaveBeenCalledWith(
            '/ajax/statuses/mymblog?uid=123&page=1&feature=0',
        );
        expect(result.ok).toBe(true);
        expect(result.failure).toBeNull();
        expect(result.posts).toEqual([{ idstr: '1' }]);
    });

    it('fetchFirstPage 登录失败返回 invalid', async () => {
        const reader = createWeiboReader(
            createDeps({
                fetchApi: async () => ({
                    status: 200,
                    body: { ok: 0, message: '请登录后使用' },
                }),
            }),
        );

        const result = await reader.fetchFirstPage('123');

        expect(result.ok).toBe(false);
        expect(result.failure).toBe('invalid');
    });

    it('hydrate 同时补拉主动态与原动态', async () => {
        const post: WeiboPost = {
            idstr: 'main',
            mblogid: 'main',
            isLongText: true,
            text: '截断正文',
            retweeted_status: {
                idstr: 'rt',
                mblogid: 'rt',
                isLongText: true,
                text: '原截断正文',
            },
        };
        const fetchApi = vi.fn(async (urlPath: string) => {
            if (urlPath.includes('id=main')) {
                return {
                    status: 200,
                    body: {
                        ok: 1,
                        data: { longTextContent: '完整正文' },
                    },
                };
            }
            return {
                status: 200,
                body: {
                    ok: 1,
                    data: { longTextContent: '原完整正文' },
                },
            };
        });
        const reader = createWeiboReader(createDeps({ fetchApi }));

        const hydrated = await reader.hydrate(post);

        expect(hydrated.text).toBe('完整正文');
        expect(hydrated.retweeted_status?.text).toBe('原完整正文');
        expect(hydrated.isLongText).toBe(false);
    });

    it('长文补拉失败保留截断正文', async () => {
        const post: WeiboPost = {
            idstr: 'main',
            mblogid: 'main',
            isLongText: true,
            text: '截断正文',
        };
        const reader = createWeiboReader(
            createDeps({
                fetchApi: async () => ({
                    status: 500,
                    body: null,
                }),
            }),
        );

        const hydrated = await reader.hydrate(post);

        expect(hydrated.text).toBe('截断正文');
    });

    it('renderCard 成功返回 buffer', async () => {
        const reader = createWeiboReader(createDeps());

        const result = await reader.renderCard({ text: '正文' });

        expect(result.ok).toBe(true);
        expect(result.buffer?.toString()).toBe('png');
    });

    it('renderCard 失败返回错误并记 warn', async () => {
        const warn = vi.fn();
        const reader = createWeiboReader(
            createDeps({
                renderHtml: async () => {
                    throw new Error('截图失败');
                },
                logger: { debug: () => {}, warn },
            }),
        );

        const result = await reader.renderCard({ text: '正文' });

        expect(result.ok).toBe(false);
        expect(result.buffer).toBeNull();
        expect(result.message).toBe('截图失败');
        expect(warn).toHaveBeenCalled();
    });
});
