/**
 * 指令触发判定的边界覆盖
 *
 * 范式: docs/instruction-pattern.md 的 "1.1 指令触发方式"
 */

import { describe, expect, it } from 'vitest';
import {
    resolveTriggerCommand,
    stripAtBotPrefix,
} from '../src/utils/atBotPrefix';

const SELF = '268491285';

describe('stripAtBotPrefix', () => {
    it('剥离消息开头匹配 selfId 的 at 段', () => {
        expect(
            stripAtBotPrefix(`[CQ:at,qq=${SELF}] #weibo ping`, SELF),
        ).toBe(' #weibo ping');
    });

    it('CQ 标记大小写不敏感', () => {
        expect(
            stripAtBotPrefix(`[cq:AT,qq=${SELF}] #weibo ping`, SELF),
        ).toBe(' #weibo ping');
    });

    it('qq 值允许双引号、单引号或裸值', () => {
        expect(stripAtBotPrefix(`[CQ:at,qq="${SELF}"] x`, SELF)).toBe(
            ' x',
        );
        expect(stripAtBotPrefix(`[CQ:at,qq='${SELF}'] x`, SELF)).toBe(
            ' x',
        );
    });

    it('属性顺序不限, 允许额外属性', () => {
        expect(
            stripAtBotPrefix(`[CQ:at,name=bot,qq=${SELF}] x`, SELF),
        ).toBe(' x');
        expect(
            stripAtBotPrefix(`[CQ:at,qq=${SELF},name=bot] x`, SELF),
        ).toBe(' x');
    });

    it('只剥离开头第一段, 后续 at 段保留', () => {
        expect(
            stripAtBotPrefix(
                `[CQ:at,qq=${SELF}][CQ:at,qq=999] x`,
                SELF,
            ),
        ).toBe('[CQ:at,qq=999] x');
    });

    it('qq 与 selfId 不相等时不剥离', () => {
        expect(stripAtBotPrefix('[CQ:at,qq=999] x', SELF)).toBe(
            '[CQ:at,qq=999] x',
        );
        // 前缀匹配但值更长, 属于不同 QQ 号
        expect(stripAtBotPrefix(`[CQ:at,qq=${SELF}0] x`, SELF)).toBe(
            `[CQ:at,qq=${SELF}0] x`,
        );
    });

    it('不在开头或不是 at 段时不剥离', () => {
        expect(stripAtBotPrefix(`x [CQ:at,qq=${SELF}]`, SELF)).toBe(
            `x [CQ:at,qq=${SELF}]`,
        );
        expect(
            stripAtBotPrefix('[CQ:image,file=a.png] x', SELF),
        ).toBe('[CQ:image,file=a.png] x');
    });

    it('selfId 缺失或为空时跳过剥离, 不抛异常', () => {
        expect(stripAtBotPrefix(`[CQ:at,qq=${SELF}] x`, '')).toBe(
            `[CQ:at,qq=${SELF}] x`,
        );
        expect(stripAtBotPrefix('', SELF)).toBe('');
    });

    it('只负责剥离, 不负责 trim', () => {
        expect(stripAtBotPrefix(`  [CQ:at,qq=${SELF}] x`, SELF)).toBe(
            `  [CQ:at,qq=${SELF}] x`,
        );
    });
});

describe('resolveTriggerCommand', () => {
    it('prefix: 以指令前缀开头时命中, 返回前缀后的参数文本', () => {
        expect(
            resolveTriggerCommand('#weibo ping', SELF, ['prefix']),
        ).toBe(' ping');
        expect(resolveTriggerCommand('#weibo', SELF, ['prefix'])).toBe(
            '',
        );
    });

    it('prefix: 带 @机器人 的普通前缀消息不命中 (不以指令前缀开头)', () => {
        expect(
            resolveTriggerCommand(
                `[CQ:at,qq=${SELF}] #weibo ping`,
                SELF,
                ['prefix'],
            ),
        ).toBeNull();
    });

    it('atBot: 剥离 @机器人 后仍带前缀才命中', () => {
        expect(
            resolveTriggerCommand(
                `[CQ:at,qq=${SELF}] #weibo ping`,
                SELF,
                ['atBot'],
            ),
        ).toBe(' ping');
    });

    it('atBot: 未带 @机器人 的普通前缀消息不命中 (严格独立)', () => {
        expect(
            resolveTriggerCommand('#weibo ping', SELF, ['atBot']),
        ).toBeNull();
    });

    it('atBot: @机器人 后未跟指令不命中', () => {
        expect(
            resolveTriggerCommand(`[CQ:at,qq=${SELF}] 在吗`, SELF, [
                'atBot',
            ]),
        ).toBeNull();
    });

    it('both: 两种形态都命中', () => {
        expect(
            resolveTriggerCommand('#weibo ping', SELF, [
                'prefix',
                'atBot',
            ]),
        ).toBe(' ping');
        expect(
            resolveTriggerCommand(
                `[CQ:at,qq=${SELF}] #weibo ping`,
                SELF,
                ['prefix', 'atBot'],
            ),
        ).toBe(' ping');
    });

    it('none: 未启用任何触发方式时恒不命中', () => {
        expect(
            resolveTriggerCommand('#weibo ping', SELF, []),
        ).toBeNull();
        expect(
            resolveTriggerCommand(
                `[CQ:at,qq=${SELF}] #weibo ping`,
                SELF,
                [],
            ),
        ).toBeNull();
    });

    it('atBot: selfId 缺失时无法剥离, 不命中', () => {
        expect(
            resolveTriggerCommand(
                `[CQ:at,qq=${SELF}] #weibo ping`,
                '',
                ['atBot'],
            ),
        ).toBeNull();
    });

    it('整体 trim 后再判定', () => {
        expect(
            resolveTriggerCommand('  #weibo ping  ', SELF, ['prefix']),
        ).toBe(' ping');
    });
});
