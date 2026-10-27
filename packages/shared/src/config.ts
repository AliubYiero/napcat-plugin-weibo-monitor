/**
 * 插件配置「单一声明源」
 *
 * 这里是配置的唯一权威定义: 一份字段描述符 (FIELDS) 同时驱动
 *   - 类型     `PluginConfig`
 *   - 默认值   `getDefaultConfig()`
 *   - 清洗     `sanitizeConfig()` (含逗号列表 codec)
 *   - 后端面板 plugin 的 `buildConfigSchema` 把 FIELDS 映射到 `ctx.NapCatConfig`
 *   - 前端表单 webui 的 `ConfigForm` 按 kind 渲染对应控件
 *
 * 【必须】新增/修改配置项时只改本文件: 在 `PluginConfig` 加字段, 在 `FIELDS` 加同 key 描述符。
 * 二者用 `satisfies` 绑定键集, 不一致时编辑器报错 (键集一致性另有单测兜底)。
 *
 * 会话级配置 (群/好友) 不属于本文件, 由 store 承载 (见 docs/store-pattern.md)。
 */

import {
    EXTENSION_URL_TOKEN,
    PLUGIN_DESCRIPTION_TOKEN,
    PLUGIN_DISPLAY_NAME_TOKEN,
} from './displayTokens';

// ==================== 字段描述符类型 ====================

/** select / multiSelect 的候选项 */
export interface ConfigOption {
    label: string;
    value: string | number;
}

/**
 * 有值字段的 kind: 每类对应一条清洗规则、一个后端控件、一个前端控件。
 *
 * | kind          | 清洗                       | 后端控件        | 前端控件     |
 * | ------------- | -------------------------- | --------------- | ------------ |
 * | boolean       | typeof 守卫, 回退默认      | 开关            | 开关         |
 * | text          | typeof 守卫, 回退默认      | 文本框          | 文本框       |
 * | password      | 同 text (typeof 守卫)      | 跳转引导 (见下) | 密码框       |
 * | number        | typeof + 区间, 回退默认    | 数字框          | 数字框       |
 * | select        | 必须命中 options, 否则默认 | 下拉单选        | 下拉单选     |
 * | multiSelect   | 过滤非法值, 空数组合法     | 下拉多选        | 下拉多选·胶囊 |
 * | stringList    | 逗号串/数组 → 去空项数组   | 逗号文本框      | 标签输入     |
 *
 * 【例外】`password` 原生面板无密码控件, 故其 `scope` 收窄为 `webui` / `both`:
 *   - `webui`: 仅在自建前端渲染密码框, 原生面板隐藏;
 *   - `both` (缺省): 自建前端渲染密码框, 原生面板渲染"前往拓展页面修改"的引导块
 *     (由 buildPasswordPanelHint 生成, 见 displayTokens), 不在面板落值。
 * 【警告】密钥明文落盘 (config.json) 并明文往返自建前端, 仅适用于对安全性要求不高的场景。
 */
export type ValueFieldKind =
    | 'boolean'
    | 'text'
    | 'password'
    | 'number'
    | 'select'
    | 'multiSelect'
    | 'stringList';

/** 全部 kind (含仅布局/展示、不落盘的字段) */
export type ConfigFieldKind = ValueFieldKind | 'section' | 'display';

/**
 * 字段可见范围:
 *   - `webui`  仅自建前端 (webui 的 ConfigForm) 显示
 *   - `panel`  仅 NapCat 原生自动面板 (buildConfigSchema) 显示
 *   - `both`   两处都显示 (默认)
 *
 * 【必须】scope 只影响呈现: 带 key 的字段即便在某侧隐藏, 仍清洗、仍落盘。
 */
export type FieldScope = 'webui' | 'panel' | 'both';

interface FieldBase {
    /** 展示标签 */
    label: string;
    /** 说明文字 */
    description?: string;
    /** 可见范围, 缺省为 both */
    scope?: FieldScope;
}

export interface BooleanFieldDescriptor extends FieldBase {
    kind: 'boolean';
    default: boolean;
}

