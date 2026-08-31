import { CAMERA_MOTION_EASING, CameraMotionClip } from "../camera/CameraMotionClip";
import type { CameraMotionClipJSON, CameraMotionEasing } from "../camera/CameraMotionClip";
import { CameraMotionPath } from "../camera/CameraMotionPath";
import type { CameraMotionPathJSON } from "../camera/CameraMotionPath";
import { CameraProgramClip } from "../camera/CameraProgramTrack";
import type { CameraProgramClipJSON } from "../camera/CameraProgramTrack";
import type { Vec3 } from "../core/SceneObject";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "./CommandDispatcher";

const MOTION_COMMAND_VERSION = "1" as const;
const MOTION_PERMISSION = "motion:edit";
const MOTION_READ_PERMISSION = "motion:read";
const EMPTY_PAYLOAD: Record<string, never> = {};
const ISSUE_CODE = {
    PAYLOAD: "motion-invalid-payload",
    CAMERA: "motion-camera-not-found",
    CLIP: "motion-clip-not-found",
    DURATION: "motion-time-outside-duration",
    OVERLAP: "motion-overlapping-clip",
    PROGRAM_OVERLAP: "program-overlapping-clip",
    PROGRAM_CLIP: "program-clip-not-found",
} as const;

interface CreateMotionClipPayload {
    readonly clip: CameraMotionClipJSON;
}

interface SetMotionClipRangePayload {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

interface SetMotionClipPathPayload {
    readonly id: string;
    readonly path: CameraMotionPathJSON;
}

interface SetMotionClipTargetPayload {
    readonly id: string;
    readonly target: Vec3;
}

interface SetMotionClipEasingPayload {
    readonly id: string;
    readonly easing: CameraMotionEasing;
}

interface RemoveMotionClipPayload {
    readonly id: string;
}

interface SetProgramClipPayload {
    readonly clip: CameraProgramClipJSON;
}

interface RemoveProgramClipPayload {
    readonly id: string;
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function finiteVector(value: unknown): value is Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component));
}

function motionClipFrom(payload: CreateMotionClipPayload): CameraMotionClip | null {
    try {
        return new CameraMotionClip(payload.clip);
    } catch {
        return null;
    }
}

function programClipFrom(payload: SetProgramClipPayload): CameraProgramClip | null {
    try {
        return new CameraProgramClip(payload.clip);
    } catch {
        return null;
    }
}

function clipRangeIssue(ctx: DirectorContext, clip: CameraMotionClip, excludedId: string | null): CommandIssue | null {
    const isOutsideDuration = clip.endTimeSeconds > ctx.timeline.document.duration;
    if (isOutsideDuration) return issue(ISSUE_CODE.DURATION, "clip", "运镜片段不能超出时间轴时长");
    const overlaps = ctx.motion
        .clipsForCamera(clip.cameraId)
        .some((current) => current.id !== excludedId && current.startTimeSeconds < clip.endTimeSeconds && clip.startTimeSeconds < current.endTimeSeconds);
    return overlaps ? issue(ISSUE_CODE.OVERLAP, "clip", "同一机位的运镜片段不能重叠") : null;
}

function existingClip(ctx: DirectorContext, id: unknown): CameraMotionClip | null {
    return typeof id === "string" && id.length > 0 ? (ctx.motion.clip(id) ?? null) : null;
}

function clipIssues(ctx: DirectorContext, clip: CameraMotionClip, excludedId: string | null): readonly CommandIssue[] {
    const camera = ctx.camera.director.getShot(clip.cameraId);
    const range = clipRangeIssue(ctx, clip, excludedId);
    return camera ? (range ? [range] : []) : [issue(ISSUE_CODE.CAMERA, "clip.cameraId", "运镜引用的机位不存在")];
}

function restoreMotionClipPayload(clip: CameraMotionClip): CreateMotionClipPayload {
    return { clip: clip.toJSON() };
}

/** Creates a serialized, camera-owned time segment. Path geometry and temporal range remain independently editable. */
export class CreateMotionClipCommand extends DirectorCommand<CreateMotionClipPayload> {
    static readonly TYPE = "motion.create-clip";
    readonly type = CreateMotionClipCommand.TYPE;

