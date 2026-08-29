import { TimelineTrack } from "./TimelineTrack";
import type { TimelineTrackInit, TimelineTrackKind } from "./TimelineTrack";

export const DEFAULT_TIMELINE_DURATION_SECONDS = 10;

export interface TimelineDocInit {
    readonly duration: number;
    readonly tracks: readonly (TimelineTrack | TimelineTrackInit)[];
}

/**
 * 时间轴纯数据聚合根。它不依赖 MobX 或 Three，能够无损 JSON 往返。
 * 编辑操作由 TimelineStore 将本值对象替换为新的文档实例。
 */
export class TimelineDoc {
    readonly duration: number;
    readonly tracks: readonly TimelineTrack[];

    constructor(init: TimelineDocInit = { duration: DEFAULT_TIMELINE_DURATION_SECONDS, tracks: [] }) {
        this.duration = init.duration;
        this.tracks = Object.freeze(init.tracks.map((track) => (track instanceof TimelineTrack ? track : new TimelineTrack(track))));
        Object.freeze(this);
    }

    track(trackId: string): TimelineTrack | undefined {
        return this.tracks.find((track) => track.id === trackId);
    }

    trackForTarget(targetId: string, kind?: TimelineTrackKind): TimelineTrack | undefined {
        return this.tracks.find((track) => track.targetId === targetId && (kind === undefined || track.kind === kind));
    }

    withTrack(track: TimelineTrack): TimelineDoc {
        return new TimelineDoc({
            duration: this.duration,
            tracks: [...this.tracks.filter((current) => current.id !== track.id), track],
        });
    }

    withoutTrack(trackId: string): TimelineDoc {
        return new TimelineDoc({ duration: this.duration, tracks: this.tracks.filter((track) => track.id !== trackId) });
    }

    withDuration(duration: number): TimelineDoc {
        return new TimelineDoc({ duration, tracks: this.tracks });
    }

    toJSON(): TimelineDocInit {
        return {
            duration: this.duration,
            tracks: this.tracks.map((track) => track.toJSON()),
        };
    }
}
