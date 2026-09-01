import { makeAutoObservable } from "mobx";

import type { AnimationBinder } from "./AnimationBinder";

const INITIAL_PREVIEW_TIME_SECONDS = 0;
const MINIMUM_DURATION_SECONDS = Number.EPSILON;

export interface ActionPreviewTarget {
    readonly objectId: string;
    readonly durationSeconds: number;
}

/** Per-desk, non-persistent action preview state. Only its active object advances on each render frame. */
export class ActionPreviewController {
    activeObjectId: string | null = null;
    durationSeconds = INITIAL_PREVIEW_TIME_SECONDS;
    isPlaying = false;
    timeSeconds = INITIAL_PREVIEW_TIME_SECONDS;

    constructor(private readonly binder: AnimationBinder) {
        makeAutoObservable<ActionPreviewController, "binder">(this, { binder: false });
    }

    prepare(target: ActionPreviewTarget): void {
        this.activeObjectId = target.objectId;
        this.durationSeconds = target.durationSeconds;
        this.isPlaying = false;
        this.timeSeconds = INITIAL_PREVIEW_TIME_SECONDS;
        this.binder.setTimeFor(target.objectId, INITIAL_PREVIEW_TIME_SECONDS);
    }

    play(target: ActionPreviewTarget): void {
        const shouldReset = this.activeObjectId !== target.objectId || this.durationSeconds !== target.durationSeconds;
        this.activeObjectId = target.objectId;
        this.durationSeconds = target.durationSeconds;
        if (shouldReset) this.timeSeconds = INITIAL_PREVIEW_TIME_SECONDS;
        this.isPlaying = true;
        this.binder.setTimeFor(target.objectId, this.timeSeconds);
    }

    pause(): void {
        this.isPlaying = false;
    }

    seek(target: ActionPreviewTarget, timeSeconds: number): void {
        this.activeObjectId = target.objectId;
        this.durationSeconds = target.durationSeconds;
        this.timeSeconds = Math.min(Math.max(INITIAL_PREVIEW_TIME_SECONDS, timeSeconds), target.durationSeconds);
        this.binder.setTimeFor(target.objectId, this.timeSeconds);
    }
    /** 工程替换时清除瞬时预览态，避免新场景继续驱动旧对象。 */
    reset(): void {
        this.activeObjectId = null;
        this.durationSeconds = INITIAL_PREVIEW_TIME_SECONDS;
        this.isPlaying = false;
        this.timeSeconds = INITIAL_PREVIEW_TIME_SECONDS;
    }

    clear(objectId: string): void {
        if (this.activeObjectId !== objectId) return;
        this.activeObjectId = null;
        this.durationSeconds = INITIAL_PREVIEW_TIME_SECONDS;
        this.isPlaying = false;
        this.timeSeconds = INITIAL_PREVIEW_TIME_SECONDS;
    }

    tick(deltaSeconds: number): void {
        if (!this.isPlaying || !this.activeObjectId || this.durationSeconds <= MINIMUM_DURATION_SECONDS) return;
        const nextTime = this.timeSeconds + deltaSeconds;
        this.timeSeconds = nextTime >= this.durationSeconds ? nextTime % this.durationSeconds : nextTime;
        this.binder.setTimeFor(this.activeObjectId, this.timeSeconds);
    }
}
