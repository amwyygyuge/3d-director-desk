import type { Vec3 } from "@/core/SceneObject";
import { CameraShot, SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";

/**
 * 景别 → 构图参数查表(Record,禁 if 链):
 * distanceFactor 是被摄体包围球半径的倍数;elevationDeg 是俯仰角。
 * 系数参考经典景别构图比例,走查后可微调——调参只动这张表。
 */
const SHOT_SIZE_PARAMS: Record<ShotSize, { distanceFactor: number; elevationDeg: number }> = {
    [SHOT_SIZE.EXTREME_LONG]: { distanceFactor: 9, elevationDeg: 12 },
    [SHOT_SIZE.LONG]: { distanceFactor: 5, elevationDeg: 10 },
    [SHOT_SIZE.MEDIUM_LONG]: { distanceFactor: 3.2, elevationDeg: 8 },
    [SHOT_SIZE.MEDIUM]: { distanceFactor: 2.2, elevationDeg: 6 },
    [SHOT_SIZE.MEDIUM_CLOSE]: { distanceFactor: 1.6, elevationDeg: 4 },
    [SHOT_SIZE.CLOSE_UP]: { distanceFactor: 1.1, elevationDeg: 2 },
    [SHOT_SIZE.EXTREME_CLOSE_UP]: { distanceFactor: 0.75, elevationDeg: 0 },
};

/** 包围球半径下限:防零距离除零/贴脸 */
const MIN_SUBJECT_RADIUS = 0.5;

/** 从未轨道过时的默认方位角(45° 斜侧):机位面板与快速创建共用 */
export const DEFAULT_SHOT_AZIMUTH_RADIANS = Math.PI / 4;

/** 相机位置 → 绕中心的方位角(机位面板景别与快速创建共用同一公式,禁两处各写) */
export function azimuthAroundCenter(eye: Vec3, center: Vec3): number {
    return Math.atan2(eye[2] - center[2], eye[0] - center[0]);
}

const DEG_TO_RAD = Math.PI / 180;
const DEFAULT_SHOT_FOV = 45;

/**
 * 景别预设(领域服务,纯函数查表):
 * 输入被摄体中心/半径与当前相机方位角 → 输出新机位;保持当前水平朝向,只按景别推距离与俯仰。
 * 纯数据进出(不碰 three),机位值对象直接可序列化。
 */
export class ShotSizePresets {
    resolve(size: ShotSize, subjectCenter: Vec3, subjectRadius: number, azimuthRad: number): CameraShot {
        const { distanceFactor, elevationDeg } = SHOT_SIZE_PARAMS[size];
        const distance = Math.max(subjectRadius, MIN_SUBJECT_RADIUS) * distanceFactor;
        const elevation = elevationDeg * DEG_TO_RAD;
        const horizontal = distance * Math.cos(elevation);
        return new CameraShot({
            position: [
                subjectCenter[0] + Math.cos(azimuthRad) * horizontal,
                subjectCenter[1] + distance * Math.sin(elevation),
                subjectCenter[2] + Math.sin(azimuthRad) * horizontal,
            ],
            target: subjectCenter,
            fov: DEFAULT_SHOT_FOV,
        });
    }
}
