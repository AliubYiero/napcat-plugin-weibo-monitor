/**
 * 订阅业务
 *
 * 指令层只负责取参与反馈; UID 校验、上限、去重、资料刷新、游标播种都在这里。
 */

import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import { WeiboCursorStore } from '../../store/WeiboCursorStore';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import {
    filterQualifiedPosts,
    getPostId,
} from '../../weibo/predicate';
import type {
    WeiboMonitor,
    WeiboMonitorTarget,
    WeiboPost,
    WeiboSubscriptionView,
} from '../../weibo/types';
import { browserService } from '../browser/service';
import { sessionConfigService } from '../sessionConfigService';
import { weiboApiService } from './apiService';
import { weiboPushService } from './pushService';
import { weiboRuntime } from './runtimeStatus';

const DEFAULT_GROUP_LIMIT = 1;
const DEFAULT_PRIVATE_LIMIT = 0;

export interface AddResult {
    monitor: WeiboMonitor;
    seeded: boolean;
}

class WeiboMonitorService {
    private get store(): WeiboMonitorStore {
        return WeiboMonitorStore.getInstance();
    }

    /** 订阅一个博主并为其播种水位线 (不补发历史) */
    async add(
        rawUid: string,
        target: WeiboMonitorTarget,
    ): Promise<AddResult> {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new Error('UID 必须是纯数字');

        if (!WeiboCookieStore.getInstance().hasCookies()) {
            throw new Error(
                '尚未配置微博 Cookie, 请先在 WebUI 账号页填写',
            );
        }
        if (!browserService.isReady()) {
            throw new Error(
                '浏览器不可用, 请先在 WebUI 账号页安装 Chrome',
            );
        }

        const existing = this.store.get(uid);
        if (existing?.to.some((item) => sameTarget(item, target))) {
            throw new Error(`本会话已订阅 ${existing.screenName}`);
        }

        const limit = effectiveLimit(target);
        const used = this.store.countForTarget(target);
        if (used >= limit) {
            throw new Error(
                `本会话最多订阅 ${limit} 个博主, 当前已订阅 ${used} 个`,
            );
        }

        const profile = await weiboApiService.fetchProfile(uid);
        if (!profile.ok || !profile.user) {
            throw new Error(
                profile.failure === 'invalid'
                    ? 'Cookie 已失效, 请更新后重试'
                    : `获取博主信息失败: ${profile.message || '未知错误'}`,
            );
        }

        const screenName = profile.user.screen_name ?? `UID ${uid}`;
        const avatar =
            profile.user.avatar_large ??
            profile.user.avatar_hd ??
            profile.user.profile_image_url ??
            '';

        const timeline = await weiboApiService.fetchMyMblog(uid);
        if (!timeline.ok) {
            throw new Error(
                timeline.failure === 'invalid'
                    ? 'Cookie 已失效, 请更新后重试'
                    : `读取博主动态失败: ${timeline.message || '未知错误'}`,
            );
        }

        const seeded = this.seedCursor(uid, timeline.posts);
        this.store.addTarget(uid, screenName, avatar, target);
        const monitor = this.store.get(uid);
        if (!monitor) throw new Error('订阅写入失败');

        pluginState.logger.info(
            `已订阅微博 @${screenName} (${uid}) → ${target.type}:${target.id}`,
        );
        return { monitor, seeded };
    }

    /** 取消订阅; 返回是否成功 */
    remove(rawUid: string, target: WeiboMonitorTarget): boolean {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new Error('UID 必须是纯数字');

        const result = this.store.removeTarget(uid, target);
        if (!result.removed) return false;

        if (result.monitorRemoved) {
            WeiboCursorStore.getInstance().remove(uid);
            weiboRuntime.prune(
                new Set(this.store.list().map((m) => m.uid)),
            );
        }
        pluginState.logger.info(
            `已取消订阅微博 ${uid} ← ${target.type}:${target.id}`,
        );
        return true;
    }

    list(target: WeiboMonitorTarget): WeiboMonitor[] {
        return this.store.listForTarget(target);
    }

    get(uid: string): WeiboMonitor | undefined {
        return this.store.get(normalizeUid(uid) ?? uid);
    }

    /** 全部订阅 (WebUI 只读列表) */
    all(): WeiboSubscriptionView[] {
        return this.store.list().map((monitor) => ({
            uid: monitor.uid,
            screenName: monitor.screenName,
            avatar: monitor.avatar,
            targets: monitor.to.map((target) => ({ ...target })),
        }));
    }

    /** 最新一条合格动态 (不要求已订阅) */
    async latest(rawUid: string): Promise<WeiboPost | null> {
        const uid = normalizeUid(rawUid);
        if (!uid) throw new Error('UID 必须是纯数字');
        if (!WeiboCookieStore.getInstance().hasCookies()) {
            throw new Error('尚未配置微博 Cookie');
        }
        if (!browserService.isReady()) {
            throw new Error('浏览器不可用');
        }

        const timeline = await weiboApiService.fetchMyMblog(uid);
        if (!timeline.ok) {
            throw new Error(
                timeline.failure === 'invalid'
                    ? 'Cookie 已失效, 请更新后重试'
                    : `读取博主动态失败: ${timeline.message || '未知错误'}`,
            );
        }

        return filterQualifiedPosts(timeline.posts, uid)[0] ?? null;
    }

    /** 把最新动态按卡片推送到当前会话 */
    async pushLatest(
        post: WeiboPost,
        uid: string,
        target: WeiboMonitorTarget,
    ): Promise<{ pushed: number; failed: number }> {
        const existing = this.store.get(uid);
        const monitor: WeiboMonitor = existing ?? {
            uid,
            screenName: post.user?.screen_name ?? `UID ${uid}`,
            avatar: post.user?.avatar_large ?? '',
            to: [target],
        };
        return weiboPushService.pushPost(post, {
            ...monitor,
            to: [target],
        });
    }

    /** 用首页动态播种水位线; 已有游标时不覆盖 */
    private seedCursor(uid: string, posts: WeiboPost[]): boolean {
        const cursorStore = WeiboCursorStore.getInstance();
        if (cursorStore.get(uid)) return false;

        const qualified = filterQualifiedPosts(posts, uid);
        const watermark = qualified[0] ? getPostId(qualified[0]) : '';
        if (!watermark) return false;

        cursorStore.set(
            uid,
            watermark,
            qualified.slice(0, 20).map(getPostId),
        );
        return true;
    }
}

export const weiboMonitorService = new WeiboMonitorService();

export function normalizeUid(raw: string): string | null {
    const uid = raw.trim();
    return /^\d{3,20}$/.test(uid) ? uid : null;
}

export function sameTarget(
    left: WeiboMonitorTarget,
    right: WeiboMonitorTarget,
): boolean {
    return left.type === right.type && left.id === right.id;
}

/** 会话的有效订阅上限; 超管私聊无上限 */
export function effectiveLimit(target: WeiboMonitorTarget): number {
    if (
        target.type === 'private' &&
        pluginState.config.adminUsers.includes(target.id)
    ) {
        return Number.POSITIVE_INFINITY;
    }
    const fallback =
        target.type === 'group'
            ? DEFAULT_GROUP_LIMIT
            : DEFAULT_PRIVATE_LIMIT;
    return sessionConfigService.getWeiboLimit(
        target.id,
        target.type,
        fallback,
    );
}
