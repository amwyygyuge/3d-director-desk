import type { FocusTargetSample } from "@/camera/CameraFocusTrack";
import { FocusTargetResolver } from "@/camera/FocusTargetResolver";
import type { SceneManager } from "@/core/SceneManager";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { CameraStore } from "@/store/CameraStore";
import { createCameraMotionSample, sampleCameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionClip, CameraMotionSample } from "@/camera/CameraMotionClip";
import type { CameraShot } from "@/camera/CameraShot";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";

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
    readonly shot: CameraShot;
    readonly clip: CameraMotionClip | null;
}

/**
 * Runtime-only Program evaluator. It reads every time-varying value from immutable data and writes
 * only caller-owned scalars into the current R3F camera, preserving free editor camera state.
 */
export class CameraMotionSampler {
    private sink: CameraMotionSink | null = null;
    private readonly positionSample: MotionPositionSample = createPositionSample();
    private readonly focusSample: FocusTargetSample = { x: 0, y: 0, z: 0 };
    private readonly focusResolver: FocusTargetResolver;
    private readonly sample: CameraMotionSample = createCameraMotionSample();

    constructor(
        private readonly motion: CameraMotionStore,
        private readonly camera: CameraStore,
        scene: SceneManager,
        private readonly preview: MotionPreviewSource,
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

    /**
     * 该时刻的成片画面:Program 输出优先;Program 留空时回退到编排中的预览片段,
     * 这正是「镜头视角能看到尚未切入 Program 的运镜」的唯一来源。
     */
    sampleCurrent(timeSeconds: number): boolean {
        const take = this.resolveTake(timeSeconds);
        if (!take) {
            this.sink?.restoreFreeDirectorPose();
            return false;
        }
        const { shot, clip } = take;
        const focusTarget = clip?.focus && this.focusResolver.resolve(clip.focus, this.focusSample) ? this.focusSample : null;
        const hasClipSample =
            clip !== null &&
            (clip.focus === null || focusTarget !== null) &&
            sampleCameraMotionClip(clip, timeSeconds, shot, focusTarget, this.positionSample, this.sample);
        if (!hasClipSample) this.writeStaticShot(shot);
        this.sink?.applyMotion(this.sample);
        return true;
    }

    restore(): void {
        this.sink?.restoreFreeDirectorPose();
    }

    private resolveTake(timeSeconds: number): ResolvedTake | null {
        const programCameraId = this.motion.program.cameraAt(timeSeconds);
        const programShot = programCameraId ? this.camera.director.getShot(programCameraId) : undefined;
        if (programCameraId && programShot) {
            return { shot: programShot, clip: this.motion.clipAt(programCameraId, timeSeconds) };
        }
        const previewClip = this.previewClipAt(timeSeconds);
        const previewShot = previewClip ? this.camera.director.getShot(previewClip.cameraId) : undefined;
        return previewClip && previewShot ? { shot: previewShot, clip: previewClip } : null;
    }

    private previewClipAt(timeSeconds: number): CameraMotionClip | null {
        const clipId = this.preview.previewClipId;
        const clip = clipId ? this.motion.clip(clipId) : undefined;
        return clip && clip.covers(timeSeconds) ? clip : null;
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
