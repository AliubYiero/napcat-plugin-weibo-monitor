const MONTHS: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12,
};

const BEIJING_OFFSET_MINUTES = 8 * 60;
const WEIBO_DATE_RE =
    /^[A-Za-z]{3}\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+([+-])(\d{2})(\d{2})\s+(\d{4})$/;

/**
 * 微博时间 → `YYYY/MM/DD hh:mm:ss` (固定北京时间)
 *
 * 无法解析时返回「未知时间」, 不抛错。
 */
export function formatWeiboTime(raw: string | undefined): string {
    if (!raw) return '未知时间';
    const text = raw.trim();
    if (!text) return '未知时间';

    const matched = parseWeiboDate(text);
    if (matched) return formatBeijing(matched);
    if (WEIBO_DATE_RE.test(text)) return '未知时间';

    const fallback = new Date(text);
    if (Number.isNaN(fallback.getTime())) return '未知时间';
    return formatBeijing(
        new Date(
            fallback.getTime() + BEIJING_OFFSET_MINUTES * 60_000,
        ),
    );
}

/**
 * 微博时间 → 毫秒时间戳 (固定北京时间)
 *
 * 仅用于同格式时间之间的先后比较; 无法解析时返回 null。
 */
export function parseWeiboTimeMs(raw: string | undefined): number | null {
    const formatted = formatWeiboTime(raw);
    if (formatted === '未知时间') return null;
    const parsed = Date.parse(
        `${formatted.replace(/\//g, '-').replace(' ', 'T')}+08:00`,
    );
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * 点赞日期 → 展示时间 (北京时间)
 *
 * 点赞日期与拉取日期同天时, 用首次拉到的轮询时间补足时分秒;
 * 不同天只显示日期; 日期缺失或非法时返回空串 (不显示「未知时间」)。
 */
export function formatLikeTime(
    likeDay: string | null | undefined,
    fetchedAt: number | undefined,
): string {
    if (!likeDay) return '';
    const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(likeDay);
    if (!matched) return '';
    const year = Number(matched[1]);
    const month = Number(matched[2]);
    const datePart = Number(matched[3]);
    const daysInMonth = new Date(
        Date.UTC(year, month, 0),
    ).getUTCDate();
    if (
        month < 1 ||
        month > 12 ||
        datePart < 1 ||
        datePart > daysInMonth
    ) {
        return '';
    }

    const at = fetchedAt ?? Date.now();
    const date = new Date(at + BEIJING_OFFSET_MINUTES * 60_000);
    const today = [
        date.getUTCFullYear(),
        pad(date.getUTCMonth() + 1),
        pad(date.getUTCDate()),
    ].join('-');

    const day = `${matched[1]}/${matched[2]}/${matched[3]}`;
    if (today !== likeDay) return day;
    return `${day} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function parseWeiboDate(raw: string): Date | null {
    const match = WEIBO_DATE_RE.exec(raw);
    if (!match) return null;

    const month = MONTHS[match[1].toLowerCase()];
    const day = Number(match[2]);
    const hour = Number(match[3]);
    const minute = Number(match[4]);
    const second = Number(match[5]);
    const offsetSign = match[6] === '-' ? -1 : 1;
    const offsetHour = Number(match[7]);
    const offsetMinute = Number(match[8]);
    const year = Number(match[9]);

    if (!month) return null;
    if (hour > 23 || minute > 59 || second > 59) return null;
    if (offsetHour > 23 || offsetMinute > 59) return null;

    const daysInMonth = new Date(
        Date.UTC(year, month, 0),
    ).getUTCDate();
    if (day < 1 || day > daysInMonth) return null;

    const offsetMinutes =
        offsetSign * (offsetHour * 60 + offsetMinute);
    const utcMs =
        Date.UTC(year, month - 1, day, hour, minute, second) -
        offsetMinutes * 60_000;

    return new Date(utcMs + BEIJING_OFFSET_MINUTES * 60_000);
}

function formatBeijing(date: Date): string {
    return (
        [
            date.getUTCFullYear(),
            pad(date.getUTCMonth() + 1),
            pad(date.getUTCDate()),
        ].join('/') +
        ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
    );
}

function pad(value: number): string {
    return String(value).padStart(2, '0');
}
