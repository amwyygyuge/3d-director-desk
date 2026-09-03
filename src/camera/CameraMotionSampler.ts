import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { CameraFrameSolver } from "@/camera/CameraFrameSolver";
import { createCameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraMotionClip, CameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraShot } from "@/camera/CameraShot";
import type { SceneManager } from "@/core/SceneManager";
import type { TimelineDocumentSource } from "@/motion/SubjectFrameResolver";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { CameraStore } from "@/store/CameraStore";

/** R3F-owned runtime bridge; no Three references ever enter MobX state. */
export interface CameraMotionSink {
    applyMotion(sample: CameraMotionSample): void;
    restoreFreeDirectorPose(): void;
}

/**
 * 预览片段来源(窄端口):镜头视角允许预览尚未切入 Program 的片段。
 * 采样器只读这一个字段,不依赖编排 Store 的其余状态。
 */
export interface MotionPreviewSource {
    readonly previewClipId: string | null;
}

interface ResolvedTake {
    readonly clip: CameraMotionClip | null;
    readonly shot: CameraShot | null;
}

/**
 * Runtime-only Program evaluator. It reads every time-varying value from immutable data and writes
 * only caller-owned scalars into the current R3F camera, preserving free editor camera state.
 */
export class CameraMotionSampler {
    private sink: CameraMotionSink | null = null;
    private readonly solver: CameraFrameSolver;
    private readonly sample: CameraMotionSample = createCameraMotionSample();

    constructor(
        private readonly motion: CameraMotionStore,
        private readonly camera: CameraStore,
        scene: SceneManager,
        timeline: TimelineDocumentSource,
        private readonly preview: MotionPreviewSource,
    ) {
        this.solver = new CameraFrameSolver(timeline, scene);
    }

    bindSink(sink: CameraMotionSink): void {
        this.sink = sink;
    }

    unbindSink(sink: CameraMotionSink): void {
        if (this.sink !== sink) return;
        sink.restoreFreeDirectorPose();
        this.sink = null;
    }

    /**
     * 该时刻的成片画面:生效片段由 CameraMotionStore.resolveOutputClipAt 裁决(预览优先于 Program),
     * 片段缺位时退回 Program 机位的静态取景;两者皆无则保持上一帧画面。
     *
     * 无输出时不复位相机:镜头视角下 scrub 出片段区间会把画面弹回导演姿态,是编排期最刺眼的跳变。
     * 复位只发生在离开成片接管(sink 解绑)时。
     */
    sampleCurrent(timeSeconds: number): boolean {
        const take = this.resolveTake(timeSeconds);
        if (!take) return false;
        if (!this.writeTakeSample(take, timeSeconds)) return false;
        this.sink?.applyMotion(this.sample);
        return true;
    }

    private writeTakeSample(take: ResolvedTake, timeSeconds: number): boolean {
        const { clip, shot } = take;
        if (clip) return this.solver.solve(clip, timeSeconds, this.sample);
        if (!shot) return false;
        this.writeStaticShot(shot);
        return true;
    }

    restore(): void {
        this.sink?.restoreFreeDirectorPose();
    }

    private resolveTake(timeSeconds: number): ResolvedTake | null {
        const clip = this.motion.resolveOutputClipAt(timeSeconds, this.preview.previewClipId);
        if (clip) return { clip, shot: null };
        const source = this.motion.program.sourceAt(timeSeconds);
        if (source?.kind !== PROGRAM_SOURCE_KIND.STATIC_SHOT) return null;
        const shot = this.camera.director.getShot(source.shotId);
        return shot ? { clip: null, shot } : null;
    }

    private writeStaticShot(shot: CameraShot): void {
        this.sample.positionX = shot.position[0];
        this.sample.positionY = shot.position[1];
        this.sample.positionZ = shot.position[2];
        this.sample.targetX = shot.target[0];
        this.sample.targetY = shot.target[1];
        this.sample.targetZ = shot.target[2];
        this.sample.fov = shot.fov;
    }
}
