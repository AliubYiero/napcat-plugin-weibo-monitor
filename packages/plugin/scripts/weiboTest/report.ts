import type { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import type {
    PostEvent,
    PresentationSegment,
} from '../../src/weibo/presentation';
import { getPostId, getUserUid } from '../../src/weibo/predicate';
import { escapeHtml } from '../../src/weibo/sanitize';
import type { WeiboPost } from '../../src/weibo/types';

export type LongTextStatus =
    | 'not-needed'
    | 'hydrated'
    | 'partial'
    | 'failed'
    | 'missing-id';

export interface AttachmentReport {
    source: 'main' | 'retweet';
    index: number;
    url: string;
    file: string | null;
    error: string | null;
}

export interface PostReport {
    index: number;
    id: string;
    mblogid: string;
    screenName: string;
    event: PostEvent;
    qualified: boolean;
    qualifiedReasons: string[];
    longTextStatus: LongTextStatus;
    textFile: string;
    cardFile: string | null;
    cardError: string | null;
    cardHtmlFile: string | null;
    cardHtml: string | null;
    attachments: AttachmentReport[];
    errors: string[];
    text: string;
}

export interface RunManifest {
    generatedAt: string;
    uid: string;
    screenName: string;
    profile: {
        ok: boolean;
        message: string;
        screenName: string;
    };
    outputDir: string;
    summary: {
        total: number;
        qualified: number;
        cardOk: number;
        cardFailed: number;
        attachmentsOk: number;
        attachmentsFailed: number;
        longTextHydrated: number;
        longTextFailed: number;
    };
    posts: Omit<PostReport, 'text' | 'cardHtml'>[];
}

export function postFileBase(index: number, post: WeiboPost): string {
    const id = post.mblogid || getPostId(post) || 'post';
    return `${String(index).padStart(3, '0')}-${safeSegment(id)}`;
}

export function materializeText(
    segments: readonly PresentationSegment[],
): string {
    let text = '';
    for (const segment of segments) {
        if (segment.type === 'text') {
            text += segment.text;
        } else {
            text += `\n[图片] ${segment.url}\n`;
        }
    }
    return text.trim();
}

export function explainQualified(
    post: WeiboPost,
    uid: string,
): { qualified: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const authorUid = getUserUid(post);
    if (authorUid !== uid) {
        reasons.push(`作者 UID: ${authorUid || '未知'}`);
    }
    if (Number(post.mblogtype) !== 0) {
        reasons.push(`mblogtype=${String(post.mblogtype)}`);
    }
    if (Number(post.isTop) === 1) {
        reasons.push('置顶');
    }
    if (post.isAd === true) {
        reasons.push('广告');
    }
    if (!getPostId(post)) {
        reasons.push('缺少动态 id');
    }
    return { qualified: reasons.length === 0, reasons };
}

export function writeTextFile(
    outputDir: string,
    file: string,
    text: string,
): void {
    fs.writeFileSync(path.join(outputDir, file), text, 'utf-8');
}

export function writeBinaryFile(
    outputDir: string,
    file: string,
    data: Buffer,
): void {
    fs.writeFileSync(path.join(outputDir, file), data);
}

export function writeJsonFile(
    outputDir: string,
    file: string,
    data: unknown,
): void {
    fs.writeFileSync(
        path.join(outputDir, file),
        JSON.stringify(data, null, 2),
        'utf-8',
    );
}

export function buildIndexHtml(
    manifest: RunManifest,
    posts: readonly PostReport[],
): string {
    const sections = posts.map(renderPost).join('\n');
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>微博真机爬取测试 · ${escapeHtml(manifest.uid)}</title>
<style>
    * { box-sizing: border-box; }
    body {
        margin: 0; padding: 24px; background: #f7f8fa; color: #1f2329;
        font-family: "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
    }
    h1 { font-size: 22px; margin: 0 0 8px; }
    .summary { margin: 0 0 24px; color: #646a73; font-size: 14px; line-height: 1.8; }
    .post {
        background: #fff; border-radius: 10px; padding: 18px 20px;
        margin-bottom: 20px; border: 1px solid #eceef1;
    }
    .post.filtered { border-left: 4px solid #c4c7cc; }
    .post.qualified { border-left: 4px solid #FB7299; }
    .post h2 { font-size: 16px; margin: 0 0 8px; }
    .badges { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
    .badge {
        font-size: 12px; padding: 2px 8px; border-radius: 999px;
        background: #f2f3f5; color: #646a73;
    }
    .badge.ok { background: #FB7299; color: #fff; }
    .reasons { font-size: 13px; color: #d4380d; margin-bottom: 10px; }
    .columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; }
    @media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
    h3 { font-size: 13px; color: #646a73; margin: 0 0 8px; font-weight: 600; }
    .card-image { width: 100%; height: auto; border: 1px solid #eceef1; border-radius: 8px; }
    pre {
        margin: 0; padding: 12px; background: #f7f8fa; border-radius: 8px;
        white-space: pre-wrap; word-break: break-word; font-size: 13px;
        line-height: 1.7; font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    pre.error { color: #d4380d; }
    .html-output { margin-top: 14px; }
    .html-head { display: flex; align-items: baseline; gap: 10px; }
    .html-head h3 { margin: 0; }
    .html-head a { font-size: 13px; color: #FB7299; text-decoration: none; }
    .html-head a:hover { text-decoration: underline; }
    .html-source { margin-top: 8px; max-height: 420px; overflow: auto; }
    details { margin-top: 14px; }
    summary { cursor: pointer; font-size: 13px; color: #646a73; }
    .attachments { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
    .attachments figure { margin: 0; width: 180px; }
    .attachments img { width: 100%; border-radius: 6px; border: 1px solid #eceef1; }
    .attachments figcaption { font-size: 12px; color: #8a8f99; margin-top: 4px; word-break: break-all; }
    .errors { margin: 10px 0 0; padding-left: 20px; color: #d4380d; font-size: 13px; }
</style>
</head>
<body>
<h1>微博真机爬取测试</h1>
<div class="summary">
    UID ${escapeHtml(manifest.uid)} · ${escapeHtml(manifest.screenName)}<br />
    第一页 ${manifest.summary.total} 条 · 合格 ${manifest.summary.qualified} 条 ·
    卡片 ${manifest.summary.cardOk} 成功 / ${manifest.summary.cardFailed} 失败 ·
    长文 ${manifest.summary.longTextHydrated} 补拉 / ${manifest.summary.longTextFailed} 失败 ·
    附图 ${manifest.summary.attachmentsOk} 下载 / ${manifest.summary.attachmentsFailed} 失败<br />
    生成时间 ${escapeHtml(manifest.generatedAt)} · 产物目录 ${escapeHtml(manifest.outputDir)}
</div>
${sections}
</body>
</html>`;
}

function renderPost(post: PostReport): string {
    const reasons = post.qualifiedReasons.length
        ? `<div class="reasons">被筛原因: ${post.qualifiedReasons.map(escapeHtml).join(' / ')}</div>`
        : '';
    const card = post.cardFile
        ? `<img class="card-image" src="${escapeHtml(post.cardFile)}" alt="" />`
        : `<pre class="error">${escapeHtml(post.cardError ?? '未生成卡片')}</pre>`;
    const attachments = renderAttachments(post);
    const errors = post.errors.length
        ? `<ul class="errors">${post.errors.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
        : '';
    const htmlOutput = post.cardHtml
        ? `<section class="html-output">
            <div class="html-head">
                <h3>HTML 输出</h3>
                ${post.cardHtmlFile ? `<a href="${escapeHtml(post.cardHtmlFile)}" target="_blank" rel="noopener noreferrer">新窗口打开</a>` : ''}
            </div>
            <details>
                <summary>查看渲染前 HTML 源码</summary>
                <pre class="html-source">${escapeHtml(post.cardHtml)}</pre>
            </details>
        </section>`
        : '';

    return `<article class="post ${post.qualified ? 'qualified' : 'filtered'}">
    <h2>#${String(post.index).padStart(3, '0')} 「${escapeHtml(post.screenName)}」${escapeHtml(post.event)}</h2>
    <div class="badges">
        <span class="badge ${post.qualified ? 'ok' : ''}">${post.qualified ? '合格' : '被筛'}</span>
        <span class="badge">id ${escapeHtml(post.id || '-')}</span>
        <span class="badge">长文 ${escapeHtml(longTextLabel(post.longTextStatus))}</span>
    </div>
    ${reasons}
    <div class="columns">
        <section>
            <h3>图片输出</h3>
            ${card}
        </section>
        <section>
            <h3>文本输出</h3>
            <pre>${escapeHtml(post.text)}</pre>
        </section>
    </div>
    ${htmlOutput}
    ${attachments}
    ${errors}
</article>`;
}

function renderAttachments(post: PostReport): string {
    if (post.attachments.length === 0) return '';
    const items = post.attachments
        .map((attachment) => {
            const label = `${attachment.source === 'retweet' ? '原动态' : '主动态'} #${attachment.index}`;
            if (!attachment.file) {
                return `<figure>
    <a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer">原图链接</a>
    <figcaption>${escapeHtml(label)} · 下载失败: ${escapeHtml(attachment.error ?? '未知错误')}</figcaption>
</figure>`;
            }
            return `<figure>
    <a href="${escapeHtml(attachment.file)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(attachment.file)}" alt="" /></a>
    <figcaption>${escapeHtml(label)}</figcaption>
</figure>`;
        })
        .join('');
    return `<details open><summary>附图 (${post.attachments.length})</summary><div class="attachments">${items}</div></details>`;
}

function longTextLabel(status: LongTextStatus): string {
    switch (status) {
        case 'not-needed':
            return '无需补拉';
        case 'hydrated':
            return '已补拉';
        case 'partial':
            return '部分补拉';
        case 'missing-id':
            return '缺少 mblogid';
        case 'failed':
            return '补拉失败';
    }
}

function safeSegment(value: string): string {
    const safe = value.replace(/[^a-zA-Z0-9._-]/g, '_');
    return safe || 'post';
}
