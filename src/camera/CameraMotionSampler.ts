import type { FocusTargetSample } from "@/camera/CameraFocusTrack";
import { FocusTargetResolver } from "@/camera/FocusTargetResolver";
import type { SceneManager } from "@/core/SceneManager";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { CameraStore } from "@/store/CameraStore";
import { sampleCameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import type { PathPositionSample } from "@/camera/CameraMotionPath";

/** R3F-owned runtime bridge; no Three references ever enter MobX state. */
export interface CameraMotionSink {
    applyMotion(sample: CameraMotionSample): void;
    restoreFreeDirectorPose(): void;
}

/**
 * Runtime-only Program evaluator. It reads every time-varying value from immutable data and writes
 * only caller-owned scalars into the current R3F camera, preserving free editor camera state.
 */
export class CameraMotionSampler {
    private sink: CameraMotionSink | null = null;
    private readonly pathSample: PathPositionSample = { x: 0, y: 0, z: 0 };
    private readonly focusSample: FocusTargetSample = { x: 0, y: 0, z: 0 };
    private readonly focusResolver: FocusTargetResolver;
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
        scene: SceneManager,
    ) {
        this.focusResolver = new FocusTargetResolver(scene);
    }

    bindSink(sink: CameraMotionSink): void {
        this.sink = sink;
    }

    unbindSink(sink: CameraMotionSink): void {
        if (this.sink !== sink) return;
        sink.restoreFreeDirectorPose();
        this.sink = null;
    }

    sampleCurrent(timeSeconds: number): boolean {
        const cameraId = this.motion.program.cameraAt(timeSeconds);
        const shot = cameraId ? this.camera.director.getShot(cameraId) : undefined;
        if (!cameraId || !shot) {
            this.sink?.restoreFreeDirectorPose();
            return false;
        }
        const clip = this.motion.clipAt(cameraId, timeSeconds);
        if (
            clip &&
            this.focusResolver.resolve(clip.focus, this.focusSample) &&
            sampleCameraMotionClip(clip, timeSeconds, shot, this.focusSample, this.pathSample, this.sample)
        ) {
            this.sink?.applyMotion(this.sample);
            return true;
        }
        this.sample.positionX = shot.position[0];
        this.sample.positionY = shot.position[1];
        this.sample.positionZ = shot.position[2];
        this.sample.targetX = shot.target[0];
        this.sample.targetY = shot.target[1];
        this.sample.targetZ = shot.target[2];
        this.sample.fov = shot.fov;
        this.sink?.applyMotion(this.sample);
        return true;
    }

    restore(): void {
        this.sink?.restoreFreeDirectorPose();
    }
}
