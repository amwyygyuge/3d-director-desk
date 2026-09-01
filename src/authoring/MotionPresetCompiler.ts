import type { CameraKeyJSON } from "@/camera/CameraKey";
import { CAMERA_MOTION_EASING } from "@/camera/CameraMotionEasing";
import type { CameraMotionEasing } from "@/camera/CameraMotionEasing";
import type { CameraShot, ShotSize } from "@/camera/CameraShot";
import { ShotSizePresets } from "@/camera/ShotSizePresets";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import type { Vec3 } from "@/core/SceneObject";

/** 导演语汇:每一项都是「规则运动」,手绘画不准、参数一句话说清。 */
export const MOTION_MOVE = {
    DOLLY_IN: "dolly-in",
    DOLLY_OUT: "dolly-out",
    PAN: "pan",
    TILT: "tilt",
    TRUCK: "truck",
    CRANE: "crane",
    ORBIT: "orbit",
    HOLD: "hold",
} as const;
export type MotionMove = (typeof MOTION_MOVE)[keyof typeof MOTION_MOVE];

export const MOTION_MOVE_LABEL: Record<MotionMove, string> = {
    [MOTION_MOVE.DOLLY_IN]: "推近",
    [MOTION_MOVE.DOLLY_OUT]: "拉远",
    [MOTION_MOVE.PAN]: "摇镜",
    [MOTION_MOVE.TILT]: "俯仰",
    [MOTION_MOVE.TRUCK]: "横移",
    [MOTION_MOVE.CRANE]: "升降",
    [MOTION_MOVE.ORBIT]: "环绕",
    [MOTION_MOVE.HOLD]: "静止",
};

export interface MotionPresetRequest {
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly move: MotionMove;
    /** 有 subject 则自动绑跟拍 */
    readonly subjectId?: string;
    /** 落幅景别(复用 ShotSizePresets) */
    readonly shotSize?: ShotSize;
    readonly easing?: CameraMotionEasing;
}

export interface MotionPresetContext {
    readonly shot: CameraShot;
    /** 被摄体世界中心与包围球半径;无 subject 时为 null */
    readonly subject: { readonly center: Vec3; readonly radius: number } | null;
}

/** 推拉幅度:一次推近吃掉四成距离,是常规单镜头的可读幅度 */
const DOLLY_RATIO = 0.4;
/** 摇/俯仰的默认转角 */
const SWING_RADIANS = Math.PI / 9;
/** 横移/升降的默认幅度相对被摄距离 */
const TRAVEL_RATIO = 0.35;
/** 环绕默认转角与中间关键点数量(圆弧靠多点保形,不靠手柄硬掰) */
const ORBIT_RADIANS = Math.PI / 2;
const ORBIT_KEY_COUNT = 5;
const MIN_DISTANCE = 0.001;

const shotSizePresets = new ShotSizePresets();

function subtract(from: Vec3, to: Vec3): Vec3 {
    return [from[0] - to[0], from[1] - to[1], from[2] - to[2]];
}

function add(base: Vec3, delta: Vec3, scale: number): Vec3 {
    return [base[0] + delta[0] * scale, base[1] + delta[1] * scale, base[2] + delta[2] * scale];
}

function length(vector: Vec3): number {
    return Math.max(Math.hypot(vector[0], vector[1], vector[2]), MIN_DISTANCE);
}

function normalize(vector: Vec3): Vec3 {
    const size = length(vector);
    return [vector[0] / size, vector[1] / size, vector[2] / size];
}

function rotateAroundY(point: Vec3, pivot: Vec3, radians: number): Vec3 {
    const offsetX = point[0] - pivot[0];
    const offsetZ = point[2] - pivot[2];
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return [pivot[0] + offsetX * cos - offsetZ * sin, point[1], pivot[2] + offsetX * sin + offsetZ * cos];
}

function rightVector(shot: CameraShot): Vec3 {
    const forward = normalize(subtract(shot.target, shot.position));
    return normalize([forward[2], 0, -forward[0]]);
}

interface MovePose {
    readonly position: Vec3;
    readonly target: Vec3;
}

type MoveResolver = (context: MotionPresetContext) => readonly MovePose[];

