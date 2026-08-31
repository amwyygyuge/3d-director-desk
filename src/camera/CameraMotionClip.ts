import { CameraFocusTrack } from "./CameraFocusTrack";
import type { CameraFocusTrackJSON, FocusTargetSample } from "./CameraFocusTrack";
import { CameraMotionPath, sampleCameraMotionPath } from "./CameraMotionPath";
import type { CameraMotionPathJSON, PathPositionSample } from "./CameraMotionPath";
import type { CameraShot } from "./CameraShot";

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
    readonly focus: CameraFocusTrack | CameraFocusTrackJSON;
    readonly easing: CameraMotionEasing;
}

export interface CameraMotionClipJSON {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly path: CameraMotionPathJSON;
    readonly focus: CameraFocusTrackJSON;
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

function isEasing(value: CameraMotionEasing): boolean {
    return value === CAMERA_MOTION_EASING.LINEAR || value === CAMERA_MOTION_EASING.SMOOTH;
}

/**
 * Time-bound camera movement aggregate. Camera configuration remains on CameraShot;
 * path and focus remain separate so future target keys do not alter spatial motion semantics.
 */
export class CameraMotionClip {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly path: CameraMotionPath;
    readonly focus: CameraFocusTrack;
    readonly easing: CameraMotionEasing;

    constructor(init: CameraMotionClipInit) {
        const path = init.path instanceof CameraMotionPath ? init.path : new CameraMotionPath(init.path);
        const focus = init.focus instanceof CameraFocusTrack ? init.focus : new CameraFocusTrack({ target: init.focus.target });
        if (
            init.id.length === 0 ||
            init.cameraId.length === 0 ||
            !Number.isFinite(init.startTimeSeconds) ||
            init.startTimeSeconds < 0 ||
            !Number.isFinite(init.durationSeconds) ||
            init.durationSeconds <= 0 ||
            !isEasing(init.easing)
        ) {
            throw new Error("CameraMotionClip requires stable identifiers, finite timing, a focus track, and easing");
        }
        this.id = init.id;
        this.cameraId = init.cameraId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        this.path = path;
        this.focus = focus;
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

    withFocus(focus: CameraFocusTrack): CameraMotionClip {
        return new CameraMotionClip({ ...this.toJSON(), focus });
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
            focus: this.focus.toJSON(),
            easing: this.easing,
        };
    }
}

function easedProgress(easing: CameraMotionEasing, progress: number): number {
    return easing === CAMERA_MOTION_EASING.SMOOTH ? progress * progress * (3 - 2 * progress) : progress;
}

/** Samples spatial motion and a resolved focus target into caller-owned scalars without allocations. */
export function sampleCameraMotionClip(
    clip: CameraMotionClip,
    timeSeconds: number,
    shot: CameraShot,
    focusTarget: FocusTargetSample,
    pathSample: PathPositionSample,
    sample: CameraMotionSample,
): boolean {
    if (!clip.covers(timeSeconds)) return false;
    const progress = (timeSeconds - clip.startTimeSeconds) / clip.durationSeconds;
    if (!sampleCameraMotionPath(clip.path, easedProgress(clip.easing, progress), pathSample)) return false;
    sample.positionX = pathSample.x;
    sample.positionY = pathSample.y;
    sample.positionZ = pathSample.z;
    sample.targetX = focusTarget.x;
    sample.targetY = focusTarget.y;
    sample.targetZ = focusTarget.z;
    sample.fov = shot.fov;
    return true;
}
