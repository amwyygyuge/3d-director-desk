export interface CameraProgramClipInit {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export interface CameraProgramClipJSON {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export interface CameraProgramTrackInit {
    readonly clips?: readonly (CameraProgramClip | CameraProgramClipInit)[];
}

export interface CameraProgramTrackJSON {
    readonly clips: readonly CameraProgramClipJSON[];
}

/** One immutable Program segment. Adjacent segments hard-cut; transitions are a later domain concern. */
export class CameraProgramClip {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;

    constructor(init: CameraProgramClipInit) {
        if (
            init.id.length === 0 ||
            init.cameraId.length === 0 ||
            !Number.isFinite(init.startTimeSeconds) ||
            init.startTimeSeconds < 0 ||
            !Number.isFinite(init.durationSeconds) ||
            init.durationSeconds <= 0
        ) {
            throw new Error("CameraProgramClip requires stable identifiers and a finite positive time range");
        }
        this.id = init.id;
        this.cameraId = init.cameraId;
        this.startTimeSeconds = init.startTimeSeconds;
        this.durationSeconds = init.durationSeconds;
        Object.freeze(this);
    }

    get endTimeSeconds(): number {
        return this.startTimeSeconds + this.durationSeconds;
    }

    covers(timeSeconds: number): boolean {
        return timeSeconds >= this.startTimeSeconds && timeSeconds < this.endTimeSeconds;
    }

    toJSON(): CameraProgramClipJSON {
        return {
            id: this.id,
            cameraId: this.cameraId,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
        };
    }
}

/**
 * The sequence's sole final-output selector. It intentionally permits gaps but never overlapping
 * segments, so one time maps to at most one Program camera.
 */
export class CameraProgramTrack {
    readonly clips: readonly CameraProgramClip[];

    constructor(init: CameraProgramTrackInit = {}) {
        const clips = init.clips?.map((clip) => (clip instanceof CameraProgramClip ? clip : new CameraProgramClip(clip))) ?? [];
        const ordered = [...clips].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
        const ids = new Set(ordered.map((clip) => clip.id));
        const hasOverlap = ordered.some((clip, index) => {
            const next = ordered[index + 1];
            return next ? clip.endTimeSeconds > next.startTimeSeconds : false;
        });
        if (ids.size !== ordered.length || hasOverlap) throw new Error("CameraProgramTrack clips must have unique ids and not overlap");
        this.clips = Object.freeze(ordered);
        Object.freeze(this);
    }

    clip(clipId: string): CameraProgramClip | undefined {
        for (const clip of this.clips) {
            if (clip.id === clipId) return clip;
        }
        return undefined;
    }

    cameraAt(timeSeconds: number): string | null {
        for (const clip of this.clips) {
            if (clip.covers(timeSeconds)) return clip.cameraId;
        }
        return null;
    }

    withClip(clip: CameraProgramClip): CameraProgramTrack {
        const retained = this.clips.filter((current) => current.id !== clip.id);
        return new CameraProgramTrack({ clips: [...retained, clip] });
    }

    withoutClip(clipId: string): CameraProgramTrack {
        return new CameraProgramTrack({ clips: this.clips.filter((clip) => clip.id !== clipId) });
    }

    withoutCamera(cameraId: string): CameraProgramTrack {
        return new CameraProgramTrack({ clips: this.clips.filter((clip) => clip.cameraId !== cameraId) });
    }

    toJSON(): CameraProgramTrackJSON {
        return { clips: this.clips.map((clip) => clip.toJSON()) };
    }
}
