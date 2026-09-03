export const FRAME_RATE_FPS = {
    FILM: 24,
    PAL: 25,
    NTSC: 30,
    HIGH: 60,
} as const;
export type FrameRateFps = (typeof FRAME_RATE_FPS)[keyof typeof FRAME_RATE_FPS];

export const DEFAULT_FRAME_RATE_FPS = FRAME_RATE_FPS.NTSC;

/** 合法帧率域:低于 1 无法表达一秒,高于 240 超出任何交付格式,均视为非法输入 */
const FPS_MIN = 1;
const FPS_MAX = 240;

export function isFrameRateFps(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= FPS_MIN && value <= FPS_MAX;
}

/**
 * 帧率(值对象):时间的原子。
 *
 * 存在的理由:此前时间是裸浮点秒,一次拖拽产出 7.623604465709729 这样的时刻——
 * 同样的操作两次结果不同、关键帧对不齐、也无法与外部工程交换。一切进入文档的时刻
 * 必须先过 quantize,栅格由本对象唯一定义。
 */
export class FrameRate {
    readonly fps: number;

    constructor(fps: number = DEFAULT_FRAME_RATE_FPS) {
        this.fps = isFrameRateFps(fps) ? fps : DEFAULT_FRAME_RATE_FPS;
        Object.freeze(this);
    }

    get frameDurationSeconds(): number {
        return 1 / this.fps;
    }

    /** 秒 → 帧号(四舍五入到最近帧);负值向零收敛由 Math.round 自然处理 */
    toFrames(seconds: number): number {
        return Math.round(seconds * this.fps);
    }

    fromFrames(frames: number): number {
        return frames / this.fps;
    }

    /** 时间落点的唯一栅格化入口:命令层写入文档前必须经过它 */
    quantize(seconds: number): number {
        return Number.isFinite(seconds) ? this.toFrames(seconds) / this.fps : seconds;
    }

    equals(other: FrameRate): boolean {
        return this.fps === other.fps;
    }

    toJSON(): number {
        return this.fps;
    }
}
