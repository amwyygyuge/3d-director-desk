import { makeAutoObservable, observable, values } from "mobx";

import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import { CameraProgramTrack, PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";

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

    /**
     * 引用了该对象的片段:注视锁定 ∪ 跟拍。两层覆盖都是可选绑定,
     * 删除对象的拦截、UI 的「谁在用我」都走这一个判据,禁两处各写一份。
     */
    clipsReferencingObject(objectId: string): readonly CameraMotionClip[] {
        return this.clips.filter((clip) => {
            const target = clip.focus?.target;
            const isFocused = target?.kind === FOCUS_TARGET_KIND.SCENE_OBJECT && target.objectId === objectId;
            return isFocused || clip.follow?.objectId === objectId;
        });
    }

    /**
     * 成片输出在某时刻的生效运镜:显式预览优先于 Program 排期。
     *
     * 采样器、打点服务与提示条必须共用这一个判据——判据分叉过一次:采样按 Program 取景、
     * 打点按预览片段落键,结果是「看到的是 A 镜头,键落进了 A 的片段,而你按的是预览 B」。
     */
    resolveOutputClipAt(timeSeconds: number, previewClipId: string | null): CameraMotionClip | null {
        const preview = previewClipId ? this.clip(previewClipId) : undefined;
        if (preview?.covers(timeSeconds)) return preview;
        const source = this.program.sourceAt(timeSeconds);
        return source?.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP ? (this.clip(source.motionClipId) ?? null) : null;
    }

    replaceClip(clip: CameraMotionClip): void {
        this.clipsById.set(clip.id, clip);
    }

    removeClip(clipId: string): void {
        this.clipsById.delete(clipId);
        this.currentProgram = this.currentProgram.withoutSource({
            kind: PROGRAM_SOURCE_KIND.MOTION_CLIP,
            motionClipId: clipId,
        });
    }

    removeStaticShot(shotId: string): void {
        this.currentProgram = this.currentProgram.withoutSource({ kind: PROGRAM_SOURCE_KIND.STATIC_SHOT, shotId });
    }

    replaceProgram(program: CameraProgramTrack): void {
        this.currentProgram = program;
    }

    restore(clips: readonly CameraMotionClip[], program: CameraProgramTrack): void {
        this.clipsById.replace(clips.map((clip) => [clip.id, clip]));
        this.currentProgram = program;
    }
}
