/**
 * 从请求错误中提取可读信息
 *
 * `fetch` 辅助函数把非 2xx 的响应体原样塞进 Error.message, 后端返回
 * JSON 时解析出其中的 message 字段。
 */
export function readApiErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        try {
            const parsed = JSON.parse(err.message) as {
                message?: unknown;
            };
            if (
                typeof parsed.message === 'string' &&
                parsed.message
            ) {
                return parsed.message;
            }
        } catch {
            /* 非 JSON 响应 */
        }
        return err.message;
    }
    return String(err);
}
