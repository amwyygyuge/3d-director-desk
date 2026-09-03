import { CameraKey } from "@/camera/CameraKey";
import { createCameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraMotionClip, CameraMotionSample } from "@/camera/CameraMotionClip";
import { FOLLOW_SPACE, followSpaceCodecFor } from "@/camera/FollowSpaceCodec";
import { transformKeyCommandFor } from "@/command/timelineCommands";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { Vec3 } from "@/core/SceneObject";

const ISSUE_CODE = {
    NO_TARGET: "authoring-no-key-target",
    NO_POSE: "authoring-viewport-pose-unavailable",
    NO_CLIP: "authoring-no-clip-at-time",
    NO_FOLLOW_FRAME: "authoring-follow-frame-unavailable",
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

/** 跟拍态下视口读数属于世界系;一枚打点的 position/target 必须一起落回片段自身的跟随系。 */
function followLocalPose(
    ctx: DirectorContext,
    clip: CameraMotionClip,
    timeSeconds: number,
): { readonly position: Vec3; readonly target: Vec3; readonly fov: number } | null {
    const follow = clip.follow;
    const position = poseVector(VIEWPORT_POSE.positionX, VIEWPORT_POSE.positionY, VIEWPORT_POSE.positionZ);
    const target = poseVector(VIEWPORT_POSE.targetX, VIEWPORT_POSE.targetY, VIEWPORT_POSE.targetZ);
    if (!follow) return { position, target, fov: VIEWPORT_POSE.fov };
    const codec = followSpaceCodecFor(ctx);
    const localPosition = codec.convertPoint(follow, timeSeconds, FOLLOW_SPACE.LOCAL, position);
    const localTarget = codec.convertPoint(follow, timeSeconds, FOLLOW_SPACE.LOCAL, target);
    return localPosition && localTarget
        ? { position: localPosition, target: localTarget, fov: VIEWPORT_POSE.fov }
        : null;
}

/** 镜头视角下 playhead 命中的可编辑片段:与采样器共用同一裁决,禁止两处推断。 */
function lensClipAt(ctx: DirectorContext, timeSeconds: number): CameraMotionClip | null {
    return ctx.motion.resolveOutputClipAt(timeSeconds, ctx.motionAuthoring.previewClipId);
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
    const progress = clip.trajectoryProgressAt(timeSeconds);
    const pose = followLocalPose(ctx, clip, timeSeconds);
    if (!pose) {
        return issue(ISSUE_CODE.NO_FOLLOW_FRAME, "follow", "跟拍主体当前无法定位,无法记录镜头关键帧");
    }
    const existing = clip.keys.find((key) => Math.abs(key.progress - progress) < KEY_MERGE_PROGRESS);
    const key = new CameraKey({
        id: existing?.id ?? crypto.randomUUID(),
        progress,
        position: pose.position,
        target: pose.target,
        fov: pose.fov,
        // 覆盖既有关键帧时保留作者已接管的切线:打点只改画面,不撤销手工调校
        ...(existing ? { inHandle: existing.inHandle, outHandle: existing.outHandle } : {}),
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
}
