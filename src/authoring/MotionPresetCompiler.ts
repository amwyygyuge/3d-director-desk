import type { CameraKeyJSON } from "@/camera/CameraKey";
import type { EasingCurve } from "@/motion/EasingCurve";
import type { CameraShot, ShotSize } from "@/camera/CameraShot";
import { ShotSizePresets } from "@/camera/ShotSizePresets";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { createId } from "@/core/createId";
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
    SPIRAL: "spiral",
    ARC_DOLLY: "arc-dolly",
    DOLLY_ZOOM: "dolly-zoom",
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
    [MOTION_MOVE.SPIRAL]: "螺旋升降",
    [MOTION_MOVE.ARC_DOLLY]: "弧线推近",
    [MOTION_MOVE.DOLLY_ZOOM]: "滑动变焦",
    [MOTION_MOVE.HOLD]: "静止",
};

/**
 * 跟拍态的语汇文案:跟随系里主体恒在原点,语汇作用于**相对主体**的运动。
 * 与 MOTION_MOVE_LABEL 并列而非替换——同一个语汇在两种参考系下是两种画面,
 * 按钮上直接说人话,作者不必在脑子里做参考系变换。
 */
export const FOLLOW_MOVE_LABEL: Record<MotionMove, string> = {
    [MOTION_MOVE.DOLLY_IN]: "边跟边推近",
    [MOTION_MOVE.DOLLY_OUT]: "边跟边拉开",
    [MOTION_MOVE.PAN]: "摇镜",
    [MOTION_MOVE.TILT]: "俯仰",
    [MOTION_MOVE.TRUCK]: "换到侧面跟",
    [MOTION_MOVE.CRANE]: "跟着走并升降",
    [MOTION_MOVE.ORBIT]: "绕着他转",
    [MOTION_MOVE.SPIRAL]: "绕着他转并升高",
    [MOTION_MOVE.ARC_DOLLY]: "弧线贴近",
    [MOTION_MOVE.DOLLY_ZOOM]: "跟着走的眩晕变焦",
    [MOTION_MOVE.HOLD]: "保持站位",
};

/**
 * 朝向类语汇:只改注视方向、不改机位(两枚关键帧 position 相同)。
 * 一旦绑定被摄对象,注视覆盖层就接管全部关键帧的 target,这类语汇随即变成空操作——
 * 故命令层直接拒绝,不产出「看起来创建成功却纹丝不动」的片段。
 */
export function isOrientationMove(move: MotionMove): boolean {
    return move === MOTION_MOVE.PAN || move === MOTION_MOVE.TILT;
}

/** 环绕方向:从被摄体正上方俯视的顺/逆时针 */
export const ORBIT_DIRECTION = { CW: "cw", CCW: "ccw" } as const;
export type OrbitDirection = (typeof ORBIT_DIRECTION)[keyof typeof ORBIT_DIRECTION];

/** 方向 → 转角符号查表(纪律:禁并列 if) */
const ORBIT_DIRECTION_SIGN: Record<OrbitDirection, 1 | -1> = { cw: 1, ccw: -1 };

/** 预设运镜的默认时长(秒):机位面板与快速创建共用 */
export const DEFAULT_PRESET_DURATION_SECONDS = 2;

/** 导演可选时长:两处入口必须产出同一档位,避免成片节奏漂移。 */
export const MOTION_DURATION_OPTIONS_SECONDS = [2, 4, 8] as const;
/** 成片占用时段按秒显示一位小数,与时间轴时长读数一致。 */
export const MOTION_PROGRAM_RANGE_DECIMALS = 1;

