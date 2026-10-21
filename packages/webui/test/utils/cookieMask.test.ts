/**
 * Cookie 掩码串: 只吃 Cookie 名, 值不参与。
 */

import { describe, expect, it } from 'vitest';
import { formatCookieMask } from '../../src/utils/cookieMask';

describe('formatCookieMask', () => {
    it('按顺序拼接固定掩码, 分号分隔', () => {
        expect(formatCookieMask(['SUB', 'SUBP'])).toBe(
            'SUB=••••••; SUBP=••••••',
        );
    });

    it('无名称时回退通用掩码', () => {
        expect(formatCookieMask([])).toBe('••••••••');
    });

    it('丢弃空白名称', () => {
        expect(formatCookieMask(['', '  ', 'SUB'])).toBe(
            'SUB=••••••',
        );
    });
});
