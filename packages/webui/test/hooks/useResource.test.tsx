// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useResource } from '../../src/hooks/useResource';
import type { ApiResult } from '../../src/utils/apiClient';

afterEach(() => {
    vi.useRealTimers();
});

function ok<T>(data: T): ApiResult<T> {
    return { ok: true, code: 0, message: '', data };
}

function fail(message: string): ApiResult<never> {
    return { ok: false, code: -1, message };
}

describe('useResource', () => {
    it('初次取数后结束 loading', async () => {
        const load = vi.fn(async () => ok(1));
        const { result } = renderHook(() => useResource(load));

        expect(result.current.loading).toBe(true);
        await waitFor(() => {
            expect(result.current.data).toBe(1);
        });
        expect(result.current.loading).toBe(false);
        expect(result.current.error).toBeNull();
        expect(result.current.stale).toBe(false);
        expect(load).toHaveBeenCalledTimes(1);
    });

    it('初始失败时保留 error, 无数据不标记 stale', async () => {
        const load = vi.fn(async () => fail('读取失败'));
        const { result } = renderHook(() => useResource(load));

        await waitFor(() => {
            expect(result.current.error).toBe('读取失败');
        });
        expect(result.current.data).toBeNull();
        expect(result.current.loading).toBe(false);
        expect(result.current.stale).toBe(false);
    });

    it('refresh 成功替换数据并清除错误', async () => {
        const load = vi
            .fn<() => Promise<ApiResult<number>>>()
            .mockResolvedValueOnce(ok(1))
            .mockResolvedValueOnce(ok(2));
        const { result } = renderHook(() => useResource(load));

        await waitFor(() => {
            expect(result.current.data).toBe(1);
        });
        await act(async () => {
            await result.current.refresh();
        });

        expect(result.current.data).toBe(2);
        expect(result.current.error).toBeNull();
        expect(result.current.stale).toBe(false);
    });

    it('refresh 失败时保留上次数据并标记 stale', async () => {
        const load = vi
            .fn<() => Promise<ApiResult<number>>>()
            .mockResolvedValueOnce(ok(1))
            .mockResolvedValueOnce(fail('刷新失败'));
        const { result } = renderHook(() => useResource(load));

        await waitFor(() => {
            expect(result.current.data).toBe(1);
        });
        await act(async () => {
            await result.current.refresh();
        });

        expect(result.current.data).toBe(1);
        expect(result.current.error).toBe('刷新失败');
        expect(result.current.stale).toBe(true);
    });

    it('refreshMs 触发轮询', async () => {
        vi.useFakeTimers();
        const load = vi.fn(async () => ok(1));
        const { result } = renderHook(() =>
            useResource(load, { refreshMs: 1000 }),
        );

        await act(async () => {
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(load).toHaveBeenCalledTimes(1);
        await act(async () => {
            await vi.advanceTimersByTimeAsync(1000);
        });
        expect(load).toHaveBeenCalledTimes(2);
        expect(result.current.data).toBe(1);
        vi.useRealTimers();
    });
});
