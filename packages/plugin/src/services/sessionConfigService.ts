/**
 * 会话配置服务
 *
 * 会话级配置的唯一读写入口 (业务代码不得直接触碰 store 或散落判定 enabled)。
 * 默认关闭: 未记录或未写 `enabled` 一律视为禁用 (严格 `enabled === true`)。
 *
 * 范式: docs/store-pattern.md (延迟实例化)、docs/config-pattern.md 的"单一查询入口"
 * 【必须】store 实例在方法内惰性获取, 不在模块加载期触碰 (此时 ctx / dataPath 尚不可用)。
 */

import { PluginSessionConfigStore } from '../store/PluginSessionConfigStore';
import type { SessionType } from '../types';

class SessionConfigService {
    private _store: PluginSessionConfigStore | null = null;

    /** 惰性获取存储实例 (避免模块加载期触达未初始化的全局状态) */
    private get store(): PluginSessionConfigStore {
        if (!this._store) {
            this._store = PluginSessionConfigStore.getInstance();
        }
        return this._store;
    }

    /** 某会话是否启用 (单一查询入口; 默认关闭, 仅显式 enabled === true 才启用) */
    isSessionEnabled(id: string, type: SessionType): boolean {
        return this.store.find(id, type)?.enabled === true;
    }

    /** 群是否启用 (便捷入口, 等价于 isSessionEnabled(id, 'group')) */
    isGroupEnabled(id: string): boolean {
        return this.isSessionEnabled(id, 'group');
    }

    /** 设置某会话的启用状态 (upsert, 显式写入 enabled, 保留其它业务字段) */
    setSessionEnabled(
        id: string,
        type: SessionType,
        enabled: boolean,
    ): void {
        this.store.setMany([{ id, type, config: { enabled } }]);
    }

    /** 批量设置同一类型下多个会话的启用状态, 一次落盘 */
    setSessionsEnabled(
        ids: string[],
        type: SessionType,
        enabled: boolean,
    ): void {
        this.store.setMany(
            ids.map((id) => ({ id, type, config: { enabled } })),
        );
    }

    /**
     * 本会话的订阅上限。
     *
     * 优先读显式配置; 未配置或值非法时用调用方给的默认值
     * (群聊 1, 私聊 0; 超管私聊由上层跳过上限检查)。
     */
    getWeiboLimit(
        id: string,
        type: SessionType,
        fallback: number,
    ): number {
        return this.getWeiboLimitOverride(id, type) ?? fallback;
    }

    /** 本会话显式写入的上限覆盖; 未覆盖时返回 undefined */
    getWeiboLimitOverride(
        id: string,
        type: SessionType,
    ): number | undefined {
        const value = this.store.find(id, type)?.weiboLimit;
        return typeof value === 'number' &&
            Number.isInteger(value) &&
            value >= 0
            ? value
            : undefined;
    }

    /** 设置本会话的订阅上限 (只允许非负整数) */
    setWeiboLimit(
        id: string,
        type: SessionType,
        limit: number,
    ): void {
        if (!Number.isInteger(limit) || limit < 0) {
            throw new Error('订阅上限必须是非负整数');
        }
        this.store.setMany([{ id, type, config: { weiboLimit: limit } }]);
    }

    /**
     * 清除本会话的订阅上限覆盖, 回落到按类型推导的默认值。
     * 记录上没有其他业务字段时整条删除, 避免留下空记录。
     */
    clearWeiboLimit(id: string, type: SessionType): void {
        const existing = this.store.find(id, type);
        if (!existing) return;

        const next = { ...existing };
        delete next.weiboLimit;
        if (
            next.enabled === undefined &&
            Object.keys(next).length <= 2
        ) {
            this.store.remove(id, type);
            return;
        }
        // undefined 在落盘时会被 JSON.stringify 丢弃, 内存中也不参与上限判定
        this.store.update(id, type, { weiboLimit: undefined });
    }
}

export const sessionConfigService = new SessionConfigService();
