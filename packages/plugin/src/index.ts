/**
 * NapCat 插件模板 - 主入口
 *
 * 导出 PluginModule 接口定义的生命周期函数，NapCat 加载插件时会调用这些函数。
 *
 * 生命周期：
 *   plugin_init        → 插件加载时调用（必选）
 *   plugin_onmessage   → 收到事件时调用（需通过 post_type 判断事件类型）
 *   plugin_onevent     → 收到所有 OneBot 事件时调用
 *   plugin_cleanup     → 插件卸载/重载时调用
 *
 * 配置相关：
 *   plugin_config_ui          → 导出配置 Schema，用于 WebUI 自动生成配置面板
 *   plugin_get_config         → 自定义配置读取
 *   plugin_set_config         → 自定义配置保存
 *   plugin_on_config_change   → 配置变更回调
 *
 * @author Your Name
 * @license MIT
 */

import type {
    NapCatPluginContext,
    PluginConfigSchema,
    PluginModule,
} from 'napcat-types/napcat-onebot/network/plugin/types';

import { buildConfigSchema, getPluginDisplayName } from './config';
import { pluginState } from './core/state';
import { handleMessage } from './handlers/messageHandler';
import { EventType } from './onebotEvent';
import { registerApiRoutes } from './services/apiService';
import {
    ensureBrowserStatus,
    invalidateBrowserStatus,
} from './services/browser/status';
import { browserService } from './services/browser/service';
import { weiboPollingService } from './services/weibo/pollingService';
import type { PluginConfig } from './types';

// ==================== 配置 UI Schema ====================

/** NapCat WebUI 读取此导出来展示配置面板 */
export let plugin_config_ui: PluginConfigSchema = [];

// ==================== 生命周期函数 ====================

/**
 * 插件初始化（必选）
 * 加载配置、注册 WebUI 路由和页面
 */
export const plugin_init: PluginModule['plugin_init'] = async (
    ctx,
) => {
    try {
        // 1. 初始化全局状态（加载配置）
        pluginState.init(ctx);

        ctx.logger.info('插件初始化中...');

        // 2. 生成配置 Schema（用于 NapCat WebUI 配置面板）
        plugin_config_ui = buildConfigSchema(ctx);

        // 3. 注册 WebUI 页面和静态资源
        registerWebUI(ctx);

        // 4. 注册 API 路由
        registerApiRoutes(ctx);

        // 5. 浏览器状态缓存与微博轮询
        ensureBrowserStatus();
        weiboPollingService.start();

        ctx.logger.info('插件初始化完成');
    } catch (error) {
        ctx.logger.error('插件初始化失败:', error);
    }
};

/**
 * 消息/事件处理（可选）
 * 收到事件时调用，需通过 post_type 判断是否为消息事件
 */
export const plugin_onmessage: PluginModule['plugin_onmessage'] =
    async (ctx, event) => {
        // 仅处理消息事件
        // (插件级启停由 NapCat 宿主负责: 停用后宿主不再调用本函数)
        if (event.post_type !== EventType.MESSAGE) return;
        // 委托给消息处理器
        await handleMessage(ctx, event);
    };

/**
 * 事件处理（可选）
 * 处理所有 OneBot 事件（通知、请求等）
 */
export const plugin_onevent: PluginModule['plugin_onevent'] = async (
    _ctx,
    _event,
) => {
    // TODO: 在这里处理通知、请求等非消息事件
    // 示例：
    // if (event.post_type === EventType.NOTICE) { ... }
    // if (event.post_type === EventType.REQUEST) { ... }
};

/**
 * 插件卸载/重载（可选）
 * 必须清理定时器、关闭连接等资源
 */
export const plugin_cleanup: PluginModule['plugin_cleanup'] = async (
    ctx,
) => {
    try {
        // 先停轮询, 再强制关闭浏览器 (不等待上下文优雅收尾)
        weiboPollingService.stop();
        browserService.dispose();
        pluginState.cleanup();
        ctx.logger.info('插件已卸载');
    } catch (e) {
        ctx.logger.warn('插件卸载时出错:', e);
    }
};

// ==================== 配置管理钩子 ====================

/** 获取当前配置 */
export const plugin_get_config: PluginModule['plugin_get_config'] =
    async (_ctx) => {
        return pluginState.config;
    };

/** 设置配置（完整替换，由 NapCat WebUI 调用） */
export const plugin_set_config: PluginModule['plugin_set_config'] =
    async (ctx, config) => {
        pluginState.replaceConfig(config as PluginConfig);
        ctx.logger.info('配置已通过 WebUI 更新');
    };

/**
 * 配置变更回调
 * 当 WebUI 中修改单个配置项时触发（需配置项标记 reactive: true）
 */
export const plugin_on_config_change: PluginModule['plugin_on_config_change'] =
    async (ctx, _ui, key, value, _currentConfig) => {
        try {
            // 【必须】WebUI 单个配置项变更同为外部输入, 经 replaceConfig 统一清洗
            pluginState.replaceConfig({
                ...pluginState.config,
                [key]: value,
            } as PluginConfig);

            if (key === 'chromeExecutablePath') {
                invalidateBrowserStatus();
                ensureBrowserStatus();
            }
            if (key === 'weiboPollIntervalMinutes') {
                weiboPollingService.reschedule();
            }

            ctx.logger.debug(`配置项 ${key} 已更新`);
        } catch (err) {
            ctx.logger.error(`更新配置项 ${key} 失败:`, err);
        }
    };

// ==================== 内部函数 ====================

/**
 * 注册 WebUI 页面和静态资源
 */
function registerWebUI(ctx: NapCatPluginContext): void {
    const router = ctx.router;

    // 托管前端静态资源（构建产物在 webui/ 目录下）
    // 访问路径: /plugin/<plugin-id>/files/static/
    router.static('/static', 'webui');

    // 注册仪表盘页面（显示在 NapCat WebUI 侧边栏）
    // 访问路径: /plugin/<plugin-id>/page/dashboard
    // 标题取 package.json 的 plugin 显示名 (getPluginDisplayName)
    router.page({
        path: 'dashboard',
        title: getPluginDisplayName(ctx),
        htmlFile: 'webui/index.html',
        description: '插件管理控制台',
    });

    ctx.logger.debug('WebUI 路由注册完成');
}
