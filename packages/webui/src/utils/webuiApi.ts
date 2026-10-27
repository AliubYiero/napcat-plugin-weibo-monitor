/** 生产适配器: 插件自带的 NoAuth 路由 */
import { noAuthFetch } from './api';
import { createApiClient } from './apiClient';

export const webuiApi = createApiClient(noAuthFetch);
