import { CAPTURE_PRODUCT_KIND } from "@/capture/CaptureProduct";
import type { CaptureProduct } from "@/capture/CaptureProduct";
import { createId } from "@/core/createId";
import { VIDEO_MAX_DURATION_SECONDS } from "@/capture/CaptureService";
import { VIDEO_EXPORT_SOURCE } from "@/capture/VideoExportSession";
import type { VideoExportSource } from "@/capture/VideoExportSession";
import { videoExportPolicyFor } from "@/capture/VideoExportSourcePolicy";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";

interface CaptureFramePayload {
    /** AI 连发/重试时按 requestId 对账产物归属。 */
    readonly requestId?: string;
    /** 默认 true:编辑辅助物不入镜；地板网格属于演播室环境，始终保留。 */
    readonly hideHelpers?: boolean;
}

interface CaptureVideoPayload {
    /** AI 连发/重试时按 requestId 对账产物归属。 */
    readonly requestId?: string;
    /** 录制起点(秒);缺省 = 播放范围入点。 */
    readonly startSeconds?: number;
    /** 录制时长(秒);缺省 = 播放范围跨度。 */
    readonly durationSeconds?: number;
    /** 缺省输出 Program 成片；viewport 明确录制编辑视角。 */
    readonly source?: VideoExportSource;
}

interface CaptureFrameRequest {
    readonly dispatcher: CommandDispatcher;
    readonly context: DirectorContext;
}

type CaptureDelivery =
    | {
          readonly kind: typeof CAPTURE_PRODUCT_KIND.IMAGE;
          readonly blob: Blob;
          readonly requestId: string;
          readonly durationSeconds: null;
      }
    | {
          readonly kind: typeof CAPTURE_PRODUCT_KIND.VIDEO;
          readonly blob: Blob;
          readonly requestId: string;
          readonly durationSeconds: number;
          readonly source: VideoExportSource;
      };

const CAPTURE_FRAME_FAILURE_PREFIX = "截图被拒绝:";
const CAPTURE_VERSION = "1" as const;
const CAPTURE_PERMISSION = "capture:write";
const CAPTURE_APPLIES_WHEN = "director-desk.capture-v1";
const CAPTURE_ISSUE_CODE = {
    EMPTY_PROGRAM: "capture-empty-program",
    NOT_RECORDING: "capture-not-recording",
} as const;
const MP4_EXPORT_FAILURE_MESSAGE = "MP4 参考视频导出失败：当前浏览器不支持稳定帧率导出";
const CAPTURE_FRAME_CONTRACT: PayloadContract = {
    properties: { hideHelpers: { type: "boolean" }, requestId: { type: "string" } },
};
const CAPTURE_VIDEO_CONTRACT: PayloadContract = {
    properties: {
        startSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        requestId: { type: "string" },
        source: { type: "string", enum: [VIDEO_EXPORT_SOURCE.PROGRAM, VIDEO_EXPORT_SOURCE.VIEWPORT] },
    },
};

function captureCapability(type: string, payload: PayloadContract): CommandCapability {
    return {
        type,
        version: CAPTURE_VERSION,
        kind: "command",
        permissions: [CAPTURE_PERMISSION],
        appliesWhen: CAPTURE_APPLIES_WHEN,
        payload,
    };
}

/** 宿主回传失败由宿主反馈；组件隔离拒绝，避免 host 模式产生第二条桌内错误提示。 */
async function reportCaptureToHost(ctx: DirectorContext, product: CaptureProduct): Promise<void> {
    try {
        await ctx.host.reportCapture(product);
    } catch {
        // 宿主已显示反馈；组件不得制造重复错误提示。
    }
}

