import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";
import type { CommandResult } from "@/command/DirectorCommand";
import { waitMs } from "@/core/waitMs";

/** 模型运行时就绪的轮询上限:40 × 250ms = 10s(本地测试资产正常亚秒级) */
const RUNTIME_WAIT_LIMIT = 40;
const RUNTIME_WAIT_INTERVAL_MS = 250;

/** 验收播种的统一入口:命令失败即抛错(story 挂掉 = 验收不过) */
export function dispatchOk(stores: DirectorDeskStores, type: string, payload: unknown): void {
    const result = stores.dispatcher.dispatch({ type, payload }, stores);
    if (!result.ok) throw new Error(result.issues?.join(";") ?? result.error);
}
/**
 * 契约闸门两态归一:dev 抛错(立刻暴露写错的调用点)、生产结构化 !ok(AI 按 path 重试)。
 * 验收只关心「被拒绝」这一事实,两种形态统一收成 CommandResult。
 */
export function dispatchCatching(stores: DirectorDeskStores, type: string, payload: unknown): CommandResult {
    try {
        return stores.dispatcher.dispatch({ type, payload }, stores);
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}

/** 播种断言:条件不成立即抛错,附模块前缀便于定位是哪条 story 挂的 */
export function assertAcceptance(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(`验收断言失败: ${message}`);
}

/** 取值否则抛错:播种里的「必须存在」收敛一处 */
export function required<T>(value: T | undefined, message: string): T {
    if (value === undefined) throw new Error(`验收断言失败: ${message}`);
    return value;
}
/** 等模型 Three 运行时就绪(加载是异步的);超时即抛错(story 挂掉 = 验收不过) */
export async function waitRuntime(stores: DirectorDeskStores, objectId: string): Promise<void> {
    for (let attempt = 0; attempt < RUNTIME_WAIT_LIMIT; attempt++) {
        if (stores.scene.manager.getRuntime(objectId)) return;
        await waitMs(RUNTIME_WAIT_INTERVAL_MS);
    }
    throw new Error(`验收断言失败: 模型运行时超时未就绪 ${objectId}`);
}
