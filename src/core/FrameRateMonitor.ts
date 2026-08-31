import { makeAutoObservable } from "mobx";

const MILLISECONDS_PER_SECOND = 1000;
const SAMPLE_WINDOW_MS = 500;
const EMPTY_FPS = 0;

/**
 * 每导演台实例的真实渲染帧率采样器。
 *
 * 只由 R3F 已发生的 render 回调喂值：不注册 RAF、不调用 invalidate，
 * 因而 demand frameloop 空闲时保持零开销。fps 仅每个采样窗口写一次，避免
 * 帧级 observable 驱动 UI 重渲染。
 */
export class FrameRateMonitor {
    fps = EMPTY_FPS;
    private sampleStartedAtMs: number | null = null;
    private sampledFrames = 0;

    constructor() {
        makeAutoObservable<FrameRateMonitor, "sampleStartedAtMs" | "sampledFrames">(this, {
            sampleStartedAtMs: false,
            sampledFrames: false,
        });
    }

    recordFrame(elapsedMs: number): void {
        const sampleStartedAtMs = this.sampleStartedAtMs;
        if (sampleStartedAtMs === null) {
            this.sampleStartedAtMs = elapsedMs;
            this.sampledFrames = 1;
            return;
        }
        this.sampledFrames += 1;
        const sampleDurationMs = elapsedMs - sampleStartedAtMs;
        if (sampleDurationMs < SAMPLE_WINDOW_MS) return;
        this.fps = Math.round((this.sampledFrames * MILLISECONDS_PER_SECOND) / sampleDurationMs);
        this.sampleStartedAtMs = elapsedMs;
        this.sampledFrames = 0;
    }
}
