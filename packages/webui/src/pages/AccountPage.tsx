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
    LoginProbeResult,
    WeiboBrowserStatus,
    WeiboCookieStatus,
    WeiboInstallState,
} from '../types';
import { noAuthFetch } from '../utils/api';
import { formatCookieMask } from '../utils/cookieMask';
import {
    formatRelative,
    formatSource,
    formatTime,
} from '../utils/format';
import { webuiApi } from '../utils/webuiApi';

const INSTALL_POLL_MS = 1000;

export default function AccountPage() {
    const [cookie, setCookie] = useState('');
    const [editing, setEditing] = useState(false);
    const [cookieStatus, setCookieStatus] =
        useState<WeiboCookieStatus | null>(null);
    const [browser, setBrowser] = useState<WeiboBrowserStatus | null>(
        null,
    );
    const [install, setInstall] = useState<WeiboInstallState | null>(
        null,
    );
    const [result, setResult] = useState<CookieActionResult | null>(
        null,
    );
    const [busy, setBusy] = useState(false);
    const [cookieBusy, setCookieBusy] = useState<
        'save' | 'validate' | 'keepalive' | null
    >(null);
    const [loading, setLoading] = useState(true);

    const fetchStatus = useCallback(async () => {
        const res = await webuiApi.getStatus();
        if (res.ok) {
            setCookieStatus(res.data.weibo.cookie);
            setBrowser(res.data.weibo.browser);
        } else {
            showToast(res.message, 'error');
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
        Promise.all([fetchStatus(), fetchInstall()])
            .then(() => setLoading(false))
            .catch(() => setLoading(false));
    }, [fetchStatus, fetchInstall]);

    useEffect(() => {
        if (!install?.running) return;
        const timer = setInterval(fetchInstall, INSTALL_POLL_MS);
        return () => clearInterval(timer);
    }, [install?.running, fetchInstall]);

    const configured = cookieStatus?.configured === true;
    const masked = configured && !editing;
    const maskText = formatCookieMask(cookieStatus?.names ?? []);

    const saveCookie = async () => {
        if (!cookie.trim()) {
            showToast('请先粘贴 Cookie', 'warning');
            return;
        }
        setBusy(true);
        setCookieBusy('save');
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
            if (data.valid) {
                setResult(data);
                setCookie('');
                setEditing(false);
                showToast('Cookie 已保存', 'success');
            } else {
                setResult({
                    valid: false,
                    message: `校验未通过，未保存：${data.message}`,
                });
                showToast(data.message, 'warning');
            }
            await fetchStatus();
        } catch (error) {
            showToast(
                error instanceof Error ? error.message : '保存失败',
                'error',
            );
        } finally {
            setBusy(false);
            setCookieBusy(null);
        }
    };

    const startReinput = () => {
        setCookie('');
        setResult(null);
        setEditing(true);
    };

    const cancelReinput = () => {
        setCookie('');
        setResult(null);
        setEditing(false);
    };

    const validateCookie = async () => {
        setBusy(true);
        setCookieBusy('validate');
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
            setCookieBusy(null);
        }
    };

    const keepAliveCookie = async () => {
        setBusy(true);
        setCookieBusy('keepalive');
        setResult(null);
        try {
            const res = await noAuthFetch<CookieActionResult>(
                '/weibo/cookie/keepalive',
                { method: 'POST' },
            );
            const data = res.data ?? {
                valid: false,
                message: '未知结果',
            };
            setResult(data);
            showToast(
                data.message,
                data.valid ? 'success' : 'warning',
            );
            await fetchStatus();
        } catch {
            showToast('保活失败', 'error');
        } finally {
            setBusy(false);
            setCookieBusy(null);
        }
    };

    const clearCookie = async () => {
        setBusy(true);
        try {
            await noAuthFetch('/weibo/cookie', { method: 'DELETE' });
            setCookie('');
            setEditing(false);
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
            {cookieStatus?.invalid && (
                <section className="card p-4 border border-red-500/30 bg-red-500/5 animate-fade-in-up">
                    <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center shrink-0">
                            <IconAlert size={16} />
                        </div>
                        <div className="min-w-0">
                            <h2 className="font-semibold text-sm text-red-600 dark:text-red-400">
                                Cookie 已失效，轮询已暂停
                            </h2>
                            <p className="text-xs text-gray-500 mt-1">
                                最后成功：
                                {formatTime(
                                    cookieStatus.lastSuccessAt ??
                                        null,
                                )}
                                {' · '}
                                已持续：
                                {formatDuration(
                                    cookieStatus.invalidSince,
                                )}
                                {cookieStatus.lastProbeMessage
                                    ? ` · ${cookieStatus.lastProbeMessage}`
                                    : ''}
                            </p>
                            <p className="text-xs text-gray-500 mt-1">
                                每日保活仍在尝试自动恢复；如持续失效，请重新粘贴
                                Cookie。
                            </p>
                        </div>
                    </div>
                </section>
            )}

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
                    <InfoCell
                        label="最后保活"
                        value={formatTime(
                            cookieStatus?.lastKeepAliveAt ?? null,
                        )}
                    />
                    <InfoCell
                        label="登录态探测"
                        value={formatProbe(
                            cookieStatus?.lastProbeResult ?? null,
                            cookieStatus?.lastProbeAt ?? null,
                        )}
                    />
                    <InfoCell
                        label="保活连续失败"
                        value={formatKeepAliveFailure(
                            cookieStatus?.keepAliveFailureCount ?? 0,
                            cookieStatus?.keepAliveInconclusiveCount ??
                                0,
                        )}
                    />
                </div>

                <textarea
                    className="input-field min-h-28 font-mono text-xs read-only:bg-gray-50 read-only:text-gray-500 read-only:cursor-default dark:read-only:bg-white/[0.03] dark:read-only:text-gray-400"
                    placeholder={
                        masked
                            ? ''
                            : '粘贴浏览器 Cookie，例如：SUB=...; SUBP=...;'
                    }
                    value={masked ? maskText : cookie}
                    readOnly={masked || busy}
                    onChange={(event) =>
                        setCookie(event.target.value)
                    }
                    aria-label={
                        masked
                            ? '已保存的 Cookie（只读掩码）'
                            : '微博 Cookie'
                    }
                />

                <div className="flex flex-wrap items-center gap-2 mt-3">
                    {masked ? (
                        <button
                            type="button"
                            className="btn btn-primary text-xs"
                            disabled={busy}
                            onClick={startReinput}
                        >
                            <IconKey size={13} />
                            重新输入
                        </button>
                    ) : (
                        <button
                            type="button"
                            className="btn btn-primary text-xs"
                            disabled={busy}
                            onClick={saveCookie}
                        >
                            {cookieBusy === 'save' ? (
                                <span className="loading-spinner" />
                            ) : (
                                <IconCheck size={13} />
                            )}
                            {cookieBusy === 'save'
                                ? '校验中...'
                                : '保存并校验'}
                        </button>
                    )}
                    {!editing && (
                        <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={busy || !configured}
                            onClick={validateCookie}
                        >
                            {cookieBusy === 'validate' ? (
                                <span className="loading-spinner" />
                            ) : (
                                <IconRefresh size={13} />
                            )}
                            {cookieBusy === 'validate'
                                ? '校验中...'
                                : '校验当前'}
                        </button>
                    )}
                    {!editing && (
                        <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={busy || !configured}
                            onClick={keepAliveCookie}
                        >
                            {cookieBusy === 'keepalive' ? (
                                <span className="loading-spinner" />
                            ) : (
                                <IconRefresh size={13} />
                            )}
                            {cookieBusy === 'keepalive'
                                ? '保活中...'
                                : '立即保活'}
                        </button>
                    )}
                    {editing && (
                        <button
                            type="button"
                            className="btn btn-ghost text-xs"
                            disabled={busy}
                            onClick={cancelReinput}
                        >
                            取消
                        </button>
                    )}
                    <button
                        type="button"
                        className="btn btn-danger text-xs"
                        disabled={busy || !configured}
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
        </div>
    );
}

function formatProbe(
    result: LoginProbeResult | null,
    at: number | null,
): string {
    if (result === null) return '尚未探测';
    const label =
        result === 'valid'
            ? '正常'
            : result === 'invalid'
              ? '失效'
              : '不确定';
    return at === null ? label : `${label} (${formatRelative(at)})`;
}

function formatKeepAliveFailure(
    failure: number,
    inconclusive: number,
): string {
    const parts: string[] = [];
    if (failure > 0) parts.push(`执行失败 ${failure}`);
    if (inconclusive > 0) parts.push(`不确定 ${inconclusive}`);
    return parts.length > 0 ? parts.join(' · ') : '无';
}

function formatDuration(since: number | null): string {
    if (since === null) return '未知';
    const elapsed = Math.max(0, Date.now() - since);
    const days = Math.floor(elapsed / 86_400_000);
    if (days >= 1) return `${days} 天`;
    const hours = Math.max(1, Math.floor(elapsed / 3_600_000));
    return `${hours} 小时`;
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
