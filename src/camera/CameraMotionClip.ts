import { CameraFocusTrack } from "@/camera/CameraFocusTrack";
import type { CameraFocusTrackJSON, FocusTargetSample } from "@/camera/CameraFocusTrack";
import { cameraKeyFrom } from "@/camera/CameraKey";
import type { CameraKey } from "@/camera/CameraKey";
import type { CameraKeyInit, CameraKeyJSON } from "@/camera/CameraKey";
import {
    CAMERA_MOTION_EASING,
    easedProgress,
    inverseEasedProgress,
    isCameraMotionEasing,
} from "@/camera/CameraMotionEasing";
import type { CameraMotionEasing } from "@/camera/CameraMotionEasing";
import { MotionTrajectory } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";

export interface CameraMotionClipInit {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly keys: readonly (CameraKey | CameraKeyInit)[];
    /** 跟拍覆盖层:缺省 null = 注视来自关键帧插值 */
    readonly focus?: CameraFocusTrack | CameraFocusTrackJSON | null;
    /** 整段时间曲线:smooth = 起落加减速,linear = 全程匀速;缺省 smooth */
    readonly easing?: CameraMotionEasing;
}

export interface CameraMotionClipJSON {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly keys: readonly CameraKeyJSON[];
    readonly focus: CameraFocusTrackJSON | null;
    readonly easing: CameraMotionEasing;
}

/** Reusable scalar output; Three runtime ownership remains with the scene layer. */
export interface CameraMotionSample {
    positionX: number;
    positionY: number;
    positionZ: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    fov: number;
}

export function createCameraMotionSample(): CameraMotionSample {
    return { positionX: 0, positionY: 0, positionZ: 0, targetX: 0, targetY: 0, targetZ: 0, fov: 45 };
}

function focusFrom(value: CameraMotionClipInit["focus"]): CameraFocusTrack | null {
    const isMissing = value === undefined || value === null;
    if (isMissing) return null;
    return value instanceof CameraFocusTrack ? value : new CameraFocusTrack({ target: value.target });
}

function trajectoryFrom(init: CameraMotionClipInit): MotionTrajectory<CameraKey> {
    return new MotionTrajectory<CameraKey>(init.keys.map(cameraKeyFrom));
}

/**
 * 时序聚合根:一段可独立播放的运镜。
 *
 * 空间形状交给通用 MotionTrajectory(模型走位将复用同一实现),
 * 本类只负责时间边界、跟拍覆盖层与「时间 → 归一化进度」的换算。
 * 运镜 key 自带完整 position/target/fov,永不回读静态机位。
 *
 * 缓动是**整段**的时间曲线,不是每段各自的:段内缓动会让每个关键帧处速度归零
 * (环绕会「走一段停一下」)。段与段之间的快慢由关键帧的 progress 分布表达。
 */
export class CameraMotionClip {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly trajectory: MotionTrajectory<CameraKey>;
    /** 跟拍目标覆盖层:非空时接管全部关键帧的注视点 */
    readonly focus: CameraFocusTrack | null;
    /** 整段起落的时间曲线 */
    readonly easing: CameraMotionEasing;

    constructor(init: CameraMotionClipInit) {
        const focus = focusFrom(init.focus);
        const trajectory = trajectoryFrom(init);
        const easing = init.easing ?? CAMERA_MOTION_EASING.SMOOTH;
        if (
            !isCameraMotionEasing(easing) ||
            init.id.length === 0 ||
            !Number.isFinite(init.startTimeSeconds) ||
            init.startTimeSeconds < 0 ||
            !Number.isFinite(init.durationSeconds) ||
            init.durationSeconds <= 0
        ) {
            throw new Error("CameraMotionClip requires stable identifiers and a finite positive time range");
        }
        this.id = init.id;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.trajectory = trajectory;
        this.focus = focus;
        this.easing = easing;
        Object.freeze(this);
    }

    get keys(): readonly CameraKey[] {
        return this.trajectory.keys;
    }

    get endTimeSeconds(): number {
        return this.startTimeSeconds + this.durationSeconds;
    }

    get isFocusOverriding(): boolean {
        return this.focus !== null;
    }

