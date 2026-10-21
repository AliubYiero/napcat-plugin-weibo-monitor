import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    buildUserAgent,
    detectChrome,
} from '../../src/services/browser/launcher';
import { createWeiboBrowserSession } from '../../src/services/weibo/browserSession';
import { pickAllPostImages } from '../../src/weibo/card';
import {
    needsLongText,
    resolveLongTextId,
} from '../../src/weibo/longText';
import { getPostId } from '../../src/weibo/predicate';
import {
    buildTextPresentation,
    resolvePostEvent,
} from '../../src/weibo/presentation';
import { createWeiboReader } from '../../src/weibo/reader';
import { parseCookieHeader } from '../../src/weibo/sanitize';
import type { WeiboPost } from '../../src/weibo/types';
import { loadWeiboTestEnv } from './env';
import {
    buildIndexHtml,
    explainQualified,
    materializeText,
    postFileBase,
    type AttachmentReport,
    type LongTextStatus,
    type PostReport,
    type RunManifest,
    writeBinaryFile,
    writeJsonFile,
    writeTextFile,
} from './report';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, '../..');
const OUTPUT_ROOT = path.join(PLUGIN_ROOT, '.weibo-test');

async function main(): Promise<void> {
    const env = loadWeiboTestEnv();
    const cookies = parseCookieHeader(env.cookie);
    if (cookies.length === 0) {
        throw new Error('WEIBO_COOKIE 未解析出任何 Cookie');
    }

    const browser = detectChrome(env.chromePath);
    if (!browser) {
        throw new Error(
            '未找到可用的 Chrome/Edge, 可用 WEIBO_CHROME_PATH 指定路径',
        );
    }

    const outputDir = path.join(
        OUTPUT_ROOT,
        env.uid,
        timestamp(),
    );
    const imagesDir = path.join(outputDir, 'images');
    fs.mkdirSync(imagesDir, { recursive: true });

    const session = createWeiboBrowserSession({
        executablePath: browser.path,
        cookies,
        logger: console,
    });
    const reader = createWeiboReader({
        fetchApi: (urlPath) => session.fetchApi(urlPath),
        renderHtml: (html) => session.renderHtml(html),
        logger: console,
    });

    console.log(`微博真机爬取测试: UID ${env.uid}`);
    console.log(`浏览器: ${browser.path} (${browser.source})`);

    try {
        const profile = await reader.fetchProfile(env.uid);
        if (!profile.ok) {
            console.warn(
                `profile 拉取失败, 降级使用动态作者信息: ${profile.message || profile.failure || '未知错误'}`,
            );
        }

        const firstPage = await reader.fetchFirstPage(env.uid);
        if (!firstPage.ok) {
            throw new Error(
                `第一页拉取失败: ${firstPage.message || firstPage.failure || '未知错误'}`,
            );
        }

        writeJsonFile(outputDir, 'posts.raw.json', firstPage.posts);
        const screenName =
            profile.user?.screen_name ??
            firstPage.posts.find((post) => post.user?.screen_name)?.user
                ?.screen_name ??
            `UID ${env.uid}`;
        const userAgent = buildUserAgent(
            session.getVersion() ?? '120.0.0.0',
        );
        const reports: PostReport[] = [];

        for (const [index, rawPost] of firstPage.posts.entries()) {
            const position = index + 1;
            const base = postFileBase(position, rawPost);
            const qualification = explainQualified(rawPost, env.uid);
            const { post, status: longTextStatus } =
                await hydrateAndResolveStatus(reader, rawPost);
            const errors: string[] = [];

            const card = await reader.renderCard(post);
            let cardFile: string | null = null;
            let cardError: string | null = null;
            if (card.ok && card.buffer) {
                cardFile = `${base}.png`;
                writeBinaryFile(outputDir, cardFile, card.buffer);
            } else {
                cardError = card.message || '卡片渲染失败';
                writeTextFile(
                    outputDir,
                    `${base}.card.error.txt`,
                    `${cardError}\n`,
                );
            }

            const text = materializeText(buildTextPresentation(post));
            writeTextFile(outputDir, `${base}.txt`, `${text}\n`);

            const attachments = await downloadAttachments(
                post,
                imagesDir,
                base,
                userAgent,
                errors,
            );

            reports.push({
                index: position,
                id: getPostId(post),
                mblogid: post.mblogid ?? '',
                screenName: post.user?.screen_name ?? screenName,
                event: resolvePostEvent(post),
                qualified: qualification.qualified,
                qualifiedReasons: qualification.reasons,
                longTextStatus,
                textFile: `${base}.txt`,
                cardFile,
                cardError,
                attachments,
                errors,
                text,
            });

            console.log(
                `[${position}/${firstPage.posts.length}] ${base} ` +
                    `合格=${qualification.qualified ? '是' : '否'} ` +
                    `卡片=${cardFile ? '成功' : '失败'} ` +
                    `附图=${attachments.filter((item) => item.file).length}/${attachments.length}`,
            );
        }

        const manifest = buildManifest(
            env.uid,
            screenName,
            outputDir,
            profile.ok,
            profile.message,
            reports,
        );
        writeJsonFile(outputDir, 'manifest.json', manifest);
        writeTextFile(
            outputDir,
            'index.html',
            buildIndexHtml(manifest, reports),
        );

        console.log('');
        console.log(
            `第一页动态: ${manifest.summary.total} (合格 ${manifest.summary.qualified})`,
        );
        console.log(
            `卡片: ${manifest.summary.cardOk} 成功 / ${manifest.summary.cardFailed} 失败`,
        );
        console.log(
            `长文: ${manifest.summary.longTextHydrated} 补拉 / ${manifest.summary.longTextFailed} 失败`,
        );
        console.log(
            `附图: ${manifest.summary.attachmentsOk} 下载 / ${manifest.summary.attachmentsFailed} 失败`,
        );
        console.log(`产物: ${outputDir}`);
    } finally {
        await session.close();
    }
}

