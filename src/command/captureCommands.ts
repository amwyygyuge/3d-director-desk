import { VIDEO_MAX_DURATION_SECONDS } from "../capture/CaptureService";
import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext } from "./DirectorCommand";
import type { CommandCapability, CommandDispatcher } from "./CommandDispatcher";

interface CaptureFramePayload {
    /** 默认 true:网格/gizmo/高亮框不入镜 */
    hideHelpers?: boolean;
}

/**
 * 预演截图:同帧强制渲染取样 → blob → objectURL → HostBridge capture-produced 回传。
 * 命令层入口(AI 可调的 S5 场景);execute 内异步管线 fire-and-forget,
 * 产物经桥消息异步交付,CommandResult 只表达「是否受理」。
 */
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
        void ctx.capture.capture({ hideHelpers: this.payload.hideHelpers ?? true }).then((blob) => {
            if (!blob) return;
            const size = ctx.capture.size ?? { width: 0, height: 0 };
            const blobUrl = URL.createObjectURL(blob);
            ctx.host.reportCapture({ blobUrl, ...size });
            ctx.ui.setLastCapture(blobUrl, {
                timeSeconds: ctx.clock.time,
                cameraPose: ctx.capture.readCameraPose(),
                ...size,
            });
        });
    }
}
const CAPTURE_FRAME_FAILURE_PREFIX = "截图被拒绝:";

interface CaptureFrameRequest {
    readonly dispatcher: CommandDispatcher;
    readonly context: DirectorContext;
}

/** 将 UI 与快捷键入口收敛到同一截图命令及失败提示。 */
export function requestFrameCapture({ dispatcher, context }: CaptureFrameRequest): void {
    const result = dispatcher.dispatch({ type: CaptureFrameCommand.TYPE, payload: {} }, context);
    if (!result.ok) context.ui.setApplicationNotice(`${CAPTURE_FRAME_FAILURE_PREFIX}${result.error}`);
}

interface CaptureVideoPayload {
    /** 录制时长(秒);缺省 = 时间轴时长 */
    readonly durationSeconds?: number;
}

function captureCapability(type: string): CommandCapability {
    return {
        type,
        version: "1",
        kind: "command",
        permissions: ["capture:write"],
        appliesWhen: "director-desk.capture-v1",
    };
}

/**
 * 录制预演视频(WebM):从 0 秒播放时间轴,画布帧流经 MediaRecorder 落 blob。
 * 异步产物:CommandResult 只表达受理;产物经 ui.lastVideoUrl/lastVideoMeta 交付,
 * 取消走 capture.video-cancel(闸门:并发守卫 + 取消路径)。
 */
export class CaptureVideoCommand extends DirectorCommand<CaptureVideoPayload> {
    static readonly TYPE = "capture.video";
    readonly type = CaptureVideoCommand.TYPE;

    constructor(readonly payload: CaptureVideoPayload = {}) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (!ctx.capture.isAttached) return ["渲染器未就绪(Canvas 尚未 onCreated)"];
        if (ctx.capture.isRecording) return ["已有录制进行中(先 capture.video-cancel 或等待完成)"];
        const duration = this.payload.durationSeconds ?? ctx.timeline.document.duration;
        if (!Number.isFinite(duration) || duration <= 0 || duration > VIDEO_MAX_DURATION_SECONDS) {
            return [`录制时长须在 0~${VIDEO_MAX_DURATION_SECONDS} 秒之间`];
        }
        return [];
    }

    execute(ctx: DirectorContext): void {
        const durationSeconds = this.payload.durationSeconds ?? ctx.timeline.document.duration;
        void (async () => {
            ctx.clock.pause();
            ctx.clock.seek(0);
            const recording = ctx.capture.recordVideo({ durationSeconds });
            ctx.ui.setVideoRecording(true);
            ctx.clock.play();
            const blob = await recording;
            ctx.ui.setVideoRecording(false);
            ctx.clock.pause();
            if (!blob) return;
            const size = ctx.capture.size ?? { width: 0, height: 0 };
            ctx.ui.setLastVideo(URL.createObjectURL(blob), { durationSeconds, ...size });
        })();
    }
}

/** 提前终止录制;无进行中录制时校验拒绝 */
export class CancelVideoCaptureCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "capture.video-cancel";
    readonly type = CancelVideoCaptureCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.capture.isRecording ? [] : ["无进行中的录制"];
    }

    execute(ctx: DirectorContext): void {
        ctx.capture.cancelRecording();
    }
}

export function registerCaptureCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(CaptureFrameCommand.TYPE, (payload: CaptureFramePayload) => new CaptureFrameCommand(payload));
    dispatcher.register(
        CaptureVideoCommand.TYPE,
        (payload: CaptureVideoPayload) => new CaptureVideoCommand(payload),
        captureCapability(CaptureVideoCommand.TYPE),
    );
    dispatcher.register(
        CancelVideoCaptureCommand.TYPE,
        (payload: Record<string, never>) => new CancelVideoCaptureCommand(payload),
        captureCapability(CancelVideoCaptureCommand.TYPE),
    );
}
