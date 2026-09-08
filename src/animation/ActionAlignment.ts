/**
 * 动作排期对齐(值对象):把一段动作的时段声明为「某条走位轨的某个关键帧区间」。
 *
 * 为什么不让作者自己填 start/duration:走路动作必须与走位区间严格同起同止,
 * 否则会出现「人还在走但动作已经切走」。作者手填两份时间就必然会漂——
 * 轨道一旦重定时(retime-track / timeline.scale / 拖关键帧),手填的排期不会跟着动。
 * 声明式对齐把时段变成走位轨的派生量,重定时后自动跟随,不需要任何同步代码。
 *
 * `fromKeyframeId` / `toKeyframeId` 省略即取整轨首/末帧。
 */
export interface ActionAlignmentInit {
    readonly trackId: string;
    readonly fromKeyframeId?: string | null;
    readonly toKeyframeId?: string | null;
}

/** 对齐解析所需的最小轨道形状:只读关键帧的 id 与时刻,不依赖 TimelineTrack 具体类型(避免动画层反向依赖时间轴层)。 */
export interface AlignableTrack {
    readonly id: string;
    readonly keyframes: readonly { readonly id: string; readonly time: number }[];
}

export interface ActionRange {
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

export class ActionAlignment {
    readonly trackId: string;
    readonly fromKeyframeId: string | null;
    readonly toKeyframeId: string | null;

    constructor(init: ActionAlignmentInit) {
        if (typeof init.trackId !== "string" || init.trackId.length === 0) {
            throw new Error("ActionAlignment: trackId 必须是非空字符串");
        }
        this.trackId = init.trackId;
        this.fromKeyframeId = init.fromKeyframeId ?? null;
        this.toKeyframeId = init.toKeyframeId ?? null;
        Object.freeze(this);
    }

    toJSON(): Required<ActionAlignmentInit> {
        return {
            trackId: this.trackId,
            fromKeyframeId: this.fromKeyframeId,
            toKeyframeId: this.toKeyframeId,
        };
    }
}

export function isActionAlignmentInit(value: unknown): value is ActionAlignmentInit {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as { trackId?: unknown; fromKeyframeId?: unknown; toKeyframeId?: unknown };
    const isOptionalId = (id: unknown): boolean => id === undefined || id === null || typeof id === "string";
    return (
        typeof candidate.trackId === "string" &&
        isOptionalId(candidate.fromKeyframeId) &&
        isOptionalId(candidate.toKeyframeId)
    );
}

/**
 * 对齐 → 时段。null = 解析不出可用时段(轨道不存在/关键帧 id 不存在/区间退化为零长),
 * 调用方应回退到显式排期而不是猜一个时段。
 */
export function resolveActionRange(alignment: ActionAlignment, track: AlignableTrack | null): ActionRange | null {
    if (!track || track.id !== alignment.trackId) return null;
    const keyframes = track.keyframes;
    if (keyframes.length < 2) return null;
    const from =
        alignment.fromKeyframeId === null
            ? keyframes[0]
            : keyframes.find((keyframe) => keyframe.id === alignment.fromKeyframeId);
    const to =
        alignment.toKeyframeId === null
            ? keyframes[keyframes.length - 1]
            : keyframes.find((keyframe) => keyframe.id === alignment.toKeyframeId);
    if (!from || !to) return null;
    const startTimeSeconds = Math.min(from.time, to.time);
    const durationSeconds = Math.abs(to.time - from.time);
    if (durationSeconds <= 0) return null;
    return { startTimeSeconds, durationSeconds };
}
