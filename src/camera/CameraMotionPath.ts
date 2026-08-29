import { CameraShot } from "./CameraShot";
import type { Vec3 } from "../core/SceneObject";

export const DIRECTOR_CAMERA_MOTION_ID = "director-camera-motion";
export const CAMERA_MOTION_EASING = {
    LINEAR: "linear",
    SMOOTH: "smooth",
} as const;
export type CameraMotionEasing = (typeof CAMERA_MOTION_EASING)[keyof typeof CAMERA_MOTION_EASING];

export interface CameraShotSnapshot {
    readonly position: Vec3;
    readonly target: Vec3;
    readonly fov: number;
}

export interface MotionKeyInit {
    readonly id: string;
    readonly timeSeconds: number;
    readonly shot: CameraShot | CameraShotSnapshot;
    readonly easing: CameraMotionEasing;
}

export interface MotionKeyJSON {
    readonly id: string;
    readonly timeSeconds: number;
    readonly shot: CameraShotSnapshot;
    readonly easing: CameraMotionEasing;
}

export interface CameraMotionPathInit {
    readonly id?: string;
    readonly keys: readonly (MotionKey | MotionKeyInit)[];
}

export interface CameraMotionPathJSON {
    readonly id: string;
    readonly keys: readonly MotionKeyJSON[];
}

/** Immutable camera-motion key: absolute timeline time plus a complete camera snapshot. */
export class MotionKey {
    readonly id: string;
    readonly timeSeconds: number;
    readonly shot: CameraShot;
    readonly easing: CameraMotionEasing;

    constructor(init: MotionKeyInit) {
        this.id = init.id;
        this.timeSeconds = init.timeSeconds;
        this.shot = init.shot instanceof CameraShot ? init.shot : new CameraShot(init.shot);
        this.easing = init.easing;
        Object.freeze(this);
    }

    withTime(timeSeconds: number): MotionKey {
        return new MotionKey({ ...this.toJSON(), timeSeconds });
    }

    withEasing(easing: CameraMotionEasing): MotionKey {
        return new MotionKey({ ...this.toJSON(), easing });
    }

    toJSON(): MotionKeyJSON {
        return { id: this.id, timeSeconds: this.timeSeconds, shot: this.shot.toJSON(), easing: this.easing };
    }
}

/** Immutable, serializable single director-camera path. */
export class CameraMotionPath {
    readonly id: string;
    readonly keys: readonly MotionKey[];

    constructor(init: CameraMotionPathInit) {
        this.id = DIRECTOR_CAMERA_MOTION_ID;
        this.keys = Object.freeze(
            init.keys
                .map((key) => key instanceof MotionKey ? key : new MotionKey(key))
                .sort((left, right) => left.timeSeconds - right.timeSeconds),
        );
        Object.freeze(this);
    }

    key(keyId: string): MotionKey | undefined {
        return this.keys.find((current) => current.id === keyId);
    }

    withKey(key: MotionKey): CameraMotionPath {
        return new CameraMotionPath({
            id: this.id,
            keys: [...this.keys.filter((current) => current.id !== key.id), key],
        });
    }

    withoutKey(keyId: string): CameraMotionPath | null {
        const keys = this.keys.filter((current) => current.id !== keyId);
        return keys.length === 0 ? null : new CameraMotionPath({ id: this.id, keys });
    }

    toJSON(): CameraMotionPathJSON {
        return { id: this.id, keys: this.keys.map((key) => key.toJSON()) };
    }
}

/** Reusable scalar output; callers own it so interpolation allocates nothing. */
export interface CameraMotionSample {
    positionX: number;
    positionY: number;
    positionZ: number;
    targetX: number;
    targetY: number;
    targetZ: number;
    fov: number;
}

function easedProgress(easing: CameraMotionEasing, progress: number): number {
    return easing === CAMERA_MOTION_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
}

function writeShot(sample: CameraMotionSample, shot: CameraShot): void {
    sample.positionX = shot.position[0];
    sample.positionY = shot.position[1];
    sample.positionZ = shot.position[2];
    sample.targetX = shot.target[0];
    sample.targetY = shot.target[1];
    sample.targetZ = shot.target[2];
    sample.fov = shot.fov;
}

/**
 * Exact shared interpolation for playback and preview. It intentionally rejects samples outside
 * the authored range so the runtime can restore the free director pose rather than clamp.
 */
export function sampleCameraMotionPath(path: CameraMotionPath, timeSeconds: number, sample: CameraMotionSample): boolean {
    const first = path.keys[0];
    const last = path.keys[path.keys.length - 1];
    if (!first || !last || timeSeconds < first.timeSeconds || timeSeconds > last.timeSeconds) return false;
    if (timeSeconds === first.timeSeconds || first === last) {
        writeShot(sample, first.shot);
        return true;
    }
    if (timeSeconds === last.timeSeconds) {
        writeShot(sample, last.shot);
        return true;
    }

    for (let index = 0; index < path.keys.length - 1; index += 1) {
        const from = path.keys[index];
        const to = path.keys[index + 1];
        if (!from || !to || timeSeconds < from.timeSeconds || timeSeconds > to.timeSeconds) continue;
        const progress = easedProgress(from.easing, (timeSeconds - from.timeSeconds) / (to.timeSeconds - from.timeSeconds));
        sample.positionX = from.shot.position[0] + (to.shot.position[0] - from.shot.position[0]) * progress;
        sample.positionY = from.shot.position[1] + (to.shot.position[1] - from.shot.position[1]) * progress;
        sample.positionZ = from.shot.position[2] + (to.shot.position[2] - from.shot.position[2]) * progress;
        sample.targetX = from.shot.target[0] + (to.shot.target[0] - from.shot.target[0]) * progress;
        sample.targetY = from.shot.target[1] + (to.shot.target[1] - from.shot.target[1]) * progress;
        sample.targetZ = from.shot.target[2] + (to.shot.target[2] - from.shot.target[2]) * progress;
        sample.fov = from.shot.fov + (to.shot.fov - from.shot.fov) * progress;
        return true;
    }
    return false;
}
