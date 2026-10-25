import { describe, expect, it } from 'vitest';
import {
    buildPostCardHtml,
    buildPostUrl,
    CARD_WIDTH,
    formatVideoDuration,
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

    it('卡片外壳使用新内边距与浅边框, 且不再输出底部 footer', () => {
        const html = buildPostCardHtml(POST);
        expect(html).toContain('padding: 16px 18px');
        expect(html).toContain(
            'border: 1px solid rgba(0, 0, 0, .05)',
        );
        expect(html).not.toContain('查看原文');
        expect(html).not.toContain('https://weibo.com/123/M1');
        expect(html).not.toContain('class="footer"');
    });

    it('顶部信息区顶部对齐, 正文与媒体统一缩进 62px', () => {
        const html = buildPostCardHtml(POST);
        expect(html).toContain('align-items: flex-start');
        expect(html).toContain('margin-right: 10px');
        expect(html).toContain('gap: 6px');
        expect(html).toContain('font-size: 15px; font-weight: 700');
        expect(html).toContain('font-size: 13px');
        expect(html).toContain('.body { margin-left: 62px; }');
    });

    it('转发块灰底铺满卡片, 文字左缘与正文对齐', () => {
        const html = buildPostCardHtml({
            ...POST,
            retweeted_status: {
                text: '被转发正文',
                user: { screen_name: '原博主' },
            },
        });
        expect(html).toContain(
            'margin: 6px -18px; padding: 6px 36px 6px 80px;',
        );
        expect(html).toContain('background: #f9f9f9');
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
        expect(html).toContain('background: #f9f9f9');
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

    it('视频块不渲染标题, 输出遮罩与播放信息', () => {
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
                play_count: '3万次播放',
                media_info: { duration: 126.386 },
            },
        });
        expect(html).toContain('class="video"');
        expect(html).toContain('class="video-shade"');
        expect(html).toContain('class="video-play"');
        expect(html).toContain('stroke-linejoin: round');
        expect(html).toContain('class="video-count">3万次播放');
        expect(html).toContain('class="video-duration">02:06');
        expect(html).toContain('max-height: 305px');
        expect(html).toContain('object-fit: contain');
        expect(html).not.toContain('class="video-title"');
        expect(html).not.toContain('_Leslieeeee_的微博视频');
    });

    it('桌面接口从 media_info.online_users 读取播放量', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: '11',
                object_type: 'video',
                page_pic: 'https://wx2.sinaimg.cn/video.jpg',
                media_info: {
                    duration: 16,
                    online_users: '502次观看',
                    online_users_number: 502,
                },
            },
        });
        expect(html).toContain('class="video-count">502次观看');
        expect(html).toContain('class="video-duration">00:16');
    });

    it('仅有 online_users_number 时补上观看单位', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: '11',
                object_type: 'video',
                page_pic: 'https://wx2.sinaimg.cn/video.jpg',
                media_info: { online_users_number: 8307 },
            },
        });
        expect(html).toContain('class="video-count">8307次观看');
    });

    it('无封面时整个视频块不渲染', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: 5,
                object_type: 'video',
                page_url: 'https://weibo.com/video/1',
                play_count: '1万次播放',
                media_info: { duration: 10 },
            },
        });
        expect(html).not.toContain('class="video"');
        expect(html).not.toContain('1万次播放');
    });

    it('播放量与时长缺失时按项省略', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '',
            page_info: {
                type: 5,
                object_type: 'video',
                page_pic: 'https://wx2.sinaimg.cn/video.jpg',
                media_info: {},
            },
        });
        expect(html).toContain('class="video"');
        expect(html).not.toContain('class="video-count"');
        expect(html).not.toContain('class="video-duration"');
    });

    it('转发块在媒体之后追加原动态时间', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '转发理由',
            retweeted_status: {
                created_at: 'Thu Dec 07 01:35:24 +0800 2023',
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
        expect(html).toContain('<div class="card has-retweet">');
        expect(html).toContain('class="rt-time"');
        expect(html).toContain('2023/12/07 01:35:24');
        expect(html.indexOf('class="rt-time"')).toBeGreaterThan(
            html.indexOf('https://wx1.sinaimg.cn/r.jpg'),
        );
    });

    it('原动态缺少时间时不渲染时间行', () => {
        const html = buildPostCardHtml({
            ...POST,
            text: '转发理由',
            retweeted_status: {
                text: '原动态正文',
                user: { screen_name: '原博主' },
            },
        });
        expect(html).not.toContain('class="rt-time"');
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

describe('formatVideoDuration', () => {
    it('向下取整为 m:ss, 满 1 小时为 h:mm:ss', () => {
        expect(formatVideoDuration(126.386)).toBe('02:06');
        expect(formatVideoDuration(59.9)).toBe('00:59');
        expect(formatVideoDuration(0)).toBe('00:00');
        expect(formatVideoDuration('3725')).toBe('1:02:05');
        expect(formatVideoDuration(3725)).toBe('1:02:05');
    });

    it('非法值返回空串', () => {
        expect(formatVideoDuration(undefined)).toBe('');
        expect(formatVideoDuration(null)).toBe('');
        expect(formatVideoDuration('')).toBe('');
        expect(formatVideoDuration('abc')).toBe('');
        expect(formatVideoDuration(-1)).toBe('');
    });
});

const LIKE_POST: WeiboPost = {
    idstr: 'L1',
    mid: 'L1',
    created_at: 'Wed Oct 21 15:05:18 +0800 2026',
    source: '微博网页版',
    text: '原微博正文',
    user: {
        idstr: '999',
        screen_name: '原博主',
        avatar_large: 'https://tvax1.sinaimg.cn/original-avatar.jpg',
    },
    title: { text: '她10-24赞过的微博' },
};

const LIKE_OPTIONS = {
    context: {
        kind: 'like' as const,
        likeDay: '2026-10-26',
        fetchedAt: Date.UTC(2026, 9, 26, 0),
    },
    identity: {
        screenName: '订阅博主',
        avatar: 'https://tvax1.sinaimg.cn/subscriber-avatar.jpg',
    },
};

const BIRTHDAY_POST: WeiboPost = {
    idstr: 'B1',
    mid: 'B1',
    created_at: 'Wed Oct 21 15:05:18 +0800 2026',
    source: '生日动态',
    text: '不应出现的正文',
    user: {
        idstr: '123',
        screen_name: '博主',
        avatar_large: 'https://tvax1.sinaimg.cn/avatar.jpg',
    },
    page_info: {
        title: '生日祝福',
        page_url: 'https://weibo.com/birthday/1',
        card_info: {
            pic_url: 'https://wx1.sinaimg.cn/birthday.jpg',
        },
    },
};

describe('点赞卡片', () => {
    it('外层用订阅博主身份, 信息栏展示点赞事件', () => {
        const html = buildPostCardHtml(LIKE_POST, LIKE_OPTIONS);
        expect(html).toContain('<div class="name">订阅博主</div>');
        expect(html).toContain(
            'https://tvax1.sinaimg.cn/subscriber-avatar.jpg',
        );
        expect(html).toContain('@原博主');
        expect(html).not.toContain(
            'https://tvax1.sinaimg.cn/original-avatar.jpg',
        );
        expect(html).toContain('2026/10/26 08:00:00');
        expect(html).toContain('点赞了微博');
        expect(html).not.toContain('微博网页版');
        expect(html).toContain('<div class="card has-retweet">');
        expect(html).toContain(
            '.card.has-retweet { padding-bottom: 0; }',
        );
    });

    it('原微博放在转发区块, 不输出原微博链接', () => {
        const html = buildPostCardHtml(
            {
                ...LIKE_POST,
                pic_ids: ['a'],
                pic_infos: {
                    a: {
                        large: {
                            url: 'https://wx1.sinaimg.cn/a.jpg',
                        },
                    },
                },
            },
            LIKE_OPTIONS,
        );
        expect(html).toContain('@原博主');
        expect(html).toContain('原微博正文');
        expect(html).toContain(
            'https://wx1.sinaimg.cn/a.jpg',
        );
        expect(html).not.toContain('查看原微博');
        expect(html).not.toContain('https://weibo.com/999/L1');
    });

    it('原动态是转发时展示 //@ 理由与最原始博文', () => {
        const html = buildPostCardHtml(
            {
                ...LIKE_POST,
                text: '被点赞博主的转发理由',
                retweeted_status: {
                    idstr: 'R1',
                    mid: 'R1',
                    created_at: 'Tue Oct 20 10:00:00 +0800 2026',
                    text: '最原始正文',
                    user: {
                        idstr: '777',
                        screen_name: '最原始博主',
                    },
                    pic_ids: ['root'],
                    pic_infos: {
                        root: {
                            large: {
                                url: 'https://wx1.sinaimg.cn/root.jpg',
                            },
                        },
                    },
                },
            },
            LIKE_OPTIONS,
        );

        expect(html).toContain(
            '//<a href="https://weibo.com/n/%E5%8E%9F%E5%8D%9A%E4%B8%BB" target="_blank" rel="noopener noreferrer">@原博主</a>:被点赞博主的转发理由',
        );
        expect(html).toContain('@最原始博主');
        expect(html).toContain('最原始正文');
        expect(html).toContain('https://wx1.sinaimg.cn/root.jpg');
        expect(html).not.toContain('查看原微博');
        expect(html).not.toContain('https://weibo.com/999/L1');
        expect(html.match(/class="retweet"/g)).toHaveLength(1);
    });

    it('多层转发时转发块落到最原始博文', () => {
        const root: WeiboPost = {
            idstr: 'ROOT',
            mid: 'ROOT',
            text: '最原始正文',
            user: { idstr: '777', screen_name: '最原始博主' },
        };
        const html = buildPostCardHtml(
            {
                ...LIKE_POST,
                text: '被点赞博主的转发理由',
                retweeted_status: {
                    idstr: 'MIDDLE',
                    mid: 'MIDDLE',
                    text: '中间转发理由',
                    retweeted_status: root,
                },
            },
            LIKE_OPTIONS,
        );

        expect(html).toContain('@最原始博主');
        expect(html).toContain('最原始正文');
        expect(html).not.toContain('中间转发理由');
    });
});

describe('生日卡片', () => {
    it('输出封面、标题与站内生日页链接', () => {
        const html = buildPostCardHtml(
            BIRTHDAY_POST,
            { context: { kind: 'birthday' } },
        );
        expect(html).toContain('birthday-card');
        expect(html).toContain(
            'https://wx1.sinaimg.cn/birthday.jpg',
        );
        expect(html).toContain('生日祝福');
        expect(html).toContain('https://weibo.com/birthday/1');
        expect(html).toContain('查看生日动态');
        expect(html).not.toContain('不应出现的正文');
    });

    it('封面回退嵌套 pic_big, 标题回退 page_info', () => {
        const html = buildPostCardHtml(
            {
                ...BIRTHDAY_POST,
                page_info: {
                    page_url: 'https://new.vip.weibo.cn/birthday/2',
                    content1: '备用标题',
                    card_info: {
                        page_info: {
                            pic_info: {
                                pic_big: {
                                    url: 'https://wx2.sinaimg.cn/fallback.jpg',
                                },
                            },
                        },
                    },
                },
            },
            { context: { kind: 'birthday' } },
        );
        expect(html).toContain(
            'https://wx2.sinaimg.cn/fallback.jpg',
        );
        expect(html).toContain('备用标题');
        expect(html).toContain(
            'https://new.vip.weibo.cn/birthday/2',
        );
    });

    it('无创建时间与地区时不输出占位', () => {
        const html = buildPostCardHtml(
            {
                ...BIRTHDAY_POST,
                created_at: undefined,
                region_name: '北京',
            },
            { context: { kind: 'birthday' } },
        );
        expect(html).not.toContain('未知时间');
        expect(html).not.toContain('北京');
    });
});
