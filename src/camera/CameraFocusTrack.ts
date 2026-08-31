import type { Vec3 } from "../core/SceneObject";
import { finiteVec3 } from "../core/SceneObject";

export const FOCUS_TARGET_KIND = {
    WORLD_POINT: "world-point",
    SCENE_OBJECT: "scene-object",
} as const;
export type FocusTargetKind = (typeof FOCUS_TARGET_KIND)[keyof typeof FOCUS_TARGET_KIND];

export interface WorldPointFocusTargetJSON {
    readonly kind: typeof FOCUS_TARGET_KIND.WORLD_POINT;
    readonly position: Vec3;
}

export interface SceneObjectFocusTargetJSON {
    readonly kind: typeof FOCUS_TARGET_KIND.SCENE_OBJECT;
    readonly objectId: string;
    readonly worldOffset: Vec3;
}

export type FocusTargetJSON = WorldPointFocusTargetJSON | SceneObjectFocusTargetJSON;
export type FocusTarget = WorldPointFocusTarget | SceneObjectFocusTarget;

export interface CameraFocusTrackInit {
    readonly target: FocusTarget | FocusTargetJSON;
}

export interface CameraFocusTrackJSON {
    readonly mode: "single";
    readonly target: FocusTargetJSON;
}

/** Caller-owned scalar focus output. Its shape stays stable when keyframed focus is introduced. */
export interface FocusTargetSample {
    x: number;
    y: number;
    z: number;
}

function copyVector(vector: Vec3): Vec3 {
    return [vector[0], vector[1], vector[2]];
}

/** A fixed world-space focus point. */
export class WorldPointFocusTarget {
    readonly kind = FOCUS_TARGET_KIND.WORLD_POINT;
    readonly position: Vec3;

    constructor(init: WorldPointFocusTargetJSON) {
        if (!finiteVec3(init.position)) throw new Error("WorldPointFocusTarget requires a finite world position");
        this.position = copyVector(init.position);
        Object.freeze(this);
    }

    toJSON(): WorldPointFocusTargetJSON {
        return { kind: this.kind, position: copyVector(this.position) };
    }
}

/** A scene root binding with an explicit world-space framing offset. */
export class SceneObjectFocusTarget {
    readonly kind = FOCUS_TARGET_KIND.SCENE_OBJECT;
    readonly objectId: string;
    readonly worldOffset: Vec3;

    constructor(init: SceneObjectFocusTargetJSON) {
        if (init.objectId.length === 0 || !finiteVec3(init.worldOffset)) {
            throw new Error("SceneObjectFocusTarget requires an object id and finite world offset");
        }
        this.objectId = init.objectId;
        this.worldOffset = copyVector(init.worldOffset);
        Object.freeze(this);
    }

    toJSON(): SceneObjectFocusTargetJSON {
        return { kind: this.kind, objectId: this.objectId, worldOffset: copyVector(this.worldOffset) };
    }
}

function focusTargetFrom(value: FocusTarget | FocusTargetJSON): FocusTarget {
    if (value instanceof WorldPointFocusTarget || value instanceof SceneObjectFocusTarget) return value;
    return value.kind === FOCUS_TARGET_KIND.WORLD_POINT
        ? new WorldPointFocusTarget(value)
        : new SceneObjectFocusTarget(value);
}

/**
 * Stable focus boundary for a clip. The current single target deliberately occupies this class so
 * future keyframes change its internal strategy without changing CameraMotionClip or the sampler.
 */
export class CameraFocusTrack {
    readonly target: FocusTarget;

    constructor(init: CameraFocusTrackInit) {
        this.target = focusTargetFrom(init.target);
        Object.freeze(this);
    }

    withTarget(target: FocusTarget): CameraFocusTrack {
        return new CameraFocusTrack({ target });
    }

    toJSON(): CameraFocusTrackJSON {
        return { mode: "single", target: this.target.toJSON() };
    }
}
