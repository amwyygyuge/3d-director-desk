import { CameraShot } from "../camera/CameraShot";
import { CAMERA_MOTION_EASING, MotionKey } from "../camera/CameraMotionPath";
import type { CameraMotionEasing } from "../camera/CameraMotionPath";
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
    TIME: "motion-invalid-time",
    DURATION: "motion-time-outside-duration",
    DUPLICATE_TIME: "motion-duplicate-time",
    KEY: "motion-key-not-found",
    PATH: "motion-path-not-found",
    PLAYING: "motion-transport-playing",
    ACTIVE_SHOT: "motion-active-static-shot",
    DIRECTOR_POSE: "motion-director-pose-unavailable",
} as const;

interface AddMotionKeyPayload {
    readonly id: string;
    readonly timeSeconds: number;
    readonly easing: CameraMotionEasing;
    /** Undo replays the original immutable snapshot; interactive authoring omits this field. */
    readonly shot?: { readonly position: Vec3; readonly target: Vec3; readonly fov: number };
}

interface MoveMotionKeyPayload {
    readonly id: string;
    readonly timeSeconds: number;
}

interface RemoveMotionKeyPayload {
    readonly id: string;
}

interface SetMotionKeyEasingPayload {
    readonly id: string;
    readonly easing: CameraMotionEasing;
}

function issue(code: string, path: string, message: string): CommandIssue {
    return { code, path, message };
}


function isFiniteVec3(value: unknown): value is Vec3 {
    return Array.isArray(value) && value.length === 3 && value.every((component) => Number.isFinite(component));
}

function isEasing(value: unknown): value is CameraMotionEasing {
    return value === CAMERA_MOTION_EASING.LINEAR || value === CAMERA_MOTION_EASING.SMOOTH;
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

function keyAtDifferentTimeIssue(ctx: DirectorContext, timeSeconds: number, excludedId: string | null): CommandIssue | null {
    const duplicate = ctx.motion.path?.keys.find((key) => key.id !== excludedId && key.timeSeconds === timeSeconds);
    return duplicate ? issue(ISSUE_CODE.DUPLICATE_TIME, "timeSeconds", "运镜关键帧时间必须唯一") : null;
}

function timeIssue(ctx: DirectorContext, timeSeconds: unknown): CommandIssue | null {
    if (typeof timeSeconds !== "number" || !Number.isFinite(timeSeconds) || timeSeconds < 0) {
        return issue(ISSUE_CODE.TIME, "timeSeconds", "运镜关键帧时间必须是非负有限秒数");
    }
    return timeSeconds > ctx.timeline.document.duration
        ? issue(ISSUE_CODE.DURATION, "timeSeconds", "运镜关键帧时间不能超过时间轴时长")
        : null;
}

function canAuthorCurrentViewIssues(ctx: DirectorContext): readonly CommandIssue[] {
    if (ctx.clock.isPlaying) return [issue(ISSUE_CODE.PLAYING, "", "播放中不能记录运镜关键帧")];
    if (ctx.camera.activeShotId !== null) return [issue(ISSUE_CODE.ACTIVE_SHOT, "", "掌镜机位激活时不能记录运镜关键帧")];
    return ctx.camera.lastDirectorPose === null
        ? [issue(ISSUE_CODE.DIRECTOR_POSE, "", "等待导演自由视角稳定后再记录运镜关键帧")]
        : [];
}

function shotIssue(shot: unknown): CommandIssue | null {
    if (typeof shot !== "object" || shot === null || Array.isArray(shot)) {
        return issue(ISSUE_CODE.PAYLOAD, "shot", "运镜快照格式无效");
    }
    const snapshot = shot as { position?: unknown; target?: unknown; fov?: unknown };
    const fov = snapshot.fov;
    if (!isFiniteVec3(snapshot.position) || !isFiniteVec3(snapshot.target) || typeof fov !== "number" || !Number.isFinite(fov)) {
        return issue(ISSUE_CODE.PAYLOAD, "shot", "运镜快照格式无效");
    }
    return fov < 1 || fov > 179
        ? issue(ISSUE_CODE.PAYLOAD, "shot.fov", "运镜 fov 须在 1~179 之间")
        : null;
}

/** Add the settled free-director view at one absolute timeline time. */
export class AddMotionKeyCommand extends DirectorCommand<AddMotionKeyPayload> {
    static readonly TYPE = "motion.add-key";
    readonly type = AddMotionKeyCommand.TYPE;

    constructor(readonly payload: AddMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const payload = this.payload;
        if (
            typeof payload !== "object" || payload === null || Array.isArray(payload) ||
            typeof payload.id !== "string" || payload.id.length === 0
        ) {
            return [issue(ISSUE_CODE.PAYLOAD, "id", "运镜关键帧 id 格式无效")];
        }
        const invalidTime = timeIssue(ctx, payload.timeSeconds);
        if (invalidTime) return [invalidTime];
        if (!isEasing(payload.easing)) return [issue(ISSUE_CODE.PAYLOAD, "easing", "运镜缓动必须为 linear 或 smooth")];
        if (ctx.motion.path?.key(payload.id)) return [issue(ISSUE_CODE.PAYLOAD, "id", "运镜关键帧 id 已存在")];
        const duplicate = keyAtDifferentTimeIssue(ctx, payload.timeSeconds, null);
        if (duplicate) return [duplicate];
        if (payload.shot !== undefined) {
            const invalidShot = shotIssue(payload.shot);
            return invalidShot ? [invalidShot] : [];
        }
        return canAuthorCurrentViewIssues(ctx);
    }

    execute(ctx: DirectorContext): void {
        const pose = this.payload.shot ?? ctx.camera.lastDirectorPose;
        if (!pose) return;
        ctx.motion.addKey(new MotionKey({ id: this.payload.id, timeSeconds: this.payload.timeSeconds, easing: this.payload.easing, shot: new CameraShot(pose) }));
        ctx.playback.sampleCurrent();
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveMotionKeyCommand.TYPE, payload: { id: this.payload.id } }];
    }
}

