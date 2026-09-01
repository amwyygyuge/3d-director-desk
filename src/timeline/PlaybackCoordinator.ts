import { reaction } from "mobx";

import type { AnimationBinder } from "@/animation/AnimationBinder";
import { CameraMotionSampler } from "@/camera/CameraMotionSampler";
import type { CameraMotionSink } from "@/camera/CameraMotionSampler";
import { PoseLayer } from "@/pose/PoseLayer";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { SceneManager } from "@/core/SceneManager";
import type { CameraStore } from "@/store/CameraStore";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { TimelineStore } from "@/store/TimelineStore";
import type { TimeTransport } from "@/time/TimeTransport";
import { TimelineSampler } from "@/timeline/TimelineSampler";

export type TimelineInvalidator = () => void;

/**
 * 时间轴运行时协调器：订阅 playhead，按顺序在动作采样之后执行变换层；
 * 仅触碰 SceneManager 的 Three 运行时索引，绝不写入实体/MobX 或历史栈。
 */
export class PlaybackCoordinator {
    private readonly sampler = new TimelineSampler();
    private readonly motionSampler: CameraMotionSampler;
    private readonly poseLayer: PoseLayer;
    private invalidator: TimelineInvalidator | null = null;
    private readonly stopTransportReaction: () => void;
    private readonly stopStoppedReaction: () => void;

    constructor(
        private readonly timeline: TimelineStore,
        private readonly scene: SceneManager,
        private readonly transport: TimeTransport,
        motion: CameraMotionStore,
        camera: CameraStore,
        private readonly binder: AnimationBinder,
        private readonly skeletons: SkeletonRuntimeRegistry,
    ) {
        this.motionSampler = new CameraMotionSampler(motion, camera, scene);
        this.poseLayer = new PoseLayer(skeletons);
        // A single reaction owns deterministic binder → transform → camera → pose sampling order.
        this.stopTransportReaction = reaction(
            () => transport.time,
            (timeSeconds) => this.sample(timeSeconds),
        );
        this.stopStoppedReaction = reaction(
            () => transport.stoppedAt,
            () => this.restoreAll(),
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

    /** 非时间线的局部动作预览复用唯一 Canvas invalidator，不采样全局 playhead。 */
    requestRender(): void {
        this.invalidate();
    }

    sampleObject(targetId: string): void {
        const runtime = this.scene.getRuntime(targetId);
        const entity = this.scene.getEntity(targetId);

        if (!runtime || !entity) return;
        this.skeletons.restoreRotations(targetId);
        this.binder.setTime(this.currentTime());
        const transformTrack = this.timeline.document.trackForTarget(targetId, TIMELINE_TRACK_KIND.TRANSFORM);
        if (!transformTrack || !this.sampler.evaluateTrack(transformTrack, this.currentTime(), runtime))
            this.restoreObject(targetId, false);
        this.applyPose(targetId);
        this.invalidate();
    }
    restoreAll(): void {
        this.restorePoseBaselines();
        this.binder.setTime(this.currentTime());
        for (const entity of this.scene.list()) {
            this.poseLayer.apply(entity.id, entity.pose);
        }
        this.motionSampler.restore();
        this.invalidate();
    }

    restoreObject(targetId: string, shouldInvalidate = true): void {
        const runtime = this.scene.getRuntime(targetId);
        const entity = this.scene.getEntity(targetId);
        if (!runtime || !entity) return;
        const transform = entity.transform;
        runtime.position.set(transform.position[0], transform.position[1], transform.position[2]);
        runtime.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
        runtime.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
        if (shouldInvalidate) this.invalidate();
    }

    dispose(): void {
        this.stopTransportReaction();
        this.stopStoppedReaction();
        this.restoreAll();
        this.invalidator = null;
    }

    private sample(timeSeconds: number): void {
        this.restorePoseBaselines();
        this.binder.setTime(timeSeconds);
        const entities = this.scene.list();
        for (let index = 0; index < entities.length; index += 1) {
            const entity = entities[index];
            if (!entity) continue;
            const runtime = this.scene.getRuntime(entity.id);
            if (!runtime) continue;
            const transformTrack = this.timeline.document.trackForTarget(entity.id, TIMELINE_TRACK_KIND.TRANSFORM);
            if (!transformTrack || !this.sampler.evaluateTrack(transformTrack, timeSeconds, runtime))
                this.restoreObject(entity.id, false);
        }
        this.motionSampler.sampleCurrent(timeSeconds);
        for (let index = 0; index < entities.length; index += 1) {
            const entity = entities[index];
            if (entity) this.applyPose(entity.id);
        }
        this.invalidate();
    }

    private applyPose(targetId: string): void {
        const entity = this.scene.getEntity(targetId);
        if (!entity || entity.kind !== "model") return;
        this.poseLayer.apply(targetId, entity.pose);
    }
    private restorePoseBaselines(): void {
        this.skeletons.restoreAllRotations();
    }

    private currentTime(): number {
        return this.transport.time;
    }

    private invalidate(): void {
        this.invalidator?.();
    }
}
