import { describe, expect, it } from 'vitest';
import {
    buildPostCardHtml,
    buildPostText,
    buildPostUrl,
    CARD_WIDTH,
    pickAvatar,
    pickPostImages,
} from '../src/weibo/card';
import type { WeiboPost } from '../src/weibo/types';

const POST: WeiboPost = {
    idstr: 'M1',
    mid: 'M1',
    mblogid: 'Mb1',
    text: '正文 <script>alert(1)</script>',
    user: {
        idstr: '123',
        screen_name: '博主',
        avatar_large: 'https://tvax1.sinaimg.cn/avatar.jpg',
    },
};

describe('pickPostImages', () => {
    it('按 large → bmiddle → thumbnail 取图, 最多 9 张', () => {
        const pic_infos: WeiboPost['pic_infos'] = {};
        const pic_ids: string[] = [];
        for (let i = 0; i < 10; i += 1) {
            const id = `p${i}`;
            pic_ids.push(id);
            pic_infos[id] =
                i === 0
                    ? { bmiddle: { url: 'b0' } }
                    : i === 1
                      ? { thumbnail: { url: 't1' } }
                      : { large: { url: `l${i}` } };
        }
        expect(pickPostImages({ pic_ids, pic_infos })).toEqual([
            'b0',
            't1',
            'l2',
            'l3',
            'l4',
            'l5',
            'l6',
            'l7',
            'l8',
        ]);
    });

    it('缺少 pic_ids 时回退 pic_infos 的值', () => {
        expect(
            pickPostImages({
                pic_infos: {
                    a: { large: { url: 'la' } },
                    b: { thumbnail: { url: 'tb' } },
                },
            }),
        ).toEqual(['la', 'tb']);
    });
});

describe('pickAvatar', () => {
    it('优先 avatar_large, 回退 avatar_hd / profile_image_url', () => {
        expect(
            pickAvatar({
                avatar_large: 'large',
                avatar_hd: 'hd',
                profile_image_url: 'profile',
            }),
        ).toBe('large');
        expect(pickAvatar({ avatar_hd: 'hd' })).toBe('hd');
        expect(pickAvatar({ profile_image_url: 'profile' })).toBe(
            'profile',
        );
    });
});

describe('buildPostUrl', () => {
    it('由 uid 与 mid 构造原文链接', () => {
        expect(buildPostUrl(POST)).toBe('https://weibo.com/123/M1');
    });

    it('缺少 mid 时回退首页', () => {
        expect(buildPostUrl({ user: { idstr: '123' } })).toBe(
            'https://weibo.com/',
        );
    });
});

describe('buildPostCardHtml', () => {
    it('输出固定宽度卡片, 转义正文并剥离脚本', () => {
        const html = buildPostCardHtml(POST);
        expect(html).toContain(`width: ${CARD_WIDTH}px`);
        expect(html).toContain('博主');
        expect(html).toContain('正文');
        expect(html).not.toContain('<script>');
        expect(html).not.toContain('转发');
        expect(html).toContain('https://weibo.com/123/M1');
    });

    it('有图时生成网格, 有转发时生成转发块', () => {
        const html = buildPostCardHtml({
            ...POST,
            pic_ids: ['a', 'b'],
            pic_infos: {
                a: { large: { url: 'https://wx1.sinaimg.cn/a.jpg' } },
                b: { large: { url: 'https://wx1.sinaimg.cn/b.jpg' } },
            },
            retweeted_status: {
                text: '被转发正文',
                user: { screen_name: '原博主' },
            },
        });
        expect(html).toContain('images n2');
        expect(html).toContain('@原博主');
        expect(html).toContain('被转发正文');
    });
});

describe('buildPostText', () => {
    it('生成文本回退并带原链接与图片数量', () => {
        const text = buildPostText({
            ...POST,
            pic_ids: ['a'],
            pic_infos: { a: { large: { url: 'a.jpg' } } },
        });
        expect(text).toContain('博主');
        expect(text).toContain('正文');
        expect(text).toContain('1');
        expect(text).toContain('https://weibo.com/123/M1');
    });
});
