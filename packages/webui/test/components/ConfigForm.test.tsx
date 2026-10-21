// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType } from 'react';
import { getDefaultConfig } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import ConfigForm, {
    type FieldRenderProps,
} from '../../src/components/ConfigForm';

function renderForm(
    overrides?: Record<string, ComponentType<FieldRenderProps>>,
) {
    const onChange = vi.fn();
    const { container } = render(
        <ConfigForm
            config={getDefaultConfig()}
            onChange={onChange}
            overrides={overrides}
        />,
    );
    return { onChange, container };
}

describe('ConfigForm', () => {
    it('按 section 切成两张卡片并保持顺序', () => {
        const { container } = renderForm();
        expect(container.querySelectorAll('.card')).toHaveLength(2);
        expect(
            screen
                .getAllByRole('heading', { level: 3 })
                .map((heading) => heading.textContent),
        ).toEqual(['基础配置', '微博监听']);
    });

    it('渲染 section 的 description 作为卡片副标题', () => {
        renderForm();
        expect(
            screen.getByText('轮询周期与浏览器路径'),
        ).toBeInTheDocument();
    });

    it('按 kind 渲染各字段控件', () => {
        renderForm();
        expect(
            screen.getByPlaceholderText('输入 QQ 号后按回车添加'),
        ).toBeInTheDocument();
        expect(screen.getByText('指令触发方式')).toBeInTheDocument();
        expect(
            screen.getByText('轮询间隔 (分钟)'),
        ).toBeInTheDocument();
        expect(
            screen.getByPlaceholderText(
                'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            ),
        ).toBeInTheDocument();
    });

    it('过滤 scope=panel 的仅原生面板字段', () => {
        renderForm();
        expect(screen.queryByText(/跳转至拓展页面/)).toBeNull();
    });

    it('渲染推送呈现方式下拉框', () => {
        renderForm();
        expect(screen.getByText('推送呈现方式')).toBeInTheDocument();
        expect(screen.getByText('图片推送')).toBeInTheDocument();
    });

    it('推送呈现方式变更冒泡 key 与标量', () => {
        const { onChange } = renderForm();
        fireEvent.click(
            screen.getByRole('button', { name: /图片推送/ }),
        );
        fireEvent.click(
            screen.getByRole('option', { name: '文本推送' }),
        );
        expect(onChange).toHaveBeenCalledWith(
            'weiboPushRenderMode',
            'text',
        );
    });

    it('卡片标题不触发 onChange', () => {
        const { onChange } = renderForm();
        expect(screen.getByText('基础配置')).toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('控件变更冒泡字段 key', () => {
        const { onChange } = renderForm();
        fireEvent.change(screen.getByRole('spinbutton'), {
            target: { value: '120' },
        });
        fireEvent.blur(screen.getByRole('spinbutton'));
        expect(onChange).toHaveBeenCalledWith(
            'weiboPollIntervalMinutes',
            120,
        );
    });

    it('overrides 按 key 覆盖渲染', () => {
        const Override = ({ value }: FieldRenderProps) => (
            <div data-testid="override">{String(value)}</div>
        );
        renderForm({ chromeExecutablePath: Override });
        expect(screen.getByTestId('override')).toBeInTheDocument();
    });
});
