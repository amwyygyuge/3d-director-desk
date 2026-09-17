import { reaction } from "mobx";
import type { Object3D } from "three";

import { ACTION_FILL_POLICY, defaultFillPolicyFor } from "@/animation/ActionFillPolicy";
import type { ActionFillPolicy } from "@/animation/ActionFillPolicy";
import type { ActionPerformance } from "@/animation/ActionPerformance";
import type { AnimationBinder } from "@/animation/AnimationBinder";
import type { ActionPreviewController } from "@/animation/ActionPreviewController";
import { CameraMotionSampler } from "@/camera/CameraMotionSampler";
import type { CameraMotionSink, MotionPreviewSource } from "@/camera/CameraMotionSampler";
import type { ViewportPoseSource } from "@/camera/ViewportPoseSource";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import { PoseLayer } from "@/pose/PoseLayer";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrack } from "@/timeline/TimelineTrack";
import type { SceneManager } from "@/core/SceneManager";
import { collectHitMeshes } from "@/core/surfaceSnap";
import type { SceneObject } from "@/core/SceneObject";
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
    private sampleTimeSeconds = 0;
    /** 播放贴地的站面候选池:失效驱动重建,常驻数组复用(帧级热路径零重分配、零遍历)。 */
    private readonly groundCandidatePool: Object3D[] = [];
    /** 候选池脏标记:初始为脏,首次采样即建池。 */
    private groundPoolDirty = true;
    private readonly stopGroundPoolWatch: () => void;
    /**
     * 刷新站面候选=锁定布景网格。只认 locked 实体:布景是静态站面;
     * 道具/人偶在播放中自身会动,把它们当站面会让贴地互相追逐。
     * 失效驱动而非逐帧重建:列表只在实体增删/锁切换(constructor 里的 reaction)与运行时
     * 绑定/模型装载(sampleObject 漏斗)时变;播放期网格移动不影响列表,射线读的是实时 matrixWorld。
     */
    private readonly refreshGroundCandidates = (): void => {
        if (!this.groundPoolDirty) return;
        this.groundPoolDirty = false;
        this.groundCandidatePool.length = 0;
        this.scene.forEachEntity((entity) => {
            if (!entity.locked) return;
            const runtime = this.scene.getRuntime(entity.id);
            if (runtime) collectHitMeshes(runtime, this.groundCandidatePool);
        });
        this.sampler.setGroundCandidates(this.groundCandidatePool);
    };
    private readonly sampleTransformForEntity = (entity: SceneObject): void => {
        const runtime = this.scene.getRuntime(entity.id);
        if (!runtime) return;
        const transformTrack = this.timeline.document.trackForTarget(entity.id, TIMELINE_TRACK_KIND.TRANSFORM);
        if (!transformTrack || !this.sampler.evaluateTrack(transformTrack, this.sampleTimeSeconds, runtime)) {
            this.restoreObject(entity.id, false);
            return;
        }
        this.syncLocomotion(entity.id, transformTrack);
    };
    private readonly applyPoseForEntity = (entity: SceneObject): void => {
        if (entity.kind !== "model") return;
        this.poseLayer.apply(entity.id, entity.pose);
    };

    private readonly blendActionForEntity = (entity: SceneObject): void => {
        // 按采样时刻选中生效排期:多动作序列下 entity.actionPerformance(首个)不再等于当前生效的那个
        const performance = entity.actionPerformanceAt(this.sampleTimeSeconds);
        if (!performance) return;
        const attackProgress = performance.attackProgressAt(this.sampleTimeSeconds);
        // 回收只对「播完即停在末帧」的段成立:repeat/stretch 在整段内始终有动作驱动,
        // 没有可回收的终态。判据取段的填充策略,而非资产 loopMode——同一个循环资产
        // 也可以被作者按 hold 排一段。
        const releaseProgress =
            this.fillPolicyOf(entity.id, performance) === ACTION_FILL_POLICY.HOLD
                ? performance.releaseProgressAt(this.sampleTimeSeconds)
                : null;
        const baseWeight = attackProgress !== null ? 1 - attackProgress : releaseProgress;
        if (baseWeight === null) return;
        this.binder.blendActionWithBasePose(entity.id, entity.pose, baseWeight);
    };

    /**
     * 该段生效的填充策略:段显式声明优先,未声明则按资产 loopMode 推默认。
     *
     * 与 ActionPerformance.clipTimeAt 的兜底必须同一判据,否则「按什么时间取帧」
     * 与「要不要回收/要不要步频同步」会错配。
     */
    private fillPolicyOf(objectId: string, performance: ActionPerformance): ActionFillPolicy | null {
        if (performance.fillPolicy) return performance.fillPolicy;
        const loopMode = this.binder.loopModeAt(objectId, performance.id);
        return loopMode ? defaultFillPolicyFor(loopMode) : null;
    }

    constructor(
        private readonly timeline: TimelineStore,
        private readonly scene: SceneManager,
        private readonly transport: TimeTransport,
        motion: CameraMotionStore,
        camera: CameraStore,
        private readonly binder: AnimationBinder,
        private readonly actionPreview: ActionPreviewController,
        private readonly skeletons: SkeletonRuntimeRegistry,
        preview: MotionPreviewSource,
    ) {
        this.motionSampler = new CameraMotionSampler(motion, camera, scene, timeline, preview);
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
        // 站面候选失效监听:锁定实体集(实体增删/文档替换/锁切换)变化才重建,播放期不逐帧遍历场景树
        this.stopGroundPoolWatch = reaction(
            () => {
                const lockedIds: string[] = [];
                this.scene.forEachEntity((entity) => {
                    if (entity.locked) lockedIds.push(entity.id);
                });
                return lockedIds.join("|");
            },
            () => {
                this.groundPoolDirty = true;
            },
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
        const timeSeconds = this.currentTime();
        this.sampleTimeSeconds = timeSeconds;
        this.skeletons.restoreRotations(targetId);
        this.applyPose(targetId);
        this.binder.setTime(timeSeconds);
        // sampleObject 是运行时绑定/模型装载的唯一漏斗:锁定布景的网格在此刻才可命中;
        // 只有 locked 实体影响候选池,非锁定实体的装载不触发重建(装载风暴期免 O(N²))
        if (entity.locked) this.groundPoolDirty = true;
        this.refreshGroundCandidates();
        this.sampleTransformForEntity(entity);
        this.blendActionForEntity(entity);
        this.actionPreview.applyCurrentFrame();
        this.invalidate();
    }
    restoreAll(): void {
        const timeSeconds = this.currentTime();
        this.sampleTimeSeconds = timeSeconds;
        this.restorePoseBaselines();
        this.scene.forEachEntity(this.applyPoseForEntity);
        this.binder.setTime(timeSeconds);
        this.scene.forEachEntity(this.blendActionForEntity);
        this.actionPreview.applyCurrentFrame();
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
        this.stopGroundPoolWatch();
        this.restoreAll();
        this.invalidator = null;
    }

    /**
     * 单次采样的定序:常驻姿势先写底层 → 动作按墙钟对齐 → 变换/轨迹求值与步频同步 →
     * 进入/回收段与常驻姿势混合 → 局部预览覆盖 → 机位采样。
     * 相位必须在变换之后:它是「已走弧长」的函数,而弧长只有采样完轨迹才知道;
     * 机位采样必须在变换之后:跟拍要读到本帧的新位置,否则镜头永远慢一帧。
     */
    private sample(timeSeconds: number): void {
        this.restorePoseBaselines();
        this.sampleTimeSeconds = timeSeconds;
        this.scene.forEachEntity(this.applyPoseForEntity);
        this.binder.setTime(timeSeconds);
        this.refreshGroundCandidates();
        this.scene.forEachEntity(this.sampleTransformForEntity);
        this.scene.forEachEntity(this.blendActionForEntity);
        this.actionPreview.applyCurrentFrame();
        this.motionSampler.sampleCurrent(timeSeconds);
        this.invalidate();
    }

    /**
     * 步频同步:动作相位由本帧已走弧长决定,未开启同步的对象保持墙钟对齐。
     *
     * 只对**按原速重复**的段生效:hold 段(倒地/受击)有自己的时间语义,被步频改写
     * 会让它跟着位移倒放;stretch 段的作者意图正是变速,步频同步会覆盖掉那个选择。
     * 走位轨可以横跨整段,动作序列各段各自表演。
     */
    private syncLocomotion(targetId: string, track: TimelineTrack): void {
        if (!track.policies.isLocomotionSynced) return;
        const entity = this.scene.getEntity(targetId);
        const performance = entity?.actionPerformanceAt(this.sampleTimeSeconds);
        if (!performance) return;
        if (this.fillPolicyOf(targetId, performance) !== ACTION_FILL_POLICY.REPEAT) return;
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
