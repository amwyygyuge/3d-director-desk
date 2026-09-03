export interface TimelineMarkerInit {
    readonly id: string;
    readonly timeSeconds: number;
    readonly label: string;
    /** 主题色 token(如 "warning.main");缺省由 UI 用默认标记色 */
    readonly colorToken?: string | null;
}

export interface TimelineMarkerJSON extends TimelineMarkerInit {
    readonly colorToken: string | null;
}

/**
 * 时间轴标记(值对象):作者在时间线上打的点——「这里换镜」「配乐进」。
 *
 * 它同时是 AI 编排的语义锚:让「在第二个标记处切到俯拍」这类指令有确定的时间参照,
 * 不必靠裸秒数描述。纯数据,可 JSON 往返。
 */
export class TimelineMarker {
    readonly id: string;
    readonly timeSeconds: number;
    readonly label: string;
    readonly colorToken: string | null;

    constructor(init: TimelineMarkerInit) {
        if (init.id.length === 0 || !Number.isFinite(init.timeSeconds) || init.timeSeconds < 0) {
            throw new Error("TimelineMarker requires a non-empty id and a finite non-negative time");
        }
        this.id = init.id;
        this.timeSeconds = init.timeSeconds;
        this.label = init.label;
        this.colorToken = init.colorToken ?? null;
        Object.freeze(this);
    }

    withTime(timeSeconds: number): TimelineMarker {
        return new TimelineMarker({ ...this.toJSON(), timeSeconds });
    }

    toJSON(): TimelineMarkerJSON {
        return {
            id: this.id,
            timeSeconds: this.timeSeconds,
            label: this.label,
            colorToken: this.colorToken,
        };
    }
}
