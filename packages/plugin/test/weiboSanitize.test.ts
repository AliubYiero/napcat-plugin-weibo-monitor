import { describe, expect, it } from 'vitest';
import {
    escapeHtml,
    htmlToText,
    parseCookieHeader,
    sanitizeWeiboHtml,
    sanitizeWeiboText,
} from '../src/weibo/sanitize';

describe('parseCookieHeader', () => {
    it('解析分号分隔的浏览器 Cookie', () => {
        const cookies = parseCookieHeader('SUB=a; SUBP=b');
        expect(cookies).toHaveLength(2);
        expect(cookies[0]).toMatchObject({
            name: 'SUB',
            value: 'a',
            domain: '.weibo.com',
            path: '/',
            sameSite: 'Lax',
        });
    });

    it('支持 Cookie: 前缀与多行输入', () => {
        expect(
            parseCookieHeader('Cookie: A=1\nB=2').map((c) => c.name),
        ).toEqual(['A', 'B']);
    });

    it('同名 Cookie 后者覆盖前者', () => {
        expect(parseCookieHeader('A=1; A=2')).toEqual([
            expect.objectContaining({ name: 'A', value: '2' }),
        ]);
    });

    it('支持 storageState JSON 并清洗字段', () => {
        const cookies = parseCookieHeader(
            JSON.stringify({
                cookies: [
                    {
                        name: 'SUB',
                        value: 'x',
                        domain: '.weibo.com',
                        path: '/',
                        sameSite: 'None',
                    },
                ],
                origins: [],
            }),
        );
        expect(cookies[0]).toMatchObject({
            name: 'SUB',
            value: 'x',
            sameSite: 'None',
            secure: true,
        });
    });

    it('非法输入返回空数组', () => {
        expect(parseCookieHeader('')).toEqual([]);
        expect(parseCookieHeader('not-a-cookie')).toEqual([]);
    });
});

describe('sanitizeWeiboHtml', () => {
    it('保留白名单链接与表情图', () => {
        const html = sanitizeWeiboHtml(
            'hi <a href="https://weibo.com/u/1">link</a> ' +
                '<img src="https://face.t.sinajs.cn/t4/emoji.png" onerror="x">',
        );
        expect(html).toContain('href="https://weibo.com/u/1"');
        expect(html).toContain('class="emoji"');
        expect(html).not.toContain('onerror');
    });

    it('剥离危险标签、脚本与非法域名图片', () => {
        const html = sanitizeWeiboHtml(
            '<script>alert(1)</script><b>粗</b>' +
                '<img src="https://evil.example/x.png">',
        );
        expect(html).toContain('粗');
        expect(html).not.toContain('script');
        expect(html).not.toContain('evil.example');
        expect(html).not.toContain('<b>');
    });

    it('javascript: 链接不保留', () => {
        expect(
            sanitizeWeiboHtml('<a href="javascript:alert(1)">x</a>'),
        ).toBe('x');
    });

    it('文本节点被转义', () => {
        expect(sanitizeWeiboHtml('a &lt; b')).toBe('a &lt; b');
    });

    it('纯文本 @、#话题# 与 URL 转为链接', () => {
        const html = sanitizeWeiboHtml(
            '@foo #话题# https://example.com/a?x=1&y=2',
        );
        expect(html).toContain('href="https://weibo.com/n/foo"');
        expect(html).toContain(
            'href="https://s.weibo.com/weibo?q=%23%E8%AF%9D%E9%A2%98%23"',
        );
        expect(html).toContain(
            'href="https://example.com/a?x=1&amp;y=2"',
        );
        expect(html.match(/<a /g)).toHaveLength(3);
    });

    it('连续话题标签全部转为链接', () => {
        const html = sanitizeWeiboHtml(
            '#育碧##育碧游戏##育碧40周年#',
        );
        expect(html.match(/<a /g)).toHaveLength(3);
        for (const label of ['#育碧#', '#育碧游戏#', '#育碧40周年#']) {
            expect(html).toContain(`>${label}</a>`);
        }
    });

    it('紧贴字母的 #话题# 也转链接', () => {
        const html = sanitizeWeiboHtml('abc#def#');
        expect(html).toBe(
            'abc<a href="https://s.weibo.com/weibo?q=%23def%23" target="_blank" rel="noopener noreferrer">#def#</a>',
        );
    });

    it('话题内部允许空格, 首尾空白不算话题', () => {
        const html = sanitizeWeiboHtml(
            '#Seventeen Hubert# 与 #5 and #6',
        );
        expect(html.match(/<a /g)).toHaveLength(1);
        expect(html).toContain('>#Seventeen Hubert#</a>');
    });

    it('邮箱不会被误判为 @ 提及', () => {
        const html = sanitizeWeiboHtml('联系 nox@vrp.live');
        expect(html).not.toContain('weibo.com/n/');
        expect(html).toContain('nox@vrp.live');
    });

    it('转发链的 // 与冒号保持为普通文本', () => {
        const html = sanitizeWeiboHtml('//@a://@b: 内容');
        expect(html).toContain('//<a href="https://weibo.com/n/a"');
        expect(html).toContain('://<a href="https://weibo.com/n/b"');
        expect(html.match(/<a /g)).toHaveLength(2);
    });

    it('已有链接不会被重复包裹', () => {
        const html = sanitizeWeiboHtml(
            '<a href="https://weibo.com/n/foo">@foo</a>',
        );
        expect(html.match(/<a /g)).toHaveLength(1);
        expect(html).toContain('>@foo</a>');
    });

    it('URL 末尾标点不进入链接', () => {
        const html = sanitizeWeiboHtml(
            '看 https://example.com/a，然后',
        );
        expect(html).toContain('href="https://example.com/a"');
        expect(html).toContain('</a>，然后');
    });
});

