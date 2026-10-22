/**
 * 由 pnpm run help:generate 生成, 禁止手改
 * cmd 权威源: scripts/generateHelp/cmds/weibo-help.ts
 */

import type { HelpVariant } from '../../utils/helpMessage';

/** 按帮助版本的文本帮助 (图片降级用), Admin 版同时用于私聊用户与群聊超管 */
export const HELP_TEXT_MAP: Record<HelpVariant, string> = {
    user: "【微博动态监听帮助】\n\n查询指令:\n#weibo list: 查看本会话订阅的博主\n#weibo latest [UID]: 获取博主最新一条微博; 不填 UID 时使用本会话唯一的订阅\n#weibo get <动态ID>: 按动态 ID 获取单条微博 (数字或短链)\n#weibo help: 显示本帮助\n",
    admin: "【微博动态监听帮助】\n\n查询指令:\n#weibo list: 查看本会话订阅的博主\n#weibo latest [UID]: 获取博主最新一条微博; 不填 UID 时使用本会话唯一的订阅\n#weibo get <动态ID>: 按动态 ID 获取单条微博 (数字或短链)\n#weibo help: 显示本帮助\n\n订阅管理 [管理员]:\n#weibo add <UID>: 订阅博主 (需数字 UID)\n#weibo remove <UID>: 取消订阅博主\n",
    superAdmin: "【微博动态监听帮助】\n\n查询指令:\n#weibo list: 查看本会话订阅的博主\n#weibo latest [UID]: 获取博主最新一条微博; 不填 UID 时使用本会话唯一的订阅\n#weibo get <动态ID>: 按动态 ID 获取单条微博 (数字或短链)\n#weibo help: 显示本帮助\n\n订阅管理 [管理员]:\n#weibo add <UID>: 订阅博主 (需数字 UID)\n#weibo remove <UID>: 取消订阅博主\n\n上限管理 [超管]:\n#weibo max: 查看本会话订阅上限\n#weibo max <N>: 设置本会话订阅上限 (0-50)\n\n会话开关 [超管]:\n#weibo enable: 开启本群微博推送 [仅群聊]\n#weibo disable: 关闭本群微博推送 (订阅保留) [仅群聊]\n",
};