    constructor(readonly payload: CreateMotionClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = motionClipFrom(this.payload);
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段格式无效")];
        if (ctx.motion.clip(clip.id)) return [issue(ISSUE_CODE.PAYLOAD, "clip.id", "运镜片段 id 已存在")];
        return clipIssues(ctx, clip, null);
    }

    execute(ctx: DirectorContext): void {
        const clip = motionClipFrom(this.payload);
        if (clip) ctx.motion.replaceClip(clip);
        ctx.playback.sampleCurrent();
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveMotionClipCommand.TYPE, payload: { id: this.payload.clip.id } }];
    }
}

/** Retimes one clip without reauthoring its spatial path. */
export class SetMotionClipRangeCommand extends DirectorCommand<SetMotionClipRangePayload> {
    static readonly TYPE = "motion.set-clip-range";
    readonly type = SetMotionClipRangeCommand.TYPE;

    constructor(readonly payload: SetMotionClipRangePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        try {
            const candidate = new CameraMotionClip({
                ...current.toJSON(),
                startTimeSeconds: this.payload.startTimeSeconds,
                durationSeconds: this.payload.durationSeconds,
            });
            return clipIssues(ctx, candidate, current.id);
        } catch {
            return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段时间范围必须是有限正数")];
        }
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        if (current) {
            ctx.motion.replaceClip(current.withTimeRange(this.payload.startTimeSeconds, this.payload.durationSeconds));
        }
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current
            ? [
                  {
                      type: SetMotionClipRangeCommand.TYPE,
                      payload: {
                          id: current.id,
                          startTimeSeconds: current.startTimeSeconds,
                          durationSeconds: current.durationSeconds,
                      },
                  },
              ]
            : null;
    }
}

/** Replaces a clip path atomically; control handles remain pure data and are safe for AI tooling. */
export class SetMotionClipPathCommand extends DirectorCommand<SetMotionClipPathPayload> {
    static readonly TYPE = "motion.set-clip-path";
    readonly type = SetMotionClipPathCommand.TYPE;

    constructor(readonly payload: SetMotionClipPathPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        try {
            new CameraMotionPath(this.payload.path);
            return [];
        } catch {
            return [issue(ISSUE_CODE.PAYLOAD, "path", "路径必须含两个以上有限 Bézier 锚点")];
        }
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        if (current) ctx.motion.replaceClip(current.withPath(new CameraMotionPath(this.payload.path)));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current
            ? [{ type: SetMotionClipPathCommand.TYPE, payload: { id: current.id, path: current.path.toJSON() } }]
            : null;
    }
}

/** Changes the default world-space look-at target. Object binding is intentionally a later strategy. */
export class SetMotionClipTargetCommand extends DirectorCommand<SetMotionClipTargetPayload> {
    static readonly TYPE = "motion.set-clip-target";
    readonly type = SetMotionClipTargetCommand.TYPE;

    constructor(readonly payload: SetMotionClipTargetPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        return finiteVector(this.payload.target) ? [] : [issue(ISSUE_CODE.PAYLOAD, "target", "注视目标必须是有限三维坐标")];
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        if (current) ctx.motion.replaceClip(current.withTarget(this.payload.target));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current ? [{ type: SetMotionClipTargetCommand.TYPE, payload: { id: current.id, target: current.target } }] : null;
    }
}

export class SetMotionClipEasingCommand extends DirectorCommand<SetMotionClipEasingPayload> {
    static readonly TYPE = "motion.set-clip-easing";
    readonly type = SetMotionClipEasingCommand.TYPE;

    constructor(readonly payload: SetMotionClipEasingPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        const isAllowed =
            this.payload.easing === CAMERA_MOTION_EASING.LINEAR || this.payload.easing === CAMERA_MOTION_EASING.SMOOTH;
        return isAllowed ? [] : [issue(ISSUE_CODE.PAYLOAD, "easing", "运镜缓动必须为 linear 或 smooth")];
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        if (current) ctx.motion.replaceClip(current.withEasing(this.payload.easing));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current
            ? [{ type: SetMotionClipEasingCommand.TYPE, payload: { id: current.id, easing: current.easing } }]
            : null;
    }
}

