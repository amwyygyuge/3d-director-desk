import { makeAutoObservable } from "mobx";

export const VIDEO_EXPORT_SOURCE = {
    PROGRAM: "program",
    VIEWPORT: "viewport",
} as const;
export type VideoExportSource = (typeof VIDEO_EXPORT_SOURCE)[keyof typeof VIDEO_EXPORT_SOURCE];

export const VIDEO_EXPORT_STATE = {
    IDLE: "idle",
    RECORDING: "recording",
} as const;
export type VideoExportState = (typeof VIDEO_EXPORT_STATE)[keyof typeof VIDEO_EXPORT_STATE];

/** 播放头低频显示值的窄端口；进度只由它派生，不另起时钟。 */
export interface PlayheadSource {
    readonly value: number;
}

/**
 * 视频导出任务的可观察生命周期；CaptureService 持有确定性编码器运行时句柄，本类只表达产品工作流状态。
 */
export class VideoExportSession {
    private currentState: VideoExportState = VIDEO_EXPORT_STATE.IDLE;
    private currentSource: VideoExportSource | null = null;
    private currentRequestId: string | null = null;
    private exportStartSeconds = 0;
    private plannedDurationSeconds = 0;

    constructor(private readonly playhead: PlayheadSource) {
        makeAutoObservable<VideoExportSession, "playhead">(this, { playhead: false });
    }

    get state(): VideoExportState {
        return this.currentState;
    }

    get source(): VideoExportSource | null {
        return this.currentSource;
    }

    get requestId(): string | null {
        return this.currentRequestId;
    }

    get durationSeconds(): number {
        return this.plannedDurationSeconds;
    }

    get isRecording(): boolean {
        return this.currentState === VIDEO_EXPORT_STATE.RECORDING;
    }

    get progressRatio(): number {
        if (!this.isRecording || this.plannedDurationSeconds <= 0) return 0;
        const elapsedSeconds = this.playhead.value - this.exportStartSeconds;
        return Math.min(1, Math.max(0, elapsedSeconds / this.plannedDurationSeconds));
    }

    get remainingSeconds(): number {
        if (!this.isRecording) return 0;
        const elapsedSeconds = this.playhead.value - this.exportStartSeconds;
        return Math.max(0, this.plannedDurationSeconds - elapsedSeconds);
    }

    begin(options: {
        readonly source: VideoExportSource;
        readonly startSeconds: number;
        readonly durationSeconds: number;
        readonly requestId: string;
    }): void {
        this.currentState = VIDEO_EXPORT_STATE.RECORDING;
        this.currentSource = options.source;
        this.currentRequestId = options.requestId;
        this.exportStartSeconds = options.startSeconds;
        this.plannedDurationSeconds = options.durationSeconds;
    }

    finish(): void {
        this.currentState = VIDEO_EXPORT_STATE.IDLE;
        this.currentSource = null;
        this.currentRequestId = null;
        this.exportStartSeconds = 0;
        this.plannedDurationSeconds = 0;
    }
}
