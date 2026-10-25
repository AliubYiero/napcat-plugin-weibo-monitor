import { describe, expect, it } from 'vitest';
import {
    buildImagePresentation,
    buildPlainText,
    buildPushHeader,
    buildTextPresentation,
    type PresentationSegment,
    resolvePostEvent,
} from '../src/weibo/presentation';
import { formatWeiboTime } from '../src/weibo/time';
import type { WeiboPost } from '../src/weibo/types';

const POST: WeiboPost = {
    idstr: 'M1',
    mid: 'M1',
    created_at: 'Wed Oct 21 15:05:18 +0800 2026',
    text: '正文',
    user: {
        idstr: '123',
        screen_name: '博主',
    },
};

const RETWEET: WeiboPost = {
    idstr: 'R1',
    mid: 'R1',
    created_at: 'Tue Oct 20 20:35:45 +0800 2026',
    text: '原动态正文',
    user: {
        idstr: '999',
        screen_name: '原博主',
    },
};

function textOf(segments: PresentationSegment[]): string {
    return segments
        .filter(
            (
                segment,
            ): segment is Extract<
                PresentationSegment,
                { type: 'text' }
            > => segment.type === 'text',
        )
        .map((segment) => segment.text)
        .join('');
}

function imagesOf(segments: PresentationSegment[]): string[] {
    return segments
        .filter(
            (
                segment,
            ): segment is Extract<
                PresentationSegment,
                { type: 'image' }
            > => segment.type === 'image',
        )
        .map((segment) => segment.url);
}

describe('formatWeiboTime', () => {
    it('解析微博时间并格式化为北京时间', () => {
        expect(
            formatWeiboTime('Thu Dec 07 01:35:24 +0800 2023'),
        ).toBe('2023/12/07 01:35:24');
        expect(
            formatWeiboTime('Wed Oct 21 15:05:18 +0800 2026'),
        ).toBe('2026/10/21 15:05:18');
    });

    it('按 +0800 换算其它时区', () => {
        expect(
            formatWeiboTime('Thu Dec 07 01:35:24 +0000 2023'),
        ).toBe('2023/12/07 09:35:24');
    });

    it('支持 ISO 时间回退', () => {
        expect(formatWeiboTime('2026-10-21T15:05:18+08:00')).toBe(
            '2026/10/21 15:05:18',
        );
    });

    it('缺失或无法解析时返回未知时间', () => {
        expect(formatWeiboTime(undefined)).toBe('未知时间');
        expect(formatWeiboTime('')).toBe('未知时间');
        expect(formatWeiboTime('not-a-date')).toBe('未知时间');
        expect(
            formatWeiboTime('Thu Feb 30 01:35:24 +0800 2023'),
        ).toBe('未知时间');
    });
});

describe('resolvePostEvent', () => {
    it('普通动态为发送了微博', () => {
        expect(resolvePostEvent(POST)).toBe('发送了微博');
    });

    it('转发动态为转发了微博', () => {
        expect(
            resolvePostEvent({
                ...POST,
                retweeted_status: RETWEET,
            }),
        ).toBe('转发了微博');
        expect(
            resolvePostEvent({
                ...POST,
                retweeted_status_id: 'R1',
            }),
        ).toBe('转发了微博');
    });

    it('视频动态为发布了视频', () => {
        expect(
            resolvePostEvent({
                ...POST,
                page_info: { media_info: {} },
            }),
        ).toBe('发布了视频');
        expect(
            resolvePostEvent({
                ...POST,
                page_info: { object_type: 'video' },
            }),
        ).toBe('发布了视频');
        expect(
            resolvePostEvent({
                ...POST,
                page_info: { page_url: 'https://weibo.com/video/1' },
            }),
        ).toBe('发布了视频');
    });

    it('转发优先于视频', () => {
        expect(
            resolvePostEvent({
                ...POST,
                retweeted_status: RETWEET,
                page_info: { media_info: {} },
            }),
        ).toBe('转发了微博');
    });
});

describe('buildPushHeader', () => {
    it('时间 + 昵称 + 事件, 」与事件间无空格', () => {
        expect(buildPushHeader(POST)).toBe(
            '[2026/10/21 15:05:18] 「博主」发送了微博',
        );
        expect(
            buildPushHeader({
                ...POST,
                retweeted_status: RETWEET,
            }),
        ).toBe('[2026/10/21 15:05:18] 「博主」转发了微博');
    });
});

