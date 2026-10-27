/**
 * 订阅页视图纯函数
 *
 * 会话名称映射、关键词筛选与上限文案; 不触碰 React 或网络。
 */

import type {
    SessionInfo,
    SessionType,
    WeiboSubscription,
} from '../types';

/** 会话唯一键（群号与 QQ 号可能重号，需带类型） */
export function sessionKey(type: SessionType, id: string): string {
    return `${type}:${id}`;
}

/** type:id → 会话名 (无名称时不写入) */
export function buildSessionNameMap(
    sessions: SessionInfo[],
): Map<string, string> {
    const map = new Map<string, string>();
    for (const session of sessions) {
        if (session.name) {
            map.set(
                sessionKey(session.type, session.id),
                session.name,
            );
        }
    }
    return map;
}

/** 会话名; 未命中时返回空串, 由调用方决定回退文案 */
export function sessionNameOf(
    names: Map<string, string>,
    type: SessionType,
    id: string,
): string {
    return names.get(sessionKey(type, id)) ?? '';
}

/** 类型标签 */
export function sessionTypeLabel(type: SessionType): string {
    return type === 'group' ? '群' : '私聊';
}

/** 名称缺失时的回退文案 */
export function sessionFallbackName(type: SessionType): string {
    return type === 'group' ? '未知群' : '未知好友';
}

/**
 * 订阅关键词命中: 博主昵称 / UID / 任一推送目标的会话名或号码。
 * 空查询命中全部。
 */
export function matchesSubscription(
    item: WeiboSubscription,
    names: Map<string, string>,
    query: string,
): boolean {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    if (item.screenName.toLowerCase().includes(keyword)) return true;
    if (item.uid.includes(keyword)) return true;
    return item.targets.some(
        (target) =>
            target.id.includes(keyword) ||
            sessionNameOf(names, target.type, target.id)
                .toLowerCase()
                .includes(keyword),
    );
}

export function filterSubscriptions(
    items: WeiboSubscription[],
    names: Map<string, string>,
    query: string,
): WeiboSubscription[] {
    if (!query.trim()) return items;
    return items.filter((item) =>
        matchesSubscription(item, names, query),
    );
}

/** 上限页会话行关键词命中: 会话名或号码 */
export function matchesSessionRow(
    row: { type: SessionType; id: string },
    names: Map<string, string>,
    query: string,
): boolean {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return true;
    return (
        row.id.includes(keyword) ||
        sessionNameOf(names, row.type, row.id)
            .toLowerCase()
            .includes(keyword)
    );
}

/** 生效上限文案; null 表示无上限 */
export function limitText(limit: number | null): string {
    return limit === null ? '∞' : String(limit);
}

/** 上限输入是否为合法整数 (含边界) */
export function isValidLimitValue(
    value: number,
    min: number,
    max: number,
): boolean {
    return Number.isInteger(value) && value >= min && value <= max;
}

/** 按会话名排序 (无名称时回退号码), 稳定且与界面语言一致 */
export function sortSessionRows<
    T extends { type: SessionType; id: string },
>(rows: T[], names: Map<string, string>): T[] {
    return [...rows].sort((left, right) => {
        const nameLeft =
            sessionNameOf(names, left.type, left.id) || left.id;
        const nameRight =
            sessionNameOf(names, right.type, right.id) || right.id;
        return nameLeft.localeCompare(nameRight, 'zh-CN');
    });
}
