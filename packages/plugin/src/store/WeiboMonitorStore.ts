/**
 * 微博订阅 store (`weibo-monitors.json`)
 *
 * 一个博主一条记录, `to` 保存所有订阅该博主的会话。删除某个会话的订阅时
 * 只摘除目标; 目标清空后整条记录删除, 避免留下无人订阅的僵尸博主。
 */

import type { SessionType } from '../types';
import type {
    WeiboMonitor,
    WeiboMonitorTarget,
} from '../weibo/types';
import { BaseStore } from './BaseStore';

export class WeiboMonitorStore extends BaseStore<WeiboMonitor> {
    private static readonly DATA_FILENAME = 'weibo-monitors.json';
    private static instance: WeiboMonitorStore | null = null;

    private constructor() {
        super(WeiboMonitorStore.DATA_FILENAME);
    }

    static getInstance(): WeiboMonitorStore {
        if (!WeiboMonitorStore.instance) {
            WeiboMonitorStore.instance = new WeiboMonitorStore();
        }
        return WeiboMonitorStore.instance;
    }

    /** 全部订阅 (浅拷贝数组, 元素为内部引用) */
    list(): WeiboMonitor[] {
        return [...this.getAll()];
    }

    /** 按 UID 取 (内部引用) */
    get(uid: string): WeiboMonitor | undefined {
        return this.findItem((item) => item.uid === uid);
    }

    has(uid: string): boolean {
        return this.hasItem((item) => item.uid === uid);
    }

    /** 某会话订阅的博主 */
    listForTarget(target: WeiboMonitorTarget): WeiboMonitor[] {
        return this.getAll().filter((item) =>
            hasTarget(item, target),
        );
    }

    /** 博主被哪些会话订阅 */
    targetsOf(uid: string): WeiboMonitorTarget[] {
        return [...(this.get(uid)?.to ?? [])];
    }

    /**
     * 添加订阅目标 (同一博主可被多个会话订阅)。
     * @returns false 表示该目标已存在
     */
    addTarget(
        uid: string,
        screenName: string,
        avatar: string,
        target: WeiboMonitorTarget,
    ): boolean {
        let added = false;

        this.mutate((items) => {
            const index = items.findIndex((item) => item.uid === uid);
            if (index === -1) {
                added = true;
                return [
                    ...items,
                    {
                        uid,
                        screenName,
                        avatar,
                        to: [target],
                    },
                ];
            }

            const current = items[index];
            if (hasTarget(current, target)) {
                const next = [...items];
                next[index] = {
                    ...current,
                    screenName,
                    avatar,
                };
                return next;
            }

            added = true;
            const next = [...items];
            next[index] = {
                ...current,
                screenName,
                avatar,
                to: [...current.to, target],
            };
            return next;
        });

        return added;
    }

    /**
     * 摘除某个会话的订阅。
     * @returns `removed` 是否摘除成功; `monitorRemoved` 是否连博主记录一并删除
     */
    removeTarget(
        uid: string,
        target: WeiboMonitorTarget,
    ): { removed: boolean; monitorRemoved: boolean } {
        let removed = false;
        let monitorRemoved = false;

        this.mutate((items) => {
            const index = items.findIndex((item) => item.uid === uid);
            if (index === -1) return items;

            const current = items[index];
            const nextTargets = current.to.filter(
                (item) =>
                    !(
                        item.id === target.id &&
                        item.type === target.type
                    ),
            );
            if (nextTargets.length === current.to.length)
                return items;

            removed = true;
            if (nextTargets.length === 0) {
                monitorRemoved = true;
                return items.filter((item) => item.uid !== uid);
            }

            const next = [...items];
            next[index] = { ...current, to: nextTargets };
            return next;
        });

        return { removed, monitorRemoved };
    }

    /** 删除博主及其全部订阅 */
    removeMonitor(uid: string): boolean {
        return this.removeItem((item) => item.uid === uid);
    }

    /** 更新博主资料 (头像/昵称) */
    updateMeta(
        uid: string,
        screenName: string,
        avatar: string,
    ): void {
        this.updateItem(
            (item) => item.uid === uid,
            (item) => ({ ...item, screenName, avatar }),
        );
    }

    /** 记录本地头像副本 (文件名 + 对应的远程 URL) */
    updateAvatar(
        uid: string,
        avatarPath: string,
        avatarSource: string,
    ): void {
        this.updateItem(
            (item) => item.uid === uid,
            (item) => ({ ...item, avatarPath, avatarSource }),
        );
    }

    /** 清除所有不存在于 validUids 的记录 (订阅已空等) */
    prune(validUids: ReadonlySet<string>): void {
        this.mutate((items) =>
            items.filter(
                (item) =>
                    validUids.has(item.uid) && item.to.length > 0,
            ),
        );
    }
}

function hasTarget(
    monitor: WeiboMonitor,
    target: WeiboMonitorTarget,
): boolean {
    return monitor.to.some(
        (item) => item.id === target.id && item.type === target.type,
    );
}

/** 构造订阅目标 (集中类型约束) */
export function createTarget(
    type: SessionType,
    id: string,
): WeiboMonitorTarget {
    return { type, id };
}
