import { describe, expect, it, vi } from 'vitest';
import {
    createPostDelivery,
    type PostDeliveryDeps,
} from '../src/services/weibo/postDelivery';
import type {
    WeiboMonitorTarget,
    WeiboPost,
} from '../src/weibo/types';

type Message = Parameters<PostDeliveryDeps['send']>[1];

const TARGET: WeiboMonitorTarget = { type: 'group', id: '10086' };

function post(overrides: Partial<WeiboPost> = {}): WeiboPost {
    return {
        idstr: '1',
        mblogid: 'abc',
        text: '正文',
        created_at: 'Tue Oct 27 12:00:00 +0800 2026',
        user: { screen_name: '博主' },
        ...overrides,
    };
}

const ATTACHMENT: Partial<WeiboPost> = {
    pic_ids: ['a'],
    pic_infos: {
        a: {
            large: { url: 'https://wx1.sinaimg.cn/a.jpg' },
        },
    },
};

function messageText(message: Message): string {
    if (typeof message === 'string') return message;
    if (!Array.isArray(message)) return '';
    return message
        .map((segment) =>
            segment.type === 'text' ? segment.data.text : '',
        )
        .join('');
}

function createHarness(
    options: {
        mode?: 'image' | 'text';
        card?: string | null;
        sendResults?: boolean[];
    } = {},
) {
    const sends: Array<{
        target: WeiboMonitorTarget;
        message: Message;
    }> = [];
    let sendIndex = 0;

    const hydrateTimeline = vi.fn(async (item: WeiboPost) => ({
        ...item,
        text: '时间线补拉正文',
    }));
    const hydrateStatus = vi.fn(async (item: WeiboPost) => ({
        ...item,
        text: '指定动态补拉正文',
    }));
    const renderCard = vi.fn(async () =>
        options.card === undefined ? 'base64://card' : options.card,
    );
    const send = vi.fn(
        async (
            target: WeiboMonitorTarget,
            message: Message,
        ): Promise<boolean> => {
            sends.push({ target, message });
            const result = options.sendResults?.[sendIndex];
            sendIndex += 1;
            return result ?? true;
        },
    );
    const sleep = vi.fn(async () => {});
    const logger = { warn: vi.fn() };

    const delivery = createPostDelivery({
        hydrateTimeline,
        hydrateStatus,
        renderCard,
        send,
        renderMode: () => options.mode ?? 'text',
        logger,
        sleep,
    });

    return {
        delivery,
        sends,
        hydrateTimeline,
        hydrateStatus,
        renderCard,
        send,
        sleep,
        logger,
    };
}

describe('PostDelivery.prepare', () => {
    it('按来源选择长文补拉规则', async () => {
        const harness = createHarness();

        await harness.delivery.prepare(post(), {
            source: 'timeline',
        });
        await harness.delivery.prepare(post(), {
            source: 'status',
        });

        expect(harness.hydrateTimeline).toHaveBeenCalledTimes(1);
        expect(harness.hydrateStatus).toHaveBeenCalledTimes(1);
    });

    it('文本模式用补拉后的正文, 不渲染卡片', async () => {
        const harness = createHarness({ mode: 'text' });

        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        expect(harness.renderCard).not.toHaveBeenCalled();
        expect(messageText(prepared.primary)).toContain(
            '时间线补拉正文',
        );
        expect(prepared.secondary).toBeUndefined();
    });

    it('图片模式渲染一次卡片并生成附图消息', async () => {
        const harness = createHarness({ mode: 'image' });

        const prepared = await harness.delivery.prepare(
            post(ATTACHMENT),
            { source: 'timeline' },
        );

        expect(harness.renderCard).toHaveBeenCalledTimes(1);
        expect(harness.renderCard).toHaveBeenCalledWith(
            expect.objectContaining({ text: '时间线补拉正文' }),
            undefined,
            undefined,
        );
        expect(prepared.primary).toBeDefined();
        expect(prepared.secondary).toBeDefined();
    });

    it('卡片渲染失败时降级为文本, 不产生附图消息', async () => {
        const harness = createHarness({
            mode: 'image',
            card: null,
        });

        const prepared = await harness.delivery.prepare(
            post(ATTACHMENT),
            { source: 'timeline' },
        );

        expect(messageText(prepared.primary)).toContain(
            '时间线补拉正文',
        );
        expect(prepared.secondary).toBeUndefined();
    });

    it('指定动态读取使用 status 补拉规则并保留身份缺省', async () => {
        const harness = createHarness({ mode: 'image' });

        await harness.delivery.prepare(post(), {
            source: 'status',
        });

        expect(harness.hydrateTimeline).not.toHaveBeenCalled();
        expect(harness.hydrateStatus).toHaveBeenCalledTimes(1);
        expect(harness.renderCard).toHaveBeenCalledWith(
            expect.objectContaining({
                text: '指定动态补拉正文',
            }),
            undefined,
            undefined,
        );
    });
});