async function hydrateAndResolveStatus(
    reader: ReturnType<typeof createWeiboReader>,
    post: WeiboPost,
): Promise<{ post: WeiboPost; status: LongTextStatus }> {
    const targets: WeiboPost[] = [post];
    if (post.retweeted_status) targets.push(post.retweeted_status);

    const needed = targets.filter((item) => needsLongText(item));
    if (needed.length === 0) {
        return { post, status: 'not-needed' };
    }

    const hydratedPost = await reader.hydrate(post);
    const afterTargets = [
        hydratedPost,
        ...(hydratedPost.retweeted_status
            ? [hydratedPost.retweeted_status]
            : []),
    ];

    let hydrated = 0;
    let missing = 0;
    for (const before of needed) {
        const after = afterTargets.find(
            (item) => getPostId(item) === getPostId(before),
        );
        if (!after) {
            missing += 1;
            continue;
        }
        if (
            after.text !== before.text ||
            after.text_raw !== before.text_raw
        ) {
            hydrated += 1;
        } else if (!resolveLongTextId(before)) {
            missing += 1;
        }
    }

    if (hydrated === needed.length) {
        return { post: hydratedPost, status: 'hydrated' };
    }
    if (hydrated > 0) return { post: hydratedPost, status: 'partial' };
    if (missing === needed.length) {
        return { post: hydratedPost, status: 'missing-id' };
    }
    return { post: hydratedPost, status: 'failed' };
}

async function downloadAttachments(
    post: WeiboPost,
    imagesDir: string,
    base: string,
    userAgent: string,
    errors: string[],
): Promise<AttachmentReport[]> {
    const groups: Array<{
        source: 'main' | 'retweet';
        images: string[];
    }> = [{ source: 'main', images: pickAllPostImages(post) }];
    if (post.retweeted_status) {
        groups.push({
            source: 'retweet',
            images: pickAllPostImages(post.retweeted_status),
        });
    }

    const reports: AttachmentReport[] = [];
    for (const group of groups) {
        for (const [index, url] of group.images.entries()) {
            const position = index + 1;
            const result = await downloadImage(
                url,
                imagesDir,
                `${base}-${group.source}-${position}`,
                userAgent,
            );
            reports.push({
                source: group.source,
                index: position,
                url,
                file: result.file,
                error: result.error,
            });
            if (result.error) {
                errors.push(
                    `附图下载失败 (${group.source} #${position}): ${result.error}`,
                );
            }
        }
    }
    return reports;
}

async function downloadImage(
    url: string,
    imagesDir: string,
    fileBase: string,
    userAgent: string,
): Promise<{ file: string | null; error: string | null }> {
    try {
        const response = await fetch(url, {
            headers: {
                'user-agent': userAgent,
                referer: 'https://weibo.com/',
            },
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const extension = imageExtension(
            url,
            response.headers.get('content-type') ?? '',
        );
        const fileName = `${fileBase}.${extension}`;
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(path.join(imagesDir, fileName), buffer);
        return { file: `images/${fileName}`, error: null };
    } catch (error) {
        return {
            file: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

function imageExtension(url: string, contentType: string): string {
    const type = contentType.toLowerCase();
    if (type.includes('image/png')) return 'png';
    if (type.includes('image/webp')) return 'webp';
    if (type.includes('image/gif')) return 'gif';
    if (type.includes('image/avif')) return 'avif';
    if (type.includes('image/jpeg')) return 'jpg';

    try {
        const extension = path
            .extname(new URL(url).pathname)
            .replace('.', '')
            .toLowerCase();
        if (
            ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif'].includes(
                extension,
            )
        ) {
            return extension === 'jpeg' ? 'jpg' : extension;
        }
    } catch {
        return 'jpg';
    }
    return 'jpg';
}

function buildManifest(
    uid: string,
    screenName: string,
    outputDir: string,
    profileOk: boolean,
    profileMessage: string,
    reports: PostReport[],
): RunManifest {
    const attachments = reports.flatMap((post) => post.attachments);
    return {
        generatedAt: new Date().toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai',
            hour12: false,
        }),
        uid,
        screenName,
        profile: {
            ok: profileOk,
            message: profileMessage,
            screenName,
        },
        outputDir,
        summary: {
            total: reports.length,
            qualified: reports.filter((post) => post.qualified).length,
            cardOk: reports.filter((post) => post.cardFile).length,
            cardFailed: reports.filter((post) => !post.cardFile).length,
            attachmentsOk: attachments.filter((item) => item.file)
                .length,
            attachmentsFailed: attachments.filter((item) => !item.file)
                .length,
            longTextHydrated: reports.filter(
                (post) =>
                    post.longTextStatus === 'hydrated' ||
                    post.longTextStatus === 'partial',
            ).length,
            longTextFailed: reports.filter(
                (post) =>
                    post.longTextStatus === 'failed' ||
                    post.longTextStatus === 'missing-id',
            ).length,
        },
        posts: reports.map(({ text: _text, ...rest }) => rest),
    };
}

function timestamp(date = new Date()): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
        `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

main().catch((error: unknown) => {
    const message =
        error instanceof Error ? error.message : String(error);
    console.error(`微博真机爬取测试失败: ${message}`);
    process.exitCode = 1;
});