export interface TextFieldDescriptor extends FieldBase {
    kind: 'text';
    default: string;
    placeholder?: string;
}

/**
 * 密码字段 (scope 只接受 webui / both)
 *
 * 语义与 `text` 一致 (清洗/落盘/默认值形态相同), 差别在前端渲染为密码框。
 * 【例外】原生面板无密码控件, 故 scope 收窄为 `webui` / `both`:
 *   - `webui`: 仅自建前端显示密码框;
 *   - `both` (缺省): 自建前端显示密码框, 原生面板显示"前往拓展页面修改"的引导块。
 * 【警告】不脱敏: 密钥明文落盘并明文往返自建前端, 仅适用于安全性要求不高的场景。
 */
export interface PasswordFieldDescriptor extends FieldBase {
    kind: 'password';
    /** 【例外】password 不支持 `panel`; 缺省为 both */
    scope?: 'webui' | 'both';
    default: string;
    placeholder?: string;
}

export interface NumberFieldDescriptor extends FieldBase {
    kind: 'number';
    default: number;
    min?: number;
    max?: number;
    step?: number;
    placeholder?: string;
}

export interface SelectFieldDescriptor extends FieldBase {
    kind: 'select';
    default: string | number;
    options: readonly ConfigOption[];
}

export interface MultiSelectFieldDescriptor extends FieldBase {
    kind: 'multiSelect';
    default: readonly (string | number)[];
    options: readonly ConfigOption[];
}

export interface StringListFieldDescriptor extends FieldBase {
    kind: 'stringList';
    default: readonly string[];
    placeholder?: string;
}

export type ValueFieldDescriptor =
    | BooleanFieldDescriptor
    | TextFieldDescriptor
    | PasswordFieldDescriptor
    | NumberFieldDescriptor
    | SelectFieldDescriptor
    | MultiSelectFieldDescriptor
    | StringListFieldDescriptor;

/**
 * 仅布局/展示, 不落盘, 无 key
 *
 * 【必须】section 是扁平 FIELDS 中的分隔行: WebUI 以它作为分卡边界
 * (其后的字段归入同名片, 直到下一个 section); 原生面板渲染为分组标题。
 * 被 `scope` 过滤时既不可见也不作为分组边界。
 */
export interface SectionFieldDescriptor extends FieldBase {
    kind: 'section';
}

export interface DisplayFieldDescriptor {
    kind: 'display';
    /** 展示用 HTML 片段 (可含 {{...}} 占位符, 见 displayTokens) */
    content: string;
    /** 可见范围, 缺省为 both */
    scope?: FieldScope;
}

/** 带 key 的有值字段 (key 必须是 PluginConfig 的键) */
export type ConfigValueField = ValueFieldDescriptor & {
    key: keyof PluginConfig;
};

/** 布局/展示字段 */
export type ConfigLayoutField =
    | SectionFieldDescriptor
    | DisplayFieldDescriptor;

/** 描述符统一类型 */
export type ConfigField = ConfigValueField | ConfigLayoutField;

// ==================== 配置接口 ====================

/**
 * 触发命令前缀 (插件内部单一来源)
 *
 * 【必须】前缀不再暴露给用户修改, 只作为插件内部常量使用;
 * 后端解析、帮助生成等所有需要前缀处一律引用本常量。
 */
export const COMMAND_PREFIX = '#weibo';

/**
 * 插件主配置接口
 *
 * 字段集必须与 `FIELDS` 完全一致 (由 satisfies 与单测双重保证)。
 *
 * 【必须】插件级全局启用/停用由 NapCat 宿主负责 (setPluginStatus),
 * 不在插件内自建 `enabled` 开关。
 */
export interface PluginConfig {
    /**
     * 超级管理员 QQ 号名单（四档角色中唯一需要人工配置的档位）。
     * WebUI 中以英文逗号分隔输入，清洗后始终是数组。
     */
    adminUsers: string[];
    /**
     * 指令触发方式（多选，仅自建前端可配）：`prefix` 识别以 COMMAND_PREFIX
     * 开头的消息，`atBot` 识别 `@机器人 + 前缀指令`。两者相互独立；
     * 空数组表示任何消息都不触发。
     */
    triggerModes: TriggerMode[];

