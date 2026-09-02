import { reaction } from "mobx";

import type { AnimationBinder } from "@/animation/AnimationBinder";
import { CameraMotionSampler } from "@/camera/CameraMotionSampler";
import type { CameraMotionSink, MotionPreviewSource } from "@/camera/CameraMotionSampler";
import type { ViewportPoseSource } from "@/camera/ViewportPoseSource";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import { PoseLayer } from "@/pose/PoseLayer";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
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
    private poseSource: ViewportPoseSource | null = null;
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
        preview: MotionPreviewSource,
    ) {
        this.motionSampler = new CameraMotionSampler(motion, camera, scene, preview);
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

    /**
     * 视口姿态探针:镜头视角下「此刻画面」的唯一读出口。
     * 编排层据此把摆位手势落成关键帧,全程不接触 Three。
     */
    bindPoseSource(source: ViewportPoseSource): void {
        this.poseSource = source;
    }

    unbindPoseSource(source: ViewportPoseSource): void {
        if (this.poseSource === source) this.poseSource = null;
    }

    readViewportPose(sample: CameraMotionSample): boolean {
        return this.poseSource?.readPose(sample) ?? false;
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

    /**
     * 单次采样的定序:动作先按墙钟对齐 → 变换/轨迹求值 → 步频同步的对象用弧长相位覆写动作 →
     * 机位采样 → 姿态层。
     * 相位必须在变换之后:它是「已走弧长」的函数,而弧长只有采样完轨迹才知道;
     * 机位采样必须在变换之后:跟拍要读到本帧的新位置,否则镜头永远慢一帧。
     */
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
            if (!transformTrack || !this.sampler.evaluateTrack(transformTrack, timeSeconds, runtime)) {
                this.restoreObject(entity.id, false);
                continue;
            }
            this.syncLocomotion(entity.id, transformTrack);
        }
        this.motionSampler.sampleCurrent(timeSeconds);
        for (let index = 0; index < entities.length; index += 1) {
            const entity = entities[index];
            if (entity) this.applyPose(entity.id);
        }
        this.invalidate();
    }

    /** 步频同步:动作相位由本帧已走弧长决定,未开启同步的对象保持墙钟对齐。 */
    private syncLocomotion(targetId: string, track: TimelineTrack): void {
        if (!track.policies.isLocomotionSynced) return;
        this.binder.setStridePhaseFor(targetId, track.policies.stridePhaseAt(this.sampler.lastArcLengthMeters));
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
