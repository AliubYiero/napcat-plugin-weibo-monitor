import { sessionTargetKey } from 'shared';
import { pluginState } from '../../core/state';
import { WeiboCookieStore } from '../../store/WeiboCookieStore';
import {
    normalizePostId,
    PostCooldown,
} from '../../weibo/postLookup';
import type {
    WeiboMonitorTarget,
    WeiboPost,
} from '../../weibo/types';
import { browserService } from '../browser/service';
import {
    type WeiboStatusFailure,
    weiboApiService,
} from './apiService';
import {
    type DeliveryResult,
    weiboPostDelivery,
} from './postDelivery';

export type PostReadFailure =
    | 'invalid_id'
    | 'login_required'
    | 'cooldown'
    | 'not_found'
    | 'risk'
    | 'failed';

export interface PostReadFailureResult {
    ok: false;
    failure: PostReadFailure;
    message: string;
}

export interface PostReadSuccess {
    ok: true;
    post: WeiboPost;
}

export type PostReadResult = PostReadSuccess | PostReadFailureResult;

class WeiboPostService {
    private readonly cooldown = new PostCooldown();

    async read(
        rawId: string,
        target: WeiboMonitorTarget,
    ): Promise<PostReadResult> {
        const id = normalizePostId(rawId);
        if (!id) return fail('invalid_id');

        if (!WeiboCookieStore.getInstance().hasCookies()) {
            return fail('login_required', '尚未配置微博 Cookie');
        }
        if (!browserService.isReady()) {
            return fail('failed', '浏览器不可用');
        }

        const key = sessionTargetKey(target);
        if (this.cooldown.isCoolingDown(key)) {
            return fail('cooldown');
        }
        this.cooldown.touch(key);

        try {
            const status = await weiboApiService.fetchStatus(id);
            if (!status.ok || !status.post) {
                return fail(
                    mapStatusFailure(status.failure),
                    status.message,
                );
            }

            return { ok: true, post: status.post };
        } catch (error) {
            pluginState.logger.warn('按 ID 读取微博失败:', error);
            return fail('failed', messageOf(error));
        }
    }

    async deliver(
        post: WeiboPost,
        target: WeiboMonitorTarget,
    ): Promise<DeliveryResult> {
        try {
            const prepared = await weiboPostDelivery.prepare(post, {
                source: 'status',
            });
            return await weiboPostDelivery.deliver(
                [target],
                prepared,
            );
        } catch (error) {
            pluginState.logger.warn('按 ID 发送微博失败:', error);
            return { pushed: 0, failed: 1 };
        }
    }
}

export const weiboPostService = new WeiboPostService();

function fail(
    failure: PostReadFailure,
    message = '',
): PostReadFailureResult {
    return { ok: false, failure, message };
}

function mapStatusFailure(
    failure: WeiboStatusFailure,
): PostReadFailure {
    if (failure === 'invalid') return 'login_required';
    if (failure === 'not_found') return 'not_found';
    if (failure === 'risk') return 'risk';
    return 'failed';
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
