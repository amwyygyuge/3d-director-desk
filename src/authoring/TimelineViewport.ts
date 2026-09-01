const MINIMUM_VISIBLE_SECONDS = 0.25;
const RATIO_MIN = 0;
const RATIO_MAX = 1;

export interface TimelineViewportInit {
    readonly startSeconds: number;
    readonly visibleSeconds: number;
}

/**
 * 时间轴可视窗口(值对象,可缩放平移)。
 *
 * 像素换算刻意留在手势层(轨道宽度只有 DOM 知道):本类只持有「窗口起点 + 跨度」,
 * 让展开轨、迷你轨与未来的音频轨共用同一份时间↔比例换算,不各写一套。
 */
export class TimelineViewport {
    readonly startSeconds: number;
    readonly visibleSeconds: number;

    constructor(init: TimelineViewportInit) {
        const visibleSeconds = Math.max(init.visibleSeconds, MINIMUM_VISIBLE_SECONDS);
        this.startSeconds = Math.max(init.startSeconds, 0);
        this.visibleSeconds = visibleSeconds;
        Object.freeze(this);
    }

    static full(durationSeconds: number): TimelineViewport {
        return new TimelineViewport({ startSeconds: 0, visibleSeconds: durationSeconds });
    }

    get endSeconds(): number {
        return this.startSeconds + this.visibleSeconds;
    }

    /** 时间 → 窗口内比例(0~1);窗口外返回越界比例,由调用方裁剪。 */
    ratioAt(timeSeconds: number): number {
        return (timeSeconds - this.startSeconds) / this.visibleSeconds;
    }

    timeAt(ratio: number): number {
        return this.startSeconds + ratio * this.visibleSeconds;
    }

    secondsPerPixel(trackWidthPx: number): number {
        return trackWidthPx > 0 ? this.visibleSeconds / trackWidthPx : this.visibleSeconds;
    }

    /** 以锚点比例为中心缩放:滚轮位置下的时刻在缩放前后保持不动。 */
    zoomedAt(factor: number, anchorRatio: number, durationSeconds: number): TimelineViewport {
        const anchorTime = this.timeAt(Math.min(Math.max(anchorRatio, RATIO_MIN), RATIO_MAX));
        const visibleSeconds = Math.min(Math.max(this.visibleSeconds * factor, MINIMUM_VISIBLE_SECONDS), durationSeconds);
        const startSeconds = anchorTime - (anchorTime - this.startSeconds) * (visibleSeconds / this.visibleSeconds);
        return new TimelineViewport({ startSeconds, visibleSeconds }).clampedTo(durationSeconds);
    }

    pannedBy(deltaSeconds: number, durationSeconds: number): TimelineViewport {
        return new TimelineViewport({
            startSeconds: this.startSeconds + deltaSeconds,
            visibleSeconds: this.visibleSeconds,
        }).clampedTo(durationSeconds);
    }

    /** 窗口不得越出工程时长:时长变短时窗口自动收敛。 */
    clampedTo(durationSeconds: number): TimelineViewport {
        const visibleSeconds = Math.min(Math.max(this.visibleSeconds, MINIMUM_VISIBLE_SECONDS), Math.max(durationSeconds, MINIMUM_VISIBLE_SECONDS));
        const startSeconds = Math.min(Math.max(this.startSeconds, 0), Math.max(durationSeconds - visibleSeconds, 0));
        return new TimelineViewport({ startSeconds, visibleSeconds });
    }
}