    /**
     * 微博轮询间隔 (分钟)。最小 1, 最大 1440; 运行期四舍五入为整数。
     * 可整除 60 的间隔按本地整分 / 整点对齐, 其余为固定间隔。
     * 插件启动与订阅成功后各立即拉取一轮, 即时拉取不改变对齐网格。
     */
    weiboPollIntervalMinutes: number;

    /**
     * 推送呈现方式: `image` 为整卡图片, `text` 为文本模板。
     * 只决定呈现形态, 不决定是否推送。
     */
    weiboPushRenderMode: PushRenderMode;

    /**
     * 推送内容类型 (多选): 转发 / 点赞 / 广告 / 生日。
     * 原创动态始终推送; 广告是独立否决项, 关闭后所有广告 (含转发内广告)
     * 都会被过滤。空数组表示只推送原创动态。
     */
    weiboPushContentTypes: WeiboContentType[];

    /**
     * Chrome / Edge 可执行文件路径。留空时自动探测共享安装目录与系统浏览器。
     * 只在用户显式指定时填写——手填路径会被优先采用。
     */
    chromeExecutablePath: string;
}

// ==================== 字段声明 ====================

/**
 * 指令触发方式
 *
 * `prefix`: 消息以 COMMAND_PREFIX 开头 (指令 参数);
 * `atBot`:  消息以 `@机器人` 开头, 剥离后仍带前缀 (@机器人 指令 参数)。
 * 两者相互独立, 可选择其一、两者或都不选 (都不选即任何消息都不触发)。
 */
export type TriggerMode = 'prefix' | 'atBot';

/** 指令触发方式候选项 (与 TriggerMode 同源) */
export const TRIGGER_MODE_OPTIONS: readonly ConfigOption[] = [
    { label: '指令 参数', value: 'prefix' },
    { label: '@机器人 指令 参数', value: 'atBot' },
];

/**
 * 推送呈现方式
 *
 * `image`: 整卡图片 (默认); `text`: 标题行 + 链接 + 正文模板。
 */
export type PushRenderMode = 'image' | 'text';

/** 推送呈现方式候选项 (与 PushRenderMode 同源) */
export const PUSH_RENDER_MODE_OPTIONS: readonly ConfigOption[] = [
    { label: '图片推送', value: 'image' },
    { label: '文本推送', value: 'text' },
];

/**
 * 推送内容类型
 *
 * `repost`: 本人转发; `like`: 本人点赞 (含点赞插入条目);
 * `ad`: 广告内容 (独立否决项); `birthday`: 生日动态。
 * 原创动态不受本开关控制, 始终推送。
 */
export type WeiboContentType = 'repost' | 'like' | 'ad' | 'birthday';

/** 推送内容类型候选项 (与 WeiboContentType 同源) */
export const WEIBO_CONTENT_TYPE_OPTIONS: readonly ConfigOption[] = [
    { label: '转发动态', value: 'repost' },
    { label: '点赞动态', value: 'like' },
    { label: '广告动态', value: 'ad' },
    { label: '生日动态', value: 'birthday' },
];

/**
 * 配置字段声明 (唯一权威)
 *
 * 【必须】每项必须声明一个可渲染的 base kind (后端面板据此渲染);
 * 自定义前端交互用 webui 的覆盖注册表实现, 不改变这里的 kind。
 * `key` 会被校验为 PluginConfig 的键; 布局字段 (section/display) 不带 key。
 * 可选 `scope` 控制可见范围 (webui/panel/both, 默认 both), 仅影响呈现。
 * display 的 `content` 可含 {{...}} 占位符, 见 displayTokens.ts。
 */
