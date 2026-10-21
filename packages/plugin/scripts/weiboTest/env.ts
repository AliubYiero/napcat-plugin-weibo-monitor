import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface WeiboTestEnv {
    cookie: string;
    uid: string;
    chromePath: string;
    envPath: string;
}

export function loadWeiboTestEnv(): WeiboTestEnv {
    const envPath = path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../.env',
    );
    const fileVars = fs.existsSync(envPath)
        ? parseEnvFile(fs.readFileSync(envPath, 'utf-8'))
        : {};

    const cookie =
        process.env.WEIBO_COOKIE || fileVars.WEIBO_COOKIE || '';
    const uid = (
        process.env.WEIBO_TEST_UID ||
        fileVars.WEIBO_TEST_UID ||
        ''
    ).trim();
    const chromePath = (
        process.env.WEIBO_CHROME_PATH ||
        fileVars.WEIBO_CHROME_PATH ||
        ''
    ).trim();

    if (!cookie.trim()) {
        throw new Error(
            'WEIBO_COOKIE 为空, 请在仓库根目录 .env 填写微博 Cookie',
        );
    }
    if (!/^\d{3,20}$/.test(uid)) {
        throw new Error('WEIBO_TEST_UID 必须是 3-20 位纯数字');
    }

    return { cookie, uid, chromePath, envPath };
}

export function parseEnvFile(text: string): Record<string, string> {
    const vars: Record<string, string> = {};
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const match =
            /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
                line,
            );
        if (!match) continue;
        let value = match[2].trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        vars[match[1]] = value;
    }
    return vars;
}