/** 截图与视频共用产品出口，保证宿主协议与桌内预览的产物身份一致。 */
async function deliverCaptureProduct(ctx: DirectorContext, delivery: CaptureDelivery): Promise<void> {
    const size = ctx.capture.size ?? { width: 0, height: 0 };
    const blobUrl = URL.createObjectURL(delivery.blob);
    const product: CaptureProduct = {
        kind: delivery.kind,
        mimeType: delivery.blob.type,
        blobUrl,
        width: size.width,
        height: size.height,
        requestId: delivery.requestId,
        durationSeconds: delivery.durationSeconds,
    };
    if (ctx.presentation.showsInternalCaptureProducts) {
        void reportCaptureToHost(ctx, product);
    } else {
        try {
            await reportCaptureToHost(ctx, product);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
        return;
    }
    switch (delivery.kind) {
        case CAPTURE_PRODUCT_KIND.IMAGE:
            ctx.ui.setLastCapture(blobUrl, {
                timeSeconds: ctx.clock.time,
                cameraPose: ctx.capture.readCameraPose(),
                requestId: delivery.requestId,
                ...size,
            });
            return;
        case CAPTURE_PRODUCT_KIND.VIDEO:
            ctx.ui.setLastVideo(blobUrl, {
                durationSeconds: delivery.durationSeconds,
                requestId: delivery.requestId,
                source: delivery.source,
                ...size,
            });
    }
}

/** 预演截图:同帧强制渲染取样，再经带类型的产品通道交付。 */
export class CaptureFrameCommand extends DirectorCommand<CaptureFramePayload> {
    static readonly TYPE = "capture.frame";
    readonly type = CaptureFrameCommand.TYPE;

    constructor(readonly payload: CaptureFramePayload = {}) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.capture.isAttached ? [] : ["渲染器未就绪(Canvas 尚未 onCreated)"];
    }

    execute(ctx: DirectorContext): void {
        const requestId = this.payload.requestId ?? createId();
        void ctx.capture.capture({ hideHelpers: this.payload.hideHelpers ?? true }).then(async (blob) => {
            if (!blob) return;
            await deliverCaptureProduct(ctx, {
                kind: CAPTURE_PRODUCT_KIND.IMAGE,
                blob,
                requestId,
                durationSeconds: null,
            });
        });
    }
}

/** 将 UI 与快捷键入口收敛到同一截图命令及失败提示。 */
export function requestFrameCapture({ dispatcher, context }: CaptureFrameRequest): void {
    const result = dispatcher.dispatch({ type: CaptureFrameCommand.TYPE, payload: {} }, context);
    if (!result.ok) context.ui.setApplicationNotice(`${CAPTURE_FRAME_FAILURE_PREFIX}${result.error}`);
}

/** 缺省导出当前入出点；显式起点/时长同时覆盖时才离开该范围。 */
function videoRangeFor(
    ctx: DirectorContext,
    payload: CaptureVideoPayload,
): {
    readonly startSeconds: number;
    readonly durationSeconds: number;
} {
    const range = ctx.timeline.document.playbackRange;
    return {
        startSeconds: payload.startSeconds ?? range.inSeconds,
        durationSeconds: payload.durationSeconds ?? range.spanSeconds,
    };
}

/**
 * 导出固定帧率 MP4：默认使用当前播放范围，Program 走预览态接管相机，viewport 是显式保留编辑辅助物的备选。
 * 异步产物只在导出任务完成且工作台状态已复原后交付。
 */
export class CaptureVideoCommand extends DirectorCommand<CaptureVideoPayload> {
    static readonly TYPE = "capture.video";
    readonly type = CaptureVideoCommand.TYPE;

