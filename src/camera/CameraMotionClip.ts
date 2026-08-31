import { CameraMotionPath, sampleCameraMotionPath } from "./CameraMotionPath";
import type { CameraMotionPathJSON, PathPositionSample } from "./CameraMotionPath";
import type { CameraShot } from "./CameraShot";
import type { Vec3 } from "../core/SceneObject";

export const CAMERA_MOTION_EASING = {
    LINEAR: "linear",
    SMOOTH: "smooth",
} as const;
export type CameraMotionEasing = (typeof CAMERA_MOTION_EASING)[keyof typeof CAMERA_MOTION_EASING];

export interface CameraMotionClipInit {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly path: CameraMotionPath | CameraMotionPathJSON;
    readonly target: Vec3;
    readonly easing: CameraMotionEasing;
}

export interface CameraMotionClipJSON {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly path: CameraMotionPathJSON;
    readonly target: Vec3;
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

function copyVector(vector: Vec3): Vec3 {
    return [vector[0], vector[1], vector[2]];
}

function isFiniteVector(vector: Vec3): boolean {
    return vector.every((component) => Number.isFinite(component));
}

function isEasing(value: CameraMotionEasing): boolean {
    return value === CAMERA_MOTION_EASING.LINEAR || value === CAMERA_MOTION_EASING.SMOOTH;
}

/**
 * Time-bound camera movement aggregate. Camera configuration remains on CameraShot;
 * this aggregate owns only the temporal path and its default look-at target.
 */
export class CameraMotionClip {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly path: CameraMotionPath;
    readonly target: Vec3;
    readonly easing: CameraMotionEasing;

    constructor(init: CameraMotionClipInit) {
        const path = init.path instanceof CameraMotionPath ? init.path : new CameraMotionPath(init.path);
        if (
            init.id.length === 0 ||
            init.cameraId.length === 0 ||
            !Number.isFinite(init.startTimeSeconds) ||
            init.startTimeSeconds < 0 ||
            !Number.isFinite(init.durationSeconds) ||
            init.durationSeconds <= 0 ||
            !isFiniteVector(init.target) ||
            !isEasing(init.easing)
        ) {
            throw new Error("CameraMotionClip requires stable identifiers, finite timing, a target, and easing");
        }
        this.id = init.id;
        this.cameraId = init.cameraId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.path = path;
        this.target = copyVector(init.target);
        this.easing = init.easing;
        Object.freeze(this);
    }

    get endTimeSeconds(): number {
        return this.startTimeSeconds + this.durationSeconds;
    }

    covers(timeSeconds: number): boolean {
        return timeSeconds >= this.startTimeSeconds && timeSeconds <= this.endTimeSeconds;
    }

    withTimeRange(startTimeSeconds: number, durationSeconds: number): CameraMotionClip {
        return new CameraMotionClip({ ...this.toJSON(), startTimeSeconds, durationSeconds });
    }

    withPath(path: CameraMotionPath): CameraMotionClip {
        return new CameraMotionClip({ ...this.toJSON(), path });
    }

    withTarget(target: Vec3): CameraMotionClip {
        return new CameraMotionClip({ ...this.toJSON(), target });
    }

    withEasing(easing: CameraMotionEasing): CameraMotionClip {
        return new CameraMotionClip({ ...this.toJSON(), easing });
    }

    toJSON(): CameraMotionClipJSON {
        return {
            id: this.id,
            cameraId: this.cameraId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
            path: this.path.toJSON(),
            target: copyVector(this.target),
            easing: this.easing,
        };
    }
}

function easedProgress(easing: CameraMotionEasing, progress: number): number {
    return easing === CAMERA_MOTION_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
}

/** Samples a clip's path and fixed look-at target into caller-owned scalars without allocations. */
export function sampleCameraMotionClip(
    clip: CameraMotionClip,
    timeSeconds: number,
    shot: CameraShot,
    pathSample: PathPositionSample,
    sample: CameraMotionSample,
): boolean {
    if (!clip.covers(timeSeconds)) return false;
    const progress = (timeSeconds - clip.startTimeSeconds) / clip.durationSeconds;
    if (!sampleCameraMotionPath(clip.path, easedProgress(clip.easing, progress), pathSample)) return false;
    sample.positionX = pathSample.x;
    sample.positionY = pathSample.y;
    sample.positionZ = pathSample.z;
    sample.targetX = clip.target[0];
    sample.targetY = clip.target[1];
    sample.targetZ = clip.target[2];
    sample.fov = shot.fov;
    return true;
}