/** Move a key by absolute seconds; the path remains strictly time ordered. */
export class MoveMotionKeyCommand extends DirectorCommand<MoveMotionKeyPayload> {
    static readonly TYPE = "motion.move-key";
    readonly type = MoveMotionKeyCommand.TYPE;

    constructor(readonly payload: MoveMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (
            typeof this.payload !== "object" || this.payload === null || Array.isArray(this.payload) ||
            typeof this.payload.id !== "string" || this.payload.id.length === 0
        ) {
            return [issue(ISSUE_CODE.PAYLOAD, "id", "运镜关键帧 id 格式无效")];
        }
        const invalidTime = timeIssue(ctx, this.payload.timeSeconds);
        if (invalidTime) return [invalidTime];
        if (!ctx.motion.path) return [issue(ISSUE_CODE.PATH, "", "运镜路径不存在")];
        if (!ctx.motion.path.key(this.payload.id)) return [issue(ISSUE_CODE.KEY, "id", "运镜关键帧不存在")];
        const duplicate = keyAtDifferentTimeIssue(ctx, this.payload.timeSeconds, this.payload.id);
        return duplicate ? [duplicate] : [];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.moveKey(this.payload.id, this.payload.timeSeconds);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const key = ctx.motion.path?.key(this.payload.id);
        return key ? [{ type: MoveMotionKeyCommand.TYPE, payload: { id: key.id, timeSeconds: key.timeSeconds } }] : null;
    }
}

export class RemoveMotionKeyCommand extends DirectorCommand<RemoveMotionKeyPayload> {
    static readonly TYPE = "motion.remove-key";
    readonly type = RemoveMotionKeyCommand.TYPE;