describe('buildTextPresentation', () => {
    it('普通动态: 标题行 + 链接 + 正文', () => {
        const text = textOf(buildTextPresentation(POST));
        expect(text).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」发送了微博',
                'https://weibo.com/123/M1',
                '正文',
            ].join('\n'),
        );
    });

    it('正文为空时只保留标题行与链接', () => {
        expect(
            textOf(
                buildTextPresentation({
                    ...POST,
                    text: '',
                    text_raw: '',
                }),
            ),
        ).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」发送了微博',
                'https://weibo.com/123/M1',
            ].join('\n'),
        );
    });

    it('转发动态: 分隔线上下各留一个空行, 后接原动态', () => {
        const text = textOf(
            buildTextPresentation({
                ...POST,
                retweeted_status: RETWEET,
            }),
        );
        expect(text).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」转发了微博',
                'https://weibo.com/123/M1',
                '正文',
                '',
                '────────',
                '',
                '[2026/10/20 20:35:45] 「原博主」',
                'https://weibo.com/999/R1',
                '原动态正文',
            ].join('\n'),
        );
    });

    it('原动态已删除时只输出提示, 分割线上下同样留空行', () => {
        const text = textOf(
            buildTextPresentation({
                ...POST,
                retweeted_status_id: 'R1',
            }),
        );
        expect(text).toContain('\n\n────────\n\n原微博已删除');
        expect(text).not.toContain('https://weibo.com/999/R1');
    });

    it('内嵌表情转为文本, 不再产生图片段', () => {
        const segments = buildTextPresentation({
            ...POST,
            text:
                '前<img alt="[泪]" title="[泪]" ' +
                'src="https://face.t.sinajs.cn/e.png">后',
        });
        expect(textOf(segments)).toContain('前[泪]后');
        expect(imagesOf(segments)).toEqual([]);
    });

    it('含图片链接展开, 纯文本话题保持', () => {
        const segments = buildTextPresentation({
            ...POST,
            text:
                '<a href="https://weibo.com/p/100808abc">' +
                '<img class="icon-link" title="#超话#" ' +
                'src="https://h5.sinaimg.cn/icon.png"/>超话</a> 带' +
                '<a href="//s.weibo.com/weibo?q=test">#话题#</a>',
        });
        expect(textOf(segments)).toContain(
            '超话(https://weibo.com/p/100808abc) 带#话题#',
        );
        expect(imagesOf(segments)).toEqual([]);
    });

    it('视频动态: 正文后仅追加封面, 不再渲染标题', () => {
        const segments = buildTextPresentation({
            ...POST,
            page_info: {
                title: '视频标题',
                page_pic: 'https://wx1.sinaimg.cn/cover.jpg',
                media_info: {},
            },
        });
        const text = textOf(segments);
        expect(text).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」发布了视频',
                'https://weibo.com/123/M1',
                '正文',
            ].join('\n'),
        );
        expect(text).not.toContain('标题:');
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/cover.jpg',
        ]);
    });

    it('视频标题字段不再产生文本行', () => {
        const segments = buildTextPresentation({
            ...POST,
            page_info: {
                title: '视频标题',
                content2: '备用标题',
                page_pic: 'https://wx1.sinaimg.cn/cover.jpg',
                media_info: {},
            },
        });
        const text = textOf(segments);
        expect(text).not.toContain('标题:');
        expect(text).not.toContain('视频标题');
        expect(text).not.toContain('备用标题');
    });

    it('附图追加在正文之后, 转发时先转发者后原动态', () => {
        const segments = buildTextPresentation({
            ...POST,
            pic_ids: ['a'],
            pic_infos: {
                a: { large: { url: 'https://wx1.sinaimg.cn/a.jpg' } },
            },
            retweeted_status: {
                ...RETWEET,
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
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/a.jpg',
            'https://wx1.sinaimg.cn/r.jpg',
        ]);
        const first = segments.findIndex(
            (segment) => segment.type === 'image',
        );
        expect(segments[first - 1]?.type).toBe('text');
    });

    it('附图不限张数', () => {
        const pic_ids: string[] = [];
        const pic_infos: WeiboPost['pic_infos'] = {};
        for (let i = 0; i < 12; i += 1) {
            const id = `p${i}`;
            pic_ids.push(id);
            pic_infos[id] = {
                large: { url: `https://wx1.sinaimg.cn/${id}.jpg` },
            };
        }
        const segments = buildTextPresentation({
            ...POST,
            pic_ids,
            pic_infos,
        });
        expect(imagesOf(segments)).toHaveLength(12);
    });
});

