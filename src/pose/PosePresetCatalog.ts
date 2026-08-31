export const POSE_PRESET_KIND = {
    ACTION: "action",
    POSE: "pose",
} as const;
export type PosePresetKind = (typeof POSE_PRESET_KIND)[keyof typeof POSE_PRESET_KIND];

export interface PosePresetPresentation {
    readonly clipName: string;
    readonly kind: PosePresetKind;
    readonly labelZh: string;
}

const HUMANOID_PRESETS: readonly PosePresetPresentation[] = [
    { clipName: "Standing", kind: POSE_PRESET_KIND.POSE, labelZh: "站立" },
    { clipName: "Sitting", kind: POSE_PRESET_KIND.POSE, labelZh: "椅上坐姿" },
    { clipName: "Sitting Floor", kind: POSE_PRESET_KIND.POSE, labelZh: "坐地" },
    { clipName: "Crouching", kind: POSE_PRESET_KIND.POSE, labelZh: "蹲伏" },
    { clipName: "Kneeling", kind: POSE_PRESET_KIND.POSE, labelZh: "单膝跪地" },
    { clipName: "Sleeping Side", kind: POSE_PRESET_KIND.POSE, labelZh: "侧卧" },
    { clipName: "Sleeping Supine", kind: POSE_PRESET_KIND.POSE, labelZh: "仰卧" },
    { clipName: "Lying Prone", kind: POSE_PRESET_KIND.POSE, labelZh: "俯卧" },
    { clipName: "Sleeping Supine Straight", kind: POSE_PRESET_KIND.POSE, labelZh: "仰卧伸展" },
    { clipName: "Idle", kind: POSE_PRESET_KIND.ACTION, labelZh: "待机" },
    { clipName: "Walking", kind: POSE_PRESET_KIND.ACTION, labelZh: "行走" },
    { clipName: "Walking Backward", kind: POSE_PRESET_KIND.ACTION, labelZh: "倒退行走" },
    { clipName: "Jump", kind: POSE_PRESET_KIND.ACTION, labelZh: "跳跃" },
    { clipName: "Running", kind: POSE_PRESET_KIND.ACTION, labelZh: "奔跑" },
];

const PRESET_BY_CLIP = new Map(HUMANOID_PRESETS.map((preset) => [preset.clipName, preset]));

/** Resolves built-in humanoid names to Chinese labels; unknown embedded clips remain usable as actions. */
export function presentPosePreset(clipName: string): PosePresetPresentation {
    return PRESET_BY_CLIP.get(clipName) ?? { clipName, kind: POSE_PRESET_KIND.ACTION, labelZh: clipName };
}