/** 每个语汇一条策略:从机位当前姿态推导落幅姿态,禁在编译器里堆分支。 */
const MOVE_RESOLVERS: Record<MotionMove, MoveResolver> = {
    [MOTION_MOVE.DOLLY_IN]: ({ shot }) => [
        { position: shot.position, target: shot.target },
        { position: add(shot.position, subtract(shot.target, shot.position), DOLLY_RATIO), target: shot.target },
    ],
    [MOTION_MOVE.DOLLY_OUT]: ({ shot }) => [
        { position: shot.position, target: shot.target },
        { position: add(shot.position, subtract(shot.position, shot.target), DOLLY_RATIO), target: shot.target },
    ],
    [MOTION_MOVE.PAN]: ({ shot }) => [
        { position: shot.position, target: shot.target },
        { position: shot.position, target: rotateAroundY(shot.target, shot.position, SWING_RADIANS) },
    ],
    [MOTION_MOVE.TILT]: ({ shot }) => {
        const distance = length(subtract(shot.target, shot.position));
        const lift: Vec3 = [shot.target[0], shot.target[1] + distance * Math.sin(SWING_RADIANS), shot.target[2]];
        return [
            { position: shot.position, target: shot.target },
            { position: shot.position, target: lift },
        ];
    },
    [MOTION_MOVE.TRUCK]: ({ shot }) => {
        const travel = length(subtract(shot.target, shot.position)) * TRAVEL_RATIO;
        const right = rightVector(shot);
        return [
            { position: shot.position, target: shot.target },
            { position: add(shot.position, right, travel), target: add(shot.target, right, travel) },
        ];
    },
    [MOTION_MOVE.CRANE]: ({ shot }) => {
        const travel = length(subtract(shot.target, shot.position)) * TRAVEL_RATIO;
        const up: Vec3 = [0, 1, 0];
        return [
            { position: shot.position, target: shot.target },
            { position: add(shot.position, up, travel), target: shot.target },
        ];
    },
    [MOTION_MOVE.ORBIT]: ({ shot, subject }) => {
        const pivot = subject?.center ?? shot.target;
        return Array.from({ length: ORBIT_KEY_COUNT }, (_, index) => {
            const radians = (ORBIT_RADIANS * index) / (ORBIT_KEY_COUNT - 1);
            return { position: rotateAroundY(shot.position, pivot, radians), target: pivot };
        });
    },
    [MOTION_MOVE.HOLD]: ({ shot }) => [
        { position: shot.position, target: shot.target },
        { position: shot.position, target: shot.target },
    ],
};

/**
 * 运镜预设编译器(领域服务):导演语汇 → 标准 CameraKey 序列。
 *
 * UI 预设按钮与 AI 的 motion.author 共用它——不为 AI 单开一条路径。
 * 产出是普通关键帧,生成后完全可再编辑,不是黑盒。
 */
export class MotionPresetCompiler {
    compile(request: MotionPresetRequest, context: MotionPresetContext): readonly CameraKeyJSON[] {
        const poses = MOVE_RESOLVERS[request.move](context);
        const landing = this.landingPose(request, context);
        const resolved = landing ? [...poses.slice(0, -1), landing] : poses;
        const easing = request.easing ?? CAMERA_MOTION_EASING.SMOOTH;
        const divisor = Math.max(resolved.length - 1, 1);
        return resolved.map((pose, index) => ({
            id: crypto.randomUUID(),
            progress: index / divisor,
            position: pose.position,
            inHandle: [0, 0, 0],
            outHandle: [0, 0, 0],
            handleMode: MOTION_HANDLE_MODE.AUTO,
            target: pose.target,
            fov: landing && index === divisor ? landing.fov : null,
            easingOut: easing,
        }));
    }

    /** 落幅景别:被摄体已知时用景别预设定死末帧,方位角沿用当前机位。 */
    private landingPose(
        request: MotionPresetRequest,
        context: MotionPresetContext,
    ): (MovePose & { readonly fov: number }) | null {
        const subject = context.subject;
        if (!request.shotSize || !subject) return null;
        const offset = subtract(context.shot.position, subject.center);
        const azimuth = Math.atan2(offset[2], offset[0]);
        const shot = shotSizePresets.resolve(request.shotSize, subject.center, subject.radius, azimuth);
        return { position: shot.position, target: shot.target, fov: shot.fov };
    }
}
