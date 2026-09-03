import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { isShellMode, SHELL_MODE } from "@/store/WorkbenchLayoutStore";
import type { ShellMode } from "@/store/WorkbenchLayoutStore";

const PRESENTATION_COMMAND_VERSION = "1" as const;
const PRESENTATION_PERMISSION = "desk:present";
const PRESENTATION_APPLIES_WHEN = "director-desk.presentation-v1";
const ISSUE_CODE = {
    EMPTY_PROGRAM: "presentation-empty-program",
    NOT_PRESENTING: "presentation-not-active",
    INVALID_SHELL_MODE: "invalid-shell-mode",
} as const;

type EmptyPayload = Record<string, never>;

interface SetShellModePayload {
    readonly mode: ShellMode;
}

interface SetShellHiddenPayload {
    readonly hidden: boolean;
}

const ENTER_PRESENTATION_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;
const EXIT_PRESENTATION_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;
const SET_SHELL_MODE_CONTRACT: PayloadContract = {
    properties: { mode: { type: "string", enum: Object.values(SHELL_MODE) } },
    required: ["mode"],
};
const SET_SHELL_HIDDEN_CONTRACT: PayloadContract = {
    properties: { hidden: { type: "boolean" } },
    required: ["hidden"],
};

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
        ctx.layout.setShellMode(SHELL_MODE.PRESENTATION);
        ctx.selection.clear();
        // ⌘K 面板若开着必须收掉:预览独占后 Hotkeys 的面板让位门会连 Esc 退出键一起吞掉
        ctx.ui.setPaletteOpen(false);
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
        if (ctx.layout.isProgramTakeover) return [];
        return [{ code: ISSUE_CODE.NOT_PRESENTING, path: "layout.shellMode", message: "当前不在全屏预览模式" }];
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    execute(ctx: DirectorContext): void {
        ctx.clock.pause();
        ctx.layout.setShellMode(SHELL_MODE.AUTHORING);
    }
}

/** 显式切换壳层空间编排:供 UI 与 AI 走同一可撤销命令入口。 */
export class SetShellModeCommand extends DirectorCommand<SetShellModePayload> {
    static readonly TYPE = "view.set-shell-mode";
    readonly type = SetShellModeCommand.TYPE;

    constructor(readonly payload: SetShellModePayload) {
        super();
    }

    validate(): string[] {
        return isShellMode(this.payload.mode) ? [] : ["壳层模式必须是 authoring、review 或 presentation"];
    }

    execute(ctx: DirectorContext): void {
        ctx.layout.setShellMode(this.payload.mode);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetShellModeCommand.TYPE, payload: { mode: ctx.layout.explicitShellMode } }];
    }
}

/** Tab 的临时全隐同样经命令层写入,恢复时不篡改当前 shellMode。 */
export class SetShellHiddenCommand extends DirectorCommand<SetShellHiddenPayload> {
    static readonly TYPE = "view.set-shell-hidden";
    readonly type = SetShellHiddenCommand.TYPE;

    constructor(readonly payload: SetShellHiddenPayload) {
        super();
    }

    validate(): string[] {
        return typeof this.payload.hidden === "boolean" ? [] : ["壳层隐藏标记必须是 boolean"];
    }

    execute(ctx: DirectorContext): void {
        ctx.layout.setShellHidden(this.payload.hidden);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetShellHiddenCommand.TYPE, payload: { hidden: ctx.layout.isShellHidden } }];
    }
}

function capability(type: string, payload: PayloadContract): CommandCapability {
    return {
        type,
        version: PRESENTATION_COMMAND_VERSION,
        kind: "command",
        permissions: [PRESENTATION_PERMISSION],
        appliesWhen: PRESENTATION_APPLIES_WHEN,
        payload,
    };
}

/** 预览模式对 AI 可见:进入/退出与显式壳层切换使用同一命令词汇。 */
export function registerPresentationCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        EnterPresentationCommand.TYPE,
        () => new EnterPresentationCommand(),
        capability(EnterPresentationCommand.TYPE, ENTER_PRESENTATION_CONTRACT),
    );
    dispatcher.register(
        ExitPresentationCommand.TYPE,
        () => new ExitPresentationCommand(),
        capability(ExitPresentationCommand.TYPE, EXIT_PRESENTATION_CONTRACT),
    );
    dispatcher.register(
        SetShellModeCommand.TYPE,
        (payload: SetShellModePayload) => new SetShellModeCommand(payload),
        capability(SetShellModeCommand.TYPE, SET_SHELL_MODE_CONTRACT),
    );
    dispatcher.register(
        SetShellHiddenCommand.TYPE,
        (payload: SetShellHiddenPayload) => new SetShellHiddenCommand(payload),
        capability(SetShellHiddenCommand.TYPE, SET_SHELL_HIDDEN_CONTRACT),
    );
}