describe('buildImagePresentation', () => {
    it('图片模式: 标题行 + 链接 + 整卡 + 转发者附图', () => {
        const segments = buildImagePresentation(
            {
                ...POST,
                pic_ids: ['a'],
                pic_infos: {
                    a: {
                        large: {
                            url: 'https://wx1.sinaimg.cn/a.jpg',
                        },
                    },
                },
                retweeted_status: {
                    ...RETWEET,
                    pic_ids: ['r'],
                    pic_infos: {
                        r: {
                            large: {
                                url: 'https://wx1.sinaimg.cn/r.jpg',
                            },
                        },
                    },
                },
            },
            'base64://card',
        );
        expect(textOf(segments)).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」转发了微博',
                'https://weibo.com/123/M1',
            ].join('\n'),
        );
        expect(imagesOf(segments)).toEqual([
            'base64://card',
            'https://wx1.sinaimg.cn/a.jpg',
        ]);
    });

    it('卡片渲染失败时回退文本并补齐原动态附图', () => {
        const segments = buildImagePresentation(
            {
                ...POST,
                retweeted_status: {
                    ...RETWEET,
                    pic_ids: ['r'],
                    pic_infos: {
                        r: {
                            large: {
                                url: 'https://wx1.sinaimg.cn/r.jpg',
                            },
                        },
                    },
                },
            },
            null,
        );
        expect(textOf(segments)).toContain('原动态正文');
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/r.jpg',
        ]);
    });
});

