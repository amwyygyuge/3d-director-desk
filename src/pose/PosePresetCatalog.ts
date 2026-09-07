import { ACTION_LOOP_MODE } from "@/assets/ActionAsset";
import type { ActionLoopMode } from "@/assets/ActionAsset";

/**
 * 内嵌 clip 的角色划分。
 *
 * 姿势不再由 clip 承载:静态帧已抽进 `posePresets.data`,标记为 POSE_SOURCE 的 clip 因此不出现在动作区,
 * 避免同一造型在「姿势」与「动作」两处各有一个入口、点了却是两种语义。
 */
export const CLIP_ROLE = {
    ACTION: "action",
    POSE_SOURCE: "pose-source",
} as const;
export type ClipRole = (typeof CLIP_ROLE)[keyof typeof CLIP_ROLE];

export interface EmbeddedClipPresentation {
    readonly clipName: string;
    readonly role: ClipRole;
    readonly labelZh: string;
    /** 仅 ACTION 消费;POSE_SOURCE 不进入动作区,无需声明循环语义。 */
    readonly loopMode?: ActionLoopMode;
}

const HUMANOID_CLIPS: readonly EmbeddedClipPresentation[] = [
    { clipName: "Idle", role: CLIP_ROLE.ACTION, labelZh: "待机", loopMode: ACTION_LOOP_MODE.LOOP },
    { clipName: "Walking", role: CLIP_ROLE.ACTION, labelZh: "行走", loopMode: ACTION_LOOP_MODE.LOOP },
    {
        clipName: "Walking Backward",
        role: CLIP_ROLE.ACTION,
        labelZh: "倒退行走",
        loopMode: ACTION_LOOP_MODE.LOOP,
    },
    { clipName: "Jump", role: CLIP_ROLE.ACTION, labelZh: "跳跃", loopMode: ACTION_LOOP_MODE.ONCE },
    { clipName: "Running", role: CLIP_ROLE.ACTION, labelZh: "奔跑", loopMode: ACTION_LOOP_MODE.LOOP },
    { clipName: "Standing", role: CLIP_ROLE.POSE_SOURCE, labelZh: "站立" },
    { clipName: "Sitting", role: CLIP_ROLE.POSE_SOURCE, labelZh: "椅上坐" },
    { clipName: "Sitting Floor", role: CLIP_ROLE.POSE_SOURCE, labelZh: "坐地" },
    { clipName: "Crouching", role: CLIP_ROLE.POSE_SOURCE, labelZh: "蹲伏" },
    { clipName: "Kneeling", role: CLIP_ROLE.POSE_SOURCE, labelZh: "单膝跪" },
    { clipName: "Sleeping Side", role: CLIP_ROLE.POSE_SOURCE, labelZh: "侧卧" },
    { clipName: "Sleeping Supine", role: CLIP_ROLE.POSE_SOURCE, labelZh: "仰卧" },
    { clipName: "Lying Prone", role: CLIP_ROLE.POSE_SOURCE, labelZh: "俯卧" },
    { clipName: "Sleeping Supine Straight", role: CLIP_ROLE.POSE_SOURCE, labelZh: "仰卧伸展" },
];

const CLIP_BY_NAME = new Map(HUMANOID_CLIPS.map((clip) => [clip.clipName, clip]));

/** 未登记的 clip(宿主注入资产)一律按动作呈现,原名即标签——不认识不等于不可用。 */
export function presentEmbeddedClip(clipName: string): EmbeddedClipPresentation {
    return (
        CLIP_BY_NAME.get(clipName) ?? {
            clipName,
            role: CLIP_ROLE.ACTION,
            labelZh: clipName,
            loopMode: ACTION_LOOP_MODE.ONCE,
        }
    );
}

export function listActionClips(clipNames: readonly string[]): readonly EmbeddedClipPresentation[] {
    return clipNames.map(presentEmbeddedClip).filter((clip) => clip.role === CLIP_ROLE.ACTION);
}
