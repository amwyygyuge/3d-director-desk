import { reaction } from "mobx";

import { CameraMotionSampler } from "../camera/CameraMotionSampler";
import type { CameraMotionSink } from "../camera/CameraMotionSampler";
import { PoseLayer } from "../pose/PoseLayer";
import type { SkeletonRuntimeRegistry } from "../pose/SkeletonRuntimeRegistry";
import type { SceneManager } from "../core/SceneManager";
import type { CameraStore } from "../store/CameraStore";
import type { CameraMotionStore } from "../store/CameraMotionStore";
import type { TimeTransport } from "../time/TimeTransport";

export type TimelineInvalidator = () => void;

/**
 * Camera-only timeline coordinator. Scene entities keep their authoritative transforms and static
 * pose snapshots; playback advances only Program camera motion and never animates models.
 */
export class PlaybackCoordinator {
    private readonly motionSampler: CameraMotionSampler;
    private readonly poseLayer: PoseLayer;
    private invalidator: TimelineInvalidator | null = null;
    private readonly stopTransportReaction: () => void;
    private readonly stopStoppedReaction: () => void;

    constructor(
        private readonly scene: SceneManager,
        private readonly transport: TimeTransport,
        motion: CameraMotionStore,
        camera: CameraStore,
        private readonly skeletons: SkeletonRuntimeRegistry,
    ) {
        this.motionSampler = new CameraMotionSampler(motion, camera, scene);
        this.poseLayer = new PoseLayer(skeletons);
        this.stopTransportReaction = reaction(
            () => transport.time,
            (timeSeconds) => this.sample(timeSeconds),
        );
        this.stopStoppedReaction = reaction(
            () => transport.stoppedAt,
            () => this.sample(this.currentTime()),
        );
    }

    bindInvalidator(invalidator: TimelineInvalidator): void {
        this.invalidator = invalidator;
        this.sampleCurrent();
    }

    unbindInvalidator(invalidator: TimelineInvalidator): void {
        if (this.invalidator === invalidator) this.invalidator = null;
    }

    bindMotionSink(sink: CameraMotionSink): void {
        this.motionSampler.bindSink(sink);
        this.sampleCurrent();
    }

    unbindMotionSink(sink: CameraMotionSink): void {
        this.motionSampler.unbindSink(sink);
    }

    sampleCurrent(): void {
        this.sample(this.currentTime());
    }

    restoreCameraMotion(): void {
        this.motionSampler.restore();
        this.invalidate();
    }

    requestRender(): void {
        this.invalidate();
    }

    /** Runtime registration and pose edits need an immediate camera/pose refresh in demand mode. */
    sampleObject(): void {
        this.sampleCurrent();
    }

    restoreObject(): void {
        this.sampleCurrent();
    }

    dispose(): void {
        this.stopTransportReaction();
        this.stopStoppedReaction();
        this.motionSampler.restore();
        this.invalidator = null;
    }

    private sample(timeSeconds: number): void {
        this.skeletonsRestoreAndApplyPoses();
        this.motionSampler.sampleCurrent(timeSeconds);
        this.invalidate();
    }

    private skeletonsRestoreAndApplyPoses(): void {
        this.skeletons.restoreAllRotations();
        for (const entity of this.scene.list()) {
            if (entity.kind === "model") this.poseLayer.apply(entity.id, entity.pose);
        }
    }

    private currentTime(): number {
        return this.transport.time;
    }

    private invalidate(): void {
        this.invalidator?.();
    }
}
