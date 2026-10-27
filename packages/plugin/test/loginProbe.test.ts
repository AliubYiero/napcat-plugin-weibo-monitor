import { describe, expect, it, vi } from 'vitest';
import {
    classifyLandingPage,
    isLoginUrl,
    type LoginProbeSession,
    probeLoginState,
} from '../src/weibo/loginProbe';

function pageSession(options: {
    url: string;
    uid: string;
    fetchApi?: LoginProbeSession['fetchApi'];
}): LoginProbeSession {
    return {
        withPage: async (task) =>
            task({
                waitForLoadState: async () => {},
                evaluate: async () => options.uid,
                url: () => options.url,
            } as never),
        fetchApi:
            options.fetchApi ??
            (async () => ({
                status: 200,
                body: { ok: 1, data: { list: [] } },
            })),
    };
}

describe('登录页识别', () => {
    it('识别常见登录域名与路径', () => {
        expect(
            isLoginUrl('https://login.sina.com.cn/sso/login.php'),
        ).toBe(true);
        expect(
            isLoginUrl('https://passport.weibo.com/sso/signin'),
        ).toBe(true);
        expect(isLoginUrl('https://weibo.com/login.php')).toBe(true);
        expect(isLoginUrl('https://weibo.com/u/1234567890')).toBe(
            false,
        );
    });
});

describe('classifyLandingPage', () => {
    it('登录页判为失效', () => {
        expect(
            classifyLandingPage(
                'https://login.sina.com.cn/sso/login.php',
                '123',
            ).result,
        ).toBe('invalid');
    });

    it('页面没有登录 uid 判为失效', () => {
        expect(
            classifyLandingPage('https://weibo.com/', '').result,
        ).toBe('invalid');
        expect(
            classifyLandingPage('https://weibo.com/', '0').result,
        ).toBe('invalid');
    });

    it('页面识别到 uid 判为有效', () => {
        expect(
            classifyLandingPage(
                'https://weibo.com/u/1234567890',
                '1234567890',
            ).result,
        ).toBe('valid');
    });
});

describe('probeLoginState', () => {
    it('无订阅时只检查页面', async () => {
        const fetchApi = vi.fn();
        const outcome = await probeLoginState(
            pageSession({
                url: 'https://weibo.com/',
                uid: '1234567890',
                fetchApi,
            }),
        );

        expect(outcome.result).toBe('valid');
        expect(fetchApi).not.toHaveBeenCalled();
    });

    it('鉴权接口 401 判为失效', async () => {
        const outcome = await probeLoginState(
            pageSession({
                url: 'https://weibo.com/',
                uid: '1234567890',
                fetchApi: async () => ({ status: 401, body: null }),
            }),
            '1234567890',
        );

        expect(outcome.result).toBe('invalid');
    });

    it('鉴权接口 5xx 只记为不确定', async () => {
        const outcome = await probeLoginState(
            pageSession({
                url: 'https://weibo.com/',
                uid: '1234567890',
                fetchApi: async () => ({ status: 500, body: null }),
            }),
            '1234567890',
        );

        expect(outcome.result).toBe('inconclusive');
    });

    it('页面探测抛错记为不确定', async () => {
        const session: LoginProbeSession = {
            withPage: async () => {
                throw new Error('导航超时');
            },
            fetchApi: async () => ({ status: 200, body: null }),
        };

        const outcome = await probeLoginState(session);

        expect(outcome.result).toBe('inconclusive');
        expect(outcome.message).toContain('导航超时');
    });

    it('页面 uid 读取失败时按 URL 判定或记为不确定', async () => {
        const session = (url: string): LoginProbeSession => ({
            withPage: async (task) =>
                task({
                    waitForLoadState: async () => {},
                    evaluate: async () => {
                        throw new Error('上下文已销毁');
                    },
                    url: () => url,
                } as never),
            fetchApi: async () => ({ status: 200, body: null }),
        });

        expect(
            (await probeLoginState(session('https://weibo.com/')))
                .result,
        ).toBe('inconclusive');
        expect(
            (
                await probeLoginState(
                    session(
                        'https://login.sina.com.cn/sso/login.php',
                    ),
                )
            ).result,
        ).toBe('invalid');
    });
});
