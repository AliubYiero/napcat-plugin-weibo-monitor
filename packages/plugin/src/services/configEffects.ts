/**
 * 配置变更副作用
 *
 * 两个配置入口 (NapCat 原生面板 `plugin_set_config` 与自建 WebUI
 * `POST /config`) 都必须在清洗落盘后调用本模块, 否则「界面显示值」会落后于
 * 「实际运行状态」。差异化逻辑保持为纯函数, 便于单测。
 */

import type { PluginConfig } from '../types';
import { browserService } from './browser/service';
import {
    ensureBrowserStatus,
    invalidateBrowserStatus,
} from './browser/status';
import { weiboPollingService } from './weibo/pollingService';

export interface ConfigEffects {
    /** 浏览器路径变化: 关闭旧进程并按新路径重测 */
    restartBrowser: boolean;
    /** 轮询间隔变化: 按新周期重新排期 */
    reschedulePolling: boolean;
}

export function resolveConfigEffects(
    prev: PluginConfig,
    next: PluginConfig,
): ConfigEffects {
    return {
        restartBrowser:
            prev.chromeExecutablePath !== next.chromeExecutablePath,
        reschedulePolling:
            prev.weiboPollIntervalMinutes !==
            next.weiboPollIntervalMinutes,
    };
}

export async function applyConfigSideEffects(
    prev: PluginConfig,
    next: PluginConfig,
): Promise<void> {
    const effects = resolveConfigEffects(prev, next);
    if (!effects.restartBrowser && !effects.reschedulePolling) return;

    if (effects.restartBrowser) {
        await browserService.close();
        invalidateBrowserStatus();
        ensureBrowserStatus();
    }
    if (effects.reschedulePolling) {
        weiboPollingService.reschedule();
    }
}
