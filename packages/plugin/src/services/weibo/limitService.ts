/**
 * 会话订阅上限
 *
 * 群上限可由超管通过 `#weibo max <n>` 调整; 私聊默认 0, 超管私聊无上限。
 */

import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import type { WeiboMonitorTarget } from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import { effectiveLimit } from './monitorService';

export interface LimitView {
    /** 有效上限; Infinity 表示无上限 */
    limit: number;
    used: number;
}

export const MAX_GROUP_LIMIT = 50;

class WeiboLimitService {
    get(target: WeiboMonitorTarget): LimitView {
        const store = WeiboMonitorStore.getInstance();
        return {
            limit: effectiveLimit(target),
            used: store.countForTarget(target),
        };
    }

    /** 设置群上限 (只允许非负整数, 最大 MAX_GROUP_LIMIT) */
    set(target: WeiboMonitorTarget, raw: number): void {
        if (!Number.isInteger(raw) || raw < 0) {
            throw new Error('上限必须是非负整数');
        }
        if (raw > MAX_GROUP_LIMIT) {
            throw new Error(`上限不能超过 ${MAX_GROUP_LIMIT}`);
        }
        sessionConfigService.setWeiboLimit(
            target.id,
            target.type,
            raw,
        );
    }
}

export const weiboLimitService = new WeiboLimitService();

export function formatLimit(limit: number): string {
    return Number.isFinite(limit) ? String(limit) : '无上限';
}