describe('sanitizeWeiboText', () => {
    it('表情图按 title 转为方括号文本, 不过滤中括号', () => {
        const html =
            '前<img alt="[可爱]" title="[可爱]" ' +
            'src="https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/78/201810_keai_mobile.png" />后';
        expect(sanitizeWeiboText(html)).toBe('前[可爱]后');
    });

    it('title 缺失时回退 alt', () => {
        const html =
            '前<img alt="[泪]" ' +
            'src="https://face.t.sinajs.cn/t4/appstyle/expression/ext/normal/87/201810_lei_mobile.png" />后';
        expect(sanitizeWeiboText(html)).toBe('前[泪]后');
    });

    it('图片+文本链接展开, 纯文本链接不展开', () => {
        const html =
            '<a target="_blank" href="https://weibo.com/p/1008088d56bf26ec2dece683f0fa7061b46749">' +
            '<img class="icon-link" title="#黄子韬[超话]#" ' +
            'src="https://h5.sinaimg.cn/upload/100/959/2020/05/09/timeline_card_small_super_default.png"/>' +
            '黄子韬超话</a> 带' +
            '<a href="//s.weibo.com/weibo?q=%23%E9%BB%84%E5%AD%90%E9%9F%AC%E7%B2%89%E4%B8%9D%E6%BE%84%E6%B8%85%23" target="_blank">' +
            '#黄子韬粉丝澄清#</a>';
        expect(sanitizeWeiboText(html)).toBe(
            '黄子韬超话(https://weibo.com/p/1008088d56bf26ec2dece683f0fa7061b46749) ' +
                '带#黄子韬粉丝澄清#',
        );
    });

    it('@用户与纯话题链接保持纯文本', () => {
        const html =
            '<a href="/n/foo">@foo</a> ' +
            '<a href="//s.weibo.com/weibo?q=%23APH%23">#APH#</a>';
        expect(sanitizeWeiboText(html)).toBe('@foo #APH#');
    });

    it('协议相对链接归一化为 https', () => {
        const html =
            '<a href="//s.weibo.com/weibo?q=test">' +
            '<img src="https://h5.sinaimg.cn/icon.png">话题</a>';
        expect(sanitizeWeiboText(html)).toBe(
            '话题(https://s.weibo.com/weibo?q=test)',
        );
    });

    it('图片域名的图片链接可展开', () => {
        const html =
            '<a href="https://wx4.sinaimg.cn/large/a.jpg">' +
            '<img class="icon-link" title="http://t.cn/x" ' +
            'src="https://h5.sinaimg.cn/upload/2015/01/21/20/timeline_card_small_photo_default.png"/>' +
            '查看图片</a>';
        expect(sanitizeWeiboText(html)).toBe(
            '查看图片(https://wx4.sinaimg.cn/large/a.jpg)',
        );
    });

    it('非法图片丢弃, 非法链接降级为纯文本', () => {
        expect(
            sanitizeWeiboText(
                '<img src="https://evil.example/x.png">',
            ),
        ).toBe('');
        expect(
            sanitizeWeiboText(
                '<a href="javascript:alert(1)">' +
                    '<img src="https://h5.sinaimg.cn/x.png">文本</a>',
            ),
        ).toBe('文本');
    });

    it('保持换行与文本顺序', () => {
        expect(sanitizeWeiboText('a<br>b')).toBe('a\nb');
    });
});

describe('htmlToText', () => {
    it('去标签、换行与实体解码', () => {
        expect(
            htmlToText('<p>a &amp; b</p><br>c<script>x</script>'),
        ).toBe('a & b\nc');
    });
});

describe('escapeHtml', () => {
    it('转义五个 HTML 特殊字符', () => {
        expect(escapeHtml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&#39;');
    });
});
