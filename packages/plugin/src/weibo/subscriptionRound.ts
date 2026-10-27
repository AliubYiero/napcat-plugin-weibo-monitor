import type { WeiboContentType } from 'shared';
import {
    type ClassifiedPost,
    findOwnerProfilePost,
} from './predicate';
import type { MyMblogResult, WeiboApiFailure } from './reader';
import { buildSeenBaseline, resolveSeenCache } from './seenCache';
import type {
    WeiboCursor,
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
    WeiboPostRenderContext,
} from './types';

export interface SubscriptionRoundLogger {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}

export interface SubscriptionRoundCursorPort {
    get(uid: string): WeiboCursor | undefined;
    set(
        uid: string,
        next: Pick<
            WeiboCursor,
            'watermark' | 'seenIds' | 'initialized'
        >,
    ): void;
    setPaused(uid: string, paused: boolean): void;
}

export interface SubscriptionRoundSubscriptionPort {
    list(): WeiboMonitor[];
    get(uid: string): WeiboMonitor | undefined;
    updateMeta(uid: string, screenName: string, avatar: string): void;
}

export interface SubscriptionRoundDeps {
    fetchPage(uid: string): Promise<MyMblogResult>;
    pushPost(
        post: WeiboPost,
        subscription: WeiboMonitor,
        context: WeiboPostRenderContext,
    ): Promise<void>;
    cursors: SubscriptionRoundCursorPort;
    subscriptions: SubscriptionRoundSubscriptionPort;
    isSessionEnabled(target: WeiboMonitorTarget): boolean;
    contentTypes(): readonly WeiboContentType[];
    now(): number;
    logger: SubscriptionRoundLogger;
}

export interface SubscriptionPollOutcome {
    ok: boolean;
    failure: WeiboApiFailure;
    message: string | null;
}

export interface SubscriptionRound {
    settlePause(): WeiboMonitor[];
    poll(
        subscription: WeiboMonitor,
    ): Promise<SubscriptionPollOutcome>;
}

export function createSubscriptionRound(
    deps: SubscriptionRoundDeps,
): SubscriptionRound {
    return {
        settlePause() {
            const active: WeiboMonitor[] = [];
            for (const subscription of deps.subscriptions.list()) {
                const enabled = subscription.to.some((target) =>
                    deps.isSessionEnabled(target),
                );
                if (enabled) {
                    active.push(subscription);
                } else {
                    deps.cursors.setPaused(subscription.uid, true);
                }
            }
            return active;
        },
        poll(subscription) {
            return pollSubscription(deps, subscription);
        },
    };
}

async function pollSubscription(
    deps: SubscriptionRoundDeps,
    subscription: WeiboMonitor,
): Promise<SubscriptionPollOutcome> {
    const result = await deps.fetchPage(subscription.uid);

    if (!result.ok) {
        const message =
            result.message ||
            `微博接口失败 (${result.failure ?? '未知'})`;
        deps.logger.warn(
            `微博拉取失败 @${subscription.screenName} (${subscription.uid}): ${message}`,
        );
        return {
            ok: false,
            failure: result.failure,
            message,
        };
    }

    const now = deps.now();
    refreshMeta(deps, subscription, result.posts);

    const cursor = deps.cursors.get(subscription.uid);

    if (cursor?.paused) {
        const baseline = buildSeenBaseline(result.posts, now);
        deps.cursors.set(subscription.uid, baseline);
        deps.cursors.setPaused(subscription.uid, false);
        deps.logger.info(
            `博主 ${subscription.uid} 已恢复推送, 已见缓存已重建 (不补发期间动态)`,
        );
        return { ok: true, failure: null, message: null };
    }

    const selection = resolveSeenCache(
        result.posts,
        subscription.uid,
        {
            seenIds: cursor?.seenIds ?? [],
            initialized: cursor?.initialized ?? false,
            watermark: cursor?.watermark ?? '',
        },
        deps.contentTypes(),
        now,
    );

    if (selection.reason === 'baseline') {
        deps.logger.info(
            `博主 ${subscription.uid} 首轮建立已见缓存 (不补发历史)`,
        );
    } else if (selection.reason === 'zero-overlap') {
        deps.logger.warn(
            `(；′⌒\`) 博主 ${subscription.uid} 的首页与已见缓存零重叠, 已静默重建`,
        );
    }

    if (
        !cursor ||
        selection.initialized !== cursor.initialized ||
        selection.nextWatermark !== cursor.watermark ||
        !sameIds(selection.nextSeenIds, cursor.seenIds)
    ) {
        deps.cursors.set(subscription.uid, {
            watermark: selection.nextWatermark,
            seenIds: selection.nextSeenIds,
            initialized: selection.initialized,
        });
    }

    const current = deps.subscriptions.get(subscription.uid);
    if (!current) {
        return { ok: true, failure: null, message: null };
    }

    for (const item of selection.pinned) {
        await deps.pushPost(
            item.post,
            current,
            buildContext(item, now),
        );
    }
    for (const item of selection.posts) {
        await deps.pushPost(
            item.post,
            current,
            buildContext(item, now),
        );
    }

    if (
        selection.pinned.length === 0 &&
        selection.posts.length === 0
    ) {
        deps.logger.debug(`微博无新动态 @${current.screenName}`);
    }

    return { ok: true, failure: null, message: null };
}

function refreshMeta(
    deps: SubscriptionRoundDeps,
    subscription: WeiboMonitor,
    posts: WeiboPost[],
): void {
    const ownerPost = findOwnerProfilePost(posts, subscription.uid);
    if (!ownerPost?.user) return;

    const screenName =
        ownerPost.user.screen_name ?? subscription.screenName;
    const avatar =
        ownerPost.user.avatar_large ??
        ownerPost.user.avatar_hd ??
        ownerPost.user.profile_image_url ??
        subscription.avatar;

    if (
        screenName !== subscription.screenName ||
        avatar !== subscription.avatar
    ) {
        deps.subscriptions.updateMeta(
            subscription.uid,
            screenName,
            avatar,
        );
    }
}

function buildContext(
    item: ClassifiedPost,
    fetchedAt: number,
): WeiboPostRenderContext {
    return {
        kind: item.kind,
        likeDay: item.likeDay,
        likeClock: item.likeClock,
        fetchedAt,
    };
}

function sameIds(left: string[], right: string[]): boolean {
    if (left.length !== right.length) return false;
    return left.every((id, index) => id === right[index]);
}