describe('PostDelivery.deliver', () => {
    it('文本模式主消息发送成功', async () => {
        const harness = createHarness({ mode: 'text' });
        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        const result = await harness.delivery.deliver(
            [TARGET],
            prepared,
        );

        expect(result).toEqual({ pushed: 1, failed: 0 });
        expect(harness.sends).toHaveLength(1);
        expect(harness.sends[0].target).toEqual(TARGET);
    });

    it('主消息失败时回退纯文本并计为成功', async () => {
        const harness = createHarness({
            mode: 'text',
            sendResults: [false, true],
        });
        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        const result = await harness.delivery.deliver(
            [TARGET],
            prepared,
        );

        expect(result).toEqual({ pushed: 1, failed: 0 });
        expect(harness.sends).toHaveLength(2);
        expect(harness.sends[1].message).toBe(prepared.fallback);
    });

    it('主消息与回退都失败时计为失败', async () => {
        const harness = createHarness({
            mode: 'text',
            sendResults: [false, false],
        });
        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        const result = await harness.delivery.deliver(
            [TARGET],
            prepared,
        );

        expect(result).toEqual({ pushed: 0, failed: 1 });
        expect(harness.sends).toHaveLength(2);
    });

    it('主消息成功后发送附图, 附图失败不影响成功计数', async () => {
        const harness = createHarness({
            mode: 'image',
            sendResults: [true, false],
        });
        const prepared = await harness.delivery.prepare(
            post(ATTACHMENT),
            { source: 'timeline' },
        );

        const result = await harness.delivery.deliver(
            [TARGET],
            prepared,
        );

        expect(result).toEqual({ pushed: 1, failed: 0 });
        expect(harness.sends).toHaveLength(2);
        expect(harness.sleep).toHaveBeenCalledTimes(1);
        expect(harness.logger.warn).toHaveBeenCalledWith(
            '微博附图发送失败: group:10086',
        );
    });

    it('多目标共用一次准备, 目标之间留发送间隔', async () => {
        const harness = createHarness({ mode: 'text' });
        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        const result = await harness.delivery.deliver(
            [TARGET, { type: 'private', id: '42' }],
            prepared,
        );

        expect(result).toEqual({ pushed: 2, failed: 0 });
        expect(harness.renderCard).not.toHaveBeenCalled();
        expect(harness.sends).toHaveLength(2);
        expect(harness.sleep).toHaveBeenCalledTimes(1);
    });

    it('空目标不发送, 返回零计数', async () => {
        const harness = createHarness({ mode: 'text' });
        const prepared = await harness.delivery.prepare(post(), {
            source: 'timeline',
        });

        const result = await harness.delivery.deliver([], prepared);

        expect(result).toEqual({ pushed: 0, failed: 0 });
        expect(harness.sends).toEqual([]);
    });
});
