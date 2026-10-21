/**
 * help:generate 命令入口
 * 通过 napcat-help-generate 服务端 API 生成帮助图片与文本, 并落盘到本插件:
 * - 结构化数据: src/handlers/help/helpData.generated.ts (生成文件, 禁止手改;
 *   汇总所有面板, 供 WebUI 帮助文档页消费, 不依赖渲染服务, 最先落盘)
 * - 图片: src/assets/{cmdId}-{Role}.png (覆盖写入)
 * - 文本: src/handlers/commands/helpText.generated.ts (生成文件, 禁止手改)
 *
 * cmd 配置权威源在本插件 scripts/generateHelp/cmds/, 经 API 传参模式 (cmd 字段)
 * 提交给上游服务渲染。
 *
 * 上游服务目录解析顺序:
 * 1. 环境变量 HELP_GENERATOR_ROOT (绝对路径或相对 cwd)
 * 2. 回退: 与本仓库同级目录下的 napcat-help-generate
 * 端口解析顺序: 环境变量 HELP_GENERATOR_PORT → 上游 .env 的 PORT → 3366
 */

import {
    type ChildProcess,
    spawn,
    spawnSync,
} from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Cmd, Role } from './cmd.ts';
import { weiboHelp } from './cmds/weiboHelp.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 本插件包根目录 (packages/plugin)
const PLUGIN_ROOT = resolve(__dirname, '..', '..');
// 本仓库根目录 (monorepo 根)
const REPO_ROOT = resolve(PLUGIN_ROOT, '..', '..');
// 上游 help-generate 项目目录: 环境变量优先, 否则约定与本仓库同级
const GENERATOR_ROOT = process.env.HELP_GENERATOR_ROOT
    ? resolve(process.env.HELP_GENERATOR_ROOT)
    : resolve(REPO_ROOT, '..', 'napcat-help-generate');

// 权威源 cmd 配置 → 落盘目标
const CMD_TARGETS: {
    cmd: Cmd;
    handlerDir: string;
}[] = [
    {
        cmd: weiboHelp,
        handlerDir: join(PLUGIN_ROOT, 'src/handlers/commands'),
    },
];

// 权限组: API 键 (PascalCase) → 变体键 (camelCase)
const ROLE_MAP: { role: Role; variant: string }[] = [
    { role: 'User', variant: 'user' },
    { role: 'Admin', variant: 'admin' },
    { role: 'SuperAdmin', variant: 'superAdmin' },
];

// 探活/请求超时与启动等待
const POLL_INTERVAL_MS = 500;
const START_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------- 服务启动 ----------

async function isServerUp(port: number): Promise<boolean> {
    try {
        const res = await fetch(`http://localhost:${port}/api/cmds`, {
            signal: AbortSignal.timeout(2000),
        });
        return res.ok;
    } catch {
        return false;
    }
}

// 解析上游端口: HELP_GENERATOR_PORT → 上游 .env 的 PORT → 3366
function readGeneratorPort(): number {
    const fromEnv = Number(process.env.HELP_GENERATOR_PORT);
    if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) {
        return fromEnv;
    }
    try {
        const env = readFileSync(
            join(GENERATOR_ROOT, '.env'),
            'utf-8',
        );
        const match = env.match(/^PORT=(\d+)\s*$/m);
        if (match) {
            return Number(match[1]);
        }
    } catch {
        // .env 不存在或不可读, 用缺省端口
    }
    return 3366;
}

// 本脚本自启的上游服务句柄; owned=false 表示复用已在运行的实例, 结束时不得关闭
interface ServerHandle {
    owned: boolean;
    child?: ChildProcess;
}

