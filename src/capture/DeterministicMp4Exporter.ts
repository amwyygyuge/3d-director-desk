import { BufferTarget, CanvasSource, Mp4OutputFormat, Output, Quality } from "mediabunny";

const MP4_MIME_TYPE = "video/mp4";
const VIDEO_CODEC = "avc";
/** H.264 Baseline Level 5.1:保留广泛模型兼容性，同时覆盖高分辨率参考帧。 */
const VIDEO_CODEC_PROFILE = "avc1.420033";
const VIDEO_ENCODER_LATENCY_MODE = "quality" as const;
const VIDEO_ALPHA_MODE = "discard" as const;
const REFERENCE_VIDEO_QUALITY = "high" as const;
const MINIMUM_FRAME_COUNT = 1;
const H264_PIXEL_ALIGNMENT = 2;
const VIDEO_RESIZE_FIT = "fill" as const;

export interface DeterministicMp4ExportOptions {
    readonly durationSeconds: number;
    readonly frameRate: number;
    readonly canvas: HTMLCanvasElement;
    readonly renderFrame: (timeSeconds: number) => void;
}

export interface DeterministicMp4ExportResult {
    readonly blob: Blob;
    readonly durationSeconds: number;
}

/** 以固定时间样本输出 H.264/MP4；设备性能只影响导出耗时，绝不改变参考视频的帧序列。 */
export class DeterministicMp4Exporter {
    private shouldStop = false;
    private shouldCancel = false;
    private renderedFrameCount = 0;

    constructor(private readonly options: DeterministicMp4ExportOptions) {}

    requestStop(): void {
        this.shouldStop = true;
    }

    requestCancel(): void {
        this.shouldCancel = true;
    }

    async export(): Promise<DeterministicMp4ExportResult | null> {
        const frameDurationSeconds = 1 / this.options.frameRate;
        const frameCount = frameCountFor(this.options);
        const target = new BufferTarget();
        const output = new Output({ format: new Mp4OutputFormat(), target });
        try {
            const source = new CanvasSource(this.options.canvas, {
                alpha: VIDEO_ALPHA_MODE,
                codec: VIDEO_CODEC,
                fullCodecString: VIDEO_CODEC_PROFILE,
                latencyMode: VIDEO_ENCODER_LATENCY_MODE,
                quality: new Quality(REFERENCE_VIDEO_QUALITY),
                transform: {
                    fit: VIDEO_RESIZE_FIT,
                    height: h264AlignedDimension(this.options.canvas.height),
                    width: h264AlignedDimension(this.options.canvas.width),
                },
            });
            output.addVideoTrack(source, { frameRate: this.options.frameRate });
            await output.start();
            return await this.writeFrames({ frameCount, frameDurationSeconds, output, source, target });
        } catch (error) {
            if (import.meta.env.DEV) console.error("[capture] MP4 export failed", error);
            await safelyCancel(output);
            throw new ReferenceVideoExportError();
        }
    }

    private async writeFrames(options: {
        readonly frameCount: number;
        readonly frameDurationSeconds: number;
        readonly output: Output<Mp4OutputFormat, BufferTarget>;
        readonly source: CanvasSource;
        readonly target: BufferTarget;
    }): Promise<DeterministicMp4ExportResult | null> {
        for (;;) {
            if (this.shouldCancel) {
                await options.output.cancel();
                return null;
            }
            if (this.shouldFinish(options.frameCount)) return this.finalize(options);
            const timestampSeconds = this.renderedFrameCount * options.frameDurationSeconds;
            this.options.renderFrame(timestampSeconds);
            await options.source.add(timestampSeconds, options.frameDurationSeconds);
            this.renderedFrameCount += 1;
        }
    }

    private shouldFinish(frameCount: number): boolean {
        return this.shouldStop || this.renderedFrameCount >= frameCount;
    }

    private async finalize(options: {
        readonly frameDurationSeconds: number;
        readonly output: Output<Mp4OutputFormat, BufferTarget>;
        readonly source: CanvasSource;
        readonly target: BufferTarget;
    }): Promise<DeterministicMp4ExportResult> {
        options.source.close();
        await options.output.finalize();
        const buffer = options.target.buffer;
        if (!buffer) throw new ReferenceVideoExportError();
        const mimeType = await options.output.getMimeType();
        return {
            blob: new Blob([buffer], { type: mimeType || MP4_MIME_TYPE }),
            durationSeconds: this.renderedFrameCount * options.frameDurationSeconds,
        };
    }
}

/** 导出能力不足时只暴露产品错误；底层编码器异常不穿透 AI/宿主边界。 */
export class ReferenceVideoExportError extends Error {
    readonly code = "capture-mp4-export-unavailable";

    constructor() {
        super("当前浏览器不支持稳定帧率的 MP4 参考视频导出");
        this.name = "ReferenceVideoExportError";
    }
}

function frameCountFor(options: Pick<DeterministicMp4ExportOptions, "durationSeconds" | "frameRate">): number {
    return Math.max(MINIMUM_FRAME_COUNT, Math.ceil(options.durationSeconds * options.frameRate));
}

async function safelyCancel(output: Output<Mp4OutputFormat, BufferTarget>): Promise<void> {
    if (output.state === "started") await output.cancel();
}

/** H.264 的 4:2:0 色度采样要求输出边长为偶数，避免源画布物理尺寸为奇数时编码失败。 */
function h264AlignedDimension(value: number): number {
    return value - (value % H264_PIXEL_ALIGNMENT);
}