describe('buildPlainText', () => {
    it('纯文本降级去掉所有图片段, 保留标题/链接/正文/原动态', () => {
        const text = buildPlainText({
            ...POST,
            pic_ids: ['a'],
            pic_infos: {
                a: {
                    large: {
                        url: 'https://wx1.sinaimg.cn/a.jpg',
                    },
                },
            },
            retweeted_status: {
                ...RETWEET,
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
        expect(text).toContain('转发了微博');
        expect(text).toContain('https://weibo.com/123/M1');
        expect(text).toContain('原动态正文');
        expect(text).toContain('https://weibo.com/999/R1');
        expect(text).not.toContain('sinaimg.cn');
    });

    it('视频纯文本去掉标题与封面', () => {
        const text = buildPlainText({
            ...POST,
            page_info: {
                title: '视频标题',
                page_pic: 'https://wx1.sinaimg.cn/cover.jpg',
                media_info: {},
            },
        });
        expect(text).not.toContain('标题:');
        expect(text).not.toContain('视频标题');
        expect(text).not.toContain('cover.jpg');
    });
});

const LIKE: WeiboPost = {
    idstr: 'L1',
    mid: 'L1',
    created_at: 'Wed Oct 21 15:05:18 +0800 2026',
    source: '微博网页版',
    text: '原微博正文',
    user: { idstr: '999', screen_name: '原博主' },
    title: { text: '她10-24赞过的微博' },
};

const LIKE_OPTIONS = {
    context: {
        kind: 'like' as const,
        likeDay: '2026-10-26',
        fetchedAt: Date.UTC(2026, 9, 26, 0),
    },
    identity: { screenName: '博主', avatar: '' },
};

const BIRTHDAY: WeiboPost = {
    idstr: 'B1',
    mid: 'B1',
    created_at: 'Wed Oct 21 15:05:18 +0800 2026',
    source: '生日动态',
    user: { idstr: '123', screen_name: '博主' },
    page_info: {
        title: '生日祝福',
        page_url: 'https://weibo.com/birthday/1',
        card_info: {
            pic_url: 'https://wx1.sinaimg.cn/birthday.jpg',
        },
    },
};

const BIRTHDAY_OPTIONS = {
    context: { kind: 'birthday' as const },
    identity: { screenName: '博主', avatar: '' },
};

describe('点赞动态', () => {
    it('外层为订阅博主, 原微博用日期去重但展示原时间', () => {
        expect(resolvePostEvent(LIKE, 'like')).toBe('点赞了微博');
        expect(buildPushHeader(LIKE, LIKE_OPTIONS)).toBe(
            '[2026/10/26 08:00:00] 「博主」点赞了微博',
        );
        expect(textOf(buildTextPresentation(LIKE, LIKE_OPTIONS))).toBe(
            [
                '[2026/10/26 08:00:00] 「博主」点赞了微博',
                '',
                '────────',
                '',
                '[2026/10/21 15:05:18] 「原博主」',
                '原微博正文',
            ].join('\n'),
        );
    });

    it('原动态是转发时输出 //@ 理由与最原始博文', () => {
        const segments = buildTextPresentation(
            {
                ...LIKE,
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

        expect(textOf(segments)).toBe(
            [
                '[2026/10/26 08:00:00] 「博主」点赞了微博',
                '//@原博主:被点赞博主的转发理由',
                '',
                '────────',
                '',
                '[2026/10/20 10:00:00] 「最原始博主」',
                '最原始正文',
            ].join('\n'),
        );
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/root.jpg',
        ]);
        expect(textOf(segments)).not.toContain('https://weibo.com/');
    });

    it('多层转发取最原始博文', () => {
        const segments = buildTextPresentation(
            {
                ...LIKE,
                text: '被点赞博主的转发理由',
                retweeted_status: {
                    idstr: 'MIDDLE',
                    text: '中间转发理由',
                    retweeted_status: {
                        idstr: 'ROOT',
                        created_at: 'Tue Oct 20 10:00:00 +0800 2026',
                        text: '最原始正文',
                        user: { screen_name: '最原始博主' },
                    },
                },
            },
            LIKE_OPTIONS,
        );

        expect(textOf(segments)).toContain('最原始正文');
        expect(textOf(segments)).not.toContain('中间转发理由');
    });

    it('标题缺失点赞日期时不输出时间括号', () => {
        const header = buildPushHeader(
            { ...LIKE, title: { text: '赞过的微博' } },
            {
                context: { kind: 'like', likeDay: null },
                identity: LIKE_OPTIONS.identity,
            },
        );
        expect(header).toBe('「博主」点赞了微博');
    });

    it('文本模式追加原微博附图', () => {
        const segments = buildTextPresentation(
            {
                ...LIKE,
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
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/a.jpg',
        ]);
    });

    it('图片模式只发卡片, 不再重复原微博附图', () => {
        const segments = buildImagePresentation(
            {
                ...LIKE,
                pic_ids: ['a'],
                pic_infos: {
                    a: {
                        large: {
                            url: 'https://wx1.sinaimg.cn/a.jpg',
                        },
                    },
                },
            },
            'base64://card',
            LIKE_OPTIONS,
        );
        expect(textOf(segments)).toBe(
            '[2026/10/26 08:00:00] 「博主」点赞了微博',
        );
        expect(imagesOf(segments)).toEqual(['base64://card']);
    });

    it('纯文本降级不输出来源与原微博链接', () => {
        const text = buildPlainText(LIKE, LIKE_OPTIONS);
        expect(text).toContain('点赞了微博');
        expect(text).not.toContain('来源：微博网页版');
        expect(text).not.toContain('https://weibo.com/999/L1');
        expect(text).toContain('原微博正文');
    });
});

describe('生日动态', () => {
    it('输出事件、标题与生日页链接', () => {
        expect(resolvePostEvent(BIRTHDAY, 'birthday')).toBe(
            '发布了生日动态',
        );
        expect(buildPushHeader(BIRTHDAY, BIRTHDAY_OPTIONS)).toBe(
            '[2026/10/21 15:05:18] 「博主」发布了生日动态',
        );
        expect(
            textOf(buildTextPresentation(BIRTHDAY, BIRTHDAY_OPTIONS)),
        ).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」发布了生日动态',
                '生日祝福',
                'https://weibo.com/birthday/1',
            ].join('\n'),
        );
    });

    it('文本模式不追加正文或封面', () => {
        const segments = buildTextPresentation(
            {
                ...BIRTHDAY,
                text: '不应出现的正文',
                pic_ids: ['cover'],
            },
            BIRTHDAY_OPTIONS,
        );
        expect(textOf(segments)).not.toContain('不应出现的正文');
        expect(imagesOf(segments)).toEqual([]);
    });

    it('图片模式只发卡片, 不重复生日封面', () => {
        const segments = buildImagePresentation(
            BIRTHDAY,
            'base64://card',
            BIRTHDAY_OPTIONS,
        );
        expect(textOf(segments)).toBe(
            [
                '[2026/10/21 15:05:18] 「博主」发布了生日动态',
                'https://weibo.com/birthday/1',
            ].join('\n'),
        );
        expect(imagesOf(segments)).toEqual(['base64://card']);
    });
});
