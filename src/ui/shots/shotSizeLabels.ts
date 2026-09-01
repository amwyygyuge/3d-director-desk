import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";

/** 景别中文标签:左栏机位生成与右栏运镜落幅共用一份,文案不在两处漂移。 */
export const SHOT_SIZE_LABELS: Record<ShotSize, string> = {
    [SHOT_SIZE.EXTREME_LONG]: "大远景",
    [SHOT_SIZE.LONG]: "远景",
    [SHOT_SIZE.MEDIUM_LONG]: "中远景",
    [SHOT_SIZE.MEDIUM]: "中景",
    [SHOT_SIZE.MEDIUM_CLOSE]: "中近景",
    [SHOT_SIZE.CLOSE_UP]: "特写",
    [SHOT_SIZE.EXTREME_CLOSE_UP]: "大特写",
};
