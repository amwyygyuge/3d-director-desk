import { ActorBuild } from "@/actor/ActorBuild";
import type { ActorBuildInit } from "@/actor/ActorBuild";

export interface BuildPreset {
    readonly id: string;
    readonly labelZh: string;
    readonly build: ActorBuildInit;
}

/**
 * 体型预设:参数空间里的命名点,不是另一套状态。
 * 语义→数值的编译在此收口(与运镜的 MotionPresetCompiler 同构):LLM 只给预设名,数值由本表产出,
 * 越界仍由 ActorBuild 与命令围栏兜底。
 */
export const BUILD_PRESETS: readonly BuildPreset[] = [
    { id: "slender", labelZh: "瘦高", build: { heightMeters: 1.86, girthScale: 0.9, shoulderScale: 0.95 } },
    { id: "standard", labelZh: "标准", build: {} },
    { id: "burly", labelZh: "魁梧", build: { heightMeters: 1.88, girthScale: 1.16, shoulderScale: 1.18 } },
    { id: "stocky", labelZh: "矮壮", build: { heightMeters: 1.63, girthScale: 1.2, shoulderScale: 1.12 } },
    { id: "youth", labelZh: "少年", build: { heightMeters: 1.45, girthScale: 0.92, shoulderScale: 0.9 } },
];

const PRESET_BY_ID = new Map(BUILD_PRESETS.map((preset) => [preset.id, preset]));

export function compileBuildPreset(presetId: string): ActorBuild | null {
    const preset = PRESET_BY_ID.get(presetId);
    return preset ? new ActorBuild(preset.build) : null;
}

/** UI 反查:当前数值命中哪个预设(未命中即「自定义」),预设 chip 与滑杆因此共用一份状态。 */
export function matchBuildPreset(build: ActorBuild): string | null {
    return BUILD_PRESETS.find((preset) => new ActorBuild(preset.build).equals(build))?.id ?? null;
}
