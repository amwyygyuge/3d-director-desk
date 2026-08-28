import { DirectorCommand } from "./DirectorCommand";
import type { DirectorContext } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

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
            ctx.ui.setLastCaptureUrl(blobUrl);
        });
    }
}

export function registerCaptureCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(CaptureFrameCommand.TYPE, (payload: CaptureFramePayload) => new CaptureFrameCommand(payload));
}