export const FIELDS = [
    {
        kind: 'display',
        scope: 'panel',
        content: `<div class="prose dark:prose-invert max-w-none">
  <div style="padding: 16px; background: linear-gradient(135deg, #fff7fa 0%, #ffeaf2 100%); border: 1px solid rgba(251,114,153,0.22); border-radius: 12px; margin-bottom: 12px; color: #5c2a3d;">
    <h3 style="margin: 0 0 6px 0; font-size: 18px; font-weight: 600; color: #b23a63;">${PLUGIN_DISPLAY_NAME_TOKEN}</h3>
    <p style="margin: 0; font-size: 13px; color: #8a5a6c; opacity: 1;">${PLUGIN_DESCRIPTION_TOKEN}</p>
    <div style="display: flex; justify-content: flex-end; margin-top: 12px;">
      <a href="${EXTENSION_URL_TOKEN}" target="_blank" rel="noopener noreferrer" style="display: inline-block; padding: 6px 14px; background: #fb7299; color: #ffffff; border-radius: 8px; font-size: 13px; font-weight: 600; text-decoration: none; line-height: 20px; white-space: nowrap; box-shadow: 0 4px 10px rgba(251,114,153,0.22);" onmouseover="this.style.background='#e85f88'; this.style.transform='translateY(-1px)'; this.style.boxShadow='0 6px 14px rgba(251,114,153,0.28)';" onmouseout="this.style.background='#fb7299'; this.style.transform='none'; this.style.boxShadow='0 4px 10px rgba(251,114,153,0.22)';">跳转至拓展页面</a>
    </div>
  </div>
</div>`,
    },
    {
        kind: 'section',
        label: '基础配置',
    },
    {
        key: 'adminUsers',
        kind: 'stringList',
        label: '超级管理员 QQ',
        description: '多个 QQ 号使用标签输入；超管不受会话类型限制',
        default: [],
        placeholder: '输入 QQ 号后按回车添加',
    },
    {
        key: 'triggerModes',
        kind: 'multiSelect',
        label: '指令触发方式',
        description:
            '选择可触发指令的消息形态；全不勾选则任何消息都不触发',
        scope: 'webui',
        options: TRIGGER_MODE_OPTIONS,
        default: ['prefix', 'atBot'],
    },
    // TODO: 在这里添加你的配置项
    // 可选 kind: boolean / text / password / number / select / multiSelect / stringList
    //            section (分组标题) / display (纯展示, content 为 HTML)

    {
        kind: 'section',
        label: '微博监听',
        description: '轮询周期、推送内容与浏览器路径',
    },
    {
        key: 'weiboPollIntervalMinutes',
        kind: 'number',
        label: '轮询间隔 (分钟)',
        description:
            '最小 1 分钟, 最大 1440 分钟; 可整除 60 的间隔按整分 / 整点对齐, 其余为固定间隔; 启动与订阅成功后各立即拉取一轮',
        default: 60,
        min: 1,
        max: 1440,
        step: 1,
    },
    {
        key: 'weiboPushRenderMode',
        kind: 'select',
        label: '推送呈现方式',
        description:
            '图片推送分两条: 标题行 + 整卡, 附图另发; 文本推送单条发送标题行、原文链接、正文与附图',
        scope: 'webui',
        options: PUSH_RENDER_MODE_OPTIONS,
        default: 'image',
    },
    {
        key: 'weiboPushContentTypes',
        kind: 'multiSelect',
        label: '推送内容类型',
        description:
            '原创动态始终推送; 广告是独立否决项, 关闭后所有广告 (含转发内广告) 都会被过滤; 部分商业游戏超话可能被误判为广告',
        options: WEIBO_CONTENT_TYPE_OPTIONS,
        default: ['repost', 'like', 'ad', 'birthday'],
    },
    {
        key: 'chromeExecutablePath',
        kind: 'text',
        label: 'Chrome 可执行文件路径',
        description:
            '留空自动探测共享安装目录与系统 Chrome / Edge; 仅需手动指定时填写',
        scope: 'webui',
        default: '',
        placeholder:
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    },
] as const satisfies readonly ConfigField[];

