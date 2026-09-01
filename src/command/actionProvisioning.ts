import { formatFromUrl } from "../assets/ModelAsset";
import type { ActionAsset } from "../assets/ActionAsset";
import { waitMs } from "../core/waitMs";
import type { DirectorContext } from "./DirectorCommand";

/** 挂载恢复的运行时等待上限:40 × 250ms = 10s(模型重新加载) */
const MOUNT_RETRY_LIMIT = 40;
const MOUNT_RETRY_INTERVAL_MS = 250;

/**
 * 动作资源置备(文档导入与目录挂载共用,Rule of Two):
 * 按 URL 取 clip(clipName 定位)→ 注册进动作库;幂等(重名复用)。
 */
export async function provisionAction(
    ctx: DirectorContext,
    init: { name: string; url: string; clipName?: string | null | undefined },
    options?: { signal?: AbortSignal },
): Promise<ActionAsset> {
    const format = formatFromUrl(init.url);
    if (!format) throw new Error(`无法识别动作资产格式: ${init.url}`);
    const handle = await ctx.models.acquire(init.url, format, options?.signal ? { signal: options.signal } : {});
    try {
        if (options?.signal?.aborted) throw new DOMException("Action provisioning was cancelled", "AbortError");
        const clip =
            (init.clipName ? handle.animations.find((candidate) => candidate.name === init.clipName) : undefined) ??
            handle.animations[0];
        if (!clip) throw new Error(`资产无动作 clip: ${init.url}`);
        return ctx.animations.register({ name: init.name, url: init.url, clip }).action;
    } finally {
        handle.release();
    }
}

/** 等目标模型运行时就绪后挂载;超时返回 false(调用方决定上报口径) */
export async function mountWhenReady(
    ctx: DirectorContext,
    objectId: string,
    actionId: string,
    options?: { signal?: AbortSignal },
): Promise<boolean> {
    for (let attempt = 0; attempt < MOUNT_RETRY_LIMIT; attempt++) {
        if (options?.signal?.aborted) return false;
        const runtime = ctx.scene.manager.getRuntime(objectId);
        const clip = ctx.animations.getClip(actionId);
        if (runtime && clip) {
            ctx.binder.mount(objectId, runtime, clip);
            ctx.scene.setObjectAction(objectId, actionId);
            return true;
        }
        await waitMs(MOUNT_RETRY_INTERVAL_MS);
    }
    return false;
}
