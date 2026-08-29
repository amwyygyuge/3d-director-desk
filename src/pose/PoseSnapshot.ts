export type BoneKey = string;
export type QuaternionTuple = readonly [number, number, number, number];

export interface PoseSnapshotInit {
    readonly bones: Readonly<Record<BoneKey, QuaternionTuple>>;
}

function normalizedComponent(value: number): number {
    return Object.is(value, -0) ? 0 : value;
}

function normalizeQuaternion(value: QuaternionTuple): QuaternionTuple {
    const [x, y, z, w] = value;
    const length = Math.hypot(x, y, z, w);
    if (!Number.isFinite(length) || length === 0) {
        throw new Error("PoseSnapshot: quaternion must be finite and non-zero");
    }
    let nx = normalizedComponent(x / length);
    let ny = normalizedComponent(y / length);
    let nz = normalizedComponent(z / length);
    let nw = normalizedComponent(w / length);
    // q and -q describe the same rotation. Canonicalize their sign so JSON is deterministic.
    if (nw < 0 || (nw === 0 && (nz < 0 || (nz === 0 && (ny < 0 || (ny === 0 && nx < 0)))))) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
        nw = -nw;
    }
    return Object.freeze([
        normalizedComponent(nx),
        normalizedComponent(ny),
        normalizedComponent(nz),
        normalizedComponent(nw),
    ] as const);
}

/**
 * Immutable, JSON-round-trippable absolute local bone rotations.
 * Keys are skeleton-root-relative BoneKeys only; semantic labels deliberately remain runtime discovery metadata.
 */
export class PoseSnapshot {
    readonly bones: Readonly<Record<BoneKey, QuaternionTuple>>;
    /** Frozen key/value pairs let the playback hot path iterate without allocating Object.keys entries. */
    readonly entries: readonly (readonly [BoneKey, QuaternionTuple])[];

    constructor(init: PoseSnapshotInit) {
        const bones: Record<BoneKey, QuaternionTuple> = {};
        for (const key of Object.keys(init.bones).sort()) {
            const quaternion = init.bones[key];
            if (
                !key ||
                !Array.isArray(quaternion) ||
                quaternion.length !== 4 ||
                !quaternion.every((component) => typeof component === "number" && Number.isFinite(component))
            ) {
                throw new Error("PoseSnapshot: each bone needs a non-empty key and finite quaternion tuple");
            }
            bones[key] = normalizeQuaternion(quaternion);
        }
        this.bones = Object.freeze(bones);
        this.entries = Object.freeze(Object.keys(bones).map((key) => Object.freeze([key, bones[key]!] as const)));
        Object.freeze(this);
    }

    withBone(key: BoneKey, quaternion: QuaternionTuple): PoseSnapshot {
        return new PoseSnapshot({ bones: { ...this.bones, [key]: quaternion } });
    }

    withoutBone(key: BoneKey): PoseSnapshot {
        const bones: Record<BoneKey, QuaternionTuple> = {};
        for (const currentKey of Object.keys(this.bones)) {
            if (currentKey === key) continue;
            const quaternion = this.bones[currentKey];
            if (quaternion) bones[currentKey] = quaternion;
        }
        return new PoseSnapshot({ bones });
    }

    toJSON(): PoseSnapshotInit {
        const bones: Record<BoneKey, QuaternionTuple> = {};
        for (const key of Object.keys(this.bones)) {
            const value = this.bones[key];
            if (value) bones[key] = [value[0], value[1], value[2], value[3]];
        }
        return { bones };
    }
}

export function isQuaternionTuple(value: unknown): value is QuaternionTuple {
    return (
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((component) => Number.isFinite(component)) &&
        value.some((component) => component !== 0)
    );
}
