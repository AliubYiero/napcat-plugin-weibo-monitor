import { useCallback, useEffect, useState } from 'react';
import {
    IconAlert,
    IconCheck,
    IconDownload,
    IconKey,
    IconRefresh,
    IconX,
} from '../components/Icons';
import { showToast } from '../hooks/useToast';
import type {
    CookieActionResult,
    PluginStatus,
    WeiboBrowserStatus,
    WeiboCookieStatus,
    WeiboInstallState,
    WeiboSubscription,
} from '../types';
import { noAuthFetch } from '../utils/api';
import {
    formatRelative,
    formatSource,
    formatTime,
} from '../utils/format';

const INSTALL_POLL_MS = 1000;

export default function AccountPage() {
    const [cookie, setCookie] = useState('');
    const [cookieStatus, setCookieStatus] =
        useState<WeiboCookieStatus | null>(null);
    const [browser, setBrowser] = useState<WeiboBrowserStatus | null>(
        null,
    );
    const [install, setInstall] = useState<WeiboInstallState | null>(
        null,
    );
    const [subscriptions, setSubscriptions] = useState<
        WeiboSubscription[]
    >([]);
    const [result, setResult] = useState<CookieActionResult | null>(
        null,
    );
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);

    const fetchStatus = useCallback(async () => {
        try {
            const res = await noAuthFetch<PluginStatus>('/status');
            if (res.code === 0 && res.data) {
                setCookieStatus(res.data.weibo.cookie);
                setBrowser(res.data.weibo.browser);
            }
        } catch {
            showToast('获取微博状态失败', 'error');
        }
    }, []);

    const fetchSubscriptions = useCallback(async () => {
        try {
            const res = await noAuthFetch<WeiboSubscription[]>(
                '/weibo/subscriptions',
            );
            if (res.code === 0 && res.data) {
                setSubscriptions(res.data);
            }
        } catch {
            showToast('获取订阅列表失败', 'error');
        }
    }, []);

    const fetchInstall = useCallback(async () => {
        try {
            const res = await noAuthFetch<WeiboInstallState>(
                '/chrome/install/progress',
            );
            if (res.code === 0 && res.data) setInstall(res.data);
        } catch {
            /* 进度查询失败不打扰用户 */
        }
    }, []);

    useEffect(() => {
        Promise.all([
            fetchStatus(),
            fetchSubscriptions(),
            fetchInstall(),
        ])
            .then(() => setLoading(false))
            .catch(() => setLoading(false));
    }, [fetchStatus, fetchSubscriptions, fetchInstall]);

    useEffect(() => {
        if (!install?.running) return;
        const timer = setInterval(fetchInstall, INSTALL_POLL_MS);
        return () => clearInterval(timer);
    }, [install?.running, fetchInstall]);

    const saveCookie = async () => {
        if (!cookie.trim()) {
            showToast('请先粘贴 Cookie', 'warning');
            return;
        }
        setBusy(true);
        setResult(null);
        try {
            const res = await noAuthFetch<CookieActionResult>(
                '/weibo/cookie',
                {
                    method: 'POST',
                    body: JSON.stringify({ cookie }),
                },
            );
            const data = res.data ?? {
                valid: false,
                message: '未知结果',
            };
            setResult(data);
            if (data.valid) {
                setCookie('');
                showToast('Cookie 已保存', 'success');
            } else {
                showToast(data.message, 'warning');
            }
            await Promise.all([fetchStatus(), fetchSubscriptions()]);
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : '保存失败',
                'error',
            );
        } finally {
            setBusy(false);
        }
    };

    const validateCookie = async () => {
        setBusy(true);
        try {
            const res = await noAuthFetch<CookieActionResult>(
                '/weibo/cookie/validate',
                { method: 'POST' },
            );
            if (res.data) {
                setResult(res.data);
                showToast(
                    res.data.message,
                    res.data.valid ? 'success' : 'warning',
                );
            }
            await fetchStatus();
        } catch {
            showToast('校验失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const clearCookie = async () => {
        setBusy(true);
        try {
            await noAuthFetch('/weibo/cookie', { method: 'DELETE' });
            setResult(null);
            showToast('Cookie 已清除', 'success');
            await fetchStatus();
        } catch {
            showToast('清除失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const detectBrowser = async () => {
        setBusy(true);
        try {
            const res = await noAuthFetch<WeiboBrowserStatus>(
                '/chrome/detect',
                { method: 'POST' },
            );
            if (res.data) setBrowser(res.data);
        } catch {
            showToast('检测失败', 'error');
        } finally {
            setBusy(false);
        }
    };

    const installBrowser = async () => {
        setBusy(true);
        try {
            await noAuthFetch('/chrome/install', { method: 'POST' });
            showToast('已开始安装 Chrome', 'success');
            await fetchInstall();
        } catch (error) {
            showToast(
                error instanceof Error
                    ? error.message
                    : '安装启动失败',
                'error',
            );
        } finally {
            setBusy(false);
        }
    };

    const removeTarget = async (
        uid: string,
        target: { type: 'group' | 'private'; id: string },
    ) => {
        try {
            await noAuthFetch('/weibo/subscriptions/remove', {
                method: 'POST',
                body: JSON.stringify({ uid, ...target }),
            });
            showToast('已移除订阅', 'success');
            await fetchSubscriptions();
        } catch {
            showToast('移除失败', 'error');
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64 empty-state">
                <div className="flex flex-col items-center gap-3">
                    <div className="loading-spinner text-primary" />
                    <div className="text-gray-400 text-sm">
                        正在加载账号信息...
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <section className="card p-5 animate-fade-in-up">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                            <IconKey size={18} />
                        </div>
                        <div>
                            <h2 className="font-semibold text-sm">
                                微博 Cookie
                            </h2>
                            <p className="text-xs text-gray-400 mt-0.5">
                                仅保存在本地数据目录, 不会上传
                            </p>
                        </div>
                    </div>
                    <StatusBadge
                        ok={Boolean(
                            cookieStatus?.configured &&
                                !cookieStatus.invalid,
                        )}
                        text={
                            !cookieStatus?.configured
                                ? '未配置'
                                : cookieStatus.invalid
                                  ? '已失效'
                                  : '可用'
                        }
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 text-xs">
                    <InfoCell
                        label="最后成功"
                        value={formatTime(
                            cookieStatus?.lastSuccessAt ?? null,
                        )}
                    />
                    <InfoCell
                        label="最后校验"
                        value={formatTime(
                            cookieStatus?.lastValidatedAt ?? null,
                        )}
                    />
                    <InfoCell
                        label="最后刷新"
                        value={formatRelative(
                            cookieStatus?.lastRefreshAt ?? null,
                        )}
                    />
                </div>

                <textarea
                    className="input-field min-h-28 font-mono text-xs"
                    placeholder="粘贴浏览器 Cookie，例如：SUB=...; SUBP=...;"
                    value={cookie}
                    onChange={(event) =>
                        setCookie(event.target.value)
                    }
                />

                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                        type="button"
                        className="btn btn-primary text-xs"
                        disabled={busy}
                        onClick={saveCookie}
                    >
                        <IconCheck size={13} />
                        保存并校验
                    </button>
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={busy || !cookieStatus?.configured}
                        onClick={validateCookie}
                    >
                        <IconRefresh size={13} />
                        校验当前
                    </button>
                    <button
                        type="button"
                        className="btn btn-danger text-xs"
                        disabled={busy || !cookieStatus?.configured}
                        onClick={clearCookie}
                    >
                        <IconX size={13} />
                        清除
                    </button>
                </div>

                {result && (
                    <div
                        className={`mt-3 flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${
                            result.valid
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                        }`}
                    >
                        <IconAlert size={14} />
                        <span>{result.message}</span>
                    </div>
                )}
            </section>

            <section className="card p-5 animate-fade-in-up">
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                        <h2 className="font-semibold text-sm">
                            浏览器
                        </h2>
                        <p className="text-xs text-gray-400 mt-0.5">
                            优先使用共享安装目录, 也支持系统 Chrome /
                            Edge
                        </p>
                    </div>
                    <StatusBadge
                        ok={Boolean(browser?.available)}
                        text={browser?.available ? '可用' : '不可用'}
                    />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <InfoCell
                        label="来源"
                        value={formatSource(
                            browser?.source ?? 'none',
                        )}
                    />
                    <InfoCell
                        label="版本"
                        value={browser?.version || '未验证'}
                    />
                    <InfoCell
                        label="可执行文件"
                        value={browser?.executablePath || '未找到'}
                        mono
                    />
                    <InfoCell
                        label="共享安装"
                        value={
                            browser?.installed ? '已安装' : '未安装'
                        }
                    />
                </div>

                {browser?.error && (
                    <div className="mt-3 flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                        <IconAlert size={14} />
                        <span>{browser.error}</span>
                    </div>
                )}

                {install?.running && (
                    <div className="mt-4">
                        <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                            <span>
                                {install.message || '安装中...'}
                            </span>
                            <span>
                                {Math.round(
                                    (install.percent || 0) * 100,
                                )}
                                %
                            </span>
                        </div>
                        <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{
                                    width: `${Math.max(
                                        2,
                                        Math.round(
                                            (install.percent || 0) *
                                                100,
                                        ),
                                    )}%`,
                                }}
                            />
                        </div>
                    </div>
                )}

                {install?.error && (
                    <div className="mt-3 text-xs text-red-500 whitespace-pre-wrap">
                        {install.error}
                    </div>
                )}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                    <button
                        type="button"
                        className="btn btn-ghost text-xs"
                        disabled={busy}
                        onClick={detectBrowser}
                    >
                        <IconRefresh size={13} />
                        完整检测
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary text-xs"
                        disabled={busy || install?.running}
                        onClick={installBrowser}
                    >
                        <IconDownload size={13} />
                        安装 Chrome
                    </button>
                </div>
            </section>

            <section className="card overflow-hidden animate-fade-in-up">
                <div className="p-5 pb-3">
                    <h2 className="font-semibold text-sm">
                        订阅列表
                    </h2>
                    <p className="text-xs text-gray-400 mt-0.5">
                        共 {subscriptions.length}{' '}
                        个博主；移除只影响对应会话
                    </p>
                </div>

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
                                            src={item.avatar}
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
                                                    <button
                                                        type="button"
                                                        className="text-gray-400 hover:text-red-500"
                                                        aria-label="移除订阅"
                                                        onClick={() =>
                                                            removeTarget(
                                                                item.uid,
                                                                target,
                                                            )
                                                        }
                                                    >
                                                        <IconX
                                                            size={11}
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

function StatusBadge({ ok, text }: { ok: boolean; text: string }) {
    return (
        <span
            className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                ok
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500'
            }`}
        >
            <span
                className={`w-1.5 h-1.5 rounded-full ${
                    ok ? 'bg-emerald-500' : 'bg-gray-400'
                }`}
            />
            {text}
        </span>
    );
}

function InfoCell({
    label,
    value,
    mono,
}: {
    label: string;
    value: string;
    mono?: boolean;
}) {
    return (
        <div className="rounded-lg bg-gray-50 dark:bg-white/[0.03] px-3 py-2">
            <div className="text-[11px] text-gray-400 mb-0.5">
                {label}
            </div>
            <div
                className={`text-gray-700 dark:text-gray-300 truncate ${
                    mono ? 'font-mono text-[11px]' : ''
                }`}
                title={value}
            >
                {value}
            </div>
        </div>
    );
}

function Avatar({ src, name }: { src: string; name: string }) {
    if (src) {
        return (
            <img
                src={src}
                alt={name}
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