// 上游服务未运行时自动启动, 轮询就绪
async function ensureServer(port: number): Promise<ServerHandle> {
    if (await isServerUp(port)) {
        console.log(
            `[help:generate] 检测到上游服务已运行 (port ${port})`,
        );
        return { owned: false };
    }

    console.log(
        `[help:generate] 上游服务未运行, 在 ${GENERATOR_ROOT} 启动 pnpm start ...`,
    );
    const bin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
    const child = spawn(bin, ['start'], {
        cwd: GENERATOR_ROOT,
        stdio: 'ignore',
        // POSIX 下自成进程组, 便于结束时整组终止
        detached: process.platform !== 'win32',
        // Windows 下 Node v20.12+ 对 .cmd 的 spawn 强制要求 shell
        shell: process.platform === 'win32',
    });

    let spawnError: Error | null = null;
    child.on('error', (err) => {
        spawnError = err;
    });

    const startedAt = Date.now();
    while (Date.now() - startedAt < START_TIMEOUT_MS) {
        if (spawnError) {
            throw new Error(
                `启动上游服务失败: ${spawnError.message}\n` +
                    '请手动进入 napcat-help-generate 目录执行 pnpm start 后重试',
            );
        }
        if (await isServerUp(port)) {
            console.log('[help:generate] 上游服务已就绪');
            return { owned: true, child };
        }
        await sleep(POLL_INTERVAL_MS);
    }
    stopServer({ owned: true, child });
    throw new Error(
        `等待上游服务就绪超时 (${START_TIMEOUT_MS / 1000}s)\n` +
            '首次运行需在上游目录执行 npx playwright install chromium; 也可手动 pnpm start 后重试',
    );
}

// 关闭本脚本自启的上游服务 (整棵进程树); 复用实例与清理失败均静默放行
function stopServer(handle: ServerHandle): void {
    const pid = handle.child?.pid;
    if (!handle.owned || !pid) {
        return;
    }
    try {
        if (process.platform === 'win32') {
            spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
                stdio: 'ignore',
            });
        } else {
            process.kill(-pid, 'SIGKILL');
        }
    } catch (err) {
        console.warn(
            `[help:generate] 关闭上游服务失败 (pid ${pid}): ${(err as Error).message}`,
        );
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

// ---------- API 请求 ----------

function assertOk(res: Response, body: string): void {
    if (res.status === 400 || res.status === 500) {
        // 上游错误响应为 {"error": "..."}
        try {
            const { error, detail } = JSON.parse(body);
            throw new Error(
                `上游返回 ${res.status}: ${error}${detail ? ` (${detail})` : ''}`,
            );
        } catch (e) {
            if (e instanceof SyntaxError) {
                throw new Error(`上游返回 ${res.status}: ${body}`);
            }
            throw e;
        }
    }
    if (!res.ok) {
        throw new Error(`上游返回 ${res.status}: ${body}`);
    }
}

async function fetchText(
    port: number,
    cmd: Cmd,
): Promise<Record<Role, string>> {
    const res = await fetch(`http://localhost:${port}/api/text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cmd: [cmd],
            role: ROLE_MAP.map((r) => r.role),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await res.text();
    assertOk(res, body);
    return JSON.parse(body);
}

async function fetchImages(
    port: number,
    cmd: Cmd,
): Promise<Map<Role, Buffer>> {
    const res = await fetch(`http://localhost:${port}/api/images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cmd: [cmd],
            role: ROLE_MAP.map((r) => r.role),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // body 只读一次: 先取 buffer, 错误响应用 UTF-8 文本判定, 成功响应按二进制解析
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
        assertOk(res, buffer.toString('utf-8'));
        throw new Error(`响应不是 multipart: ${contentType}`);
    }

    // 手写解析 multipart 响应 (上游 boundary 固定前缀 napcat-help-generate-)
    // 二进制安全: 以 latin1 解码 buffer, 保证字节 1:1 (PNG 不可走 UTF-8 text())
    const boundaryMatch = contentType.match(/boundary=(.+)$/);
    if (!boundaryMatch) {
        throw new Error(`响应缺少 boundary: ${contentType}`);
    }
    const boundary = boundaryMatch[1];
    const bodyBin = buffer.toString('latin1');
    const parts = bodyBin.split(`--${boundary}`);
    const imageMap = new Map<Role, Buffer>();
    for (const part of parts) {
        // part 形如 \r\nContent-Disposition: form-data; name="User"; filename="{cmdId}-User.png"\r\nContent-Type: image/png\r\n\r\n<binary>\r\n
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
            continue;
        }
        const nameMatch = part.match(
            /name="(User|Admin|SuperAdmin)"/,
        );
        if (!nameMatch) {
            continue;
        }
        const raw = part.slice(headerEnd + 4).replace(/\r\n$/, '');
        imageMap.set(
            nameMatch[1] as Role,
            Buffer.from(raw, 'latin1'),
        );
    }
    const missing = ROLE_MAP.map((r) => r.role).filter(
        (r) => !imageMap.has(r),
    );
    if (missing.length > 0) {
        throw new Error(
            `multipart 响应缺少 role part: ${missing.join(', ')}`,
        );
    }
    return imageMap;
}

