import { describe, expect, it } from 'vitest';
import {
    explainQualified,
    materializeText,
    postFileBase,
} from '../scripts/weiboTest/report';
import type { WeiboPost } from '../src/weibo/types';

describe('materializeText', () => {
    it('文本段原样拼接, 图片写成占位行', () => {
        expect(
            materializeText([
                { type: 'text', text: '正文' },
                { type: 'image', url: 'https://example.com/1.jpg' },
                { type: 'text', text: '结尾' },
            ]),
        ).toBe('正文\n[图片] https://example.com/1.jpg\n结尾');
    });
});

describe('postFileBase', () => {
    it('序号补零并使用 mblogid', () => {
        expect(
            postFileBase(1, {
                mblogid: 'Mb123',
            } as WeiboPost),
        ).toBe('001-Mb123');
    });

    it('无 mblogid 时回退 idstr 并净化文件名', () => {
        expect(
            postFileBase(2, {
                idstr: 'a/b:c',
            } as WeiboPost),
        ).toBe('002-a_b_c');
    });
});

describe('explainQualified', () => {
    it('作者与类型都符合时判为合格', () => {
        expect(
            explainQualified(
                {
                    idstr: '1',
                    mblogtype: 0,
                    isTop: 0,
                    user: { idstr: '123' },
                },
                '123',
            ),
        ).toEqual({ qualified: true, reasons: [] });
    });

    it('列出全部被筛原因', () => {
        const result = explainQualified(
            {
                mblogtype: 1,
                isTop: 1,
                isAd: true,
                user: { idstr: '999' },
            },
            '123',
        );

        expect(result.qualified).toBe(false);
        expect(result.reasons).toEqual([
            '作者 UID: 999',
            'mblogtype=1',
            '置顶',
            '广告',
            '缺少动态 id',
        ]);
    });
});
