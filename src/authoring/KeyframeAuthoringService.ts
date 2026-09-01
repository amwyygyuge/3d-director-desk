import { CameraKey } from "@/camera/CameraKey";
import { createCameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraMotionClip, CameraMotionSample } from "@/camera/CameraMotionClip";
import { transformKeyCommandFor } from "@/command/timelineCommands";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { Vec3 } from "@/core/SceneObject";

const ISSUE_CODE = {
    NO_TARGET: "authoring-no-key-target",
    NO_POSE: "authoring-viewport-pose-unavailable",
    NO_CLIP: "authoring-no-clip-at-time",
} as const;

/** 同一时刻重复打点视为覆盖同一枚关键帧,避免 progress 冲突把作者卡住。 */
const KEY_MERGE_PROGRESS = 1e-4;

/** 视口姿态读取缓冲:命令层的模块级临时对象先例,打点是低频动作但仍不制造垃圾。 */
const VIEWPORT_POSE: CameraMotionSample = createCameraMotionSample();

export type KeyframeAuthoringResult = SerializedCommand | CommandIssue;

export function isCommandIssue(result: KeyframeAuthoringResult): result is CommandIssue {
    return "code" in result;
}

function issue(code: string, path: string, message: string, options?: CommandIssue["options"]): CommandIssue {
    return { code, path, message, ...(options ? { options } : {}) };
}

function poseVector(x: number, y: number, z: number): Vec3 {
    return [x, y, z];
}

/** 镜头视角下 playhead 命中的可编辑片段:先看预览片段,再看 Program 输出所在机位的片段。 */
function lensClipAt(ctx: DirectorContext, timeSeconds: number): CameraMotionClip | null {
    const previewClipId = ctx.motionAuthoring.previewClipId;
    const preview = previewClipId ? ctx.motion.clip(previewClipId) : undefined;
    if (preview && preview.covers(timeSeconds)) return preview;
    const programCameraId = ctx.motion.program.cameraAt(timeSeconds);
    return programCameraId ? ctx.motion.clipAt(programCameraId, timeSeconds) : null;
}

function cameraKeyCommand(ctx: DirectorContext): KeyframeAuthoringResult {
    const timeSeconds = ctx.clock.time;
    const clip = lensClipAt(ctx, timeSeconds);
    if (!clip) {
        return issue(ISSUE_CODE.NO_CLIP, "clip", "当前时间没有镜头片段", [
            { type: "motion.create-take", label: "在此创建 1 秒片段" },
        ]);
    }
    if (!ctx.playback.readViewportPose(VIEWPORT_POSE)) {
        return issue(ISSUE_CODE.NO_POSE, "viewport", "视口相机尚未接管,无法读取当前画面");
    }
    const progress = clip.progressAt(timeSeconds);
    const existing = clip.keys.find((key) => Math.abs(key.progress - progress) < KEY_MERGE_PROGRESS);
    const key = new CameraKey({
        id: existing?.id ?? crypto.randomUUID(),
        progress,
        position: poseVector(VIEWPORT_POSE.positionX, VIEWPORT_POSE.positionY, VIEWPORT_POSE.positionZ),
        target: poseVector(VIEWPORT_POSE.targetX, VIEWPORT_POSE.targetY, VIEWPORT_POSE.targetZ),
        fov: VIEWPORT_POSE.fov,
        // 覆盖既有关键帧时保留作者已接管的切线与出段缓动:打点只改画面,不撤销手工调校
        ...(existing ? { inHandle: existing.inHandle, outHandle: existing.outHandle, easingOut: existing.easingOut } : {}),
        handleMode: existing?.handleMode ?? MOTION_HANDLE_MODE.AUTO,
    });
    return { type: "motion.set-key", payload: { clipId: clip.id, key: key.toJSON() } };
}

function transformKeyCommand(ctx: DirectorContext): KeyframeAuthoringResult {
    const objectId = ctx.selection.primaryId;
    const command = objectId ? transformKeyCommandFor(ctx, objectId) : null;
    return command ?? issue(ISSUE_CODE.NO_TARGET, "selection", "选中场景对象后才能打关键帧");
}

/**
 * 打点上下文分派(应用服务)。
 *
 * K 是同一个动词、两个领域:镜头视角下落镜头关键帧,其余情形落对象走位关键帧。
 * 分派收敛在此,快捷键表里不堆并列 if;失败一律返回结构化 issue 供 UI/AI 换方案。
 */
export class KeyframeAuthoringService {
    resolve(ctx: DirectorContext): KeyframeAuthoringResult {
        return ctx.motionAuthoring.lensViewActive ? cameraKeyCommand(ctx) : transformKeyCommand(ctx);
    }

    /** 视口摆位手势终点复用同一条路径:镜头视角外不产出命令。 */
    resolveCameraKey(ctx: DirectorContext): KeyframeAuthoringResult {
        return cameraKeyCommand(ctx);
    }
}
