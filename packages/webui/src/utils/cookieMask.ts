/**
 * Cookie 掩码串
 *
 * 只接收 Cookie 名 (值永不出后端), 生成 `SUB=••••••; SUBP=••••••` 形式的只读展示串。
 * 名称缺失 (旧后端) 时回退为通用掩码。
 */

const VALUE_MASK = '••••••';
const GENERIC_MASK = '••••••••';

export function formatCookieMask(names: string[]): string {
    const valid = names
        .map((name) => name.trim())
        .filter((name) => name !== '');
    if (valid.length === 0) return GENERIC_MASK;
    return valid.map((name) => `${name}=${VALUE_MASK}`).join('; ');
}
