/**
 * 登录态探测
 *
 * 同时检查微博页面登录态与一条鉴权接口。页面跳登录 / 无 uid、401、
 * 登录文案属于判决性失败; 超时、风控、服务端错误只记为不确定。
 */

import type { Page } from 'playwright-core';
import { createWeiboReader } from './reader';
import type { ApiFetchResult, LoginProbeResult } from './types';

export type { LoginProbeResult } from './types';

export interface LoginProbeOutcome {
    result: LoginProbeResult;
    message: string;
}

export interface LoginProbeSession {
    withPage<T>(task: (page: Page) => Promise<T>): Promise<T>;
    fetchApi(urlPath: string): Promise<ApiFetchResult>;
}

const LOGIN_URL_PATTERN =
    /(^|[/.])login\.|(^|[/.])passport\.|weibo\.(com|cn)\/(login|signin|signup)/i;

const PAGE_IDLE_TIMEOUT_MS = 10_000;

export function isLoginUrl(url: string): boolean {
    return LOGIN_URL_PATTERN.test(url);
}

export function classifyLandingPage(
    url: string,
    uid: string | null,
): LoginProbeOutcome {
    if (isLoginUrl(url)) {
        return { result: 'invalid', message: '页面跳转到登录页' };
    }
    if (!uid || uid === '0') {
        return {
            result: 'invalid',
            message: '页面未识别到登录账号',
        };
    }
    return { result: 'valid', message: '页面登录态正常' };
}

export async function probeLoginState(
    session: LoginProbeSession,
    monitoredUid?: string,
): Promise<LoginProbeOutcome> {
    let snapshot: {
        url: string;
        uid: string;
        evaluated: boolean;
    };
    try {
        snapshot = await session.withPage(async (page) => {
            await page
                .waitForLoadState('networkidle', {
                    timeout: PAGE_IDLE_TIMEOUT_MS,
                })
                .catch(() => {});
            const url = page.url();
            try {
                const uid = await page.evaluate(() => {
                    const config = (
                        window as unknown as {
                            $CONFIG?: { uid?: string | number };
                        }
                    ).$CONFIG;
                    return config?.uid ? String(config.uid) : '';
                });
                return { url, uid, evaluated: true };
            } catch {
                return { url, uid: '', evaluated: false };
            }
        });
    } catch (error) {
        return {
            result: 'inconclusive',
            message: `页面探测失败: ${errorMessage(error)}`,
        };
    }

    if (!snapshot.evaluated) {
        if (isLoginUrl(snapshot.url)) {
            return { result: 'invalid', message: '页面跳转到登录页' };
        }
        return {
            result: 'inconclusive',
            message: '页面登录态读取失败',
        };
    }

    const landing = classifyLandingPage(snapshot.url, snapshot.uid);
    if (landing.result !== 'valid') return landing;
    if (!monitoredUid) return landing;

    try {
        const reader = createWeiboReader({
            fetchApi: (urlPath) => session.fetchApi(urlPath),
            renderHtml: async () => Buffer.alloc(0),
        });
        const result = await reader.fetchFirstPage(monitoredUid);
        if (result.ok) {
            return { result: 'valid', message: '鉴权接口正常' };
        }
        if (result.failure === 'invalid') {
            return {
                result: 'invalid',
                message: result.message || '鉴权接口要求登录',
            };
        }
        return {
            result: 'inconclusive',
            message:
                result.message ||
                `鉴权接口暂不可用 (${result.failure ?? '未知'})`,
        };
    } catch (error) {
        return {
            result: 'inconclusive',
            message: `鉴权接口异常: ${errorMessage(error)}`,
        };
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
