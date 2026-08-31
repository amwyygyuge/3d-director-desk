import type { Vec3 } from "../core/SceneObject";

export interface MotionPathAnchorInit {
    readonly id: string;
    readonly position: Vec3;
    readonly inHandle?: Vec3;
    readonly outHandle?: Vec3;
}

export interface MotionPathAnchorJSON {
    readonly id: string;
    readonly position: Vec3;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;
}

export interface CameraMotionPathInit {
    readonly anchors: readonly (MotionPathAnchor | MotionPathAnchorInit)[];
}

export interface CameraMotionPathJSON {
    readonly anchors: readonly MotionPathAnchorJSON[];
}

export interface PathPositionSample {
    x: number;
    y: number;
    z: number;
}
const MINIMUM_PATH_ANCHORS = 2;
const CUBIC_BEZIER_CONTROL_WEIGHT = 3;

const ZERO_VECTOR: Vec3 = [0, 0, 0];

function copyVector(vector: Vec3): Vec3 {
    return [vector[0], vector[1], vector[2]];
}

function isFiniteVector(vector: Vec3): boolean {
    return vector.every((component) => Number.isFinite(component));
}

/** Immutable Bézier anchor. Handles are offsets from the anchor position, never Three vectors. */
export class MotionPathAnchor {
    readonly id: string;
    readonly position: Vec3;
    readonly inHandle: Vec3;
    readonly outHandle: Vec3;

    constructor(init: MotionPathAnchorInit) {
        const inHandle = init.inHandle ?? ZERO_VECTOR;
        const outHandle = init.outHandle ?? ZERO_VECTOR;
        if (init.id.length === 0 || !isFiniteVector(init.position) || !isFiniteVector(inHandle) || !isFiniteVector(outHandle)) {
            throw new Error("MotionPathAnchor requires a stable id and finite vectors");
        }
        this.id = init.id;
        this.position = copyVector(init.position);
        this.inHandle = copyVector(inHandle);
        this.outHandle = copyVector(outHandle);
        Object.freeze(this);
    }

    withPosition(position: Vec3): MotionPathAnchor {
        return new MotionPathAnchor({ ...this.toJSON(), position });
    }

    withHandle(kind: "in" | "out", value: Vec3): MotionPathAnchor {
        const handles = kind === "in" ? { inHandle: value } : { outHandle: value };
        return new MotionPathAnchor({ ...this.toJSON(), ...handles });
    }

    toJSON(): MotionPathAnchorJSON {
        return {
            id: this.id,
            position: copyVector(this.position),
            inHandle: copyVector(this.inHandle),
            outHandle: copyVector(this.outHandle),
        };
    }
}

/** Immutable spatial path. Time belongs to CameraMotionClip, so one path can be retimed without redrawing it. */
export class CameraMotionPath {
    readonly anchors: readonly MotionPathAnchor[];

    constructor(init: CameraMotionPathInit) {
        const anchors = init.anchors.map((anchor) =>
            anchor instanceof MotionPathAnchor ? anchor : new MotionPathAnchor(anchor),
        );
        if (anchors.length < MINIMUM_PATH_ANCHORS) throw new Error("CameraMotionPath requires at least two anchors");
        const ids = new Set(anchors.map((anchor) => anchor.id));
        if (ids.size !== anchors.length) throw new Error("CameraMotionPath anchor ids must be unique");
        this.anchors = Object.freeze(anchors);
        Object.freeze(this);
    }

    anchor(anchorId: string): MotionPathAnchor | undefined {
        return this.anchors.find((anchor) => anchor.id === anchorId);
    }

    withAnchor(anchor: MotionPathAnchor): CameraMotionPath {
        const existing = this.anchor(anchor.id);
        const anchors = existing
            ? this.anchors.map((current) => (current.id === anchor.id ? anchor : current))
            : [...this.anchors, anchor];
        return new CameraMotionPath({ anchors });
    }

    withoutAnchor(anchorId: string): CameraMotionPath | null {
        const anchors = this.anchors.filter((anchor) => anchor.id !== anchorId);
        return anchors.length < MINIMUM_PATH_ANCHORS ? null : new CameraMotionPath({ anchors });
    }

    toJSON(): CameraMotionPathJSON {
        return { anchors: this.anchors.map((anchor) => anchor.toJSON()) };
    }
}

function cubicPoint(
    from: MotionPathAnchor,
    to: MotionPathAnchor,
    progress: number,
    sample: PathPositionSample,
): void {
    const inverse = 1 - progress;
    const inverseSquared = inverse * inverse;
    const progressSquared = progress * progress;
    const fromOutX = from.position[0] + from.outHandle[0];
    const fromOutY = from.position[1] + from.outHandle[1];
    const fromOutZ = from.position[2] + from.outHandle[2];
    const toInX = to.position[0] + to.inHandle[0];
    const toInY = to.position[1] + to.inHandle[1];
    const toInZ = to.position[2] + to.inHandle[2];
    sample.x =
        inverseSquared * inverse * from.position[0] +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverseSquared * progress * fromOutX +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverse * progressSquared * toInX +
        progressSquared * progress * to.position[0];
    sample.y =
        inverseSquared * inverse * from.position[1] +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverseSquared * progress * fromOutY +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverse * progressSquared * toInY +
        progressSquared * progress * to.position[1];
    sample.z =
        inverseSquared * inverse * from.position[2] +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverseSquared * progress * fromOutZ +
        CUBIC_BEZIER_CONTROL_WEIGHT * inverse * progressSquared * toInZ +
        progressSquared * progress * to.position[2];
}

/** Samples a spatial Bézier path into caller-owned scalars; suitable for every playback frame. */
export function sampleCameraMotionPath(path: CameraMotionPath, progress: number, sample: PathPositionSample): boolean {
    if (!Number.isFinite(progress)) return false;
    const segmentCount = path.anchors.length - 1;
    const clamped = Math.min(Math.max(progress, 0), 1);
    const scaled = clamped * segmentCount;
    const segmentIndex = Math.min(Math.floor(scaled), segmentCount - 1);
    const from = path.anchors[segmentIndex];
    const to = path.anchors[segmentIndex + 1];
    if (!from || !to) return false;
    cubicPoint(from, to, scaled - segmentIndex, sample);
    return true;
}