export interface MotionProgramRangeOptions {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export interface MotionProgramRange {
    readonly startTimeSeconds: number;
    readonly endTimeSeconds: number;
}

/** 预设入口共用的成片占用范围:显示与命令载荷始终来自同一时长。 */
export function motionProgramRangeFor(options: MotionProgramRangeOptions): MotionProgramRange {
    return {
        startTimeSeconds: options.startTimeSeconds,
        endTimeSeconds: options.startTimeSeconds + options.durationSeconds,
    };
}

/** 命令层围栏:payload 的 direction 先过枚举检查(hasOwn 挡原型链) */
export function isOrbitDirection(value: unknown): value is OrbitDirection {
    return typeof value === "string" && Object.hasOwn(ORBIT_DIRECTION_SIGN, value);
}

export interface MotionPresetRequest {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly move: MotionMove;
    /** 有 subject 则自动绑跟拍 */
    readonly subjectId?: string;
    /** 落幅景别(复用 ShotSizePresets) */
    readonly shotSize?: ShotSize;
    readonly easing?: EasingCurve;
    /** 环绕类语汇(orbit/spiral)的转角(度);缺省 90,上限 360 */
    readonly degrees?: number;
    /** 环绕类语汇的方向;缺省 cw(俯视顺时针) */
    readonly direction?: OrbitDirection;
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
/** 环绕默认转角(度) */
const ORBIT_DEFAULT_DEGREES = 90;
/** 环绕角度上限:整圈 */
export const ORBIT_MAX_DEGREES = 360;
/** 环绕类保形密度:约每 30° 一枚关键帧(圆弧靠多点保形,不靠手柄硬掰) */
const ORBIT_DEGREES_PER_KEY = 30;
/** 弧线推近关键点数:弧线+推近双变化,三键保形 */
const ARC_DOLLY_KEY_COUNT = 3;
/** 螺旋升降的爬升幅度:相对被摄距离 */
const SPIRAL_RISE_RATIO = 0.35;
/** 弧线推近的环绕转角 */
const ARC_DOLLY_RADIANS = Math.PI / 4;
/** 滑动变焦的推拉幅度:推进四成,焦距反比补偿保持主体构图大小(希区柯克) */
const DOLLY_ZOOM_RATIO = 0.4;
const MIN_DISTANCE = 0.001;
const DEGREES_TO_RADIANS = Math.PI / 180;

/** 环绕类语汇的参数解析:方向取符号,键数按角度自适应 */
function orbitParamsOf(request: MotionPresetRequest): { readonly radians: number; readonly keyCount: number } {
    const degrees = request.degrees ?? ORBIT_DEFAULT_DEGREES;
    const keyCount = Math.max(Math.round(degrees / ORBIT_DEGREES_PER_KEY) + 1, 2);
    const sign = ORBIT_DIRECTION_SIGN[request.direction ?? ORBIT_DIRECTION.CW];
    return { radians: degrees * DEGREES_TO_RADIANS * sign, keyCount };
}

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
    /** 焦距覆盖(滑动变焦);缺省 = null 进关键帧,沿用机位/上一帧 */
    readonly fov?: number;
}

type MoveResolver = (context: MotionPresetContext, request: MotionPresetRequest) => readonly MovePose[];

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
    [MOTION_MOVE.ORBIT]: ({ shot, subject }, request) => {
        const pivot = subject?.center ?? shot.target;
        const { radians, keyCount } = orbitParamsOf(request);
        return Array.from({ length: keyCount }, (_, index) => {
            const step = (radians * index) / (keyCount - 1);
            return { position: rotateAroundY(shot.position, pivot, step), target: pivot };
        });
    },
    [MOTION_MOVE.SPIRAL]: ({ shot, subject }, request) => {
        const pivot = subject?.center ?? shot.target;
        const { radians, keyCount } = orbitParamsOf(request);
        const rise = length(subtract(shot.target, shot.position)) * SPIRAL_RISE_RATIO;
        return Array.from({ length: keyCount }, (_, index) => {
            const t = index / (keyCount - 1);
            const rotated = rotateAroundY(shot.position, pivot, radians * t);
            const lifted: Vec3 = [rotated[0], rotated[1] + rise * t, rotated[2]];
            return { position: lifted, target: pivot };
        });
    },
    [MOTION_MOVE.ARC_DOLLY]: ({ shot, subject }) => {
        const pivot = subject?.center ?? shot.target;
        const approach = subtract(shot.target, shot.position);
        return Array.from({ length: ARC_DOLLY_KEY_COUNT }, (_, index) => {
            const t = index / (ARC_DOLLY_KEY_COUNT - 1);
            const advanced = add(shot.position, approach, DOLLY_RATIO * t);
            return { position: rotateAroundY(advanced, pivot, ARC_DOLLY_RADIANS * t), target: pivot };
        });
    },
    [MOTION_MOVE.DOLLY_ZOOM]: ({ shot }) => {
        // 希区柯克变焦:位置推进,焦距按距离比反放,主体构图大小不变、背景压缩
        const approached = add(shot.position, subtract(shot.target, shot.position), DOLLY_ZOOM_RATIO);
        const halfFovRadians = (shot.fov / 2) * DEGREES_TO_RADIANS;
        const keptFov = (2 * Math.atan(Math.tan(halfFovRadians) / (1 - DOLLY_ZOOM_RATIO))) / DEGREES_TO_RADIANS;
        return [
            { position: shot.position, target: shot.target },
            { position: approached, target: shot.target, fov: keptFov },
        ];
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
        const poses = MOVE_RESOLVERS[request.move](context, request);
        const landing = this.landingPose(request, context);
        const resolved: readonly MovePose[] = landing ? [...poses.slice(0, -1), landing] : poses;
        const divisor = Math.max(resolved.length - 1, 1);
        return resolved.map((pose, index) => ({
            id: createId(),
            progress: index / divisor,
            position: pose.position,
            inHandle: [0, 0, 0],
            outHandle: [0, 0, 0],
            handleMode: MOTION_HANDLE_MODE.AUTO,
            target: pose.target,
            // 每枚 key 都携带完整焦距，成片不再回退读取起幅机位。
            fov: pose.fov ?? context.shot.fov,
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
