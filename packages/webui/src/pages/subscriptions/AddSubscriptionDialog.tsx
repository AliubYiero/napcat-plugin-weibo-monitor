import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    IconAlert,
    IconCheck,
    IconX,
} from '../../components/Icons';
import Checkbox from '../../components/form/Checkbox';
import { showToast } from '../../hooks/useToast';
import type {
    AddWeiboSubscriptionResult,
    PluginStatus,
    SessionInfo,
    WeiboLimitRow,
    WeiboLimitsView,
    WeiboSubscription,
    WeiboSubscriptionTargetResult,
    WeiboSubscriptionTargetInput,
} from '../../types';
import {
    noAuthFetch,
    readApiErrorMessage,
} from '../../utils/api';
import {
    limitText,
    sessionFallbackName,
    sessionKey,
    sessionTypeLabel,
} from '../../utils/subscriptionView';

interface AddSubscriptionDialogProps {
    open: boolean;
    sessions: SessionInfo[];
    subscriptions: WeiboSubscription[];
    onClose: () => void;
    onAdded: () => Promise<void>;
    onOpenSessions: () => void;
    onOpenLimits: () => void;
}

const UID_PATTERN = /^\d{3,20}$/;

export default function AddSubscriptionDialog({
    open,
    sessions,
    subscriptions,
    onClose,
    onAdded,
    onOpenSessions,
    onOpenLimits,
}: AddSubscriptionDialogProps) {
    const [uid, setUid] = useState('');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [limits, setLimits] = useState<Map<string, WeiboLimitRow>>(
        new Map(),
    );
    const [limitsLoading, setLimitsLoading] = useState(false);
    const [limitsError, setLimitsError] = useState<string | null>(null);
    const [status, setStatus] = useState<PluginStatus | null>(null);
    const [statusError, setStatusError] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [results, setResults] = useState<
        WeiboSubscriptionTargetResult[] | null
    >(null);

    useEffect(() => {
        if (!open) return;
        setUid('');
        setSelected(new Set());
        setResults(null);
        setSubmitting(false);
        setLimits(new Map());
        setStatus(null);
        setStatusError(false);
        setLimitsLoading(true);
        setLimitsError(null);

        let cancelled = false;
        void (async () => {
            const [limitsResult, statusResult] = await Promise.allSettled([
                noAuthFetch<WeiboLimitsView>('/weibo/limits'),
                noAuthFetch<PluginStatus>('/status'),
            ]);
            if (cancelled) return;

            if (
                limitsResult.status === 'fulfilled' &&
                limitsResult.value.code === 0 &&
                limitsResult.value.data
            ) {
                const map = new Map<string, WeiboLimitRow>();
                for (const row of limitsResult.value.data.sessions) {
                    map.set(sessionKey(row.type, row.id), row);
                }
                setLimits(map);
            } else {
                setLimitsError(
                    limitsResult.status === 'rejected'
                        ? readApiErrorMessage(limitsResult.reason)
                        : '读取会话上限失败',
                );
            }

            if (
                statusResult.status === 'fulfilled' &&
                statusResult.value.code === 0 &&
                statusResult.value.data
            ) {
                setStatus(statusResult.value.data);
            } else {
                setStatusError(true);
            }
            setLimitsLoading(false);
        })();

        return () => {
            cancelled = true;
        };
    }, [open]);

    const uidValue = uid.trim();
    const uidValid = UID_PATTERN.test(uidValue);
    const uidInvalid = uidValue.length > 0 && !uidValid;

    const enabledSessions = useMemo(
        () =>
            sessions
                .filter((session) => session.enabled)
                .slice()
                .sort((left, right) =>
                    left.name.localeCompare(right.name, 'zh-CN'),
                ),
        [sessions],
    );

    const subscribedKeys = useMemo(() => {
        const keys = new Set<string>();
        if (!uidValid) return keys;
        const item = subscriptions.find(
            (subscription) => subscription.uid === uidValue,
        );
        if (!item) return keys;
        for (const target of item.targets) {
            keys.add(sessionKey(target.type, target.id));
        }
        return keys;
    }, [subscriptions, uidValid, uidValue]);

    useEffect(() => {
        setSelected((prev) => {
            let changed = false;
            const next = new Set<string>();
            for (const key of prev) {
                if (subscribedKeys.has(key)) {
                    changed = true;
                } else {
                    next.add(key);
                }
            }
            return changed ? next : prev;
        });
    }, [subscribedKeys]);

    const usedByKey = useMemo(() => {
        const map = new Map<string, number>();
        for (const subscription of subscriptions) {
            for (const target of subscription.targets) {
                const key = sessionKey(target.type, target.id);
                map.set(key, (map.get(key) ?? 0) + 1);
            }
        }
        return map;
    }, [subscriptions]);

    const targetByKey = useMemo(() => {
        const map = new Map<string, WeiboSubscriptionTargetInput>();
        for (const session of sessions) {
            map.set(sessionKey(session.type, session.id), {
                type: session.type,
                id: session.id,
            });
        }
        return map;
    }, [sessions]);

    const rowState = (session: SessionInfo) => {
        const key = sessionKey(session.type, session.id);
        const row = limits.get(key);
        const used = row?.used ?? usedByKey.get(key) ?? 0;
        const limit = row ? row.limit : null;
        const unlimited = row?.unlimited ?? false;
        const subscribed = subscribedKeys.has(key);
        const full =
            !unlimited && limit !== null && used >= limit;
        return {
            key,
            used,
            limit,
            unlimited,
            subscribed,
            full,
            selectable: !subscribed && !full,
        };
    };

    const selectableKeys = enabledSessions
        .filter((session) => rowState(session).selectable)
        .map((session) => sessionKey(session.type, session.id));

    const allSelected =
        selectableKeys.length > 0 &&
        selectableKeys.every((key) => selected.has(key));

    const toggleAll = () => {
        setSelected(
            allSelected ? new Set() : new Set(selectableKeys),
        );
    };

    const toggleOne = (key: string, checked: boolean) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (checked) next.add(key);
            else next.delete(key);
            return next;
        });
    };

    const cookieReady =
        status !== null &&
        status.weibo.cookie.configured &&
        !status.weibo.cookie.invalid;
    const browserReady = status !== null && status.weibo.browser.available;
    const prerequisiteError = statusError
        ? '无法读取运行状态，请关闭窗口后重试。'
        : status === null
          ? null
          : !cookieReady
            ? '未配置有效的微博 Cookie，无法获取博主资料。请先在「账号」页完成 Cookie 配置。'
            : !browserReady
              ? '未找到可用的 Chromium 内核浏览器，无法获取博主资料。请先在「账号」页安装或指定浏览器。'
              : null;

    const submitDisabled =
        submitting ||
        !uidValid ||
        selected.size === 0 ||
        status === null ||
        prerequisiteError !== null ||
        limitsLoading ||
        limitsError !== null;

    const submit = async () => {
        if (submitDisabled) return;
        const targets = [...selected]
            .map((key) => targetByKey.get(key))
            .filter(
                (target): target is WeiboSubscriptionTargetInput =>
                    target !== undefined,
            );
        if (targets.length === 0) return;

        setSubmitting(true);
        setResults(null);
        try {
            const res = await noAuthFetch<AddWeiboSubscriptionResult>(
                '/weibo/subscriptions/add',
                {
                    method: 'POST',
                    body: JSON.stringify({ uid: uidValue, targets }),
                },
            );
            if (res.code !== 0 || !res.data) {
                throw new Error(res.message || '新增订阅失败');
            }

            const { results: list } = res.data;
            setResults(list);
            const okCount = list.filter((item) => item.ok).length;
            const failed = list.filter((item) => !item.ok);

            if (okCount > 0) {
                await onAdded();
            }

            if (failed.length === 0) {
                showToast(
                    `已新增 ${okCount} 个会话的订阅`,
                    'success',
                );
                onClose();
                return;
            }

            setSelected(
                new Set(
                    failed.map((item) =>
                        sessionKey(item.type, item.id),
                    ),
                ),
            );
            showToast(
                okCount > 0
                    ? `已新增 ${okCount} 个，${failed.length} 个失败`
                    : '新增失败',
                okCount > 0 ? 'warning' : 'error',
            );
        } catch (err) {
            showToast(readApiErrorMessage(err), 'error');
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    const hasSelectable = selectableKeys.length > 0;
    const emptyAllSubscribed =
        uidValid &&
        enabledSessions.length > 0 &&
        enabledSessions.every((session) =>
            subscribedKeys.has(
                sessionKey(session.type, session.id),
            ),
        );

    return createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
                className="absolute inset-0 bg-black/40"
                onClick={() => {
                    if (!submitting) onClose();
                }}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-label="新增订阅"
                className="relative card w-full max-w-lg max-h-[85vh] flex flex-col"
            >
                <div className="flex items-start justify-between gap-3 p-5 pb-3 border-b border-gray-100 dark:border-gray-800">
                    <div>
                        <h2 className="font-semibold text-sm">
                            新增订阅
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            输入博主 UID，选择要推送的会话；同一博主在多个会话间共用一份动态缓存。
                        </p>
                    </div>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                        aria-label="关闭"
                        disabled={submitting}
                        onClick={onClose}
                    >
                        <IconX size={16} />
                    </button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto">
                    {prerequisiteError && (
                        <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                            <IconAlert size={14} />
                            <span>{prerequisiteError}</span>
                        </div>
                    )}
                    {limitsError && (
                        <div className="flex items-start gap-2 text-xs text-red-600 dark:text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                            <IconAlert size={14} />
                            <span className="flex-1">
                                读取会话上限失败：{limitsError}
                            </span>
                        </div>
                    )}

                    <div>
                        <label
                            htmlFor="weibo-uid"
                            className="block text-xs font-medium text-gray-500 mb-1"
                        >
                            博主 UID
                        </label>
                        <input
                            id="weibo-uid"
                            type="text"
                            inputMode="numeric"
                            value={uid}
                            autoFocus
                            disabled={submitting}
                            onChange={(event) =>
                                setUid(event.target.value)
                            }
                            placeholder="例如 1234567890"
                            className="input-field text-sm font-mono"
                        />
                        {uidInvalid && (
                            <p className="text-xs text-red-500 mt-1">
                                UID 必须是 3~20 位数字
                            </p>
                        )}
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs font-medium text-gray-500">
                                推送会话
                            </span>
                            <label className="flex items-center gap-1.5 text-xs text-gray-500">
                                <Checkbox
                                    checked={allSelected}
                                    disabled={
                                        !hasSelectable || submitting
                                    }
                                    onChange={toggleAll}
                                    ariaLabel="全选可推送会话"
                                />
                                全选
                            </label>
                        </div>

                        {limitsLoading && (
                            <div className="flex items-center justify-center h-20">
                                <div className="loading-spinner text-primary" />
                            </div>
                        )}

                        {!limitsLoading &&
                            enabledSessions.length === 0 && (
                                <div className="text-center text-xs text-gray-400 py-6 space-y-2">
                                    <p>没有已启用的会话，无法新增订阅。</p>
                                    <button
                                        type="button"
                                        className="btn btn-ghost text-xs"
                                        onClick={onOpenSessions}
                                    >
                                        去会话管理
                                    </button>
                                </div>
                            )}

                        {!limitsLoading &&
                            enabledSessions.length > 0 && (
                                <div className="max-h-64 overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800/50">
                                    {enabledSessions.map((session) => {
                                        const state = rowState(session);
                                        const label =
                                            session.name ||
                                            sessionFallbackName(
                                                session.type,
                                            );
                                        return (
                                            <label
                                                key={state.key}
                                                className={`flex items-center gap-2 px-3 py-2 text-xs ${
                                                    state.selectable
                                                        ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5'
                                                        : 'opacity-60'
                                                }`}
                                            >
                                                <Checkbox
                                                    checked={selected.has(
                                                        state.key,
                                                    )}
                                                    disabled={
                                                        !state.selectable ||
                                                        submitting
                                                    }
                                                    onChange={(checked) =>
                                                        toggleOne(
                                                            state.key,
                                                            checked,
                                                        )
                                                    }
                                                    ariaLabel={`推送 ${label}`}
                                                />
                                                <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] text-gray-500">
                                                    {sessionTypeLabel(
                                                        session.type,
                                                    )}
                                                </span>
                                                <span className="flex-1 truncate">
                                                    {label}
                                                </span>
                                                <span className="font-mono text-[11px] text-gray-400">
                                                    ({session.id})
                                                </span>
                                                <span
                                                    className={`shrink-0 text-[11px] ${
                                                        state.subscribed
                                                            ? 'text-primary'
                                                            : state.full
                                                              ? 'text-amber-600 dark:text-amber-400'
                                                              : 'text-gray-400'
                                                    }`}
                                                >
                                                    {state.subscribed
                                                        ? '已订阅'
                                                        : state.full
                                                          ? '已满'
                                                          : `已用 ${state.used}/${
                                                                state.unlimited
                                                                    ? limitText(
                                                                          null,
                                                                      )
                                                                    : limitText(
                                                                          state.limit,
                                                                      )
                                                            }`}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            )}

                        {!limitsLoading &&
                            enabledSessions.length > 0 &&
                            !hasSelectable && (
                                <div className="text-center text-xs text-gray-400 py-3 space-y-1">
                                    <p>
                                        {emptyAllSubscribed
                                            ? '该博主已订阅所有已启用的会话。'
                                            : '所有可推送会话均已达到订阅上限。'}
                                    </p>
                                    {!emptyAllSubscribed && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost text-xs"
                                            onClick={onOpenLimits}
                                        >
                                            去调整订阅上限
                                        </button>
                                    )}
                                </div>
                            )}
                    </div>

                    {results && results.length > 0 && (
                        <div className="space-y-1 rounded-lg bg-gray-50 dark:bg-white/[0.03] px-3 py-2">
                            {results.map((item) => {
                                const session = sessions.find(
                                    (candidate) =>
                                        candidate.type === item.type &&
                                        candidate.id === item.id,
                                );
                                const label =
                                    session?.name ||
                                    sessionFallbackName(item.type);
                                return (
                                    <div
                                        key={sessionKey(
                                            item.type,
                                            item.id,
                                        )}
                                        className={`flex items-start gap-1.5 text-xs ${
                                            item.ok
                                                ? 'text-green-600 dark:text-green-400'
                                                : 'text-red-600 dark:text-red-400'
                                        }`}
                                    >
                                        <span className="mt-0.5 shrink-0">
                                            {item.ok ? (
                                                <IconCheck size={12} />
                                            ) : (
                                                <IconX size={12} />
                                            )}
                                        </span>
                                        <span className="flex-1">
                                            {label}（{item.id}）：
                                            {item.message}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 p-5 pt-3 border-t border-gray-100 dark:border-gray-800">
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={submitting}
                        onClick={onClose}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary text-xs"
                        disabled={submitDisabled}
                        onClick={() => {
                            void submit();
                        }}
                    >
                        {submitting
                            ? '添加中...'
                            : `添加${selected.size > 0 ? ` (${selected.size})` : ''}`}
                    </button>
                </div>
            </div>
        </div>,
        document.body,
    );
}
