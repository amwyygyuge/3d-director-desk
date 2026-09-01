import { makeAutoObservable, onBecomeObserved, onBecomeUnobserved, reaction } from "mobx";

import type { TimeTransport } from "../../time/TimeTransport";

const PLAYHEAD_DISPLAY_RATE_HZ = 12;
const PLAYHEAD_DISPLAY_INTERVAL_MS = 1000 / PLAYHEAD_DISPLAY_RATE_HZ;
const THROTTLE_START_DELAY_MS = 0;

/**
 * playhead 显示值(UI 层):把帧级时钟节流为低频 observable,供 observer 组件渲染期直读。
 * 惰性维持:仅被观察时(Inspector 播放控件在树)才挂 reaction 与节流定时器;
 * 最后一个观察者消失(面板关闭/卸载)即全拆,停表零开销。
 */
export class PlayheadDisplay {
    value: number;
    private latestTime: number;
    private updateTimer: number | null = null;
    private lastFlushAt = 0;
    private stopReaction: (() => void) | null = null;

    constructor(private readonly clock: TimeTransport) {
        this.value = clock.time;
        this.latestTime = clock.time;
        makeAutoObservable<PlayheadDisplay, "clock">(this, { clock: false });
        onBecomeObserved(this, "value", () => this.start());
        onBecomeUnobserved(this, "value", () => this.stop());
    }

    private start(): void {
        this.value = this.clock.time;
        this.stopReaction = reaction(
            () => this.clock.time,
            (time) => this.schedule(time),
        );
    }

    private stop(): void {
        this.stopReaction?.();
        this.stopReaction = null;
        if (this.updateTimer !== null) {
            window.clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }
    }

    private schedule(time: number): void {
        this.latestTime = time;
        if (this.updateTimer !== null) return;
        const elapsed = performance.now() - this.lastFlushAt;
        const delay = Math.max(THROTTLE_START_DELAY_MS, PLAYHEAD_DISPLAY_INTERVAL_MS - elapsed);
        this.updateTimer = window.setTimeout(() => this.flush(), delay);
    }

    private flush(): void {
        this.updateTimer = null;
        this.lastFlushAt = performance.now();
        this.value = this.latestTime;
    }
}
