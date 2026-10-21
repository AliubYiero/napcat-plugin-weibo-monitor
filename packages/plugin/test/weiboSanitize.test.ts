import { describe, expect, it } from 'vitest';
import {
    escapeHtml,
    htmlToText,
    parseCookieHeader,
    sanitizeWeiboHtml,
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
