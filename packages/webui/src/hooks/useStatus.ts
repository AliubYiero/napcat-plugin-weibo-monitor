import { useCallback } from 'react';
import { webuiApi } from '../utils/webuiApi';
import { useResource } from './useResource';

const STATUS_REFRESH_MS = 5000;

export function useStatus() {
    const resource = useResource(
        useCallback(() => webuiApi.getStatus(), []),
        { refreshMs: STATUS_REFRESH_MS },
    );

    return {
        status: resource.data,
        fetchStatus: resource.refresh,
        loading: resource.loading,
        error: resource.error,
    };
}
