import { useCallback, useEffect, useState } from 'react';
import ConfigForm, {
    type FieldRenderer,
} from '../components/ConfigForm';
import {
    IconActivity,
    IconAlert,
    IconClock,
    IconDownload,
    IconGroup,
    IconKey,
    IconRefresh,
} from '../components/Icons';
import { showToast } from '../hooks/useToast';
import type { PluginConfig, PluginStatus } from '../types';
import { noAuthFetch } from '../utils/api';
import { formatRelative, formatTime } from '../utils/format';

interface StatusPageProps {
    status: PluginStatus | null;
}

/** 将毫秒格式化为可读时长 */
function formatUptime(uptimeMs: number): string {
    const seconds = Math.floor(uptimeMs / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (days > 0)
        return `${days}天 ${hours}小时 ${minutes}分 ${secs}秒`;
    if (hours > 0) return `${hours}小时 ${minutes}分 ${secs}秒`;
    if (minutes > 0) return `${minutes}分 ${secs}秒`;
    return `${secs}秒`;
}

/**
 * 自定义字段覆盖注册表 (逃生舱)
 *
 * 只改前端呈现, 不改清洗语义。键为 FIELDS 中的字段 key。
 * 例: adminUsers: MyAdminListEditor,
 */
const FIELD_OVERRIDES: Record<string, FieldRenderer> = {};

export default function StatusPage({ status }: StatusPageProps) {
    const [displayUptime, setDisplayUptime] = useState<string>('-');
    const [syncInfo, setSyncInfo] = useState<{
        baseUptime: number;
        syncTime: number;
    } | null>(null);
    const [config, setConfig] = useState<PluginConfig | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (status?.uptime !== undefined && status.uptime > 0) {
            setSyncInfo({
                baseUptime: status.uptime,
                syncTime: Date.now(),
            });
        }
    }, [status?.uptime]);

    useEffect(() => {
        if (!syncInfo) {
            setDisplayUptime('-');
            return;
        }
        const updateUptime = () => {
            const elapsed = Date.now() - syncInfo.syncTime;
            setDisplayUptime(
                formatUptime(syncInfo.baseUptime + elapsed),
            );
        };
        updateUptime();
        const interval = setInterval(updateUptime, 1000);
        return () => clearInterval(interval);
    }, [syncInfo]);

    const fetchConfig = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginConfig>('/config');
            if (res.code === 0 && res.data) setConfig(res.data);
        } catch {
            showToast('获取配置失败', 'error');
        }
    }, []);

    useEffect(() => {
        fetchConfig();
    }, [fetchConfig]);

    const saveConfig = useCallback(
        async (update: Partial<PluginConfig>) => {
            if (!config) return;
            setSaving(true);
            try {
                const newConfig = { ...config, ...update };
                await noAuthFetch('/config', {
                    method: 'POST',
                    body: JSON.stringify(newConfig),
                });
                setConfig(newConfig);
                showToast('配置已保存', 'success');
            } catch {
                showToast('保存失败', 'error');
            } finally {
                setSaving(false);
            }
        },
        [config],
    );

    const handleChange = useCallback(
        (key: keyof PluginConfig, value: unknown) => {
            if (!config) return;
            setConfig({ ...config, [key]: value });
            saveConfig({ [key]: value } as Partial<PluginConfig>);
        },
        [config, saveConfig],
    );

    if (!status) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">
                        正在获取插件状态...
                    </div>
                </div>
            </div>
        );
    }

    const { stats, weibo } = status;

    const pollingLabel = weibo.cookie.invalid
        ? '已暂停'
        : weibo.polling.backoffUntil
          ? '退避中'
          : weibo.polling.running
            ? '运行中'
            : '已停止';

    const statCards = [
        {
            label: '运行时长',
            value: displayUptime,
            icon: <IconClock size={18} />,
            color: 'text-primary',
            bg: 'bg-primary/10',
        },
        {
            label: '今日处理',
            value: String(stats.todayProcessed),
            icon: <IconActivity size={18} />,
            color: 'text-amber-500',
            bg: 'bg-amber-500/10',
        },
        {
            label: '累计处理',
            value: String(stats.processed),
            icon: <IconDownload size={18} />,
            color: 'text-violet-500',
            bg: 'bg-violet-500/10',
        },
        {
            label: '订阅博主',
            value: String(weibo.subscriptions),
            icon: <IconGroup size={18} />,
            color: 'text-sky-500',
            bg: 'bg-sky-500/10',
        },
        {
            label: '轮询状态',
            value: pollingLabel,
            icon: <IconRefresh size={18} />,
            color: 'text-emerald-500',
            bg: 'bg-emerald-500/10',
        },
        {
            label: '微博 Cookie',
            value: !weibo.cookie.configured
                ? '未配置'
                : weibo.cookie.invalid
                  ? '已失效'
                  : '可用',
            icon: <IconKey size={18} />,
            color: 'text-rose-500',
            bg: 'bg-rose-500/10',
        },
    ];

    return (
        <div className="space-y-6">
            {/* 统计卡片 */}
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 stagger-children">
                {statCards.map((card) => (
                    <div
                        key={card.label}
                        className="card p-4 hover-lift"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-gray-400 font-medium">
                                {card.label}
                            </span>
                            <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center ${card.bg} ${card.color} transition-transform duration-300 hover:scale-110`}
                            >
                                {card.icon}
                            </div>
                        </div>
                        <div className="text-xl font-bold text-gray-900 dark:text-white">
                            {card.value}
                        </div>
                    </div>
                ))}
            </div>

            {/* 微博运行状态 */}
            <div className="card p-5 animate-fade-in-up">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                    <h2 className="font-semibold text-sm">
                        微博运行状态
                    </h2>
                    <div className="text-xs text-gray-400">
                        上次轮询{' '}
                        {formatRelative(weibo.polling.lastPollAt)}
                        <span className="px-2">·</span>
                        下次 {formatTime(weibo.polling.nextPollAt)}
                        <span className="px-2">·</span>
                        间隔 {weibo.polling.intervalMinutes} 分钟
                    </div>
                </div>

                {weibo.polling.lastError && (
                    <div className="mb-3 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                        <IconAlert size={14} />
                        <span>{weibo.polling.lastError}</span>
                    </div>
                )}

                {weibo.targets.length === 0 ? (
                    <p className="py-6 text-center text-sm text-gray-400">
                        暂无订阅，可在已启用的群聊中发送
                        <span className="font-mono px-1">
                            #weibo add UID
                        </span>
                    </p>
                ) : (
                    <div className="overflow-x-auto -mx-5">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                                    <th className="py-2 px-5 font-medium">
                                        博主
                                    </th>
                                    <th className="py-2 px-5 font-medium">
                                        UID
                                    </th>
                                    <th className="py-2 px-5 font-medium">
                                        会话
                                    </th>
                                    <th className="py-2 px-5 font-medium">
                                        最后推送
                                    </th>
                                    <th className="py-2 px-5 font-medium">
                                        状态
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50 dark:divide-gray-800/50">
                                {weibo.targets.map((target) => (
                                    <tr key={target.uid}>
                                        <td className="py-2.5 px-5 font-medium">
                                            {target.screenName}
                                        </td>
                                        <td className="py-2.5 px-5 font-mono text-xs text-gray-500">
                                            {target.uid}
                                        </td>
                                        <td className="py-2.5 px-5 text-xs text-gray-500">
                                            {target.subscribers}
                                        </td>
                                        <td className="py-2.5 px-5 text-xs text-gray-500">
                                            {formatRelative(
                                                target.lastPushedAt,
                                            )}
                                        </td>
                                        <td className="py-2.5 px-5 text-xs">
                                            {target.lastError ? (
                                                <span
                                                    className="text-amber-600 dark:text-amber-400"
                                                    title={
                                                        target.lastError
                                                    }
                                                >
                                                    异常
                                                </span>
                                            ) : (
                                                <span className="text-emerald-600 dark:text-emerald-400">
                                                    正常
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* 配置分组 (由 FIELDS 的 section 切分为多张卡片) */}
            {config ? (
                <ConfigForm
                    config={config}
                    onChange={handleChange}
                    overrides={FIELD_OVERRIDES}
                />
            ) : (
                <div className="card p-5 hover-lift animate-fade-in-up">
                    <div className="flex items-center justify-center h-32 empty-state">
                        <div className="flex flex-col items-center gap-3">
                            <div className="loading-spinner text-primary" />
                            <div className="text-gray-400 text-sm">
                                加载配置中...
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {saving && (
                <div className="saving-indicator fixed bottom-4 right-4 bg-primary text-white text-xs px-3 py-2 rounded-lg shadow-lg flex items-center gap-2">
                    <div className="loading-spinner !w-3 !h-3 !border-[1.5px]" />
                    保存中...
                </div>
            )}
        </div>
    );
}