    constructor(readonly payload: RemoveMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (
            typeof this.payload !== "object" || this.payload === null || Array.isArray(this.payload) ||
            typeof this.payload.id !== "string" || this.payload.id.length === 0
        ) {
            return [issue(ISSUE_CODE.PAYLOAD, "id", "运镜关键帧 id 格式无效")];
        }
        if (!ctx.motion.path) return [issue(ISSUE_CODE.PATH, "", "运镜路径不存在")];
        return ctx.motion.path.key(this.payload.id) ? [] : [issue(ISSUE_CODE.KEY, "id", "运镜关键帧不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.removeKey(this.payload.id);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const key = ctx.motion.path?.key(this.payload.id);
        return key ? [{ type: AddMotionKeyCommand.TYPE, payload: key.toJSON() }] : null;
    }
}

export class SetMotionKeyEasingCommand extends DirectorCommand<SetMotionKeyEasingPayload> {
    static readonly TYPE = "motion.set-key-easing";
    readonly type = SetMotionKeyEasingCommand.TYPE;

    constructor(readonly payload: SetMotionKeyEasingPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        if (
            typeof this.payload !== "object" || this.payload === null || Array.isArray(this.payload) ||
            typeof this.payload.id !== "string" || this.payload.id.length === 0
        ) {
            return [issue(ISSUE_CODE.PAYLOAD, "id", "运镜关键帧 id 格式无效")];
        }
        if (!isEasing(this.payload.easing)) return [issue(ISSUE_CODE.PAYLOAD, "easing", "运镜缓动必须为 linear 或 smooth")];
        if (!ctx.motion.path) return [issue(ISSUE_CODE.PATH, "", "运镜路径不存在")];
        return ctx.motion.path.key(this.payload.id) ? [] : [issue(ISSUE_CODE.KEY, "id", "运镜关键帧不存在")];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.setKeyEasing(this.payload.id, this.payload.easing);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const key = ctx.motion.path?.key(this.payload.id);
        return key ? [{ type: SetMotionKeyEasingCommand.TYPE, payload: { id: key.id, easing: key.easing } }] : null;
    }
}

/** Read-only discovery payload; contains only serialized domain data and authoring conditions. */
export class CameraMotionGetQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "motion.get";
    readonly type = CameraMotionGetQuery.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {}

    validate(): readonly string[] {
        return this.validateIssues().map((current) => current.message);
    }

    validateIssues(): readonly CommandIssue[] {
        return typeof this.payload === "object" && this.payload !== null && !Array.isArray(this.payload) &&
                Object.getPrototypeOf(this.payload) === Object.prototype && Object.keys(this.payload).length === 0
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "", "motion.get payload 必须是空对象")];
    }

    execute(ctx: DirectorContext): unknown {
        const hasDirectorPose = ctx.camera.lastDirectorPose !== null;
        const isShotActive = ctx.camera.activeShotId !== null;
        return {
            path: ctx.motion.path?.toJSON() ?? null,
            hasDirectorPose,
            isShotActive,
            canAddCurrentView: hasDirectorPose && !isShotActive && !ctx.clock.isPlaying,
        };
    }
}

function capability(type: string, kind: "command" | "query", permissions: readonly string[]): CommandCapability {
    return { type, version: MOTION_COMMAND_VERSION, kind, permissions, appliesWhen: "director-desk.camera-motion-v1" };
}

/** motion.* command, query, and discovery metadata share the Dispatcher registry. */
export function registerCameraMotionCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(AddMotionKeyCommand.TYPE, (payload: AddMotionKeyPayload) => new AddMotionKeyCommand(payload), capability(AddMotionKeyCommand.TYPE, "command", [MOTION_PERMISSION]));
    dispatcher.register(MoveMotionKeyCommand.TYPE, (payload: MoveMotionKeyPayload) => new MoveMotionKeyCommand(payload), capability(MoveMotionKeyCommand.TYPE, "command", [MOTION_PERMISSION]));
    dispatcher.register(RemoveMotionKeyCommand.TYPE, (payload: RemoveMotionKeyPayload) => new RemoveMotionKeyCommand(payload), capability(RemoveMotionKeyCommand.TYPE, "command", [MOTION_PERMISSION]));
    dispatcher.register(SetMotionKeyEasingCommand.TYPE, (payload: SetMotionKeyEasingPayload) => new SetMotionKeyEasingCommand(payload), capability(SetMotionKeyEasingCommand.TYPE, "command", [MOTION_PERMISSION]));
    dispatcher.registerQuery(CameraMotionGetQuery.TYPE, (payload: Record<string, never>) => new CameraMotionGetQuery(payload), capability(CameraMotionGetQuery.TYPE, "query", [MOTION_READ_PERMISSION]));
}
