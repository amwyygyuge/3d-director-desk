import type { CameraMotionStore } from "../store/CameraMotionStore";
import type { CameraStore } from "../store/CameraStore";
import { sampleCameraMotionPath } from "./CameraMotionPath";
import type { CameraMotionSample } from "./CameraMotionPath";

/** R3F-owned runtime bridge; no Three references ever enter MobX state. */
export interface CameraMotionSink {
    applyMotion(sample: CameraMotionSample): void;
    restoreFreeDirectorPose(): void;
}

/**
 * Runtime-only motion evaluator. The reusable scalar sample keeps every playback tick allocation-free;
 * the enclosing PlaybackCoordinator owns reactions and invalidation ordering.
 */
export class CameraMotionSampler {
    private sink: CameraMotionSink | null = null;
    private readonly sample: CameraMotionSample = {
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        targetX: 0,
        targetY: 0,
        targetZ: 0,
        fov: 45,
    };

    constructor(
        private readonly motion: CameraMotionStore,
        private readonly camera: CameraStore,
    ) {}

    bindSink(sink: CameraMotionSink): void {
        this.sink = sink;
    }

    unbindSink(sink: CameraMotionSink): void {
        if (this.sink !== sink) return;
        sink.restoreFreeDirectorPose();
        this.sink = null;
    }

    sampleCurrent(timeSeconds: number): boolean {
        if (this.camera.activeShotId !== null) return false;
        const path = this.motion.path;
        if (!path || !sampleCameraMotionPath(path, timeSeconds, this.sample)) {
            this.sink?.restoreFreeDirectorPose();
            return false;
        }
        this.sink?.applyMotion(this.sample);
        return true;
    }

    restore(): void {
        if (this.camera.activeShotId === null) this.sink?.restoreFreeDirectorPose();
    }
}
