/**
 * 微博游标 store (`weibo-cursor.json`)
 *
 * 记录每个博主的水位线与最近 id 集合。数据是"uid → 游标"的映射而非列表,
 * 因此不复用 BaseStore, 但同样遵守单例 + 延迟实例化 + 立即落盘。
 */

import { pluginState } from '../core/state';
import type { WeiboCursor } from '../weibo/types';

type CursorMap = Record<string, WeiboCursor>;

const EMPTY: WeiboCursor = {
    watermark: '',
    recentIds: [],
    updatedAt: 0,
};

export class WeiboCursorStore {
    private static readonly DATA_FILENAME = 'weibo-cursor.json';
    private static instance: WeiboCursorStore | null = null;

    private data: CursorMap;

    private constructor() {
        this.data = this.load();
    }

    static getInstance(): WeiboCursorStore {
        if (!WeiboCursorStore.instance) {
            WeiboCursorStore.instance = new WeiboCursorStore();
        }
        return WeiboCursorStore.instance;
    }

    get(uid: string): WeiboCursor | undefined {
        const item = this.data[uid];
        return item
            ? { ...item, recentIds: [...item.recentIds] }
            : undefined;
    }

    /** 游标视图 (只读, 供状态页) */
    list(): Array<{ uid: string } & WeiboCursor> {
        return Object.entries(this.data).map(([uid, cursor]) => ({
            uid,
            ...cursor,
            recentIds: [...cursor.recentIds],
        }));
    }

    /** 写入水位线与最近 id 集合 */
    set(uid: string, watermark: string, recentIds: string[]): void {
        this.data[uid] = {
            watermark,
            recentIds: recentIds.slice(0, 20),
            updatedAt: Date.now(),
        };
        this.save();
    }

    remove(uid: string): void {
        if (!(uid in this.data)) return;
        delete this.data[uid];
        this.save();
    }

    /** 删除不再订阅的博主游标 */
    prune(validUids: ReadonlySet<string>): void {
        let changed = false;
        for (const uid of Object.keys(this.data)) {
            if (!validUids.has(uid)) {
                delete this.data[uid];
                changed = true;
            }
        }
        if (changed) this.save();
    }

    private load(): CursorMap {
        const raw = pluginState.loadDataFile<unknown>(
            WeiboCursorStore.DATA_FILENAME,
            {},
        );
        if (!isRecord(raw)) {
            pluginState.logger.warn(
                `(；′⌒\`) 数据文件 ${WeiboCursorStore.DATA_FILENAME} 内容不是对象, 已按空数据加载`,
            );
            return {};
        }

        const out: CursorMap = {};
        for (const [uid, value] of Object.entries(raw)) {
            const cursor = normalizeCursor(value);
            if (cursor) out[uid] = cursor;
        }
        return out;
    }

    private save(): void {
        pluginState.saveDataFile(
            WeiboCursorStore.DATA_FILENAME,
            this.data,
        );
    }
}

function normalizeCursor(value: unknown): WeiboCursor | null {
    if (!isRecord(value)) return EMPTY;
    const watermark =
        typeof value.watermark === 'string' ? value.watermark : '';
    const recentIds = Array.isArray(value.recentIds)
        ? value.recentIds.filter(
              (id): id is string => typeof id === 'string',
          )
        : [];
    const updatedAt =
        typeof value.updatedAt === 'number' ? value.updatedAt : 0;
    return { watermark, recentIds, updatedAt };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}
