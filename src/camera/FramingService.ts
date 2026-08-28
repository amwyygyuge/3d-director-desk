import type { Vec3 } from "../core/SceneObject";
import type { DirectorPose } from "../store/CameraStore";

/** 取景留边:包围球半径的倍率,主体不贴画幅边 */
const FRAME_PADDING = 1.4;
/** 从未轨道过时(lastDirectorPose 为空)的默认取景方位 */
const FALLBACK_DIRECTION: Vec3 = [0.6, 0.4, 0.8];
const DEG_TO_RAD = Math.PI / 180;

/**
 * 取景服务(领域服务,纯数据):对象集合包围球 → 相机 pose。
 * 保持当前视角方向(方位角/俯仰角),只推距离——用户的构图朝向不被打断。
 */
export class FramingService {
    frame(input: { center: Vec3; radius: number; fromPose: DirectorPose | null }): DirectorPose {
        const { center, radius, fromPose } = input;
        const direction = fromPose
            ? normalize([
                  fromPose.position[0] - fromPose.target[0],
                  fromPose.position[1] - fromPose.target[1],
                  fromPose.position[2] - fromPose.target[2],
              ])
            : normalize(FALLBACK_DIRECTION);
        const fov = fromPose?.fov ?? 45;
        // 恰好容纳包围球的距离:radius / sin(半视场角),再加留边
        const distance = (Math.max(radius, 0.1) / Math.sin((fov / 2) * DEG_TO_RAD)) * FRAME_PADDING;
        return {
            position: [
                center[0] + direction[0] * distance,
                center[1] + direction[1] * distance,
                center[2] + direction[2] * distance,
            ],
            target: center,
            fov,
        };
    }
}

function normalize(v: Vec3): Vec3 {
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
}
