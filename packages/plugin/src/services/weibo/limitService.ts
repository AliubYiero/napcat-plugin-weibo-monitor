/**
 * 会话订阅上限
 *
 * 会话上限可由超管通过 `#weibo max <n>` 或 WebUI 调整; 群默认 1, 私聊默认 0,
 * 超管私聊无上限。显式覆盖存于会话级配置, 清除后回落类型默认值。
 * 已用 / 上限 / 剩余统一由 shared 的 `buildSessionCapabilities` 推导。
 */

import {
    buildSessionCapabilities,
    type SessionCapability,
    type SessionCapabilitySession,
    WEIBO_LIMIT_DEFAULTS,
    WEIBO_LIMIT_MAX,
    WEIBO_LIMIT_MIN,
} from 'shared';
import { pluginState } from '../../core/state';
import { WeiboMonitorStore } from '../../store/WeiboMonitorStore';
import type { WeiboLimitRow, WeiboLimitsView } from '../../types';
import type { WeiboMonitorTarget } from '../../weibo/types';
import { sessionConfigService } from '../sessionConfigService';

export interface LimitView {
    /** 有效上限; Infinity 表示无上限 */
    limit: number;
    used: number;
}

/** 上限允许的最小值 (0 表示禁止新增订阅) */
export const MIN_LIMIT = WEIBO_LIMIT_MIN;
/** 上限允许的最大值 */
export const MAX_LIMIT = WEIBO_LIMIT_MAX;
/** 兼容旧调用方的别名 */
export const MAX_GROUP_LIMIT = MAX_LIMIT;

class WeiboLimitService {
    get(target: WeiboMonitorTarget): LimitView {
        const [capability] = this.build([
            {
                type: target.type,
                id: target.id,
                enabled: sessionConfigService.isSessionEnabled(
                    target.id,
                    target.type,
                ),
            },
        ]);
        return {
            limit: capability.unlimited
                ? Number.POSITIVE_INFINITY
                : (capability.limit ?? 0),
            used: capability.used,
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
        if (this.get(target).limit === Number.POSITIVE_INFINITY) {
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
        sessions: readonly SessionCapabilitySession[],
    ): WeiboLimitsView {
        const rows: WeiboLimitRow[] = this.build(sessions).map(
            (capability) => toLimitRow(capability),
        );

        return {
            meta: {
                min: MIN_LIMIT,
                max: MAX_LIMIT,
                defaults: { ...WEIBO_LIMIT_DEFAULTS },
            },
            sessions: rows,
        };
    }

    private build(
        sessions: readonly SessionCapabilitySession[],
    ): SessionCapability[] {
        const store = WeiboMonitorStore.getInstance();
        const subscriptions = store.list().map((monitor) => ({
            uid: monitor.uid,
            targets: monitor.to,
        }));
        const overrides = sessions.flatMap((session) => {
            const limit = sessionConfigService.getWeiboLimitOverride(
                session.id,
                session.type,
            );
            return limit === undefined
                ? []
                : [{ type: session.type, id: session.id, limit }];
        });

        return buildSessionCapabilities({
            sessions,
            subscriptions,
            overrides,
            adminUsers: pluginState.config.adminUsers,
        });
    }
}

export const weiboLimitService = new WeiboLimitService();

export function formatLimit(limit: number): string {
    return Number.isFinite(limit) ? String(limit) : '无上限';
}

function toLimitRow(capability: SessionCapability): WeiboLimitRow {
    const row: WeiboLimitRow = {
        type: capability.type,
        id: capability.id,
        used: capability.used,
        limit: capability.limit,
        unlimited: capability.unlimited,
        enabled: capability.enabled,
    };
    if (capability.override !== undefined) {
        row.override = capability.override;
    }
    return row;
}
