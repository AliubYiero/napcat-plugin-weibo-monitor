export const POST_COOLDOWN_MS = 5_000;

export function normalizePostId(raw: string): string | null {
    const id = raw.trim();
    return /^[A-Za-z0-9]{1,20}$/.test(id) ? id : null;
}

export class PostCooldown {
    private readonly lastAt = new Map<string, number>();

    isCoolingDown(key: string, now = Date.now()): boolean {
        const last = this.lastAt.get(key);
        return last !== undefined && now - last < POST_COOLDOWN_MS;
    }

    touch(key: string, now = Date.now()): void {
        this.lastAt.set(key, now);
    }

    clear(): void {
        this.lastAt.clear();
    }
}