// ---------- 落盘 ----------

// 结构化帮助数据: 汇总所有面板, 供 WebUI 帮助文档页 (GET /help) 消费。
// 不依赖渲染服务, 因此在联网生成图片/文本前先落盘, 渲染失败也不影响该数据。
function writeHelpPanels(): void {
    const helpDir = join(PLUGIN_ROOT, 'src/handlers/help');
    mkdirSync(helpDir, { recursive: true });
    const panels = CMD_TARGETS.map((target) => target.cmd);
    const lines: string[] = [];
    lines.push('/**');
    lines.push(' * 由 pnpm run help:generate 生成, 禁止手改');
    lines.push(' * cmd 权威源: scripts/generateHelp/cmds/');
    lines.push(' * 供 WebUI 帮助文档页消费 (GET /help)');
    lines.push(' */');
    lines.push('');
    lines.push("import type { Cmd } from 'shared';");
    lines.push('');
    lines.push(
        '/** 全部帮助面板 (内容为各 cmds 权威源原样, 未经权限过滤) */',
    );
    lines.push(
        `export const HELP_PANELS: Cmd[] = ${JSON.stringify(panels, null, 4)};`,
    );
    lines.push('');
    const file = join(helpDir, 'helpData.generated.ts');
    writeFileSync(file, lines.join('\n'));
    console.log(`[help:generate] 写入 ${file}`);
}

function writeImages(cmdId: string, images: Map<Role, Buffer>): void {
    const assetsDir = join(PLUGIN_ROOT, 'src/assets');
    mkdirSync(assetsDir, { recursive: true });
    for (const [role, buffer] of images) {
        const file = join(assetsDir, `${cmdId}-${role}.png`);
        writeFileSync(file, buffer);
        console.log(
            `[help:generate] 写入 ${file} (${buffer.length} bytes)`,
        );
    }
}

function writeHelpText(
    cmdId: string,
    handlerDir: string,
    texts: Record<Role, string>,
): void {
    const lines: string[] = [];
    lines.push('/**');
    lines.push(' * 由 pnpm run help:generate 生成, 禁止手改');
    lines.push(
        ` * cmd 权威源: scripts/generateHelp/cmds/${cmdId}.ts`,
    );
    lines.push(' */');
    lines.push('');
    lines.push(
        "import type { HelpVariant } from '../../utils/helpMessage';",
    );
    lines.push('');
    lines.push(
        '/** 按帮助版本的文本帮助 (图片降级用), Admin 版同时用于私聊用户与群聊超管 */',
    );
    lines.push(
        'export const HELP_TEXT_MAP: Record<HelpVariant, string> = {',
    );
    for (const { role, variant } of ROLE_MAP) {
        lines.push(`    ${variant}: ${JSON.stringify(texts[role])},`);
    }
    lines.push('};');
    lines.push('');
    const file = join(handlerDir, 'helpText.generated.ts');
    writeFileSync(file, lines.join('\n'));
    console.log(`[help:generate] 写入 ${file}`);
}

// ---------- 主流程 ----------

async function main(): Promise<void> {
    // 结构化数据产出不依赖渲染服务, 先写, 保证服务不可用时 WebUI 数据仍可用
    writeHelpPanels();

    const port = readGeneratorPort();
    const handle = await ensureServer(port);

    try {
        for (const { cmd, handlerDir } of CMD_TARGETS) {
            console.log(`[help:generate] 生成 ${cmd.id} ...`);
            const texts = await fetchText(port, cmd);
            const images = await fetchImages(port, cmd);
            writeImages(cmd.id, images);
            writeHelpText(cmd.id, handlerDir, texts);
        }
        console.log('[help:generate] 全部完成');
    } finally {
        stopServer(handle);
    }
}

main().then(
    () => process.exit(0),
    (err) => {
        console.error('[help:generate] 失败:', err);
        process.exit(1);
    },
);
