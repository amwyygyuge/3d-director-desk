import { reaction } from "mobx";

import type { SceneManager } from "../core/SceneManager";
import type { TimeTransport } from "../time/TimeTransport";
import type { TimelineStore } from "../store/TimelineStore";
import { TimelineSampler } from "./TimelineSampler";

export type TimelineInvalidator = () => void;

/**
 * 时间轴运行时协调器：订阅 playhead，按顺序在动作采样之后执行变换层；
 * 仅触碰 SceneManager 的 Three 运行时索引，绝不写入实体/MobX 或历史栈。
 */
export class PlaybackCoordinator {
    private readonly sampler = new TimelineSampler();
    private invalidator: TimelineInvalidator | null = null;
    private readonly stopTransportReaction: () => void;
    private readonly stopStoppedReaction: () => void;

    constructor(
        private readonly timeline: TimelineStore,
        private readonly scene: SceneManager,
        private readonly transport: TimeTransport,
    ) {
        // AnimationBinder 在本协调器之前绑定 transport，因此动作 → transform → 后续 pose 的反应顺序确定。
        this.stopTransportReaction = reaction(
            () => transport.time,
            (timeSeconds) => this.sample(timeSeconds),
        );
        this.stopStoppedReaction = reaction(
            () => transport.stoppedAt,
            () => this.restoreAll(),
        );
    }

    bindInvalidator(invalidator: TimelineInvalidator): void {
        this.invalidator = invalidator;
        this.sampleCurrent();
    }

    unbindInvalidator(invalidator: TimelineInvalidator): void {
        if (this.invalidator === invalidator) this.invalidator = null;
    }

    sampleCurrent(): void {
        this.sample(this.currentTime());
    }

    sampleObject(targetId: string): void {
        const runtime = this.scene.getRuntime(targetId);
        if (!runtime) return;
        if (!this.sampler.evaluateTarget(this.timeline.document, targetId, this.currentTime(), runtime)) {
            this.restoreObject(targetId, false);
        }
        this.invalidate();
    }

    restoreAll(): void {
        for (const track of this.timeline.document.tracks) this.restoreObject(track.targetId, false);
        this.invalidate();
    }

    restoreObject(targetId: string, shouldInvalidate = true): void {
        const runtime = this.scene.getRuntime(targetId);
        const entity = this.scene.getEntity(targetId);
        if (!runtime || !entity) return;
        const transform = entity.transform;
        runtime.position.set(transform.position[0], transform.position[1], transform.position[2]);
        runtime.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
        runtime.scale.set(transform.scale[0], transform.scale[1], transform.scale[2]);
        if (shouldInvalidate) this.invalidate();
    }

    dispose(): void {
        this.stopTransportReaction();
        this.stopStoppedReaction();
        this.restoreAll();
        this.invalidator = null;
    }

    private sample(timeSeconds: number): void {
        for (const track of this.timeline.document.tracks) {
            const runtime = this.scene.getRuntime(track.targetId);
            if (!runtime) continue;
            if (!this.sampler.evaluateTrack(track, timeSeconds, runtime)) {
                this.restoreObject(track.targetId, false);
            }
        }
        this.invalidate();
    }

    private currentTime(): number {
        return this.transport.time;
    }

    private invalidate(): void {
        this.invalidator?.();
    }
}
