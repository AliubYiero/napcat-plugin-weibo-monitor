interface CheckboxProps {
    id?: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    /** 无可见文字标签时提供无障碍名 */
    ariaLabel?: string;
    className?: string;
}

const BASE_CLASS = 'rounded border-gray-300 dark:border-gray-600';

/**
 * 通用勾选框
 *
 * 配置表单之外 (如列表全选 / 行选择) 复用同一外观,
 * 避免页面内重复书写原生 checkbox 的样式类。
 */
export default function Checkbox({
    id,
    checked,
    onChange,
    disabled = false,
    ariaLabel,
    className,
}: CheckboxProps) {
    return (
        <input
            id={id}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            aria-label={ariaLabel}
            onChange={(event) => onChange(event.target.checked)}
            className={
                className ? `${BASE_CLASS} ${className}` : BASE_CLASS
            }
        />
    );
}