    constructor(readonly payload: CaptureVideoPayload = {}) {
        super();
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const source = this.payload.source ?? VIDEO_EXPORT_SOURCE.PROGRAM;
        if (!ctx.capture.isAttached) {
            return [
                {
                    code: "capture-renderer-unavailable",
                    path: "capture",
                    message: "渲染器未就绪(Canvas 尚未 onCreated)",
                },
            ];
        }
        if (ctx.videoExport.isRecording) {
            return [
                {
                    code: "capture-already-recording",
                    path: "videoExport.state",
                    message: "已有录制进行中(先停止或取消)",
                },
            ];
        }
        const range = videoRangeFor(ctx, this.payload);
        const endSeconds = range.startSeconds + range.durationSeconds;
        const playbackRange = ctx.timeline.document.playbackRange;
        if (
            !Number.isFinite(range.startSeconds) ||
            !Number.isFinite(range.durationSeconds) ||
            range.startSeconds < playbackRange.inSeconds ||
            endSeconds > playbackRange.outSeconds ||
            range.durationSeconds <= 0 ||
            range.durationSeconds > VIDEO_MAX_DURATION_SECONDS
        ) {
            return [
                {
                    code: "capture-invalid-duration",
                    path: "durationSeconds",
                    message: `录制范围须落在当前播放范围内，时长在 0~${VIDEO_MAX_DURATION_SECONDS} 秒之间`,
                },
            ];
        }
        if (source === VIDEO_EXPORT_SOURCE.VIEWPORT || ctx.motion.program.clips.length > 0) return [];
        return [
            {
                code: CAPTURE_ISSUE_CODE.EMPTY_PROGRAM,
                path: "program.clips",
                message: "Program 输出轨为空，先在时间线为机位排出片段再导出成片",
                options: [{ type: "program.set-clip", label: "切入选中机位" }],
            },
        ];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    execute(ctx: DirectorContext): void {
        const source = this.payload.source ?? VIDEO_EXPORT_SOURCE.PROGRAM;
        const requestId = this.payload.requestId ?? createId();
        const range = videoRangeFor(ctx, this.payload);
        void this.exportAndDeliver(ctx, { source, requestId, ...range });
    }

    private async exportAndDeliver(
        ctx: DirectorContext,
        options: {
            readonly source: VideoExportSource;
            readonly requestId: string;
            readonly startSeconds: number;
            readonly durationSeconds: number;
        },
    ): Promise<void> {
        const policy = videoExportPolicyFor(options.source);
        try {
            policy.prepare(ctx);
            ctx.clock.pause();
            ctx.clock.seek(options.startSeconds);
            ctx.videoExport.begin(options);
            const outcome = await ctx.capture.exportVideo({
                durationSeconds: options.durationSeconds,
                frameRate: ctx.timeline.document.frameRate.fps,
                hideHelpers: options.source === VIDEO_EXPORT_SOURCE.PROGRAM,
                renderFrame: (timeSeconds) => ctx.clock.seek(options.startSeconds + timeSeconds),
            });
            if (!outcome) return;
            await deliverCaptureProduct(ctx, {
                kind: CAPTURE_PRODUCT_KIND.VIDEO,
                blob: outcome.blob,
                requestId: options.requestId,
                durationSeconds: outcome.durationSeconds,
                source: options.source,
            });
        } catch {
            ctx.ui.setApplicationNotice(MP4_EXPORT_FAILURE_MESSAGE);
        } finally {
            ctx.videoExport.finish();
            ctx.clock.pause();
            policy.restore(ctx);
        }
    }
}

/** 在当前已完成帧之后停止导出并交付 MP4；无进行中导出时返回结构化拒绝。 */
export class CaptureStopVideoCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "capture.video-stop";
    readonly type = CaptureStopVideoCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (ctx.videoExport.isRecording) return [];
        return [{ code: CAPTURE_ISSUE_CODE.NOT_RECORDING, path: "videoExport.state", message: "无进行中的录制" }];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    execute(ctx: DirectorContext): void {
        void ctx.capture.stopVideoExport();
    }
}

/** 取消导出并丢弃 MP4 产物。 */
export class CancelVideoCaptureCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "capture.video-cancel";
    readonly type = CancelVideoCaptureCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (ctx.videoExport.isRecording) return [];
        return [{ code: CAPTURE_ISSUE_CODE.NOT_RECORDING, path: "videoExport.state", message: "无进行中的录制" }];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((issue) => issue.message);
    }

    execute(ctx: DirectorContext): void {
        void ctx.capture.cancelVideoExport();
    }
}

export function registerCaptureCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        CaptureFrameCommand.TYPE,
        (payload: CaptureFramePayload) => new CaptureFrameCommand(payload),
        captureCapability(CaptureFrameCommand.TYPE, CAPTURE_FRAME_CONTRACT),
    );
    dispatcher.register(
        CaptureVideoCommand.TYPE,
        (payload: CaptureVideoPayload) => new CaptureVideoCommand(payload),
        captureCapability(CaptureVideoCommand.TYPE, CAPTURE_VIDEO_CONTRACT),
    );
    dispatcher.register(
        CaptureStopVideoCommand.TYPE,
        (payload: Record<string, never>) => new CaptureStopVideoCommand(payload),
        captureCapability(CaptureStopVideoCommand.TYPE, EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        CancelVideoCaptureCommand.TYPE,
        (payload: Record<string, never>) => new CancelVideoCaptureCommand(payload),
        captureCapability(CancelVideoCaptureCommand.TYPE, EMPTY_PAYLOAD_CONTRACT),
    );
}
