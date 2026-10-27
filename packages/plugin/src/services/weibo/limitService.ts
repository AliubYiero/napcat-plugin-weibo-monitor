/**
 * 会话订阅上限
 *
 * 会话上限可由超管通过 `#weibo max <n>` 或 WebUI 调整; 群默认 1, 私聊默认 0,
 * 超管私聊无上限。显式覆盖存于会话级配置, 清除后回落类型默认值。
 */

import { pluginState } from '../../core/state';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import type {
    SessionType,
    WeiboLimitRow,
    WeiboLimitsView,
} from '../../types';
import type { WeiboMonitorTarget } from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';
import {
    DEFAULT_GROUP_LIMIT,
    DEFAULT_PRIVATE_LIMIT,
    effectiveLimit,
} from './monitorService';

export interface LimitView {
    /** 有效上限; Infinity 表示无上限 */
    limit: number;
    used: number;
}

/** 上限允许的最小值 (0 表示禁止新增订阅) */
export const MIN_LIMIT = 0;
/** 上限允许的最大值 */
export const MAX_LIMIT = 50;
/** 兼容旧调用方的别名 */
export const MAX_GROUP_LIMIT = MAX_LIMIT;

class WeiboLimitService {
    get(target: WeiboMonitorTarget): LimitView {
        const store = WeiboMonitorStore.getInstance();
        return {
            limit: effectiveLimit(target),
            used: store.countForTarget(target),
        };
    }

    /** 设置上限 (只允许 0..MAX_LIMIT 的整数) */
    set(target: WeiboMonitorTarget, raw: number): void {
        if (!Number.isInteger(raw) || raw < MIN_LIMIT) {
            throw new Error('上限必须是非负整数');
        }
        if (raw > MAX_LIMIT) {
            throw new Error(`上限不能超过 ${MAX_LIMIT}`);
        }
        if (isUnlimited(target)) {
            throw new Error('超级管理员私聊无上限, 无需设置');
        }
        sessionConfigService.setWeiboLimit(
            target.id,
            target.type,
            raw,
        );
    }

    /** 清除上限覆盖, 回落类型默认值 */
    clear(target: WeiboMonitorTarget): void {
        sessionConfigService.clearWeiboLimit(target.id, target.type);
    }

    /** 全部现有会话的上限视图 (用于 WebUI「订阅上限」tab) */
    view(
        sessions: Array<{
            type: SessionType;
            id: string;
            enabled: boolean;
        }>,
    ): WeiboLimitsView {
        const store = WeiboMonitorStore.getInstance();

        const rows: WeiboLimitRow[] = sessions.map((session) => {
            const target: WeiboMonitorTarget = {
                type: session.type,
                id: session.id,
            };
            const effective = effectiveLimit(target);
            return {
                type: session.type,
                id: session.id,
                used: store.countForTarget(target),
                override: sessionConfigService.getWeiboLimitOverride(
                    session.id,
                    session.type,
                ),
                limit: Number.isFinite(effective) ? effective : null,
                unlimited: !Number.isFinite(effective),
                enabled: session.enabled,
            };
        });

        return {
            meta: {
                min: MIN_LIMIT,
                max: MAX_LIMIT,
                defaults: {
                    group: DEFAULT_GROUP_LIMIT,
                    private: DEFAULT_PRIVATE_LIMIT,
                },
            },
            sessions: rows,
        };
    }
}

export const weiboLimitService = new WeiboLimitService();

export function formatLimit(limit: number): string {
    return Number.isFinite(limit) ? String(limit) : '无上限';
}

/** 超级管理员本人的私聊无上限 */
function isUnlimited(target: WeiboMonitorTarget): boolean {
    return (
        target.type === 'private' &&
        pluginState.config.adminUsers.includes(target.id)
    );
}
