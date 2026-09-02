import { FOV_MAX, FOV_MIN } from "@/camera/CameraShot";
import { copyVec3, MotionKey } from "@/motion/MotionKey";
import type { MotionKeyInit, MotionKeyJSON } from "@/motion/MotionKey";
import { finiteVec3 } from "@/core/SceneObject";
import type { Vec3 } from "@/core/SceneObject";

export interface CameraKeyInit extends MotionKeyInit {
    /** 该刻画面注视的世界点;被跟拍目标覆盖时该值仍保留,解绑即恢复 */
    readonly target: Vec3;
    /** 运镜自有焦距;关键帧必须是可独立播放的完整镜头姿态。 */
    readonly fov: number;
}

export interface CameraKeyJSON extends MotionKeyJSON {
    readonly target: Vec3;
    readonly fov: number;
}

/** 作者摆位手势天然产出的一帧画面:位置 + 注视 + 焦距。 */
export interface CameraKeyPose {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
}

export function isCameraKeyFov(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= FOV_MIN && value <= FOV_MAX;
}

/**
 * 镜头关键帧(值对象):在通用轨迹关键点之上补齐「画面」三要素。
 *
 * 决策依据:用户摆的是画面本身而非三条独立的轨,故 position / target / fov 同住一个关键点;
 * 空间形状仍由 motion 模块的轨迹负责,本类只增加相机领域的画面载荷。
 * 缓动不在这里:段内缓动会让每个关键帧处速度归零(环绕会「走一段停一下」),
 * 加减速属于整段时间曲线,住在 CameraMotionClip;段间配速由 progress 分布表达。
 */
export class CameraKey extends MotionKey {
    readonly target: Vec3;
    readonly fov: number;

    constructor(init: CameraKeyInit) {
        super(init);
        if (!finiteVec3(init.target) || !isCameraKeyFov(init.fov)) {
            throw new Error("CameraKey requires a finite target and an in-range fov");
        }
        this.target = copyVec3(init.target);
        this.fov = init.fov;
        Object.freeze(this);
    }

    protected override replicate(overrides: Partial<CameraKeyJSON>): CameraKey {
        return new CameraKey({ ...this.toJSON(), ...overrides });
    }

    override withProgress(progress: number): CameraKey {
        return this.replicate({ progress });
    }

    override withPosition(position: Vec3): CameraKey {
        return this.replicate({ position });
    }

    override withHandle(kind: "in" | "out", value: Vec3): CameraKey {
        return super.withHandle(kind, value) as CameraKey;
    }

    override withAutoHandles(): CameraKey {
        return super.withAutoHandles() as CameraKey;
    }

    /** 视口摆位落点:一次手势同时定死位置、注视与焦距。 */
    withPose(pose: CameraKeyPose): CameraKey {
        return this.replicate({ position: pose.position, target: pose.target, fov: pose.fov });
    }

    override toJSON(): CameraKeyJSON {
        return {
            ...super.toJSON(),
            target: copyVec3(this.target),
            fov: this.fov,
        };
    }
}

export function cameraKeyFrom(value: CameraKey | CameraKeyInit): CameraKey {
    return value instanceof CameraKey ? value : new CameraKey(value);
}
