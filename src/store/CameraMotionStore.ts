import { makeAutoObservable, observable, values } from "mobx";

import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import { CameraProgramTrack } from "@/camera/CameraProgramTrack";

/** Per-desk motion timeline state. Cameras remain static entities; clips and Program output live here. */
export class CameraMotionStore {
    private readonly clipsById = observable.map<string, CameraMotionClip>();
    private currentProgram = new CameraProgramTrack();

    constructor() {
        makeAutoObservable(this);
    }

    get clips(): readonly CameraMotionClip[] {
        return [...values(this.clipsById)].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
    }

    get program(): CameraProgramTrack {
        return this.currentProgram;
    }

    clip(clipId: string): CameraMotionClip | undefined {
        return this.clipsById.get(clipId);
    }

    clipsForCamera(cameraId: string): readonly CameraMotionClip[] {
        return this.clips.filter((clip) => clip.cameraId === cameraId);
    }

    /** 跟拍覆盖层是可选的:只有显式绑定了对象的片段才构成引用关系。 */
    clipsForFocusObject(objectId: string): readonly CameraMotionClip[] {
        return this.clips.filter((clip) => {
            const target = clip.focus?.target;
            return target?.kind === FOCUS_TARGET_KIND.SCENE_OBJECT && target.objectId === objectId;
        });
    }

    clipAt(cameraId: string, timeSeconds: number): CameraMotionClip | null {
        for (const clip of this.clipsById.values()) {
            if (clip.cameraId === cameraId && clip.covers(timeSeconds)) return clip;
        }
        return null;
    }

    /**
     * 成片输出在某时刻的生效片段:显式预览优先于 Program 排期。
     *
     * 采样器、打点服务与提示条必须共用这一个判据——判据分叉过一次:采样按 Program 取景、
     * 打点按预览片段落键,结果是「看到的是 A 机位,键落进了 A 的片段,而你按的是预览 B」。
     */
    resolveOutputClipAt(timeSeconds: number, previewClipId: string | null): CameraMotionClip | null {
        const preview = previewClipId ? this.clip(previewClipId) : undefined;
        if (preview?.covers(timeSeconds)) return preview;
        const cameraId = this.program.cameraAt(timeSeconds);
        return cameraId ? this.clipAt(cameraId, timeSeconds) : null;
    }

    replaceClip(clip: CameraMotionClip): void {
        this.clipsById.set(clip.id, clip);
    }

    removeClip(clipId: string): void {
        this.clipsById.delete(clipId);
    }

    removeCamera(cameraId: string): void {
        for (const clip of this.clipsForCamera(cameraId)) this.clipsById.delete(clip.id);
        this.currentProgram = this.currentProgram.withoutCamera(cameraId);
    }

    replaceProgram(program: CameraProgramTrack): void {
        this.currentProgram = program;
    }

    restore(clips: readonly CameraMotionClip[], program: CameraProgramTrack): void {
        this.clipsById.replace(clips.map((clip) => [clip.id, clip]));
        this.currentProgram = program;
    }
}
