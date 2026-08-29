import { PoseSnapshot } from "./PoseSnapshot";
import type { PoseSnapshotInit } from "./PoseSnapshot";
import type { TimelineEasing } from "../timeline/TransformKeyframe";

export interface PoseKeyframeInit {
    readonly id: string;
    readonly time: number;
    readonly value: PoseSnapshot | PoseSnapshotInit;
    readonly easing: TimelineEasing;
}

/** Immutable time-axis value for an object's absolute local pose snapshot. */
export class PoseKeyframe {
    readonly id: string;
    readonly time: number;
    readonly value: PoseSnapshot;
    readonly easing: TimelineEasing;

    constructor(init: PoseKeyframeInit) {
        this.id = init.id;
        this.time = init.time;
        this.value = init.value instanceof PoseSnapshot ? init.value : new PoseSnapshot(init.value);
        this.easing = init.easing;
        Object.freeze(this);
    }

    toJSON(): PoseKeyframeInit {
        return { id: this.id, time: this.time, value: this.value.toJSON(), easing: this.easing };
    }
}
