import { useCallback, useEffect, useMemo, useState } from 'react';
import Checkbox from '../components/form/Checkbox';
import Toggle from '../components/form/Toggle';
import {
    IconCheck,
    IconGroup,
    IconRefresh,
    IconSearch,
    IconX,
} from '../components/Icons';
import { showToast } from '../hooks/useToast';
import type { SessionInfo } from '../types';
import { noAuthFetch } from '../utils/api';
import { sessionKey as sessionTargetKey } from '../utils/subscriptionView';

type TabType = 'group' | 'private';

/** 会话唯一键（群号与 QQ 号可能重号，需带类型） */
function sessionKey(session: SessionInfo): string {
    return sessionTargetKey(session.type, session.id);
}

export default function SessionsPage() {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<TabType>('group');
    const [search, setSearch] = useState('');
    const [selectAll, setSelectAll] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const fetchSessions = useCallback(async () => {
        setLoading(true);
        try {
            const res = await noAuthFetch<SessionInfo[]>('/sessions');
            if (res.code === 0 && res.data) {
                setSessions(res.data);
            }
        } catch {
            showToast('获取会话列表失败', 'error');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSessions();
    }, [fetchSessions]);

    const groups = useMemo(
        () => sessions.filter((s) => s.type === 'group'),
        [sessions],
    );
    const friends = useMemo(
        () => sessions.filter((s) => s.type === 'private'),
        [sessions],
    );

    const current = tab === 'group' ? groups : friends;
    const filtered = current.filter((s) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return s.name?.toLowerCase().includes(q) || s.id.includes(q);
    });

    const switchTab = (next: TabType) => {
        setTab(next);
        setSearch('');
        setSelected(new Set());
        setSelectAll(false);
    };

    const toggleSession = async (
        session: SessionInfo,
        enabled: boolean,
    ) => {
        try {
            await noAuthFetch(
                `/sessions/${session.type}/${session.id}/config`,
                {
                    method: 'POST',
                    body: JSON.stringify({ enabled }),
                },
            );
            setSessions((prev) =>
                prev.map((s) =>
                    sessionKey(s) === sessionKey(session)
                        ? { ...s, enabled }
                        : s,
                ),
            );
            showToast(
                `已${enabled ? '启用' : '禁用'} ${session.name || session.id}`,
                'success',
            );
        } catch {
            showToast('操作失败', 'error');
        }
    };

    const bulkToggle = async (enabled: boolean) => {
        const ids = filtered
            .filter((s) => selected.has(sessionKey(s)))
            .map((s) => s.id);
        if (ids.length === 0) {
            showToast('请先选择会话', 'warning');
            return;
        }
        try {
            await noAuthFetch('/sessions/bulk-config', {
                method: 'POST',
                body: JSON.stringify({ type: tab, enabled, ids }),
            });
            setSessions((prev) =>
                prev.map((s) =>
                    s.type === tab && selected.has(sessionKey(s))
                        ? { ...s, enabled }
                        : s,
                ),
            );
            showToast(
                `已批量${enabled ? '启用' : '禁用'} ${ids.length} 个会话`,
                'success',
            );
            setSelected(new Set());
            setSelectAll(false);
        } catch {
            showToast('批量操作失败', 'error');
        }
    };

    const toggleSelect = (session: SessionInfo) => {
        const key = sessionKey(session);
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const toggleSelectAll = () => {
        if (selectAll) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filtered.map(sessionKey)));
        }
        setSelectAll(!selectAll);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">
                        加载会话列表中...
                    </div>
                </div>
            </div>
        );
    }

    const tabs: { id: TabType; label: string; count: number }[] = [
        { id: 'group', label: '群聊', count: groups.length },
        { id: 'private', label: '好友', count: friends.length },
    ];

    return (
        <div className="space-y-4">
            {/* Tab 切换 */}
            <div className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800 animate-fade-in-down">
                {tabs.map((t) => (
                    <button
                        type="button"
                        key={t.id}
                        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                            tab === t.id
                                ? 'border-primary text-primary'
                                : 'border-transparent text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                        }`}
                        onClick={() => switchTab(t.id)}
                    >
                        {t.label} ({t.count})
                    </button>
                ))}
            </div>

            {/* 工具栏 */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-fade-in-down">
                <div className="relative flex-1 w-full sm:max-w-xs">
                    <IconSearch
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                    />
                    <input
                        className="input-field pl-9"
                        placeholder={
                            tab === 'group'
                                ? '搜索群名称或群号...'
                                : '搜索好友昵称或 QQ...'
                        }
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        onClick={fetchSessions}
                    >
                        <IconRefresh size={13} />
                        刷新
                    </button>
                    {selected.size > 0 && (
                        <>
                            <button
                                type="button"
                                className="btn btn-primary text-xs animate-scale-in"
                                onClick={() => bulkToggle(true)}
                            >
                                <IconCheck size={13} />
                                批量启用 ({selected.size})
                            </button>
                            <button
                                type="button"
                                className="btn btn-danger text-xs animate-scale-in"
                                onClick={() => bulkToggle(false)}
                            >
                                <IconX size={13} />
                                批量禁用 ({selected.size})
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* 统计 */}
            <p className="text-xs text-gray-400">
                共 {current.length} 个
                {tab === 'group' ? '群' : '好友'}，
                {current.filter((s) => s.enabled).length} 个已启用
                {search && `，搜索到 ${filtered.length} 个`}
            </p>

            {/* 会话列表 */}
            <div className="card overflow-hidden animate-fade-in-up">
                <table className="w-full text-sm stagger-rows">
                    <thead>
                        <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.02]">
                            <th className="py-2.5 px-4 font-medium w-10">
                                <Checkbox
                                    checked={selectAll}
                                    onChange={toggleSelectAll}
                                    ariaLabel="全选会话"
                                />
                            </th>
                            <th className="py-2.5 px-4 font-medium">
                                {tab === 'group' ? '群名称' : '昵称'}
                            </th>
                            <th className="py-2.5 px-4 font-medium">
                                {tab === 'group' ? '群号' : 'QQ'}
                            </th>
                            {tab === 'group' && (
                                <th className="py-2.5 px-4 font-medium">
                                    成员
                                </th>
                            )}
                            <th className="py-2.5 px-4 font-medium text-right">
                                状态
                            </th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                        {filtered.map((session) => (
                            <tr
                                key={sessionKey(session)}
                                className="hover:bg-gray-50/50 dark:hover:bg-white/[0.02] transition-colors"
                            >
                                <td className="py-2.5 px-4">
                                    <Checkbox
                                        checked={selected.has(
                                            sessionKey(session),
                                        )}
                                        onChange={() =>
                                            toggleSelect(session)
                                        }
                                        ariaLabel={`选择 ${
                                            session.name || session.id
                                        }`}
                                    />
                                </td>
                                <td className="py-2.5 px-4">
                                    <span className="text-gray-800 dark:text-gray-200 font-medium">
                                        {session.name ||
                                            (tab === 'group'
                                                ? '未知群'
                                                : '未知好友')}
                                    </span>
                                </td>
                                <td className="py-2.5 px-4 font-mono text-xs text-gray-500">
                                    {session.id}
                                </td>
                                {tab === 'group' && (
                                    <td className="py-2.5 px-4 text-xs text-gray-500">
                                        {session.memberCount}/
                                        {session.maxMemberCount}
                                    </td>
                                )}
                                <td className="py-2.5 px-4 text-right">
                                    <Toggle
                                        checked={session.enabled}
                                        ariaLabel={`${
                                            session.name || session.id
                                        } 启用状态`}
                                        onChange={(enabled) =>
                                            toggleSession(
                                                session,
                                                enabled,
                                            )
                                        }
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>

                {filtered.length === 0 && (
                    <div className="py-12 text-center empty-state">
                        <IconGroup
                            size={32}
                            className="mx-auto text-gray-300 dark:text-gray-600 mb-3"
                        />
                        <p className="text-gray-400 text-sm">
                            {search
                                ? '没有匹配的会话'
                                : tab === 'group'
                                  ? '暂无群数据'
                                  : '暂无好友数据'}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
