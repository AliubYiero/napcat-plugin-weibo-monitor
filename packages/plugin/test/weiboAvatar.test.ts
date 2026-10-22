/**
 * 头像缓存的纯函数判定
 *
 * 关注两件事: 非图片内容不能落盘; 远程 URL 变了要重下、没变不能反复重下。
 */

import { describe, expect, it } from 'vitest';
import {
    avatarFilename,
    avatarNeedsRefresh,
    pickAvatarExtension,
} from '../src/weibo/avatar';

describe('pickAvatarExtension', () => {
    it('识别常见图片类型 (忽略大小写与参数)', () => {
        expect(pickAvatarExtension('image/jpeg')).toBe('jpg');
        expect(pickAvatarExtension('IMAGE/PNG; charset=binary')).toBe(
            'png',
        );
        expect(pickAvatarExtension('image/webp')).toBe('webp');
    });

    it('非图片与缺失一律拒绝', () => {
        expect(pickAvatarExtension('text/html')).toBeNull();
        expect(
            pickAvatarExtension('application/octet-stream'),
        ).toBeNull();
        expect(pickAvatarExtension(null)).toBeNull();
    });
});

describe('avatarFilename', () => {
    it('按 uid + 扩展名定位, 同 uid 不同扩展名可区分', () => {
        expect(avatarFilename('123456', 'jpg')).toBe('123456.jpg');
        expect(avatarFilename('123456', 'webp')).toBe('123456.webp');
    });
});

describe('avatarNeedsRefresh', () => {
    it('没有本地副本时需要下载', () => {
        expect(
            avatarNeedsRefresh({
                avatar: 'https://example.com/a.jpg',
            }),
        ).toBe(true);
    });

    it('远程 URL 变更后需要重新下载', () => {
        expect(
            avatarNeedsRefresh({
                avatar: 'https://example.com/new.jpg',
                avatarPath: '123.jpg',
                avatarSource: 'https://example.com/old.jpg',
            }),
        ).toBe(true);
    });

    it('源一致且已有副本时不再下载', () => {
        expect(
            avatarNeedsRefresh({
                avatar: 'https://example.com/a.jpg',
                avatarPath: '123.jpg',
                avatarSource: 'https://example.com/a.jpg',
            }),
        ).toBe(false);
    });

    it('没有远程 URL 时视为无需下载 (不做空请求)', () => {
        expect(avatarNeedsRefresh({ avatar: '' })).toBe(false);
    });
});