export class RemoveMotionClipCommand extends DirectorCommand<RemoveMotionClipPayload> {
    static readonly TYPE = "motion.remove-clip";
    readonly type = RemoveMotionClipCommand.TYPE;

    constructor(readonly payload: RemoveMotionClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return existingClip(ctx, this.payload.id) ? [] : [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.removeClip(this.payload.id);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current ? [{ type: CreateMotionClipCommand.TYPE, payload: restoreMotionClipPayload(current) }] : null;
    }
}

/** Updates the sole Program output track. A program segment may reference a static or moving camera. */
export class SetProgramClipCommand extends DirectorCommand<SetProgramClipPayload> {
    static readonly TYPE = "program.set-clip";
    readonly type = SetProgramClipCommand.TYPE;

    constructor(readonly payload: SetProgramClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = programClipFrom(this.payload);
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "输出片段格式无效")];
        if (!ctx.camera.director.getShot(clip.cameraId)) {
            return [issue(ISSUE_CODE.CAMERA, "clip.cameraId", "输出片段引用的机位不存在")];
        }
        if (clip.endTimeSeconds > ctx.timeline.document.duration) {
            return [issue(ISSUE_CODE.DURATION, "clip", "输出片段不能超出时间轴时长")];
        }
        try {
            ctx.motion.program.withClip(clip);
            return [];
        } catch {
            return [issue(ISSUE_CODE.PROGRAM_OVERLAP, "clip", "Program 输出片段不能重叠")];
        }
    }

    execute(ctx: DirectorContext): void {
        const clip = programClipFrom(this.payload);
        if (clip) ctx.motion.replaceProgram(ctx.motion.program.withClip(clip));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prior = ctx.motion.program.clip(this.payload.clip.id);
        return prior
            ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: prior.toJSON() } }]
            : [{ type: RemoveProgramClipCommand.TYPE, payload: { id: this.payload.clip.id } }];
    }
}

export class RemoveProgramClipCommand extends DirectorCommand<RemoveProgramClipPayload> {
    static readonly TYPE = "program.remove-clip";
    readonly type = RemoveProgramClipCommand.TYPE;

    constructor(readonly payload: RemoveProgramClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return ctx.motion.program.clip(this.payload.id)
            ? []
            : [issue(ISSUE_CODE.PROGRAM_CLIP, "id", "Program 输出片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.replaceProgram(ctx.motion.program.withoutClip(this.payload.id));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = ctx.motion.program.clip(this.payload.id);
        return current ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: current.toJSON() } }] : null;
    }
}

/** Read-only AI discovery and inspection endpoint. No Three references cross this boundary. */
export class CameraMotionGetQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "motion.get";
    readonly type = CameraMotionGetQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return Object.keys(this.payload).length === 0 ? [] : ["motion.get payload 必须是空对象"];
    }

    execute(ctx: DirectorContext): unknown {
        return {
            clips: ctx.motion.clips.map((clip) => clip.toJSON()),
            program: ctx.motion.program.toJSON(),
            activeProgramCameraId: ctx.motion.program.cameraAt(ctx.clock.time),
            timelineDurationSeconds: ctx.timeline.document.duration,
        };
    }
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: MOTION_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.camera-motion-v2" };
}

/** Motion and Program commands share one discovery namespace while retaining independent write permissions. */
export function registerCameraMotionCommands(dispatcher: CommandDispatcher): void {
    const commands = [
        CreateMotionClipCommand,
        SetMotionClipRangeCommand,
        SetMotionClipPathCommand,
        SetMotionClipTargetCommand,
        SetMotionClipEasingCommand,
        RemoveMotionClipCommand,
        SetProgramClipCommand,
        RemoveProgramClipCommand,
    ] as const;
    for (const Command of commands) {
        dispatcher.register(Command.TYPE, (payload) => new Command(payload), capability(Command.TYPE, "command", [MOTION_PERMISSION]));
    }
    dispatcher.registerQuery(
        CameraMotionGetQuery.TYPE,
        (payload: Record<string, never>) => new CameraMotionGetQuery(payload),
        capability(CameraMotionGetQuery.TYPE, "query", [MOTION_READ_PERMISSION]),
    );
}
