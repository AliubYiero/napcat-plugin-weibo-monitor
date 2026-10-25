import type { Buffer } from 'node:buffer';
import { buildPostCardHtml } from './card';
import {
    extractLongText,
    hasTruncationSignal,
    needsLongText,
    resolveLongTextId,
    withLongText,
} from './longText';
import type {
    ApiFetchResult,
    WeiboLongTextResponse,
    WeiboMyMblogResponse,
    WeiboPost,
    WeiboPostIdentity,
    WeiboPostRenderContext,
    WeiboProfileResponse,
    WeiboStatusResponse,
    WeiboUser,
} from './types';

export type WeiboApiFailure = 'invalid' | 'risk' | null;

export interface MyMblogResult {
    ok: boolean;
    posts: WeiboPost[];
    message: string;
    failure: WeiboApiFailure;
}

export interface ProfileResult {
    ok: boolean;
    user: WeiboUser | null;
    message: string;
    failure: WeiboApiFailure;
}

export type WeiboStatusFailure =
    | 'invalid'
    | 'risk'
    | 'not_found'
    | null;

export interface StatusResult {
    ok: boolean;
    post: WeiboPost | null;
    message: string;
    failure: WeiboStatusFailure;
}

export interface LongTextResult {
    ok: boolean;
    text: string;
    message: string;
    status: number;
}

export interface CardRenderResult {
    ok: boolean;
    buffer: Buffer | null;
    html: string | null;
    message: string;
}

export interface WeiboReaderLogger {
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

export interface WeiboReaderDeps {
    fetchApi(urlPath: string): Promise<ApiFetchResult>;
    renderHtml(html: string): Promise<Buffer>;
    logger?: WeiboReaderLogger;
}

export interface WeiboReader {
    fetchFirstPage(uid: string): Promise<MyMblogResult>;
    fetchProfile(uid: string): Promise<ProfileResult>;
    fetchStatus(id: string): Promise<StatusResult>;
    fetchLongText(mblogid: string): Promise<LongTextResult>;
    hydrate(post: WeiboPost): Promise<WeiboPost>;
    hydrateStatus(post: WeiboPost): Promise<WeiboPost>;
    renderCard(
        post: WeiboPost,
        context?: WeiboPostRenderContext,
        identity?: WeiboPostIdentity,
    ): Promise<CardRenderResult>;
}

export function extractPosts(body: unknown): WeiboPost[] {
    const response = body as WeiboMyMblogResponse | null;
    const list = response?.data?.list;
    return Array.isArray(list) ? list : [];
}

export function extractUser(body: unknown): WeiboUser | null {
    const response = body as WeiboProfileResponse | null;
    const user = response?.data?.user;
    return user && typeof user === 'object' ? user : null;
}

export function extractStatus(body: unknown): WeiboPost | null {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return null;
    }
    const response = body as WeiboStatusResponse;
    if (response.ok !== 1) return null;

    const id = response.idstr ?? response.mid ?? response.id;
    if (id === undefined || id === null || String(id) === '') {
        return null;
    }
    return response;
}

export function classifyFailure(
    status: number,
    body: unknown,
): WeiboApiFailure {
    if (status === 418 || status === 403) return 'risk';

    const response = body as { ok?: number; message?: string } | null;
    if (response && response.ok === 0) {
        const message = String(response.message ?? '');
        if (/登录|login|未登录|请先登录/i.test(message)) {
            return 'invalid';
        }
        return 'risk';
    }

    if (status >= 400) return 'risk';
    return null;
}

export function classifyStatusFailure(
    status: number,
    body: unknown,
): WeiboStatusFailure {
    if (status === 404) return 'not_found';
    if (status === 401) return 'invalid';
    if (status === 418 || status === 403) return 'risk';

    const response = body as { ok?: number; message?: string } | null;
    if (response && response.ok === 0) {
        const message = String(response.message ?? '');
        if (/登录|login|未登录|请先登录/i.test(message)) {
            return 'invalid';
        }
        if (
            /不存在|已删除|删除|无权|无权限|没有权限|不可见|审核中|仅自己可见/.test(
                message,
            )
        ) {
            return 'not_found';
        }
        return 'risk';
    }

    if (status >= 400) return 'risk';
    return null;
}

class WeiboReaderImpl implements WeiboReader {
    constructor(private readonly deps: WeiboReaderDeps) {}

