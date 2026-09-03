import type { CommandCapability, CommandDispatcher } from "@/command/CommandDispatcher";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import { nullable } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { TimelineMarker } from "@/timeline/TimelineMarker";

const MARKER_COMMAND_VERSION = "1" as const;
const MARKER_PERMISSION = "timeline:edit";
const MARKER_APPLIES_WHEN = "director-desk.timeline-v1";
const TIMELINE_START_SECONDS = 0;
const ISSUE_CODE = {
    PAYLOAD: "marker.invalid-payload",
    DURATION: "marker.time-outside-duration",
    NOT_FOUND: "marker.not-found",
    DUPLICATE: "marker.duplicate-id",
} as const;

interface AddMarkerPayload {
    readonly id: string;
    readonly timeSeconds: number;
    readonly label: string;
    readonly colorToken?: string | null;
}

interface MoveMarkerPayload {
    readonly id: string;
    readonly timeSeconds: number;
}

interface RemoveMarkerPayload {
    readonly id: string;
}

const ADD_MARKER_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        timeSeconds: { type: "number" },
        label: { type: "string" },
        colorToken: nullable({ type: "string" }),
    },
    required: ["id", "timeSeconds", "label"],
};
const MOVE_MARKER_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, timeSeconds: { type: "number" } },
    required: ["id", "timeSeconds"],
};
const REMOVE_MARKER_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function markerIdIssue(id: unknown): CommandIssue | null {
    return typeof id === "string" && id.length > 0 ? null : issue(ISSUE_CODE.PAYLOAD, "id", "标记 id 格式无效");
}

function markerTimeIssue(ctx: DirectorContext, timeSeconds: unknown): CommandIssue | null {
    if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds)) {
        return issue(ISSUE_CODE.PAYLOAD, "timeSeconds", "标记时间必须是有限秒数");
    }
    if (timeSeconds < TIMELINE_START_SECONDS || timeSeconds > ctx.timeline.document.duration) {
        return issue(ISSUE_CODE.DURATION, "timeSeconds", "标记时间必须落在时间轴范围内");
    }
    const quantized = ctx.timeline.document.frameRate.quantize(timeSeconds);
    return quantized <= ctx.timeline.document.duration
        ? null
        : issue(ISSUE_CODE.DURATION, "timeSeconds", "标记时间栅格化后超出时间轴范围");
}

function markerAtPayloadTime(ctx: DirectorContext, payload: AddMarkerPayload): TimelineMarker {
    const init = {
        id: payload.id,
        timeSeconds: ctx.timeline.document.frameRate.quantize(payload.timeSeconds),
        label: payload.label,
    };
    return new TimelineMarker(payload.colorToken === undefined ? init : { ...init, colorToken: payload.colorToken });
}

function markerCommandCapability(type: string, payload: PayloadContract): CommandCapability {
    return {
        type,
        version: MARKER_COMMAND_VERSION,
        kind: "command",
        permissions: [MARKER_PERMISSION],
        appliesWhen: MARKER_APPLIES_WHEN,
        payload,
    };
}

export class AddTimelineMarkerCommand extends DirectorCommand<AddMarkerPayload> {
    static readonly TYPE = "timeline.add-marker";
    readonly type = AddTimelineMarkerCommand.TYPE;

    constructor(readonly payload: AddMarkerPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const idIssue = markerIdIssue(this.payload.id);
        if (idIssue) return [idIssue];
        if (typeof this.payload.label !== "string") {
            return [issue(ISSUE_CODE.PAYLOAD, "label", "标记标签必须是文本")];
        }
        if (
            this.payload.colorToken !== undefined &&
            this.payload.colorToken !== null &&
            typeof this.payload.colorToken !== "string"
        ) {
            return [issue(ISSUE_CODE.PAYLOAD, "colorToken", "标记颜色必须是主题色 token")];
        }
        const timeIssue = markerTimeIssue(ctx, this.payload.timeSeconds);
        if (timeIssue) return [timeIssue];
        return ctx.timeline.document.marker(this.payload.id)
            ? [issue(ISSUE_CODE.DUPLICATE, "id", "标记 id 已存在")]
            : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.setMarker(markerAtPayloadTime(ctx, this.payload));
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveTimelineMarkerCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

export class MoveTimelineMarkerCommand extends DirectorCommand<MoveMarkerPayload> {
    static readonly TYPE = "timeline.move-marker";
    readonly type = MoveTimelineMarkerCommand.TYPE;

    constructor(readonly payload: MoveMarkerPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const idIssue = markerIdIssue(this.payload.id);
        if (idIssue) return [idIssue];
        const timeIssue = markerTimeIssue(ctx, this.payload.timeSeconds);
        if (timeIssue) return [timeIssue];
        return ctx.timeline.document.marker(this.payload.id) ? [] : [issue(ISSUE_CODE.NOT_FOUND, "id", "标记不存在")];
    }

    execute(ctx: DirectorContext): void {
        const marker = ctx.timeline.document.marker(this.payload.id);
        if (!marker) return;
        ctx.timeline.setMarker(marker.withTime(ctx.timeline.document.frameRate.quantize(this.payload.timeSeconds)));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const marker = ctx.timeline.document.marker(this.payload.id);
        return marker
            ? [{ type: MoveTimelineMarkerCommand.TYPE, payload: { id: marker.id, timeSeconds: marker.timeSeconds } }]
            : null;
    }
}

export class RemoveTimelineMarkerCommand extends DirectorCommand<RemoveMarkerPayload> {
    static readonly TYPE = "timeline.remove-marker";
    readonly type = RemoveTimelineMarkerCommand.TYPE;

    constructor(readonly payload: RemoveMarkerPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const idIssue = markerIdIssue(this.payload.id);
        if (idIssue) return [idIssue];
        return ctx.timeline.document.marker(this.payload.id) ? [] : [issue(ISSUE_CODE.NOT_FOUND, "id", "标记不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.timeline.removeMarker(this.payload.id);
        ctx.timelineSelection.forget(this.payload.id);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const marker = ctx.timeline.document.marker(this.payload.id);
        return marker ? [{ type: AddTimelineMarkerCommand.TYPE, payload: marker.toJSON() }] : null;
    }
}

export function registerMarkerCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        AddTimelineMarkerCommand.TYPE,
        (payload: AddMarkerPayload) => new AddTimelineMarkerCommand(payload),
        markerCommandCapability(AddTimelineMarkerCommand.TYPE, ADD_MARKER_CONTRACT),
    );
    dispatcher.register(
        MoveTimelineMarkerCommand.TYPE,
        (payload: MoveMarkerPayload) => new MoveTimelineMarkerCommand(payload),
        markerCommandCapability(MoveTimelineMarkerCommand.TYPE, MOVE_MARKER_CONTRACT),
    );
    dispatcher.register(
        RemoveTimelineMarkerCommand.TYPE,
        (payload: RemoveMarkerPayload) => new RemoveTimelineMarkerCommand(payload),
        markerCommandCapability(RemoveTimelineMarkerCommand.TYPE, REMOVE_MARKER_CONTRACT),
    );
}
