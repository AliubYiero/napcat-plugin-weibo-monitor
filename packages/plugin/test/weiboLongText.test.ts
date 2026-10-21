import { describe, expect, it } from 'vitest';
import {
    extractLongText,
    needsLongText,
    resolveLongTextId,
    withLongText,
} from '../src/weibo/longText';
import type { WeiboPost } from '../src/weibo/types';

const POST: WeiboPost = {
    idstr: 'M1',
    mblogid: 'Mb1',
    text: '截断正文',
};

describe('needsLongText', () => {
    it('isLongText 为真或 1 时需要补拉', () => {
        expect(needsLongText({ ...POST, isLongText: true })).toBe(
            true,
        );
        expect(needsLongText({ ...POST, isLongText: 1 })).toBe(true);
    });

    it('正文含全文或展开链接时需要补拉', () => {
        expect(
            needsLongText({
                ...POST,
                text: '正文 <a href="https://weibo.com/1">全文</a>',
            }),
        ).toBe(true);
        expect(
            needsLongText({
                ...POST,
                text: '正文 <a href="https://weibo.com/1">展开</a>',
            }),
        ).toBe(true);
        expect(
            needsLongText({
                ...POST,
                text: '正文 <a href="https://weibo.com/1">展开全文</a>',
            }),
        ).toBe(true);
    });

    it('普通正文不需要补拉', () => {
        expect(needsLongText(POST)).toBe(false);
        expect(needsLongText({ ...POST, isLongText: false })).toBe(
            false,
        );
    });
});

describe('resolveLongTextId', () => {
    it('取 mblogid 并去除首尾空白', () => {
        expect(resolveLongTextId({ mblogid: 'Mb1' })).toBe('Mb1');
        expect(resolveLongTextId({ mblogid: '  Mb1  ' })).toBe('Mb1');
    });

    it('mblogid 缺失或为空时返回空串', () => {
        expect(resolveLongTextId({})).toBe('');
        expect(resolveLongTextId({ mblogid: '  ' })).toBe('');
        expect(resolveLongTextId({ mid: '123' })).toBe('');
    });
});

describe('extractLongText', () => {
    it('优先取 longTextContent', () => {
        expect(
            extractLongText({
                ok: 1,
                data: {
                    longTextContent: '完整正文',
                    longTextContent_raw: '备用正文',
                },
            }),
        ).toBe('完整正文');
    });

    it('longTextContent 为空时回退 raw', () => {
        expect(
            extractLongText({
                ok: 1,
                data: {
                    longTextContent: '  ',
                    longTextContent_raw: '备用正文',
                },
            }),
        ).toBe('备用正文');
    });

    it('非法响应返回空串', () => {
        expect(extractLongText(null)).toBe('');
        expect(extractLongText({ ok: 0 })).toBe('');
        expect(extractLongText({ data: {} })).toBe('');
    });
});

describe('withLongText', () => {
    it('替换 text 与 text_raw 并清空补拉标记', () => {
        const result = withLongText(
            { ...POST, isLongText: true },
            '  完整正文  ',
        );
        expect(result).not.toBe(POST);
        expect(result.text).toBe('完整正文');
        expect(result.text_raw).toBe('完整正文');
        expect(result.isLongText).toBe(false);
    });

    it('空文本不覆盖原动态', () => {
        expect(withLongText(POST, '   ')).toBe(POST);
    });
});
