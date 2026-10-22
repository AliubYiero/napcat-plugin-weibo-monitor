import { useCallback, useEffect, useRef, useState } from 'react';
import { IconAlert, IconRefresh, IconX } from '../components/Icons';
import { showToast } from '../hooks/useToast';
import type {
    WeiboSubscription,
    WeiboSubscriptionsResult,
} from '../types';
import { noAuthFetch, noAuthUrl } from '../utils/api';

interface PendingRemoval {
    uid: string;
    screenName: string;
    target: { type: 'group' | 'private'; id: string };
}

export default function SubscriptionsPage() {
    const [subscriptions, setSubscriptions] = useState<
        WeiboSubscription[]
    >([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [removing, setRemoving] = useState(false);
    const [pending, setPending] = useState<PendingRemoval | null>(
        null,
    );
    const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );

    const fetchSubscriptions = useCallback(async () => {
        const res = (await noAuthFetch<WeiboSubscription[]>(
            '/weibo/subscriptions',
        )) as WeiboSubscriptionsResult;
        if (res.code === 0 && res.data) {
            setSubscriptions(res.data);
        }
        // 后端正在后台补拉头像: 只自动重试一次, 避免轮询
        if (
            (res.pendingAvatars ?? 0) > 0 &&
            retryTimer.current === null
        ) {
            retryTimer.current = setTimeout(() => {
                retryTimer.current = null;
                void fetchSubscriptions().catch(() => {
                    showToast('获取订阅列表失败', 'error');
                });
            }, 3000);
        }
    }, []);

    useEffect(() => {
        fetchSubscriptions()
            .catch(() => showToast('获取订阅列表失败', 'error'))
            .finally(() => setLoading(false));
        return () => {
            if (retryTimer.current !== null) {
                clearTimeout(retryTimer.current);
                retryTimer.current = null;
            }
        };
    }, [fetchSubscriptions]);

    const refresh = async () => {
        setRefreshing(true);
        try {
            await fetchSubscriptions();
        } catch {
            showToast('获取订阅列表失败', 'error');
        } finally {
            setRefreshing(false);
        }
    };

    const confirmRemoval = async () => {
        if (!pending) return;
        setRemoving(true);
        try {
            await noAuthFetch('/weibo/subscriptions/remove', {
                method: 'POST',
                body: JSON.stringify({
                    uid: pending.uid,
                    ...pending.target,
                }),
            });
            showToast('已移除订阅', 'success');
            setPending(null);
            await fetchSubscriptions();
        } catch {
            showToast('移除失败', 'error');
        } finally {
            setRemoving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">
                        正在加载订阅列表...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <section className="card overflow-hidden animate-fade-in-up">
                <div className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h2 className="font-semibold text-sm">
                            订阅列表
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            共 {subscriptions.length}{' '}
                            个博主；新增订阅请在已启用的会话中发送
                            <span className="font-mono px-1">
                                #weibo add UID
                            </span>
                        </p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={refreshing}
                        onClick={refresh}
                    >
                        <IconRefresh size={13} />
                        刷新
                    </button>
                </div>

                {pending && (
                    <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                        <IconAlert size={14} />
                        <span className="flex-1">
                            将移除 @{pending.screenName} 的
                            {pending.target.type === 'group'
                                ? '群 '
                                : '私聊 '}
                            {pending.target.id}{' '}
                            订阅；重新订阅不会补发期间动态。
                        </span>
                        <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={removing}
                            onClick={() => setPending(null)}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            className="btn btn-danger text-xs"
                            disabled={removing}
                            onClick={confirmRemoval}
                        >
                            确认移除
                        </button>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-white/[0.02]">
                                <th className="py-2.5 px-5 font-medium">
                                    博主
                                </th>
                                <th className="py-2.5 px-5 font-medium">
                                    UID
                                </th>
                                <th className="py-2.5 px-5 font-medium">
                                    订阅会话
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                            {subscriptions.map((item) => (
                                <tr key={item.uid}>
                                    <td className="py-3 px-5">
                                        <div className="flex items-center gap-2.5">
                                            <Avatar
                                                src={
                                                    item.avatarUrl
                                                        ? noAuthUrl(
                                                              item.avatarUrl,
                                                          )
                                                        : item.avatar
                                                }
                                                name={item.screenName}
                                            />
                                            <span className="font-medium">
                                                {item.screenName}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="py-3 px-5 font-mono text-xs text-gray-500">
                                        {item.uid}
                                    </td>
                                    <td className="py-3 px-5">
                                        <div className="flex flex-wrap gap-1.5">
                                            {item.targets.map(
                                                (target) => (
                                                    <span
                                                        key={`${target.type}:${target.id}`}
                                                        className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
                                                    >
                                                        {target.type ===
                                                        'group'
                                                            ? '群'
                                                            : '私聊'}{' '}
                                                        {target.id}
                                                        {!target.enabled && (
                                                            <span className="text-[10px] px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                                已禁用
                                                            </span>
                                                        )}
                                                        <button
                                                            type="button"
                                                            className="text-gray-400 hover:text-red-500"
                                                            aria-label="移除订阅"
                                                            onClick={() =>
                                                                setPending(
                                                                    {
                                                                        uid: item.uid,
                                                                        screenName:
                                                                            item.screenName,
                                                                        target,
                                                                    },
                                                                )
                                                            }
                                                        >
                                                            <IconX
                                                                size={
                                                                    11
                                                                }
                                                            />
                                                        </button>
                                                    </span>
                                                ),
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {subscriptions.length === 0 && (
                    <div className="py-12 text-center text-gray-400 text-sm">
                        暂无订阅，可在已启用的群聊中发送
                        <span className="font-mono px-1">
                            #weibo add UID
                        </span>
                    </div>
                )}
            </section>
        </div>
    );
}

function Avatar({ src, name }: { src: string; name: string }) {
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const failed = failedSrc === src;

    if (src && !failed) {
        return (
            <img
                src={src}
                alt={name}
                onError={() => setFailedSrc(src)}
                className="w-8 h-8 rounded-full object-cover bg-gray-100"
            />
        );
    }
    return (
        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
            {name.slice(0, 1)}
        </div>
    );
}
