import { makeAutoObservable } from "mobx";

export const DEFAULT_CAMERA_SEQUENCE_DURATION_SECONDS = 10;

/** Camera sequence timing only. Scene objects retain static transforms and poses outside the timeline. */
export class TimelineStore {
    private sequenceDurationSeconds = DEFAULT_CAMERA_SEQUENCE_DURATION_SECONDS;

    constructor() {
        makeAutoObservable(this);
    }

    get duration(): number {
        return this.sequenceDurationSeconds;
    }

    setDuration(duration: number): void {
        this.sequenceDurationSeconds = duration;
    }
}
