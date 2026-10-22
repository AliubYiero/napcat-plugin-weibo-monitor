/**
 * 订阅页数据
 *
 * 一次性加载订阅列表与会话列表 (后者用于会话名映射), 写操作后重新拉取。
 * 头像后台补拉只自动重试一次, 不做轮询。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    SessionInfo,
    SessionType,
    WeiboSubscription,
    WeiboSubscriptionsResult,
} from '../types';
import { noAuthFetch } from '../utils/api';
import {
    buildSessionNameMap,
    filterSubscriptions,
} from '../utils/subscriptionView';
import { showToast } from './useToast';

export function useSubscriptions() {
    const [subscriptions, setSubscriptions] = useState<
        WeiboSubscription[]
    >([]);
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [keyword, setKeyword] = useState('');
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

    const fetchSessions = useCallback(async () => {
        const res = await noAuthFetch<SessionInfo[]>('/sessions');
        if (res.code === 0 && res.data) {
            setSessions(res.data);
        }
    }, []);

    const load = useCallback(async () => {
        const results = await Promise.allSettled([
            fetchSubscriptions(),
            fetchSessions(),
        ]);
        if (results.some((item) => item.status === 'rejected')) {
            throw new Error('部分数据加载失败');
        }
    }, [fetchSubscriptions, fetchSessions]);

    useEffect(() => {
        load()
            .catch(() => showToast('获取订阅数据失败', 'error'))
            .finally(() => setLoading(false));
        return () => {
            if (retryTimer.current !== null) {
                clearTimeout(retryTimer.current);
                retryTimer.current = null;
            }
        };
    }, [load]);

    const refresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await load();
        } catch {
            showToast('获取订阅数据失败', 'error');
        } finally {
            setRefreshing(false);
        }
    }, [load]);

    const sessionNames = useMemo(
        () => buildSessionNameMap(sessions),
        [sessions],
    );

    const filtered = useMemo(
        () =>
            filterSubscriptions(subscriptions, sessionNames, keyword),
        [subscriptions, sessionNames, keyword],
    );

    const remove = useCallback(
        async (uid: string, target: { type: SessionType; id: string }) => {
            await noAuthFetch('/weibo/subscriptions/remove', {
                method: 'POST',
                body: JSON.stringify({ uid, ...target }),
            });
            await load();
        },
        [load],
    );

    return {
        subscriptions,
        sessions,
        sessionNames,
        filtered,
        keyword,
        setKeyword,
        loading,
        refreshing,
        refresh,
        remove,
    };
}
