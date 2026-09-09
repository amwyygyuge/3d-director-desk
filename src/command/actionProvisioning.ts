import type { Object3D } from "three";

import { formatFromUrl, MODEL_FORMAT } from "@/assets/ModelAsset";
import type { ActionAsset, ActionLoopMode } from "@/assets/ActionAsset";
import { ACTION_CHANNEL_POLICY, MixamoActionRetargeter } from "@/animation/MixamoActionRetargeter";
import { MountActionCommand } from "@/command/actionCommands";
import { waitMs } from "@/core/waitMs";
import type { DirectorContext } from "@/command/DirectorCommand";

/** 挂载恢复的运行时等待上限:40 × 250ms = 10s(模型重新加载) */
const MOUNT_RETRY_LIMIT = 40;
const MOUNT_RETRY_INTERVAL_MS = 250;
const actionRetargeter = new MixamoActionRetargeter();

/**
 * 动作资源置备(文档导入与目录挂载共用,Rule of Two):
 * 按 URL 取 clip(clipName 定位)→ 外部 FBX 以目标骨架做世界空间重定向 → 注册进动作库;幂等(重名复用)。
 */
export async function provisionAction(
    ctx: DirectorContext,
    init: {
        name: string;
        url: string;
        clipName?: string | null | undefined;
        loopMode: ActionLoopMode;
        trimStartSeconds?: number | null;
        trimEndSeconds?: number | null;
    },
    options?: { signal?: AbortSignal; targetObjectId?: string },
): Promise<ActionAsset> {
    const format = formatFromUrl(init.url);
    if (!format) throw new Error(`无法识别动作资产格式: ${init.url}`);
    const needsRetarget = format === MODEL_FORMAT.FBX;
    if (needsRetarget && !options?.targetObjectId) throw new Error(`FBX 动作需要目标人偶:${init.url}`);
    const targetRuntime = needsRetarget
        ? await targetRuntimeWhenReady(ctx, options?.targetObjectId, options?.signal)
        : null;
    if (needsRetarget && !targetRuntime) throw new Error(`目标骨架未就绪:${options?.targetObjectId}`);

    const handle = await ctx.models.acquire(init.url, format, options?.signal ? { signal: options.signal } : {});
    try {
        if (options?.signal?.aborted) throw new DOMException("Action provisioning was cancelled", "AbortError");
        // clipName 有值却找不到:资产里的 clip 被改名/重排,或文档被手改。
        // 此时绝不能回落到第一个 clip——骨骼校验对着错的 clip 也能通过,结果是静默播错动作。
        // 只有 clipName 缺省(单 clip 文件,见字段注释)才用索引 0。
        const namedClip = init.clipName
            ? handle.animations.find((candidate) => candidate.name === init.clipName)
            : undefined;
        if (init.clipName && !namedClip) {
            const available = handle.animations.map((candidate) => candidate.name).join(", ");
            throw new Error(`资产内找不到动作 clip "${init.clipName}": ${init.url};可用 clip: [${available}]`);
        }
        const clip = namedClip ?? handle.animations[0];
        if (!clip) throw new Error(`资产无动作 clip: ${init.url}`);
        const retargetedClip = actionRetargeter.normalize(clip, {
            channels: needsRetarget ? ACTION_CHANNEL_POLICY.ROTATION_ONLY : ACTION_CHANNEL_POLICY.PRESERVE,
            trimStartSeconds: init.trimStartSeconds ?? 0,
            trimEndSeconds: init.trimEndSeconds ?? 0,
            sourceRoot: handle.object3d,
            ...(targetRuntime ? { targetRoot: targetRuntime } : {}),
        });
        return ctx.animations.register({
            name: init.name,
            url: init.url,
            clip: retargetedClip,
            loopMode: init.loopMode,
            trimStartSeconds: init.trimStartSeconds ?? 0,
            trimEndSeconds: init.trimEndSeconds ?? 0,
        }).action;
    } finally {
        handle.release();
    }
}

async function targetRuntimeWhenReady(
    ctx: DirectorContext,
    objectId: string | undefined,
    signal?: AbortSignal,
): Promise<Object3D | null> {
    return objectId ? targetRuntimeAttempt(ctx, objectId, MOUNT_RETRY_LIMIT, signal) : null;
}

async function targetRuntimeAttempt(
    ctx: DirectorContext,
    objectId: string,
    remainingAttempts: number,
    signal?: AbortSignal,
): Promise<Object3D | null> {
    if (remainingAttempts === 0 || signal?.aborted) return null;
    const runtime = ctx.scene.manager.getRuntime(objectId);
    if (runtime) return runtime;
    await waitMs(MOUNT_RETRY_INTERVAL_MS);
    return targetRuntimeAttempt(ctx, objectId, remainingAttempts - 1, signal);
}

/**
 * 等目标模型运行时就绪后挂载。
 *
 * 返回值必须区分两种失败,不能合并成一个 boolean:
 *  - `reason: "timeout"` 运行时或 clip 始终没就绪;
 *  - `reason: "rejected"` 命令层校验拒绝(骨骼不兼容、时段交叠……),`issues` 带原文。
 *
 * 旧实现两者都返回 `false`,调用方一律上报「动作挂载等待运行时超时」——真实的
 * 骨骼不兼容 / 排期交叠因此被伪装成超时,提示把排查方向指向完全错误的地方。
 */
export type MountOutcome =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "timeout" }
    | { readonly ok: false; readonly reason: "rejected"; readonly issues: readonly string[] };

export async function mountWhenReady(
    ctx: DirectorContext,
    objectId: string,
    actionId: string,
    options?: {
        signal?: AbortSignal;
        /** 文档恢复必须原样传回段 id:重新生成会让持久化的段身份在导入后漂移。 */
        performanceId?: string;
        startTimeSeconds?: number;
        durationSeconds?: number;
        attackSeconds?: number;
        releaseSeconds?: number;
        alignToTrack?: { trackId: string; fromKeyframeId?: string | null; toKeyframeId?: string | null };
        replace?: boolean;
    },
): Promise<MountOutcome> {
    for (let attempt = 0; attempt < MOUNT_RETRY_LIMIT; attempt++) {
        if (options?.signal?.aborted) return { ok: false, reason: "timeout" };
        const runtime = ctx.scene.manager.getRuntime(objectId);
        const clip = ctx.animations.getClip(actionId);
        if (runtime && clip) {
            const mount = new MountActionCommand({
                objectId,
                actionId,
                ...(options?.performanceId !== undefined ? { performanceId: options.performanceId } : {}),
                ...(options?.startTimeSeconds !== undefined ? { startTimeSeconds: options.startTimeSeconds } : {}),
                ...(options?.durationSeconds !== undefined ? { durationSeconds: options.durationSeconds } : {}),
                ...(options?.attackSeconds !== undefined ? { attackSeconds: options.attackSeconds } : {}),
                ...(options?.releaseSeconds !== undefined ? { releaseSeconds: options.releaseSeconds } : {}),
                ...(options?.alignToTrack ? { alignToTrack: options.alignToTrack } : {}),
                ...(options?.replace === undefined ? {} : { replace: options.replace }),
            });
            const issues = mount.validate(ctx);
            if (issues.length > 0) return { ok: false, reason: "rejected", issues };
            mount.execute(ctx);
            return { ok: true };
        }
        await waitMs(MOUNT_RETRY_INTERVAL_MS);
    }
    return { ok: false, reason: "timeout" };
}
