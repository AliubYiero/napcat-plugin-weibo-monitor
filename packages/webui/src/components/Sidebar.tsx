import type { ComponentType } from 'react';
import { PAGE_LIST, type PageIconName, type PageId } from 'shared';
import {
    IconDashboard,
    IconGithub,
    IconGroup,
    IconHelp,
    IconKey,
    IconPlugin,
    IconSettings,
} from './Icons';

interface SidebarProps {
    currentPage: PageId;
    onPageChange: (page: PageId) => void;
}

/** 图标注册表: PageMeta.icon → 图标组件 */
const PAGE_ICONS: Record<
    PageIconName,
    ComponentType<{ size?: number; className?: string }>
> = {
    dashboard: IconDashboard,
    settings: IconSettings,
    group: IconGroup,
    help: IconHelp,
    account: IconKey,
};

const menuItems = [...PAGE_LIST]
    .filter((page) => !page.hidden)
    .sort((a, b) => a.order - b.order);

export default function Sidebar({
    currentPage,
    onPageChange,
}: SidebarProps) {
    return (
        <aside className="w-60 flex-shrink-0 bg-white dark:bg-[#1a1b1d] border-r border-gray-200 dark:border-gray-800 flex flex-col">
            {/* Logo */}
            <div className="px-5 py-6 flex items-center gap-3">
                <div className="sidebar-logo w-8 h-8 flex items-center justify-center bg-brand-500 rounded-lg text-white">
                    <IconPlugin size={18} />
                </div>
                <div>
                    <h1 className="font-bold text-sm leading-tight text-gray-900 dark:text-white">
                        {__PLUGIN_DISPLAY_NAME__}
                    </h1>
                    <p className="text-[10px] text-gray-400 font-medium tracking-wider">
                        {__PLUGIN_ID__
                            .split(/[-_]/g)
                            .join(' ')
                            .toLocaleUpperCase()
                            .replace(/NAPCAT PLUGIN\s?/i, '')}
                    </p>
                </div>
            </div>

            {/* Nav */}
            <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto nav-stagger">
                {menuItems.map((item) => {
                    const Icon = PAGE_ICONS[item.icon];
                    return (
                        <button
                            type="button"
                            key={item.id}
                            className={`sidebar-item ${currentPage === item.id ? 'active' : ''}`}
                            onClick={() => onPageChange(item.id)}
                        >
                            <span className="sidebar-icon">
                                <Icon size={18} />
                            </span>
                            <span>{item.title}</span>
                        </button>
                    );
                })}
            </nav>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800">
                <a
                    href={__PLUGIN_GITHUB_URL__}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-full py-2 rounded-lg text-gray-500 bg-gray-50 dark:bg-gray-800/50 text-xs"
                >
                    <IconGithub size={16} />
                    <span className="pl-3">
                        {__PLUGIN_DISPLAY_NAME__} v
                        {__PLUGIN_VERSION__}
                    </span>
                </a>
            </div>
        </aside>
    );
}