    covers(timeSeconds: number): boolean {
        return timeSeconds >= this.startTimeSeconds && timeSeconds <= this.endTimeSeconds;
    }

    /** 时间 → 归一化时间:重定时后同一比例仍指向同一时刻。 */
    progressAt(timeSeconds: number): number {
        return (timeSeconds - this.startTimeSeconds) / this.durationSeconds;
    }

    /**
     * 时间 → 轨迹参数(关键帧 progress 所在的域)。
     *
     * 整段时间曲线在此生效:采样与打点必须共用这一个换算,否则「我看到的画面」与
     * 「我落的关键帧」落在轨迹的不同位置,提交后画面会自己跳一下。
     */
    trajectoryProgressAt(timeSeconds: number): number {
        return easedProgress(this.easing, this.progressAt(timeSeconds));
    }

    /** 轨迹参数 → 时刻:时间轴菱形、跳转与吸附的唯一换算口(时间曲线的反解)。 */
    timeAtProgress(progress: number): number {
        return this.startTimeSeconds + inverseEasedProgress(this.easing, progress) * this.durationSeconds;
    }

    key(keyId: string): CameraKey | undefined {
        return this.trajectory.key(keyId);
    }

    withTimeRange(startTimeSeconds: number, durationSeconds: number): CameraMotionClip {
        return this.replicate({ startTimeSeconds, durationSeconds });
    }

    withKey(key: CameraKey): CameraMotionClip {
        return this.replicate({ keys: this.trajectory.withKey(key).keys });
    }

    /** 关键帧少于两个即无轨迹可言;返回 null 让调用方决定是否连片段一并删除。 */
    withoutKey(keyId: string): CameraMotionClip | null {
        const trajectory = this.trajectory.withoutKey(keyId);
        return trajectory ? this.replicate({ keys: trajectory.keys }) : null;
    }

    withFocus(focus: CameraFocusTrack | null): CameraMotionClip {
        return this.replicate({ focus });
    }

    withEasing(easing: CameraMotionEasing): CameraMotionClip {
        return this.replicate({ easing });
    }

    toJSON(): CameraMotionClipJSON {
        return {
            id: this.id,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            keys: this.keys.map((key) => key.toJSON()),
            focus: this.focus?.toJSON() ?? null,
            easing: this.easing,
        };
    }

    private replicate(overrides: Partial<CameraMotionClipInit>): CameraMotionClip {
        return new CameraMotionClip({
            id: this.id,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            keys: this.keys,
            focus: this.focus,
            easing: this.easing,
            ...overrides,
        });
    }
}

/**
 * 采样一刻画面到调用方标量。
 *
 * 时间曲线先作用于**整段进度**(起落加减速),再据此定位段并在段内线性插值——
 * 这保证速度在关键帧处连续,不会每过一枚关键帧就顿一下。
 * 帧级调用,零分配、无临时对象。
 */
export function sampleCameraMotionClip(
    clip: CameraMotionClip,
    timeSeconds: number,
    focusTarget: FocusTargetSample | null,
    positionSample: MotionPositionSample,
    sample: CameraMotionSample,
): boolean {
    if (!clip.covers(timeSeconds)) return false;
    const progress = clip.trajectoryProgressAt(timeSeconds);
    const trajectory = clip.trajectory;
    const segmentIndex = trajectory.segmentIndexAt(progress);
    const from = trajectory.keyAt(segmentIndex);
    const to = trajectory.keyAt(segmentIndex + 1);
    if (!from || !to) return false;
    const local = trajectory.segmentProgress(progress, segmentIndex);
    if (!trajectory.sampleSegment(segmentIndex, local, positionSample)) return false;
    sample.positionX = positionSample.x;
    sample.positionY = positionSample.y;
    sample.positionZ = positionSample.z;
    sample.targetX = focusTarget ? focusTarget.x : from.target[0] + (to.target[0] - from.target[0]) * local;
    sample.targetY = focusTarget ? focusTarget.y : from.target[1] + (to.target[1] - from.target[1]) * local;
    sample.targetZ = focusTarget ? focusTarget.z : from.target[2] + (to.target[2] - from.target[2]) * local;
    sample.fov = from.fov + (to.fov - from.fov) * local;
    return true;
}
