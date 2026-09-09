import type { Vec3 } from "@/core/SceneObject";
import type { DirectorPose } from "@/store/CameraStore";

/** 取景留边:包围球半径的倍率,主体不贴画幅边 */
const FRAME_PADDING = 1.4;
/** 从未轨道过时(lastDirectorPose 为空)的默认取景方位 */
const FALLBACK_DIRECTION: Vec3 = [0.6, 0.4, 0.8];
const DEG_TO_RAD = Math.PI / 180;

/** 轴向取景方位:预设视角(前/顶/右)与元素正视图共用同一查表 */
export const VIEW_DIRECTION = {
    FRONT: "front",
    TOP: "top",
    RIGHT: "right",
} as const;
export type ViewDirection = (typeof VIEW_DIRECTION)[keyof typeof VIEW_DIRECTION];

/**
 * 方位 → 从目标指向相机的单位方向;顶视沿 +Y。
 *
 * 正视是 -Z:模型正面朝 -Z(three 惯例,与 TimelineSampler / yawFacing 同一约定),
 * 相机要落在主体正面一侧才看得到脸,写成 +Z 会得到一张背影。
 */
const VIEW_DIRECTION_VECTORS: Record<ViewDirection, Vec3> = {
    front: [0, 0, -1],
    top: [0, 1, 0],
    right: [1, 0, 0],
};

/** 命令层围栏:外部 payload 的 direction 先过枚举检查(空间幻觉围栏,红灯 9);hasOwn 挡原型链("constructor" 等) */
export function isViewDirection(value: unknown): value is ViewDirection {
    return typeof value === "string" && Object.hasOwn(VIEW_DIRECTION_VECTORS, value);
}

/**
 * 取景服务(领域服务,纯数据):对象集合包围球 → 相机 pose。
 * direction 缺省时保持当前视角方向(方位角/俯仰角)只推距离——用户的构图朝向不被打断;
 * 显式给出方位(预设视角/正视图)时按轴向查表取向。
 */
export class FramingService {
    frame(input: {
        center: Vec3;
        radius: number;
        fromPose: DirectorPose | null;
        direction?: ViewDirection | undefined;
    }): DirectorPose {
        const { center, radius, fromPose } = input;
        const direction =
            input.direction !== undefined
                ? VIEW_DIRECTION_VECTORS[input.direction]
                : fromPose
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
