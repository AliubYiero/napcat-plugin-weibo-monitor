import { useState } from 'react';
import {
    IconAlert,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconX,
} from '../../components/Icons';
import { showToast } from '../../hooks/useToast';
import type { SessionType, WeiboSubscription } from '../../types';
import { noAuthUrl } from '../../utils/api';
import {
    sessionFallbackName,
    sessionNameOf,
    sessionTypeLabel,
} from '../../utils/subscriptionView';
import Avatar from './Avatar';

interface PendingRemoval {
    uid: string;
    screenName: string;
    target: { type: SessionType; id: string };
}

interface SubscriptionsTabProps {
    subscriptions: WeiboSubscription[];
    filtered: WeiboSubscription[];
    sessionNames: Map<string, string>;
    keyword: string;
    onKeywordChange: (value: string) => void;
    onAdd: () => void;
    onRemove: (
        uid: string,
        target: { type: SessionType; id: string },
    ) => Promise<void>;
    onRefresh: () => Promise<void>;
    refreshing: boolean;
}

export default function SubscriptionsTab({
    subscriptions,
    filtered,
    sessionNames,
    keyword,
    onKeywordChange,
    onAdd,
    onRemove,
    onRefresh,
    refreshing,
}: SubscriptionsTabProps) {
    const [pending, setPending] = useState<PendingRemoval | null>(
        null,
    );
    const [removing, setRemoving] = useState(false);

    const confirmRemoval = async () => {
        if (!pending) return;
        setRemoving(true);
        try {
            await onRemove(pending.uid, pending.target);
            showToast('已移除订阅', 'success');
            setPending(null);
        } catch {
            showToast('移除失败', 'error');
        } finally {
            setRemoving(false);
        }
    };

    return (
        <section className="card overflow-hidden animate-fade-in-up">
            <div className="p-5 pb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2 className="font-semibold text-sm">订阅列表</h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                        共 {subscriptions.length} 个博主
                        {keyword.trim() &&
                            `，筛选出 ${filtered.length} 个`}
                        ；也可在已启用的会话中发送
                        <span className="font-mono px-1">
                            #weibo add UID
                        </span>
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                            <IconSearch size={13} />
                        </span>
                        <input
                            type="text"
                            value={keyword}
                            onChange={(event) =>
                                onKeywordChange(event.target.value)
                            }
                            placeholder="筛选博主 / UID / 会话"
                            className="input-field text-xs pl-8 pr-7 w-52"
                        />
                        {keyword && (
                            <button
                                type="button"
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                aria-label="清空筛选"
                                onClick={() => onKeywordChange('')}
                            >
                                <IconX size={12} />
                            </button>
                        )}
                    </div>
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={refreshing}
                        onClick={() => {
                            void onRefresh();
                        }}
                    >
                        <IconRefresh size={13} />
                        刷新
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary text-xs"
                        onClick={onAdd}
                    >
                        <IconPlus size={13} />
                        新增订阅
                    </button>
                </div>
            </div>

            {pending && (
                <div className="mx-5 mb-3 flex flex-wrap items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                    <IconAlert size={14} />
                    <span className="flex-1">
                        将移除 @{pending.screenName} 在
                        {sessionTypeLabel(pending.target.type)}{' '}
                        {pending.target.id} 的订阅；重新订阅不会补发期间动态。
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
                        onClick={() => {
                            void confirmRemoval();
                        }}
                    >
                        确认移除
                    </button>
                </div>
            )}

            {filtered.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-sm">
                    {subscriptions.length === 0 ? (
                        <>
                            暂无订阅，点击右上角「新增订阅」，或在已启用的会话中发送
                            <span className="font-mono px-1">
                                #weibo add UID
                            </span>
                        </>
                    ) : (
                        <>
                            没有匹配「{keyword.trim()}」的博主
                            <button
                                type="button"
                                className="btn btn-ghost text-xs ml-2"
                                onClick={() => onKeywordChange('')}
                            >
                                清空筛选
                            </button>
                        </>
                    )}
                </div>
            ) : (
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
                            {filtered.map((item) => (
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
                                                (target) => {
                                                    const name =
                                                        sessionNameOf(
                                                            sessionNames,
                                                            target.type,
                                                            target.id,
                                                        ) ||
                                                        sessionFallbackName(
                                                            target.type,
                                                        );
                                                    return (
                                                        <span
                                                            key={`${target.type}:${target.id}`}
                                                            className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500"
                                                        >
                                                            {
                                                                name
                                                            }{' '}
                                                            (
                                                            {
                                                                target.id
                                                            }
                                                            )
                                                            {!target.enabled && (
                                                                <span className="text-[10px] px-1 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                                    已禁用
                                                                </span>
                                                            )}
                                                            <button
                                                                type="button"
                                                                className="text-gray-400 hover:text-red-500"
                                                                aria-label={`移除 ${name} 的订阅`}
                                                                onClick={() => {
                                                                    setPending(
                                                                        {
                                                                            uid: item.uid,
                                                                            screenName:
                                                                                item.screenName,
                                                                            target,
                                                                        },
                                                                    );
                                                                }}
                                                            >
                                                                <IconX
                                                                    size={
                                                                        11
                                                                    }
                                                                />
                                                            </button>
                                                        </span>
                                                    );
                                                },
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
