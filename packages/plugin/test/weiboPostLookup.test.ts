import { describe, expect, it } from 'vitest';
import {
    normalizePostId,
    POST_COOLDOWN_MS,
    PostCooldown,
} from '../src/weibo/postLookup';

describe('normalizePostId', () => {
    it('接受纯数字与 mblogid', () => {
        expect(normalizePostId('5356201715958095')).toBe(
            '5356201715958095',
        );
        expect(normalizePostId('RnA3VoZYj')).toBe('RnA3VoZYj');
    });

    it('去除首尾空白', () => {
        expect(normalizePostId('  RnA3VoZYj  ')).toBe('RnA3VoZYj');
    });

    it('拒绝 URL、空格、符号与超长输入', () => {
        expect(
            normalizePostId('https://weibo.com/1/RnA3VoZYj'),
        ).toBeNull();
        expect(normalizePostId('abc def')).toBeNull();
        expect(normalizePostId('abc-def')).toBeNull();
        expect(normalizePostId('a'.repeat(21))).toBeNull();
        expect(normalizePostId('')).toBeNull();
    });
});

describe('PostCooldown', () => {
    it('首次请求不冷却, 记录后进入冷却', () => {
        const cooldown = new PostCooldown();
        expect(cooldown.isCoolingDown('group:1', 1000)).toBe(false);
        cooldown.touch('group:1', 1000);
        expect(cooldown.isCoolingDown('group:1', 1000)).toBe(true);
        expect(
            cooldown.isCoolingDown(
                'group:1',
                1000 + POST_COOLDOWN_MS - 1,
            ),
        ).toBe(true);
    });

    it('冷却到期后放行', () => {
        const cooldown = new PostCooldown();
        cooldown.touch('group:1', 1000);
        expect(
            cooldown.isCoolingDown(
                'group:1',
                1000 + POST_COOLDOWN_MS,
            ),
        ).toBe(false);
    });

    it('不同会话互不影响', () => {
        const cooldown = new PostCooldown();
        cooldown.touch('group:1', 1000);
        expect(cooldown.isCoolingDown('group:2', 1000)).toBe(false);
        expect(cooldown.isCoolingDown('private:1', 1000)).toBe(false);
    });

    it('clear 清空全部冷却', () => {
        const cooldown = new PostCooldown();
        cooldown.touch('group:1', 1000);
        cooldown.clear();
        expect(cooldown.isCoolingDown('group:1', 1000)).toBe(false);
    });
});
