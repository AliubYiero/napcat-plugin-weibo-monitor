import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

const mocks = vi.hoisted(() => ({
    raw: {} as unknown,
}));

vi.mock('../src/core/state', () => ({
    pluginState: {
        loadDataFile: () => mocks.raw,
        saveDataFile: (_name: string, data: unknown) => {
            mocks.raw = data;
        },
    },
}));

const { WeiboCookieStore } = await import(
    '../src/store/WeiboCookieStore'
);

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function store() {
    return WeiboCookieStore.getInstance();
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
    mocks.raw = {};
    store().clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('WeiboCookieStore 保活状态', () => {
    it('保活失败计数按类型互斥累计', () => {
        store().recordKeepAliveFailure('failure');
        store().recordKeepAliveFailure('failure');
        expect(store().getData().keepAliveFailureCount).toBe(2);
        expect(store().getData().keepAliveInconclusiveCount).toBe(0);

        store().recordKeepAliveFailure('inconclusive');
        expect(store().getData().keepAliveFailureCount).toBe(0);
        expect(store().getData().keepAliveInconclusiveCount).toBe(1);
    });

    it('保存或保活后 20 小时内不再保活', () => {
        expect(store().needsKeepAlive(20 * HOUR)).toBe(true);

        store().saveCookies([]);
        expect(store().needsKeepAlive(20 * HOUR)).toBe(false);

        vi.setSystemTime(Date.now() + 21 * HOUR);
        expect(store().needsKeepAlive(20 * HOUR)).toBe(true);
    });

    it('有效探测会清零连续失败计数', () => {
        store().recordKeepAliveFailure('failure');
        store().recordKeepAliveFailure('inconclusive');

        store().recordProbe('valid', '页面登录态正常');

        expect(store().getData().keepAliveFailureCount).toBe(0);
        expect(store().getData().keepAliveInconclusiveCount).toBe(0);
    });

    it('保存新 Cookie 清除失效与告警状态', () => {
        store().markInvalid();
        store().markInvalidNotified();

        store().saveCookies([]);

        const data = store().getData();
        expect(data.invalid).toBe(false);
        expect(data.invalidSince).toBeNull();
        expect(data.invalidNotifiedAt).toBeNull();
        expect(data.lastKeepAliveAttemptAt).not.toBeNull();
    });

    it('接口成功不擅自解除失效', () => {
        store().markInvalid();

        store().markSuccess();

        expect(store().getData().invalid).toBe(true);

        store().markRecovered();

        expect(store().getData().invalid).toBe(false);
    });
});

describe('WeiboCookieStore 告警状态', () => {
    it('失效告警受每日冷却与投递重试节流约束', () => {
        store().markInvalid();
        expect(store().getData().invalidSince).not.toBeNull();
        expect(store().canNotifyInvalid(DAY)).toBe(true);

        store().markInvalidAlertAttempt();
        expect(store().canAttemptInvalidAlert(5 * 60_000)).toBe(
            false,
        );

        vi.setSystemTime(Date.now() + 6 * 60_000);
        expect(store().canAttemptInvalidAlert(5 * 60_000)).toBe(true);

        store().markInvalidNotified();
        expect(store().canNotifyInvalid(DAY)).toBe(false);

        vi.setSystemTime(Date.now() + DAY + 1);
        expect(store().canNotifyInvalid(DAY)).toBe(true);
    });

    it('恢复后清除失效与告警状态', () => {
        store().markInvalid();
        store().markInvalidNotified();

        store().markRecovered();

        const data = store().getData();
        expect(data.invalid).toBe(false);
        expect(data.invalidSince).toBeNull();
        expect(data.invalidNotifiedAt).toBeNull();
    });

    it('运行故障告警在恢复通知后不再待处理', () => {
        store().markRuntimeAlerted();
        expect(store().hadRuntimeAlert()).toBe(true);

        store().markRuntimeRecoveryNotified();
        expect(store().hadRuntimeAlert()).toBe(false);
    });
});

describe('WeiboCookieStore 旧数据迁移', () => {
    it('缺失字段回退为零值', async () => {
        vi.resetModules();
        mocks.raw = {
            cookies: [{ name: 'SUB', value: 'token' }],
            lastRefreshAt: 123,
            lastSuccessAt: null,
            lastValidatedAt: null,
            invalid: false,
            invalidNotifiedAt: null,
        };

        const mod = await import('../src/store/WeiboCookieStore');
        const data = mod.WeiboCookieStore.getInstance().getData();

        expect(data.cookies).toHaveLength(1);
        expect(data.lastRefreshAt).toBe(123);
        expect(data.invalidSince).toBeNull();
        expect(data.lastKeepAliveAt).toBeNull();
        expect(data.lastProbeResult).toBeNull();
        expect(data.keepAliveFailureCount).toBe(0);
        expect(data.runtimeAlertedAt).toBeNull();
    });
});
