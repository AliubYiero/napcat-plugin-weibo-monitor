/**
 * 订阅页数据
 *
 * 一次性加载订阅列表与会话列表 (后者用于会话名映射), 写操作后重新拉取。
 * 头像后台补拉只自动重试一次, 不做轮询。
 */

import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import type {
    SessionInfo,
    SessionType,
    WeiboSubscription,
} from '../types';
import type { ApiResult } from '../utils/apiClient';
import {
    buildSessionNameMap,
    filterSubscriptions,
} from '../utils/subscriptionView';
import { webuiApi } from '../utils/webuiApi';
import { useResource } from './useResource';
import { showToast } from './useToast';

interface SubscriptionBundle {
    subscriptions: WeiboSubscription[];
    sessions: SessionInfo[];
    pendingAvatars: number;
}

const AVATAR_RETRY_MS = 3000;

export function useSubscriptions() {
    const load = useCallback(async (): Promise<
        ApiResult<SubscriptionBundle>
    > => {
        const [subscriptionsResult, sessionsResult] =
            await Promise.all([
                webuiApi.listSubscriptions(),
                webuiApi.listSessions(),
            ]);
        if (!subscriptionsResult.ok) return subscriptionsResult;
        if (!sessionsResult.ok) return sessionsResult;

        return {
            ok: true,
            code: 0,
            message: '',
            data: {
                subscriptions: subscriptionsResult.data.subscriptions,
                sessions: sessionsResult.data,
                pendingAvatars:
                    subscriptionsResult.data.pendingAvatars,
            },
        };
    }, []);

    const resource = useResource(load);
    const [keyword, setKeyword] = useState('');
    const retriedRef = useRef(false);

    const subscriptions = resource.data?.subscriptions ?? [];
    const sessions = resource.data?.sessions ?? [];

    useEffect(() => {
        if (!resource.error) return;
        showToast(resource.error, 'error');
    }, [resource.error]);

    useEffect(() => {
        const pending = resource.data?.pendingAvatars ?? 0;
        if (pending <= 0) {
            retriedRef.current = false;
            return;
        }
        if (retriedRef.current) return;

        const timer = setTimeout(() => {
            retriedRef.current = true;
            void resource.refresh();
        }, AVATAR_RETRY_MS);
        return () => clearTimeout(timer);
    }, [resource.data?.pendingAvatars, resource.refresh]);

    const refresh = useCallback(async () => {
        retriedRef.current = false;
        await resource.refresh();
    }, [resource.refresh]);

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
        async (
            uid: string,
            target: { type: SessionType; id: string },
        ) => {
            const result = await webuiApi.removeSubscription({
                uid,
                ...target,
            });
            if (!result.ok) throw new Error(result.message);
            await refresh();
        },
        [refresh],
    );

    return {
        subscriptions,
        sessions,
        sessionNames,
        filtered,
        keyword,
        setKeyword,
        loading: resource.loading && resource.data === null,
        refreshing: resource.loading && resource.data !== null,
        error: resource.error,
        refresh,
        remove,
    };
}
