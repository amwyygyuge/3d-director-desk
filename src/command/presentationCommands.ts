import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";

const PRESENTATION_COMMAND_VERSION = "1" as const;
const PRESENTATION_PERMISSION = "desk:present";
const PRESENTATION_APPLIES_WHEN = "director-desk.presentation-v1";
const ISSUE_CODE = {
    EMPTY_PROGRAM: "presentation-empty-program",
    NOT_PRESENTING: "presentation-not-active",
} as const;

type EmptyPayload = Record<string, never>;

/**
 * 进入全屏预览:悬浮壳层与场景辅助物隐去,Program 输出轨接管视口相机并从头播放。
 *
 * 预览是瞬态视图模式(同 transport.play、view.frame),不入撤销栈——
 * 它不改变任何场景数据,只切换视口的呈现方式。
 */
export class EnterPresentationCommand extends DirectorCommand<EmptyPayload> {
    static readonly TYPE = "desk.enter-presentation";
    readonly type = EnterPresentationCommand.TYPE;

    constructor(readonly payload: EmptyPayload = {}) {
        super();
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (ctx.motion.program.clips.length > 0) return [];
        return [
            {
                code: ISSUE_CODE.EMPTY_PROGRAM,
                path: "program.clips",
                message: "Program 输出轨为空,先在时间线为机位排出片段再预览",
                options: [{ type: "program.set-clip", label: "切入选中机位" }],
            },
        ];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    execute(ctx: DirectorContext): void {
        ctx.layout.setPresentationMode(true);
        ctx.selection.clear();
        ctx.clock.seek(0);
        ctx.clock.play();
    }
}

/** 退出全屏预览:暂停播放并交还视口给编辑相机(恢复由 CameraMotionRig 承担)。 */
export class ExitPresentationCommand extends DirectorCommand<EmptyPayload> {
    static readonly TYPE = "desk.exit-presentation";
    readonly type = ExitPresentationCommand.TYPE;

    constructor(readonly payload: EmptyPayload = {}) {
        super();
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (ctx.layout.presentationMode) return [];
        return [{ code: ISSUE_CODE.NOT_PRESENTING, path: "layout.presentationMode", message: "当前不在预览模式" }];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.pause();
        ctx.layout.setPresentationMode(false);
    }
}

function capability(type: string): CommandCapability {
    return {
        type,
        version: PRESENTATION_COMMAND_VERSION,
        kind: "command",
        permissions: [PRESENTATION_PERMISSION],
        appliesWhen: PRESENTATION_APPLIES_WHEN,
    };
}

/** 预览模式对 AI 可见:进入/退出同一命令词汇,UI 按钮与 agent 工具调用共用一条路径。 */
export function registerPresentationCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        EnterPresentationCommand.TYPE,
        () => new EnterPresentationCommand(),
        capability(EnterPresentationCommand.TYPE),
    );
    dispatcher.register(
        ExitPresentationCommand.TYPE,
        () => new ExitPresentationCommand(),
        capability(ExitPresentationCommand.TYPE),
    );
}
