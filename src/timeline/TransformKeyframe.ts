import type { Transform } from "../core/SceneObject";

export const TIMELINE_EASING = {
    LINEAR: "linear",
    SMOOTH: "smooth",
} as const;

export type TimelineEasing = (typeof TIMELINE_EASING)[keyof typeof TIMELINE_EASING];

export interface TransformKeyframeInit {
    readonly id: string;
    readonly time: number;
    readonly value: Transform;
    readonly easing: TimelineEasing;
}

function copyVector([x, y, z]: Transform["position"]): Transform["position"] {
    return [x, y, z];
}

function copyTransform(value: Transform): Transform {
    return {
        position: copyVector(value.position),
        rotation: copyVector(value.rotation),
        scale: copyVector(value.scale),
    };
}

/** 可序列化的变换关键帧值对象；时间采用绝对秒。 */
export class TransformKeyframe {
    readonly id: string;
    readonly time: number;
    readonly value: Transform;
    readonly easing: TimelineEasing;

    constructor(init: TransformKeyframeInit) {
        this.id = init.id;
        this.time = init.time;
        this.value = copyTransform(init.value);
        this.easing = init.easing;
        Object.freeze(this.value.position);
        Object.freeze(this.value.rotation);
        Object.freeze(this.value.scale);
        Object.freeze(this.value);
        Object.freeze(this);
    }

    toJSON(): TransformKeyframeInit {
        return {
            id: this.id,
            time: this.time,
            value: copyTransform(this.value),
            easing: this.easing,
        };
    }
}
