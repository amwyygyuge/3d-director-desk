import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";

const SEQUENCE_COMMAND_VERSION = "1" as const;
const SEQUENCE_PERMISSION = "sequence:edit";
const SEQUENCE_READ_PERMISSION = "sequence:read";
const EMPTY_PAYLOAD: Record<string, never> = {};
const DURATION_ISSUE = "sequence-invalid-duration";

interface SetDurationPayload {
    readonly duration: number;
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: SEQUENCE_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.camera-sequence-v1" };
}

/** Changes the shared camera sequence duration without creating scene-object animation tracks. */
export class SetTimelineDurationCommand extends DirectorCommand<SetDurationPayload> {
    static readonly TYPE = "sequence.set-duration";
    readonly type = SetTimelineDurationCommand.TYPE;

    constructor(readonly payload: SetDurationPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return this.validateIssues(ctx).map((current) => current.message);
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (!Number.isFinite(this.payload.duration) || this.payload.duration <= 0) {
            return [issue(DURATION_ISSUE, "duration", "序列时长必须是大于零的有限秒数")];
        }
        const hasOversizedMotion = ctx.motion.clips.some((clip) => clip.endTimeSeconds > this.payload.duration);
        const hasOversizedProgram = ctx.motion.program.clips.some((clip) => clip.endTimeSeconds > this.payload.duration);
        return hasOversizedMotion || hasOversizedProgram
            ? [issue(DURATION_ISSUE, "duration", "序列时长不能截断已有运镜或 Program 片段")]
            : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setDuration(this.payload.duration);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        return [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.duration } }];
    }
}

/** AI-readable camera sequence timing without exposing scene-object animation state. */
export class CameraSequenceGetQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "sequence.get";
    readonly type = CameraSequenceGetQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return Object.keys(this.payload).length === 0 ? [] : ["sequence.get payload 必须是空对象"];
    }

    execute(ctx: DirectorContext): unknown {
        return { durationSeconds: ctx.timeline.duration };
    }
}

export function registerTimelineCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        SetTimelineDurationCommand.TYPE,
        (payload: SetDurationPayload) => new SetTimelineDurationCommand(payload),
        capability(SetTimelineDurationCommand.TYPE, "command", [SEQUENCE_PERMISSION]),
    );
    dispatcher.registerQuery(
        CameraSequenceGetQuery.TYPE,
        (payload: Record<string, never>) => new CameraSequenceGetQuery(payload),
        capability(CameraSequenceGetQuery.TYPE, "query", [SEQUENCE_READ_PERMISSION]),
    );
}
