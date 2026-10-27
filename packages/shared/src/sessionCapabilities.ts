/**
 * 会话能力投影
 *
 * 输入宿主会话、微博订阅、上限覆盖与超管名单, 输出每条会话的
 * 已用 / 上限 / 剩余 / 可选状态。纯函数: 不读 store、不碰网络、不依赖时间。
 */

import type { SessionType } from './index';
import type { WeiboSubscriptionTargetInput } from './weibo';

/** 未覆盖时的默认订阅上限 */
export const WEIBO_LIMIT_DEFAULTS = {
    group: 1,
    private: 0,
} as const satisfies Record<SessionType, number>;

/** 上限允许的最小值 */
export const WEIBO_LIMIT_MIN = 0;
/** 上限允许的最大值 */
export const WEIBO_LIMIT_MAX = 50;

/** 参与能力投影的宿主会话 */
export interface SessionCapabilitySession {
    type: SessionType;
    id: string;
    enabled: boolean;
}

/** 参与 used 统计的订阅投影 */
export interface SessionCapabilitySubscription {
    uid: string;
    targets: readonly WeiboSubscriptionTargetInput[];
}

/** 显式上限覆盖 */
export interface SessionCapabilityOverride
    extends WeiboSubscriptionTargetInput {
    limit: number;
}

export interface BuildSessionCapabilitiesInput {
    sessions: readonly SessionCapabilitySession[];
    subscriptions: readonly SessionCapabilitySubscription[];
    overrides?: readonly SessionCapabilityOverride[];
    adminUsers?: readonly string[];
    /** 传入时额外计算「该 uid 是否已订阅」与对应不可选原因 */
    subjectUid?: string | null;
}

export type SessionCapabilityReason =
    | 'session_disabled'
    | 'already_subscribed'
    | 'limit_reached';

export interface SessionCapability
    extends WeiboSubscriptionTargetInput {
    enabled: boolean;
    used: number;
    override?: number;
    /** 生效上限; null 表示无上限 */
    limit: number | null;
    unlimited: boolean;
    /** 还能新增多少; null 表示无上限 */
    remaining: number | null;
    /** 仅在提供 subjectUid 时可能为 true */
    subscribed: boolean;
    selectable: boolean;
    reason: SessionCapabilityReason | null;
}

/** 会话唯一键: 群号与 QQ 号可能重号, 必须带类型 */
export function sessionTargetKey(
    target: WeiboSubscriptionTargetInput,
): string {
    return `${target.type}:${target.id}`;
}

export function buildSessionCapabilities(
    input: BuildSessionCapabilitiesInput,
): SessionCapability[] {
    const usedByKey = new Map<string, number>();
    for (const subscription of input.subscriptions) {
        for (const target of subscription.targets) {
            const key = sessionTargetKey(target);
            usedByKey.set(key, (usedByKey.get(key) ?? 0) + 1);
        }
    }

    const subjectUid = normalizeSubjectUid(input.subjectUid);
    const subscribedKeys = new Set<string>();
    if (subjectUid !== null) {
        for (const subscription of input.subscriptions) {
            if (subscription.uid !== subjectUid) continue;
            for (const target of subscription.targets) {
                subscribedKeys.add(sessionTargetKey(target));
            }
        }
    }

    const overrides = new Map<string, number>();
    for (const override of input.overrides ?? []) {
        if (!isValidOverride(override.limit)) continue;
        overrides.set(sessionTargetKey(override), override.limit);
    }

    const adminUsers = input.adminUsers ?? [];

    return input.sessions.map((session) => {
        const key = sessionTargetKey(session);
        const used = usedByKey.get(key) ?? 0;
        const override = overrides.get(key);
        const unlimited =
            session.type === 'private' &&
            adminUsers.includes(session.id);
        const limit = unlimited
            ? null
            : (override ?? WEIBO_LIMIT_DEFAULTS[session.type]);
        const subscribed =
            subjectUid !== null && subscribedKeys.has(key);
        const remaining =
            limit === null ? null : Math.max(0, limit - used);

        let reason: SessionCapabilityReason | null = null;
        if (!session.enabled) reason = 'session_disabled';
        else if (subscribed) reason = 'already_subscribed';
        else if (remaining === 0) reason = 'limit_reached';

        return {
            type: session.type,
            id: session.id,
            enabled: session.enabled,
            used,
            ...(override === undefined ? {} : { override }),
            limit,
            unlimited,
            remaining,
            subscribed,
            selectable: reason === null,
            reason,
        };
    });
}

function normalizeSubjectUid(
    value: string | null | undefined,
): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

function isValidOverride(value: number): boolean {
    return Number.isInteger(value) && value >= WEIBO_LIMIT_MIN;
}
