/**
 * 资源取数
 *
 * 统一 loading / error / stale / refresh, 并可选按固定间隔轮询。
 * `load` 必须是稳定引用 (useCallback); 变化只替换下次 refresh 的取数函数,
 * 不会自动重取, 需要新参数的调用方自行触发 refresh。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult } from '../utils/apiClient';
import { readApiErrorMessage } from '../utils/apiError';

export interface UseResourceOptions<T> {
    initialData?: T | null;
    /** 大于 0 时按此间隔轮询 */
    refreshMs?: number;
}

export interface Resource<T> {
    data: T | null;
    loading: boolean;
    error: string | null;
    /** 取数失败但仍有上次成功数据 */
    stale: boolean;
    refresh: () => Promise<void>;
}

export function useResource<T>(
    load: () => Promise<ApiResult<T>>,
    options: UseResourceOptions<T> = {},
): Resource<T> {
    const { initialData = null, refreshMs } = options;
    const [data, setData] = useState<T | null>(initialData);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [stale, setStale] = useState(false);
    const loadRef = useRef(load);
    const dataRef = useRef<T | null>(initialData);
    const mountedRef = useRef(false);
    const requestIdRef = useRef(0);

    useEffect(() => {
        loadRef.current = load;
    }, [load]);

    const refresh = useCallback(async () => {
        const requestId = ++requestIdRef.current;
        setLoading(true);

        let result: ApiResult<T>;
        try {
            result = await loadRef.current();
        } catch (err) {
            result = {
                ok: false,
                code: -1,
                message: readApiErrorMessage(err),
            };
        }

        if (
            !mountedRef.current ||
            requestId !== requestIdRef.current
        ) {
            return;
        }

        if (result.ok) {
            dataRef.current = result.data;
            setData(result.data);
            setError(null);
            setStale(false);
        } else {
            setError(result.message);
            setStale(dataRef.current !== null);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        mountedRef.current = true;
        void refresh();
        return () => {
            mountedRef.current = false;
            requestIdRef.current += 1;
        };
    }, [refresh]);

    useEffect(() => {
        if (refreshMs === undefined || refreshMs <= 0) return;
        const timer = setInterval(() => {
            void refresh();
        }, refreshMs);
        return () => clearInterval(timer);
    }, [refreshMs, refresh]);

    return { data, loading, error, stale, refresh };
}
