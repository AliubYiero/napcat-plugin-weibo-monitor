/**
 * WebUI 骨架元信息「单一声明源」
 *
 * 页面清单 (PAGES) 同时驱动:
 *   - webui 侧边栏菜单与排序
 *   - 页头标题 / 描述
 *   - 默认页
 *
 * 【必须】新增页面时只改本文件: 在 PAGES 加一项, 并在 webui 的
 * `PageId -> 组件` 注册表补上对应组件 (组件无法放进 shared)。
 */

/** 侧栏图标名, 由 webui 的图标注册表解析为具体图标组件 */
export type PageIconName =
    | 'dashboard'
    | 'settings'
    | 'group'
    | 'help'
    | 'account'
    | 'subscription';

export interface PageMeta {
    /** 页面唯一标识, 同时是 webui 的 PageId */
    id: string;
    /** 页头标题, 也是侧栏菜单文案 */
    title: string;
    /** 页头描述 */
    description: string;
    /** 侧栏图标 */
    icon: PageIconName;
    /** 侧栏排序权重, 升序 */
    order: number;
    /** 为 true 时不在侧栏显示 (仍可被默认页指向) */
    hidden?: boolean;
}

/** 页面清单 (唯一权威) */
export const PAGES = [
    {
        id: 'status',
        title: '仪表盘',
        description: '插件运行状态与数据概览',
        icon: 'dashboard',
        order: 10,
    },
    {
        id: 'account',
        title: '账号',
        description: '微博 Cookie 与浏览器',
        icon: 'account',
        order: 20,
    },
    {
        id: 'subscriptions',
        title: '订阅',
        description: '查看博主订阅关系与推送目标',
        icon: 'subscription',
        order: 25,
    },
    {
        id: 'sessions',
        title: '会话管理',
        description: '管理群聊与好友的启用与禁用',
        icon: 'group',
        order: 30,
    },
    {
        id: 'help',
        title: '帮助文档',
        description: '查看插件支持的全部指令与使用说明',
        icon: 'help',
        order: 40,
    },
] as const satisfies readonly PageMeta[];

/** 页面标识, 从 PAGES 派生 */
export type PageId = (typeof PAGES)[number]['id'];

/**
 * 遍历用视图: 保留 PageId 字面量类型, 同时补上 PageMeta 的可选属性
 * (as const 字面量类型不含未显式声明的可选属性, 直接遍历会丢 hidden)。
 */
export const PAGE_LIST: readonly (PageMeta & { id: PageId })[] =
    PAGES;

/** 默认页 */
export const DEFAULT_PAGE: PageId = 'status';
