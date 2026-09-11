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

/**
 * 内置人偶不内嵌 clip:动作独立成 `actions.glb`(见 scripts/bake-actor-assets.ts),
 * 姿势预设独立成 `posePresets.data`。故本表为空,呈现规则只服务宿主注入的第三方资产
 * ——它们的 clip 名不可预期,一律走下面的回退。
 */
const HUMANOID_CLIPS: readonly EmbeddedClipPresentation[] = [];

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
