export interface PlaybackRangeInit {
    readonly inSeconds: number;
    readonly outSeconds: number;
}

/** 入出点至少要框住一帧的量级,否则播放与导出都退化成一个点 */
const MINIMUM_SPAN_SECONDS = 0.001;

/**
 * 播放范围(值对象):入点 / 出点。
 *
 * 与工程时长的边界:duration 是「这条片子有多长」,本对象是「现在在排哪一段」。
 * 播放、循环、预览与导出共用它——此前三者各自默认 0~duration,于是「只导一段」无从表达。
 */
export class PlaybackRange {
    readonly inSeconds: number;
    readonly outSeconds: number;

    constructor(init: PlaybackRangeInit) {
        const inSeconds = Math.max(Math.min(init.inSeconds, init.outSeconds - MINIMUM_SPAN_SECONDS), 0);
        this.inSeconds = inSeconds;
        this.outSeconds = Math.max(init.outSeconds, inSeconds + MINIMUM_SPAN_SECONDS);
        Object.freeze(this);
    }

    static full(durationSeconds: number): PlaybackRange {
        return new PlaybackRange({ inSeconds: 0, outSeconds: Math.max(durationSeconds, MINIMUM_SPAN_SECONDS) });
    }

    get spanSeconds(): number {
        return this.outSeconds - this.inSeconds;
    }

    covers(timeSeconds: number): boolean {
        return timeSeconds >= this.inSeconds && timeSeconds <= this.outSeconds;
    }

    /** 工程时长变短时范围随之收敛,不得越界 */
    clampedTo(durationSeconds: number): PlaybackRange {
        const limit = Math.max(durationSeconds, MINIMUM_SPAN_SECONDS);
        return new PlaybackRange({
            inSeconds: Math.min(this.inSeconds, limit - MINIMUM_SPAN_SECONDS),
            outSeconds: Math.min(this.outSeconds, limit),
        });
    }

    /** 是否等价于「全片」:UI 据此决定要不要显示入出点标记 */
    isFull(durationSeconds: number): boolean {
        return this.inSeconds <= 0 && this.outSeconds >= durationSeconds;
    }

    toJSON(): PlaybackRangeInit {
        return { inSeconds: this.inSeconds, outSeconds: this.outSeconds };
    }
}
