import { describe, expect, it } from 'vitest';
import {
    buildPostCardHtml,
    buildPostUrl,
    CARD_WIDTH,
    pickAllPostImages,
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

    it('pickAllPostImages 不截断张数', () => {
        const pic_infos: WeiboPost['pic_infos'] = {};
        const pic_ids: string[] = [];
        for (let i = 0; i < 12; i += 1) {
            const id = `p${i}`;
            pic_ids.push(id);
            pic_infos[id] = { large: { url: `l${i}` } };
        }
        expect(
            pickAllPostImages({ pic_ids, pic_infos }),
        ).toHaveLength(12);
    });

    it('缺少 pic_infos 时从 mix_media_info 取图并忽略视频项', () => {
        expect(
            pickAllPostImages({
                pic_ids: ['a', 'b'],
                mix_media_info: {
                    items: [
                        {
                            type: 'pic',
                            id: 'a',
                            data: {
                                large: {
                                    url: 'https://wx1.sinaimg.cn/large/a.jpg',
                                },
                            },
                        },
                        { type: 'video', id: 'v', data: {} },
                        {
                            type: 'pic',
                            id: 'b',
                            data: {
                                bmiddle: {
                                    url: 'https://wx2.sinaimg.cn/wap360/b.jpg',
                                },
                            },
                        },
                    ],
                },
            }),
        ).toEqual([
            'https://wx1.sinaimg.cn/large/a.jpg',
            'https://wx2.sinaimg.cn/wap360/b.jpg',
        ]);
    });

    it('优先 pic_infos, 其余用 mix_media_info 补足, 顺序跟随 pic_ids', () => {
        expect(
            pickAllPostImages({
                pic_ids: ['a', 'b'],
                pic_infos: { a: { large: { url: 'la' } } },
                mix_media_info: {
                    items: [
                        {
                            type: 'pic',
                            id: 'b',
                            data: { thumbnail: { url: 'tb' } },
                        },
                    ],
                },
            }),
        ).toEqual(['la', 'tb']);
    });

    it('两种来源都缺失时用 pic_id 拼 CDN 地址', () => {
        expect(
            pickAllPostImages({ pic_ids: ['005NIE2aly1abc'] }),
        ).toEqual([
            'https://wx1.sinaimg.cn/large/005NIE2aly1abc.jpg',
        ]);
    });

    it('mix_media_info 中未列入 pic_ids 的图片按原顺序追加', () => {
        expect(
            pickAllPostImages({
                pic_ids: ['a'],
                mix_media_info: {
                    items: [
                        {
                            type: 'pic',
                            id: 'a',
                            data: { large: { url: 'la' } },
                        },
                        {
                            type: 'pic',
                            id: 'b',
                            data: { large: { url: 'lb' } },
                        },
                    ],
                },
            }),
        ).toEqual(['la', 'lb']);
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
    });

    it('外框为灰色直角边框, 且不再输出底部 footer', () => {
        const html = buildPostCardHtml(POST);
        expect(html).toContain('border: 1px solid #d9d9d9');
        expect(html).not.toContain('查看原文');
        expect(html).not.toContain('https://weibo.com/123/M1');
        expect(html).not.toContain('class="footer"');
    });

    it('卡片时间格式化为北京时间', () => {
        const html = buildPostCardHtml({
            ...POST,
            created_at: 'Thu Dec 07 01:35:24 +0800 2023',
        });
        expect(html).toContain('2023/12/07 01:35:24');
        expect(html).not.toContain('Thu Dec 07');
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
        expect(html).toContain('background: #f7f7f7');
        expect(html).not.toContain('border-left: 3px');
    });

    it('超过 9 张时第 9 张叠加剩余张数角标', () => {
        const pic_infos: WeiboPost['pic_infos'] = {};
        const pic_ids: string[] = [];
        for (let i = 0; i < 12; i += 1) {
            const id = `p${i}`;
            pic_ids.push(id);
            pic_infos[id] = {
                large: {
                    url: `https://wx1.sinaimg.cn/large/p${i}.jpg`,
                },
            };
        }
        const html = buildPostCardHtml({
            ...POST,
            pic_ids,
            pic_infos,
        });
        expect(html).toContain('class="thumb"');
        expect(html).toContain('<span class="more">+3</span>');
    });

    it('不超过 9 张时不输出剩余张数角标', () => {
        const html = buildPostCardHtml({
            ...POST,
            pic_ids: ['a'],
            pic_infos: { a: { large: { url: 'la' } } },
        });
        expect(html).not.toContain('class="thumb"');
        expect(html).not.toContain('class="more"');
    });

    it('外链网页渲染为横向卡并标注来源', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: 2,
                object_type: 'webpage',
                page_title: 'B站视频标题',
                page_url:
                    'sinaweibo://browser?url=https%3A%2F%2Fshare.b23.tv%2FBV1TNn36wE9M%2F1',
                page_pic: 'https://i0.hdslb.com/cover.jpg',
            },
        });
        expect(html).toContain('class="link-card"');
        expect(html).toContain('class="link-cover"');
        expect(html).toContain('width: 160px');
        expect(html).toContain('B站视频标题');
        expect(html).toContain('哔哩哔哩');
        expect(html).not.toContain('class="video"');
    });

    it('微博站内 page_info 不渲染为外链卡', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: 2,
                page_title: '金阁寺烧了吗 的微博',
                page_url:
                    'sinaweibo://detail?mblogid=5355138546142994',
                page_pic: 'https://wx4.sinaimg.cn/cover.jpg',
            },
        });
        expect(html).not.toContain('class="link-card"');
    });

    it('视频标题回退到 page_title', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: 5,
                object_type: 'video',
                page_title: '_Leslieeeee_的微博视频',
                page_url:
                    'sinaweibo://infopage?containerid=2304445354971583938563',
                page_pic: 'https://wx2.sinaimg.cn/video.jpg',
            },
        });
        expect(html).toContain('_Leslieeeee_的微博视频');
    });

    it('重复的 page_info 只渲染在转发块内', () => {
        const page = {
            type: 5,
            object_type: 'video',
            page_title: '_Leslieeeee_的微博视频',
            page_url:
                'sinaweibo://infopage?containerid=2304445354971583938563',
            page_pic: 'https://wx2.sinaimg.cn/video.jpg',
        };
        const html = buildPostCardHtml({
            ...POST,
            text: '转发理由',
            page_info: page,
            retweeted_status: {
                text: '原动态正文',
                user: { screen_name: '原博主' },
                page_info: page,
            },
        });
        expect(html.match(/class="video"/g)).toHaveLength(1);
        const retweetIndex = html.indexOf('class="retweet"');
        const videoIndex = html.indexOf('class="video"');
        expect(videoIndex).toBeGreaterThan(retweetIndex);
    });

    it('主动态图片留在转发块外, 原动态图片在块内', () => {
        const html = buildPostCardHtml({
            ...POST,
            pic_ids: ['m'],
            pic_infos: {
                m: { large: { url: 'https://wx1.sinaimg.cn/m.jpg' } },
            },
            retweeted_status: {
                text: '原动态正文',
                user: { screen_name: '原博主' },
                pic_ids: ['r'],
                pic_infos: {
                    r: {
                        large: {
                            url: 'https://wx1.sinaimg.cn/r.jpg',
                        },
                    },
                },
            },
        });
        const retweetIndex = html.indexOf('class="retweet"');
        expect(
            html.indexOf('https://wx1.sinaimg.cn/m.jpg'),
        ).toBeLessThan(retweetIndex);
        expect(
            html.indexOf('https://wx1.sinaimg.cn/r.jpg'),
        ).toBeGreaterThan(retweetIndex);
    });

    it('原动态的外链卡渲染在转发块内', () => {
        const page = {
            type: 2,
            page_title: 'B站视频标题',
            page_url:
                'sinaweibo://browser?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1',
            page_pic: 'https://i0.hdslb.com/cover.jpg',
        };
        const html = buildPostCardHtml({
            ...POST,
            text: '转发理由',
            page_info: page,
            retweeted_status: {
                text: '原动态正文',
                user: { screen_name: '原博主' },
                page_info: page,
            },
        });
        expect(html.match(/class="link-card"/g)).toHaveLength(1);
        expect(html.indexOf('class="link-card"')).toBeGreaterThan(
            html.indexOf('class="retweet"'),
        );
        expect(html).toContain('哔哩哔哩');
    });
});