// 编译期断言: FIELDS 的有值字段键集与 PluginConfig 键集完全一致 (编辑器可见)
type FieldKeys = Extract<
    (typeof FIELDS)[number],
    { key: string }
>['key'];
type KeysInSync = [keyof PluginConfig] extends [FieldKeys]
    ? [FieldKeys] extends [keyof PluginConfig]
        ? true
        : never
    : never;
const _assertKeysInSync: KeysInSync = true;
void _assertKeysInSync;

// ==================== 派生: 默认值 ====================

/** 从 FIELDS 派生默认配置 (每次返回全新对象, 数组已复制) */
export function getDefaultConfig(): PluginConfig {
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
        if (!('key' in field)) continue;
        out[field.key] = cloneValue(
            (field as ConfigValueField).default,
        );
    }
    return out as unknown as PluginConfig;
}

function cloneValue(value: unknown): unknown {
    return Array.isArray(value) ? [...value] : value;
}

// ==================== 派生: 清洗 ====================

/**
 * 配置清洗函数 (纯函数)
 *
 * 【必须】一切外部输入的配置写回都必须经过本函数 (磁盘配置文件、WebUI 提交、
 * 指令修改)。规则从 FIELDS 的 kind 派生, 不再逐字段手写:
 *
 * | kind        | 规则                                                  |
 * | ----------- | ----------------------------------------------------- |
 * | boolean     | typeof 守卫; 不合法保留默认值                          |
 * | text        | typeof 守卫; 不合法保留默认值                          |
 * | password    | 同 text (typeof 守卫; 不合法保留默认值)                |
 * | number      | typeof + 区间钳制; 不合法回退默认值                    |
 * | select      | 必须命中 options 的 value; 否则回退默认值              |
 * | multiSelect | 过滤非法值; **空数组是合法语义**, 不回退默认值          |
 * | stringList  | 容错输入格式 (逗号串 / 数组), 统一转为去空项数组        |
 *
 * 【必须】清洗不抛错: 任何非法输入都回退默认值或丢弃条目, 保证插件在损坏的
 * 配置文件下仍能启动。
 */
export function sanitizeConfig(raw: unknown): PluginConfig {
    const source = isPlainObject(raw) ? raw : {};
    const out: Record<string, unknown> = {};
    for (const field of FIELDS) {
        if (!('key' in field)) continue;
        out[field.key] = sanitizeValue(
            field as ConfigValueField,
            source[field.key],
        );
    }
    return out as unknown as PluginConfig;
}

function sanitizeValue(
    field: ConfigValueField,
    value: unknown,
): unknown {
    switch (field.kind) {
        case 'boolean':
            return typeof value === 'boolean' ? value : field.default;
        case 'text':
        case 'password':
            return typeof value === 'string' ? value : field.default;
        case 'number': {
            if (
                typeof value !== 'number' ||
                !Number.isFinite(value)
            ) {
                return field.default;
            }
            let result = value;
            if (typeof field.min === 'number')
                result = Math.max(result, field.min);
            if (typeof field.max === 'number')
                result = Math.min(result, field.max);
            return result;
        }
        case 'select':
            return field.options.some(
                (option) => option.value === value,
            )
                ? value
                : field.default;
        case 'multiSelect': {
            if (!Array.isArray(value)) return [...field.default];
            return value.filter((item) =>
                field.options.some((option) => option.value === item),
            );
        }
        case 'stringList':
            return decodeStringList(value, field.default);
    }
}

/**
 * stringList codec: 逗号 / 换行分隔文本 → 去空项数组
 *
 * 与 webui 的标签输入共用, 是前后端一致的唯一定义。
 * 分隔符为逗号或换行; 【限制】不支持值本身含逗号 / 换行 (QQ 号等场景不涉及)。
 */
export function parseStringList(input: string): string[] {
    return input
        .split(/[,\n\r]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function decodeStringList(
    value: unknown,
    fallback: readonly string[],
): string[] {
    if (typeof value === 'string') return parseStringList(value);
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0);
    }
    return [...fallback];
}

function isPlainObject(
    value: unknown,
): value is Record<string, unknown> {
    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}
