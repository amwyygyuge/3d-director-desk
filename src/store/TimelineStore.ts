import { makeAutoObservable } from "mobx";

import { TimelineDoc, DEFAULT_TIMELINE_DURATION_SECONDS } from "../timeline/TimelineDoc";
import { TimelineTrack, TIMELINE_TRACK_KIND } from "../timeline/TimelineTrack";
import type { TransformKeyframe } from "../timeline/TransformKeyframe";
import type { PoseKeyframe } from "../pose/PoseKeyframe";

/**
 * 每个 DirectorDesk 实例各自拥有的时间轴状态。仅保存 TimelineDoc 纯数据；
 * 所有公开写入口仅供 timeline.* 命令调用。
 */
export class TimelineStore {
    private currentDocument = new TimelineDoc({ duration: DEFAULT_TIMELINE_DURATION_SECONDS, tracks: [] });

    constructor() {
        makeAutoObservable(this);
    }

    get document(): TimelineDoc {
        return this.currentDocument;
    }

    setDuration(duration: number): void {
        this.currentDocument = this.currentDocument.withDuration(duration);
    }

    addKey(trackId: string, targetId: string, keyframe: TransformKeyframe): void {
        const existing = this.currentDocument.track(trackId);
        const track = existing
            ? existing.withKeyframe(keyframe)
            : new TimelineTrack({ id: trackId, targetId, kind: TIMELINE_TRACK_KIND.TRANSFORM, keyframes: [keyframe] });
        this.currentDocument = this.currentDocument.withTrack(track);
    }

    addPoseKey(trackId: string, targetId: string, keyframe: PoseKeyframe): void {
        const existing = this.currentDocument.track(trackId);
        const track = existing
            ? existing.withKeyframe(keyframe)
            : new TimelineTrack({ id: trackId, targetId, kind: TIMELINE_TRACK_KIND.POSE, keyframes: [keyframe] });
        this.currentDocument = this.currentDocument.withTrack(track);
    }

    moveKey(trackId: string, keyframe: TransformKeyframe | PoseKeyframe): void {
        const track = this.currentDocument.track(trackId);
        if (!track) return;
        this.currentDocument = this.currentDocument.withTrack(track.withKeyframe(keyframe));
    }

    removeKey(trackId: string, keyframeId: string): void {
        const track = this.currentDocument.track(trackId);
        if (!track) return;
        const nextTrack = track.withoutKeyframe(keyframeId);
        this.currentDocument =
            nextTrack.keyframes.length === 0
                ? this.currentDocument.withoutTrack(trackId)
                : this.currentDocument.withTrack(nextTrack);
    }

    removeObjectTracks(targetId: string): readonly TimelineTrack[] {
        const removed = this.currentDocument.tracks.filter((track) => track.targetId === targetId);
        if (removed.length === 0) return removed;
        this.currentDocument = new TimelineDoc({
            duration: this.currentDocument.duration,
            tracks: this.currentDocument.tracks.filter((track) => track.targetId !== targetId),
        });
        return removed;
    }

    restoreTracks(tracks: readonly TimelineTrack[]): void {
        this.currentDocument = tracks.reduce((document, track) => document.withTrack(track), this.currentDocument);
    }
}
