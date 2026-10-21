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

    it('内嵌图片与文本按原顺序交替', () => {
        const segments = buildTextPresentation({
            ...POST,
            text: '前<img src="https://face.t.sinajs.cn/e.png">后',
        });
        expect(textOf(segments)).toContain('前');
        expect(textOf(segments)).toContain('后');
        expect(imagesOf(segments)).toEqual([
            'https://face.t.sinajs.cn/e.png',
        ]);
        const imageIndex = segments.findIndex(
            (segment) => segment.type === 'image',
        );
        expect(segments[imageIndex - 1]?.type).toBe('text');
        expect(segments[imageIndex + 1]?.type).toBe('text');
    });

    it('视频动态: 正文后追加标题与封面', () => {
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
                '标题: 视频标题',
            ].join('\n'),
        );
        expect(imagesOf(segments)).toEqual([
            'https://wx1.sinaimg.cn/cover.jpg',
        ]);
    });

    it('视频标题多字段回退, 全无则省略标题行', () => {
        expect(
            textOf(
                buildTextPresentation({
                    ...POST,
                    page_info: {
                        content2: '备用标题',
                        media_info: {},
                    },
                }),
            ),
        ).toContain('标题: 备用标题');
        expect(
            textOf(
                buildTextPresentation({
                    ...POST,
                    page_info: {
                        page_pic: 'https://wx1.sinaimg.cn/cover.jpg',
                        media_info: {},
                    },
                }),
            ),
        ).not.toContain('标题:');
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

    it('视频纯文本保留标题, 去掉封面', () => {
        const text = buildPlainText({
            ...POST,
            page_info: {
                title: '视频标题',
                page_pic: 'https://wx1.sinaimg.cn/cover.jpg',
                media_info: {},
            },
        });
        expect(text).toContain('标题: 视频标题');
        expect(text).not.toContain('cover.jpg');
    });
});
