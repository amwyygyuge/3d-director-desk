import { makeAutoObservable, observable, values } from "mobx";

import type { CameraMotionClip } from "../camera/CameraMotionClip";
import { FOCUS_TARGET_KIND } from "../camera/CameraFocusTrack";
import { CameraProgramTrack } from "../camera/CameraProgramTrack";

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
    clipsForFocusObject(objectId: string): readonly CameraMotionClip[] {
        return this.clips.filter(
            (clip) =>
                clip.focus.target.kind === FOCUS_TARGET_KIND.SCENE_OBJECT && clip.focus.target.objectId === objectId,
        );
    }
    clipAt(cameraId: string, timeSeconds: number): CameraMotionClip | null {
        for (const clip of this.clipsById.values()) {
            if (clip.cameraId === cameraId && clip.covers(timeSeconds)) return clip;
        }
        return null;
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
