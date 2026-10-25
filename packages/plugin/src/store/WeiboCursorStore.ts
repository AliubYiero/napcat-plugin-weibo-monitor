/**
 * 微博游标 store (`weibo-cursor.json`)
 *
 * 数据是"uid → 游标"的映射而非列表, 因此不复用 BaseStore,
 * 但同样遵守单例 + 延迟实例化 + 立即落盘。
 */

import { pluginState } from '../core/state';
import { SEEN_ID_LIMIT } from '../weibo/seenCache';
import type { WeiboCursor } from '../weibo/types';

type CursorMap = Record<string, WeiboCursor>;

const EMPTY: WeiboCursor = {
    watermark: '',
    seenIds: [],
    initialized: false,
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
            ? { ...item, seenIds: [...item.seenIds] }
            : undefined;
    }

    /** 游标视图 (只读, 供状态页) */
    list(): Array<{ uid: string } & WeiboCursor> {
        return Object.entries(this.data).map(([uid, cursor]) => ({
            uid,
            ...cursor,
            seenIds: [...cursor.seenIds],
        }));
    }

    /** 写入已见缓存与展示水位线 */
    set(
        uid: string,
        next: Pick<WeiboCursor, 'watermark' | 'seenIds' | 'initialized'>,
    ): void {
        this.data[uid] = {
            watermark: next.watermark,
            seenIds: next.seenIds.slice(0, SEEN_ID_LIMIT),
            initialized: next.initialized,
            updatedAt: Date.now(),
        };
        this.save();
    }

    /**
     * 标记/清除暂停拉取状态 (幂等, 无变化时不落盘)
     *
     * 暂停标记持久化, 使插件重启后重新启用仍能走「基线重建不补发」。
     */
    setPaused(uid: string, paused: boolean): void {
        const current = this.data[uid];
        if (paused) {
            if (current?.paused === true) return;
            this.data[uid] = {
                ...(current ?? EMPTY),
                paused: true,
            };
        } else {
            if (!current || current.paused !== true) return;
            const { paused: _paused, ...rest } = current;
            this.data[uid] = rest;
        }
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

/**
 * 旧游标升级: 丢弃 watermark / recentIds 锚点, 只保留 paused。
 * 新的 initialized 标记缺失时视为未初始化, 首轮走基线不补发。
 */
function normalizeCursor(value: unknown): WeiboCursor | null {
    if (!isRecord(value)) return { ...EMPTY, seenIds: [] };
    const hasSeenSchema =
        Array.isArray(value.seenIds) || value.initialized === true;
    const seenIds = hasSeenSchema && Array.isArray(value.seenIds)
        ? value.seenIds
              .filter(
                  (id): id is string => typeof id === 'string',
              )
              .slice(0, SEEN_ID_LIMIT)
        : [];
    const watermark =
        hasSeenSchema && typeof value.watermark === 'string'
            ? value.watermark
            : '';
    const updatedAt =
        typeof value.updatedAt === 'number' ? value.updatedAt : 0;
    return {
        watermark,
        seenIds,
        initialized: value.initialized === true,
        updatedAt,
        paused: value.paused === true,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}
