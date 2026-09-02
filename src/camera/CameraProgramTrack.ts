export const PROGRAM_SOURCE_KIND = {
    STATIC_SHOT: "static-shot",
    MOTION_CLIP: "motion-clip",
} as const;

export interface StaticShotProgramSource {
    readonly kind: typeof PROGRAM_SOURCE_KIND.STATIC_SHOT;
    readonly shotId: string;
}

export interface MotionClipProgramSource {
    readonly kind: typeof PROGRAM_SOURCE_KIND.MOTION_CLIP;
    readonly motionClipId: string;
}

export type ProgramSource = StaticShotProgramSource | MotionClipProgramSource;

function sourceFrom(source: ProgramSource): ProgramSource {
    switch (source.kind) {
        case PROGRAM_SOURCE_KIND.STATIC_SHOT:
            if (source.shotId.length === 0) throw new Error("StaticShotProgramSource requires a stable shot id");
            return Object.freeze({ kind: source.kind, shotId: source.shotId });
        case PROGRAM_SOURCE_KIND.MOTION_CLIP:
            if (source.motionClipId.length === 0)
                throw new Error("MotionClipProgramSource requires a stable motion clip id");
            return Object.freeze({ kind: source.kind, motionClipId: source.motionClipId });
    }
}

export function sameProgramSource(left: ProgramSource, right: ProgramSource): boolean {
    switch (left.kind) {
        case PROGRAM_SOURCE_KIND.STATIC_SHOT:
            return right.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT && left.shotId === right.shotId;
        case PROGRAM_SOURCE_KIND.MOTION_CLIP:
            return right.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP && left.motionClipId === right.motionClipId;
    }
}

export interface CameraProgramClipInit {
    readonly id: string;
    readonly source: ProgramSource;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export interface CameraProgramClipJSON {
    readonly id: string;
    readonly source: ProgramSource;
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
    readonly source: ProgramSource;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;

    constructor(init: CameraProgramClipInit) {
        const source = sourceFrom(init.source);
        if (
            init.id.length === 0 ||
            !Number.isFinite(init.startTimeSeconds) ||
            init.startTimeSeconds < 0 ||
            !Number.isFinite(init.durationSeconds) ||
            init.durationSeconds <= 0
        ) {
            throw new Error("CameraProgramClip requires stable identifiers and a finite positive time range");
        }
        this.id = init.id;
        this.source = source;
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
            source: this.source,
            startTimeSeconds: this.startTimeSeconds,
            durationSeconds: this.durationSeconds,
        };
    }
}

/** The sequence's sole final-output selector. It intentionally permits gaps but never overlapping segments. */
export class CameraProgramTrack {
    readonly clips: readonly CameraProgramClip[];

    constructor(init: CameraProgramTrackInit = {}) {
        const clips =
            init.clips?.map((clip) => (clip instanceof CameraProgramClip ? clip : new CameraProgramClip(clip))) ?? [];
        const ordered = [...clips].sort((left, right) => left.startTimeSeconds - right.startTimeSeconds);
        const ids = new Set(ordered.map((clip) => clip.id));
        const hasOverlap = ordered.some((clip, index) => {
            const next = ordered[index + 1];
            return next ? clip.endTimeSeconds > next.startTimeSeconds : false;
        });
        if (ids.size !== ordered.length || hasOverlap)
            throw new Error("CameraProgramTrack clips must have unique ids and not overlap");
        this.clips = Object.freeze(ordered);
        Object.freeze(this);
    }

    clip(clipId: string): CameraProgramClip | undefined {
        return this.clips.find((clip) => clip.id === clipId);
    }

    sourceAt(timeSeconds: number): ProgramSource | null {
        return this.clips.find((clip) => clip.covers(timeSeconds))?.source ?? null;
    }

    withClip(clip: CameraProgramClip): CameraProgramTrack {
        const retained = this.clips.filter((current) => current.id !== clip.id);
        return new CameraProgramTrack({ clips: [...retained, clip] });
    }

    withoutClip(clipId: string): CameraProgramTrack {
        return new CameraProgramTrack({ clips: this.clips.filter((clip) => clip.id !== clipId) });
    }

    withoutSource(source: ProgramSource): CameraProgramTrack {
        return new CameraProgramTrack({ clips: this.clips.filter((clip) => !sameProgramSource(clip.source, source)) });
    }

    toJSON(): CameraProgramTrackJSON {
        return { clips: this.clips.map((clip) => clip.toJSON()) };
    }
}
