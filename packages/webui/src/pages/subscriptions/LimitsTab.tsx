import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    WEIBO_LIMIT_DEFAULTS,
    WEIBO_LIMIT_MAX,
    WEIBO_LIMIT_MIN,
} from 'shared';
import {
    IconAlert,
    IconRefresh,
    IconSearch,
} from '../../components/Icons';
import { useResource } from '../../hooks/useResource';
import { showToast } from '../../hooks/useToast';
import type {
    SessionType,
    WeiboLimitRow,
    WeiboLimitsView,
} from '../../types';
import {
    isValidLimitValue,
    limitText,
    matchesSessionRow,
    sessionFallbackName,
    sessionKey,
    sessionNameOf,
    sortSessionRows,
} from '../../utils/subscriptionView';
import { webuiApi } from '../../utils/webuiApi';

interface LimitsTabProps {
    sessionNames: Map<string, string>;
}

const EMPTY_VIEW: WeiboLimitsView = {
    meta: {
        min: WEIBO_LIMIT_MIN,
        max: WEIBO_LIMIT_MAX,
        defaults: { ...WEIBO_LIMIT_DEFAULTS },
    },
    sessions: [],
};

export default function LimitsTab({ sessionNames }: LimitsTabProps) {
    const [tab, setTab] = useState<SessionType>('group');
    const [keyword, setKeyword] = useState('');
    const [drafts, setDrafts] = useState<Record<string, string>>({});
    const [savingKey, setSavingKey] = useState<string | null>(null);

    const loadLimits = useCallback(() => webuiApi.getLimits(), []);
    const resource = useResource(loadLimits);
    const view = resource.data ?? EMPTY_VIEW;
    const loading = resource.loading && resource.data === null;
    const refreshing = resource.loading && resource.data !== null;
    const error = resource.error;
    const refresh = resource.refresh;

    useEffect(() => {
        if (!resource.data) return;
        const next: Record<string, string> = {};
        for (const row of resource.data.sessions) {
            next[sessionKey(row.type, row.id)] =
                row.override === undefined
                    ? ''
                    : String(row.override);
        }
        setDrafts(next);
    }, [resource.data]);

    const groupRows = useMemo(
        () =>
            sortSessionRows(
                view.sessions.filter((row) => row.type === 'group'),
                sessionNames,
            ),
        [view.sessions, sessionNames],
    );
    const privateRows = useMemo(
        () =>
            sortSessionRows(
                view.sessions.filter((row) => row.type === 'private'),
                sessionNames,
            ),
        [view.sessions, sessionNames],
    );

    const currentRows = tab === 'group' ? groupRows : privateRows;
    const filtered = useMemo(
        () =>
            currentRows.filter((row) =>
                matchesSessionRow(row, sessionNames, keyword),
            ),
        [currentRows, sessionNames, keyword],
    );

    const setDraft = (row: WeiboLimitRow, value: string) => {
        setDrafts((prev) => ({
            ...prev,
            [sessionKey(row.type, row.id)]: value,
        }));
    };

    const save = async (row: WeiboLimitRow) => {
        const key = sessionKey(row.type, row.id);
        const trimmed = (drafts[key] ?? '').trim();
        if (trimmed === '') {
            await reset(row);
            return;
        }
        setSavingKey(key);
        try {
            const result = await webuiApi.setLimit({
                type: row.type,
                id: row.id,
                max: Number(trimmed),
            });
            if (!result.ok) {
                showToast(result.message, 'error');
                return;
            }
            showToast('已更新订阅上限', 'success');
            await refresh();
        } finally {
            setSavingKey(null);
        }
    };

    const reset = async (row: WeiboLimitRow) => {
        setSavingKey(sessionKey(row.type, row.id));
        try {
            const result = await webuiApi.clearLimit({
                type: row.type,
                id: row.id,
            });
            if (!result.ok) {
                showToast(result.message, 'error');
                return;
            }
            showToast('已恢复默认上限', 'success');
            await refresh();
        } finally {
            setSavingKey(null);
        }
    };

    const tabs: Array<{
        id: SessionType;
        label: string;
        count: number;
    }> = [
        { id: 'group', label: '群聊', count: groupRows.length },
        { id: 'private', label: '好友', count: privateRows.length },
    ];

    return (
        <section className="card overflow-hidden animate-fade-in-up">
            <div className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold text-sm">
                        订阅上限
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                        上限只约束新增订阅，调整后不会回收已有订阅；设为{' '}
                        {view.meta.min}{' '}
                        可禁止新增。留空并保存、或点击「恢复」即回落默认值。
                    </p>
                </div>
                <button
                    type="button"
                    className="btn btn-ghost text-xs"
                    disabled={refreshing}
                    onClick={() => {
                        void refresh();
                    }}
                >
                    <IconRefresh size={13} />
                    刷新
                </button>
            </div>

            {error && (
                <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                    <IconAlert size={14} />
                    <span className="flex-1">{error}</span>
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={() => {
                            void refresh();
                        }}
                    >
                        重试
                    </button>
                </div>
            )}

            <div className="flex items-center gap-1 px-5 border-b border-gray-100 dark:border-gray-800">
                {tabs.map((item) => (
                    <button
                        type="button"
                        key={item.id}
                        className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            tab === item.id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                        }`}
                        onClick={() => setTab(item.id)}
                    >
                        {item.label} ({item.count})
                    </button>
                ))}
            </div>

            <div className="px-5 py-3 flex items-center gap-3">
                <div className="relative flex-1 max-w-xs">
                    <IconSearch
                        size={13}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                        type="text"
                        value={keyword}
                        onChange={(event) =>
                            setKeyword(event.target.value)
                        }
                        placeholder={
                            tab === 'group'
                                ? '搜索群名称或群号...'
                                : '搜索好友昵称或 QQ...'
                        }
                        className="input-field text-xs pl-8"
                    />
                </div>
                <span className="text-xs text-gray-400">
                    默认上限：群 {view.meta.defaults.group}，好友{' '}
                    {view.meta.defaults.private}
                </span>
            </div>

            {loading ? (
                <div className="flex items-center justify-center h-40">
                    <div className="loading-spinner text-primary" />
                </div>
            ) : error ? null : filtered.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                    {currentRows.length === 0
                        ? `宿主未返回任何${
                              tab === 'group' ? '群聊' : '好友'
                          }`
                        : `没有匹配「${keyword.trim()}」的会话`}
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.02]">
                                <th className="py-2.5 px-5 font-medium">
                                    会话
                                </th>
                                <th className="py-2.5 px-5 font-medium">
                                    已用 / 上限
                                </th>
                                <th className="py-2.5 px-5 font-medium">
                                    上限设置
                                </th>
                                <th className="py-2.5 px-5 font-medium text-right">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                            {filtered.map((row) => {
                                const key = sessionKey(
                                    row.type,
                                    row.id,
                                );
                                const name =
                                    sessionNameOf(
                                        sessionNames,
                                        row.type,
                                        row.id,
                                    ) ||
                                    sessionFallbackName(row.type);
                                const draft = drafts[key] ?? '';
                                const trimmed = draft.trim();
                                const parsed = Number(trimmed);
                                const valid =
                                    trimmed !== '' &&
                                    isValidLimitValue(
                                        parsed,
                                        view.meta.min,
                                        view.meta.max,
                                    );
                                const canSave =
                                    valid ||
                                    (trimmed === '' &&
                                        row.override !== undefined);
                                const dirty =
                                    row.override === undefined
                                        ? trimmed !== ''
                                        : trimmed !==
                                          String(row.override);
                                const saving = savingKey === key;

                                return (
                                    <tr key={key}>
                                        <td className="py-3 px-5">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-medium">
                                                    {name}
                                                </span>
                                                <span className="font-mono text-xs text-gray-400">
                                                    ({row.id})
                                                </span>
                                                {!row.enabled && (
                                                    <span className="text-[10px] px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                        已禁用
                                                    </span>
                                                )}
                                                {row.override ===
                                                    undefined && (
                                                    <span className="text-[10px] px-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                                                        默认
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="py-3 px-5">
                                            <span className="font-mono text-xs">
                                                {row.used} /{' '}
                                                {limitText(row.limit)}
                                            </span>
                                            {valid &&
                                                parsed < row.used && (
                                                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                                                        低于已用{' '}
                                                        {row.used}
                                                        ，新增将被拒绝
                                                    </div>
                                                )}
                                        </td>
                                        <td className="py-3 px-5">
                                            {row.unlimited ? (
                                                <span className="text-xs text-gray-400">
                                                    超级管理员私聊无上限
                                                </span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={
                                                        view.meta.min
                                                    }
                                                    max={
                                                        view.meta.max
                                                    }
                                                    step={1}
                                                    value={draft}
                                                    placeholder={`默认 ${view.meta.defaults[row.type]}`}
                                                    disabled={saving}
                                                    onChange={(
                                                        event,
                                                    ) =>
                                                        setDraft(
                                                            row,
                                                            event
                                                                .target
                                                                .value,
                                                        )
                                                    }
                                                    className="input-field text-xs w-24"
                                                />
                                            )}
                                        </td>
                                        <td className="py-3 px-5">
                                            {!row.unlimited && (
                                                <div className="flex items-center justify-end gap-1">
                                                    <button
                                                        type="button"
                                                        className="btn btn-primary text-xs"
                                                        disabled={
                                                            saving ||
                                                            !dirty ||
                                                            !canSave
                                                        }
                                                        onClick={() => {
                                                            void save(
                                                                row,
                                                            );
                                                        }}
                                                    >
                                                        保存
                                                    </button>
                                                    {row.override !==
                                                        undefined && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-ghost text-xs"
                                                            disabled={
                                                                saving
                                                            }
                                                            onClick={() => {
                                                                void reset(
                                                                    row,
                                                                );
                                                            }}
                                                        >
                                                            恢复
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