    async fetchFirstPage(uid: string): Promise<MyMblogResult> {
        const result = await this.deps.fetchApi(
            `/ajax/statuses/mymblog?uid=${encodeURIComponent(uid)}&page=1&feature=0`,
        );
        const posts = extractPosts(result.body);
        const response = result.body as WeiboMyMblogResponse | null;
        const ok = result.status < 400 && response?.ok === 1;
        const failure = ok
            ? null
            : classifyFailure(result.status, result.body);

        return {
            ok,
            posts,
            message: String(response?.message ?? ''),
            failure,
        };
    }

    async fetchProfile(uid: string): Promise<ProfileResult> {
        const result = await this.deps.fetchApi(
            `/ajax/profile/info?uid=${encodeURIComponent(uid)}`,
        );
        const user = extractUser(result.body);
        const response = result.body as WeiboProfileResponse | null;
        const ok =
            result.status < 400 &&
            response?.ok === 1 &&
            user !== null;
        const failure = ok
            ? null
            : classifyFailure(result.status, result.body);

        return {
            ok,
            user,
            message: String(response?.message ?? ''),
            failure,
        };
    }

    async fetchStatus(id: string): Promise<StatusResult> {
        const result = await this.deps.fetchApi(
            `/ajax/statuses/show?id=${encodeURIComponent(id)}&locale=zh-CN&isGetLongText=true`,
        );
        const response = result.body as WeiboStatusResponse | null;
        const post = extractStatus(result.body);
        const ok = result.status < 400 && post !== null;
        const failure = ok
            ? null
            : classifyStatusFailure(result.status, result.body);

        return {
            ok,
            post,
            message: String(response?.message ?? ''),
            failure,
        };
    }

    async fetchLongText(mblogid: string): Promise<LongTextResult> {
        const result = await this.deps.fetchApi(
            `/ajax/statuses/longtext?id=${encodeURIComponent(mblogid)}`,
        );
        const response = result.body as WeiboLongTextResponse | null;
        const text = extractLongText(result.body);
        const ok =
            result.status < 400 &&
            response?.ok === 1 &&
            text.trim() !== '';

        const message = String(response?.message ?? '');
        const failureMessage =
            message ||
            (result.status >= 400
                ? `HTTP ${result.status}`
                : text.trim()
                  ? ''
                  : '空长文');
        return {
            ok,
            text,
            message: failureMessage,
            status: result.status,
        };
    }

    async hydrate(post: WeiboPost): Promise<WeiboPost> {
        return this.hydrateWith(post, needsLongText);
    }

    async hydrateStatus(post: WeiboPost): Promise<WeiboPost> {
        return this.hydrateWith(post, hasTruncationSignal);
    }

    async renderCard(
        post: WeiboPost,
        context?: WeiboPostRenderContext,
        identity?: WeiboPostIdentity,
    ): Promise<CardRenderResult> {
        let html: string | null = null;
        try {
            html = buildPostCardHtml(post, {
                context,
                identity,
            });
            const buffer = await this.deps.renderHtml(html);
            return { ok: true, buffer, html, message: '' };
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : String(error);
            this.deps.logger?.warn('微博卡片渲染失败:', error);
            return { ok: false, buffer: null, html, message };
        }
    }

    private async hydrateWith(
        post: WeiboPost,
        shouldHydrate: (post: WeiboPost) => boolean,
    ): Promise<WeiboPost> {
        const main = await this.hydrateOne(post, shouldHydrate);
        const retweet = main.retweeted_status;
        if (!retweet) return main;

        const original = await this.hydrateOne(
            retweet,
            shouldHydrate,
        );
        if (original === retweet) return main;
        return { ...main, retweeted_status: original };
    }

    private async hydrateOne(
        post: WeiboPost,
        shouldHydrate: (post: WeiboPost) => boolean,
    ): Promise<WeiboPost> {
        if (!shouldHydrate(post)) return post;

        const mblogid = resolveLongTextId(post);
        if (!mblogid) {
            this.deps.logger?.debug('微博长文缺少 mblogid, 跳过补拉');
            return post;
        }

        try {
            const result = await this.fetchLongText(mblogid);
            if (!result.ok || !result.text.trim()) {
                this.deps.logger?.warn(
                    `微博长文补拉失败 ${mblogid}: ` +
                        (result.message || `HTTP ${result.status}`),
                );
                return post;
            }
            return withLongText(post, result.text);
        } catch (error) {
            this.deps.logger?.warn(
                `微博长文补拉异常 ${mblogid}:`,
                error,
            );
            return post;
        }
    }
}

export function createWeiboReader(deps: WeiboReaderDeps): WeiboReader {
    return new WeiboReaderImpl(deps);
}
