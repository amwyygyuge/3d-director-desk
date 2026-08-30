/** 通用等待(命令层异步编排共用,Rule of Two) */
export function waitMs(ms: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
}
