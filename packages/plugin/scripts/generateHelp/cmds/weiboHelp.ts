import type { Cmd } from '../cmd.ts';

/**
 * 微博监听帮助面板权威源
 *
 * 修改帮助内容只改本文件, 再执行 `pnpm run help:generate` 重新生成。
 * 指令前缀写死在文本里, 修改 shared 的 COMMAND_PREFIX 后需同步本文件。
 */
export const weiboHelp: Cmd = {
    id: 'weibo-help',
    title: '微博动态监听帮助',
    cmd: [
        {
            groupName: '查询指令',
            instructions: [
                { cmd: '#weibo list', desc: '查看本会话订阅的博主' },
                {
                    cmd: '#weibo latest [UID]',
                    desc: '获取博主最新一条微博; 不填 UID 时使用本会话唯一的订阅',
                },
                { cmd: '#weibo help', desc: '显示本帮助' },
            ],
        },
        {
            groupName: '订阅管理',
            isAdmin: true,
            instructions: [
                {
                    cmd: '#weibo add <UID>',
                    desc: '订阅博主 (需数字 UID)',
                },
                { cmd: '#weibo remove <UID>', desc: '取消订阅博主' },
            ],
        },
        {
            groupName: '上限管理',
            isSuperAdmin: true,
            instructions: [
                { cmd: '#weibo max', desc: '查看本会话订阅上限' },
                {
                    cmd: '#weibo max <N>',
                    desc: '设置本会话订阅上限 (0-50)',
                },
            ],
        },
        {
            groupName: '会话开关',
            isSuperAdmin: true,
            instructions: [
                {
                    cmd: '#weibo enable',
                    desc: '开启本群微博推送',
                    onlyGroup: true,
                },
                {
                    cmd: '#weibo disable',
                    desc: '关闭本群微博推送 (订阅保留)',
                    onlyGroup: true,
                },
            ],
        },
    ],
};
