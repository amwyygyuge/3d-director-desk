import { DEFAULT_FRAME_RATE_FPS, FrameRate } from "@/timeline/FrameRate";
import { PlaybackRange } from "@/timeline/PlaybackRange";
import type { PlaybackRangeInit } from "@/timeline/PlaybackRange";
import { TimelineMarker } from "@/timeline/TimelineMarker";
import type { TimelineMarkerInit, TimelineMarkerJSON } from "@/timeline/TimelineMarker";
import { TimelineTrack } from "@/timeline/TimelineTrack";
import type { TimelineTrackInit, TimelineTrackKind } from "@/timeline/TimelineTrack";

export const DEFAULT_TIMELINE_DURATION_SECONDS = 10;

export interface TimelineDocInit {
    readonly duration: number;
    readonly tracks: readonly (TimelineTrack | TimelineTrackInit)[];
    /** 帧率(fps):时间原子;缺省 30 */
    readonly frameRate?: number;
    /** 播放/循环/导出共用的入出点;缺省全片 */
    readonly playbackRange?: PlaybackRangeInit;
    readonly markers?: readonly (TimelineMarker | TimelineMarkerInit)[];
}

export interface TimelineDocJSON {
    readonly duration: number;
    readonly tracks: readonly TimelineTrackInit[];
    readonly frameRate: number;
    readonly playbackRange: PlaybackRangeInit;
    readonly markers: readonly TimelineMarkerJSON[];
}

/**
 * 时间轴纯数据聚合根。它不依赖 MobX 或 Three，能够无损 JSON 往返。
 * 编辑操作由 TimelineStore 将本值对象替换为新的文档实例。
 *
 * 三条成员各管一件事,不可互相推导:duration 是「片子多长」,playbackRange 是「现在排哪一段」,
 * frameRate 是「时间的原子」。markers 是作者与 AI 共用的时间锚点。
 */
export class TimelineDoc {
    readonly duration: number;
    readonly tracks: readonly TimelineTrack[];
    readonly frameRate: FrameRate;
    readonly playbackRange: PlaybackRange;
    readonly markers: readonly TimelineMarker[];

    constructor(init: TimelineDocInit = { duration: DEFAULT_TIMELINE_DURATION_SECONDS, tracks: [] }) {
        this.duration = init.duration;
        this.tracks = Object.freeze(
            init.tracks.map((track) => (track instanceof TimelineTrack ? track : new TimelineTrack(track))),
        );
        this.frameRate = new FrameRate(init.frameRate ?? DEFAULT_FRAME_RATE_FPS);
        this.playbackRange = (
            init.playbackRange ? new PlaybackRange(init.playbackRange) : PlaybackRange.full(init.duration)
        ).clampedTo(init.duration);
        this.markers = Object.freeze(
            (init.markers ?? [])
                .map((marker) => (marker instanceof TimelineMarker ? marker : new TimelineMarker(marker)))
                .sort((left, right) => left.timeSeconds - right.timeSeconds),
        );
        Object.freeze(this);
    }

    track(trackId: string): TimelineTrack | undefined {
        return this.tracks.find((track) => track.id === trackId);
    }

    trackForTarget(targetId: string, kind?: TimelineTrackKind): TimelineTrack | undefined {
        return this.tracks.find((track) => track.targetId === targetId && (kind === undefined || track.kind === kind));
    }

    marker(markerId: string): TimelineMarker | undefined {
        return this.markers.find((marker) => marker.id === markerId);
    }

    withTrack(track: TimelineTrack): TimelineDoc {
        return this.copyWith({ tracks: [...this.tracks.filter((current) => current.id !== track.id), track] });
    }

    withoutTrack(trackId: string): TimelineDoc {
        return this.copyWith({ tracks: this.tracks.filter((track) => track.id !== trackId) });
    }

    withTracks(tracks: readonly TimelineTrack[]): TimelineDoc {
        return this.copyWith({ tracks });
    }

    /** 时长收缩时播放范围随之收敛:构造函数统一 clamp,这里不重复判断 */
    withDuration(duration: number): TimelineDoc {
        return this.copyWith({ duration });
    }

    withFrameRate(frameRate: number): TimelineDoc {
        return this.copyWith({ frameRate });
    }

    withPlaybackRange(playbackRange: PlaybackRangeInit): TimelineDoc {
        return this.copyWith({ playbackRange });
    }

    withMarker(marker: TimelineMarker): TimelineDoc {
        return this.copyWith({ markers: [...this.markers.filter((current) => current.id !== marker.id), marker] });
    }

    withoutMarker(markerId: string): TimelineDoc {
        return this.copyWith({ markers: this.markers.filter((marker) => marker.id !== markerId) });
    }

    toJSON(): TimelineDocJSON {
        return {
            duration: this.duration,
            tracks: this.tracks.map((track) => track.toJSON()),
            frameRate: this.frameRate.toJSON(),
            playbackRange: this.playbackRange.toJSON(),
            markers: this.markers.map((marker) => marker.toJSON()),
        };
    }

    /**
     * 唯一的整体重建口:成员一多,每个 with* 各自罗列全部字段必然漏掉新成员
     * (加 frameRate 那天就会静默丢失)。改一处即可,不留第二份装配逻辑。
     */
    private copyWith(overrides: Partial<TimelineDocInit>): TimelineDoc {
        return new TimelineDoc({
            duration: this.duration,
            tracks: this.tracks,
            frameRate: this.frameRate.fps,
            playbackRange: this.playbackRange.toJSON(),
            markers: this.markers,
            ...overrides,
        });
    }
}
