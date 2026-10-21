/**
 * 由 pnpm run help:generate 生成, 禁止手改
 * cmd 权威源: scripts/generateHelp/cmds/
 * 供 WebUI 帮助文档页消费 (GET /help)
 */

import type { Cmd } from 'shared';

/** 全部帮助面板 (内容为各 cmds 权威源原样, 未经权限过滤) */
export const HELP_PANELS: Cmd[] = [
    {
        "id": "weibo-help",
        "title": "微博动态监听帮助",
        "cmd": [
            {
                "groupName": "查询指令",
                "instructions": [
                    {
                        "cmd": "#weibo list",
                        "desc": "查看本会话订阅的博主"
                    },
                    {
                        "cmd": "#weibo latest [UID]",
                        "desc": "获取博主最新一条微博; 不填 UID 时使用本会话唯一的订阅"
                    },
                    {
                        "cmd": "#weibo help",
                        "desc": "显示本帮助"
                    }
                ]
            },
            {
                "groupName": "订阅管理",
                "isAdmin": true,
                "instructions": [
                    {
                        "cmd": "#weibo add <UID>",
                        "desc": "订阅博主 (需数字 UID)"
                    },
                    {
                        "cmd": "#weibo remove <UID>",
                        "desc": "取消订阅博主"
                    }
                ]
            },
            {
                "groupName": "上限管理",
                "isSuperAdmin": true,
                "instructions": [
                    {
                        "cmd": "#weibo max",
                        "desc": "查看本会话订阅上限"
                    },
                    {
                        "cmd": "#weibo max <N>",
                        "desc": "设置本群订阅上限 (0-50)",
                        "onlyGroup": true
                    }
                ]
            }
        ]
    }
];
