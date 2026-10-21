/**
 * 微博监听运行时状态
 *
 * 只存在于内存, 不落盘; 供状态页与 API 读取。持久化数据一律走 store。
 */

export interface TargetRuntime {
    lastError: string | null;
    lastPushedAt: number | null;
}

class WeiboRuntime {
    running = false;
    lastPollAt: number | null = null;
    nextPollAt: number | null = null;
    backoffUntil: number | null = null;
    lastError: string | null = null;

    private targets = new Map<string, TargetRuntime>();

    getTarget(uid: string): TargetRuntime {
        let target = this.targets.get(uid);
        if (!target) {
            target = { lastError: null, lastPushedAt: null };
            this.targets.set(uid, target);
        }
        return target;
    }

    setTargetError(uid: string, error: string): void {
        this.getTarget(uid).lastError = error;
    }

    clearTargetError(uid: string): void {
        this.getTarget(uid).lastError = null;
    }

    recordPush(uid: string): void {
        this.getTarget(uid).lastPushedAt = Date.now();
    }

    /** 清理已取消订阅博主的运行时残留 */
    prune(validUids: ReadonlySet<string>): void {
        for (const uid of this.targets.keys()) {
            if (!validUids.has(uid)) this.targets.delete(uid);
        }
    }
}

export const weiboRuntime = new WeiboRuntime();
