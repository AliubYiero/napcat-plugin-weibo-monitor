import { describe, expect, it, vi } from 'vitest';
import {
    classifyFailure,
    classifyStatusFailure,
    createWeiboReader,
    extractPosts,
    extractStatus,
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
    it('401 判定为失效', () => {
        expect(classifyFailure(401, null)).toBe('invalid');
    });

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

describe('classifyStatusFailure', () => {
    it('404 判定为不存在', () => {
        expect(classifyStatusFailure(404, null)).toBe('not_found');
    });

    it('401 判定为失效', () => {
        expect(classifyStatusFailure(401, null)).toBe('invalid');
    });

    it('418 / 403 判定为风控', () => {
        expect(classifyStatusFailure(418, null)).toBe('risk');
        expect(classifyStatusFailure(403, null)).toBe('risk');
    });

    it('登录提示判定为失效', () => {
        expect(
            classifyStatusFailure(200, {
                ok: 0,
                message: '请登录后使用',
            }),
        ).toBe('invalid');
    });

    it('删除或无权提示判定为不存在', () => {
        expect(
            classifyStatusFailure(200, {
                ok: 0,
                message: '抱歉，此微博已被作者删除',
            }),
        ).toBe('not_found');
        expect(
            classifyStatusFailure(200, {
                ok: 0,
                message: '你没有权限查看这条微博',
            }),
        ).toBe('not_found');
    });

    it('其它 ok:0 与 HTTP 错误判定为风控', () => {
        expect(
            classifyStatusFailure(200, {
                ok: 0,
                message: '系统错误',
            }),
        ).toBe('risk');
        expect(classifyStatusFailure(500, null)).toBe('risk');
    });

    it('成功响应返回 null', () => {
        expect(
            classifyStatusFailure(200, { ok: 1, idstr: '1' }),
        ).toBeNull();
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

describe('extractStatus', () => {
    it('ok:1 且带动态 ID 时返回动态对象', () => {
        const body = { ok: 1, idstr: '5356201715958095' };
        expect(extractStatus(body)).toBe(body);
    });

    it('ok:0 或缺少动态 ID 时返回 null', () => {
        expect(
            extractStatus({ ok: 0, message: '不存在' }),
        ).toBeNull();
        expect(extractStatus({ ok: 1 })).toBeNull();
        expect(extractStatus(null)).toBeNull();
        expect(extractStatus([])).toBeNull();
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

    it('fetchStatus 请求 show 接口并解析成功结果', async () => {
        const fetchApi = vi.fn(async () => ({
            status: 200,
            body: {
                ok: 1,
                idstr: '5356201715958095',
                text: '正文',
            },
        }));
        const reader = createWeiboReader(createDeps({ fetchApi }));

        const result = await reader.fetchStatus('RnA3VoZYj');

        expect(fetchApi).toHaveBeenCalledWith(
            '/ajax/statuses/show?id=RnA3VoZYj&locale=zh-CN&isGetLongText=true',
        );
        expect(result.ok).toBe(true);
        expect(result.post?.idstr).toBe('5356201715958095');
        expect(result.failure).toBeNull();
    });

    it('fetchStatus 将删除提示映射为 not_found', async () => {
        const reader = createWeiboReader(
            createDeps({
                fetchApi: async () => ({
                    status: 200,
                    body: {
                        ok: 0,
                        message: '抱歉，此微博已被作者删除',
                    },
                }),
            }),
        );

        const result = await reader.fetchStatus('123');

        expect(result.ok).toBe(false);
        expect(result.post).toBeNull();
        expect(result.failure).toBe('not_found');
    });

    it('hydrateStatus 不因 isLongText 标记重复补拉已展开正文', async () => {
        const fetchApi = vi.fn(async () => ({
            status: 200,
            body: { ok: 1, data: { longTextContent: '完整正文' } },
        }));
        const reader = createWeiboReader(createDeps({ fetchApi }));
        const post: WeiboPost = {
            idstr: 'main',
            mblogid: 'main',
            isLongText: true,
            text: '完整正文',
        };

        const hydrated = await reader.hydrateStatus(post);

        expect(fetchApi).not.toHaveBeenCalled();
        expect(hydrated).toBe(post);
    });

    it('hydrateStatus 在正文为空且标记长文时补拉', async () => {
        const fetchApi = vi.fn(async () => ({
            status: 200,
            body: {
                ok: 1,
                data: { longTextContent: '完整正文' },
            },
        }));
        const reader = createWeiboReader(createDeps({ fetchApi }));
        const post: WeiboPost = {
            idstr: 'main',
            mblogid: 'main',
            isLongText: true,
            text: '',
        };

        const hydrated = await reader.hydrateStatus(post);

        expect(fetchApi).toHaveBeenCalledWith(
            '/ajax/statuses/longtext?id=main',
        );
        expect(hydrated.text).toBe('完整正文');
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

    it('renderCard 成功返回 buffer 与渲染前 HTML', async () => {
        let received = '';
        const reader = createWeiboReader(
            createDeps({
                renderHtml: async (html) => {
                    received = html;
                    return Buffer.from('png');
                },
            }),
        );

        const result = await reader.renderCard({ text: '正文' });

        expect(result.ok).toBe(true);
        expect(result.buffer?.toString()).toBe('png');
        expect(result.html).toBe(received);
        expect(result.html).toContain('class="card"');
        expect(result.html).toContain('正文');
    });

    it('renderCard 失败返回错误并保留渲染前 HTML', async () => {
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
        expect(result.html).toContain('class="card"');
        expect(result.message).toBe('截图失败');
        expect(warn).toHaveBeenCalled();
    });
});
