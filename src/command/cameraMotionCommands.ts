import { CameraFocusTrack, FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { FocusTargetJSON } from "@/camera/CameraFocusTrack";
import { CameraKey } from "@/camera/CameraKey";
import type { CameraKeyJSON } from "@/camera/CameraKey";
import { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import { CAMERA_MOTION_EASING, isCameraMotionEasing } from "@/camera/CameraMotionEasing";
import type { CameraMotionEasing } from "@/camera/CameraMotionEasing";
import { CameraProgramClip } from "@/camera/CameraProgramTrack";
import type { CameraProgramClipJSON } from "@/camera/CameraProgramTrack";
import { PROGRAM_SLOT_KIND, ProgramLinkage } from "@/camera/ProgramLinkage";
import {
    isOrbitDirection,
    MotionPresetCompiler,
    MOTION_MOVE,
    ORBIT_DIRECTION,
    ORBIT_MAX_DEGREES,
} from "@/authoring/MotionPresetCompiler";
import type { MotionMove, MotionPresetRequest, OrbitDirection } from "@/authoring/MotionPresetCompiler";
import { SHOT_SIZE } from "@/camera/CameraShot";
import type { CameraShot, ShotSize } from "@/camera/CameraShot";
import { azimuthAroundCenter, DEFAULT_SHOT_AZIMUTH_RADIANS, ShotSizePresets } from "@/camera/ShotSizePresets";
import { subjectBoundsFor } from "@/command/subjectBounds";
import type { SubjectFocusBounds } from "@/command/subjectBounds";
import { SetTimelineDurationCommand } from "@/command/timelineCommands";
import { VIEW_MODE } from "@/store/MotionAuthoringStore";
import type { ViewMode } from "@/store/MotionAuthoringStore";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { CommandIssue, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { finiteVec3 } from "@/core/SceneObject";
import type { Vec3 } from "@/core/SceneObject";
import { MOTION_HANDLE_MODE } from "@/motion/MotionKey";
import { EMPTY_PAYLOAD_CONTRACT, nullable, VEC3_SCHEMA } from "@/command/PayloadContract";
import type { PayloadContract, PayloadFieldSchema } from "@/command/PayloadContract";

const MOTION_COMMAND_VERSION = "1" as const;
const MOTION_PERMISSION = "motion:edit";
const MOTION_READ_PERMISSION = "motion:read";
const MOTION_APPLIES_WHEN = "director-desk.camera-motion-v3";
const EMPTY_PAYLOAD: Record<string, never> = {};
const MINIMUM_KEYS_PER_CLIP = 2;
const CAMERA_FOCUS_MODE = "single" as const;
const MOTION_KEY_HANDLE_KIND = {
    IN: "in",
    OUT: "out",
} as const;
type MotionKeyHandleKind = (typeof MOTION_KEY_HANDLE_KIND)[keyof typeof MOTION_KEY_HANDLE_KIND];

const ISSUE_CODE = {
    PAYLOAD: "motion-invalid-payload",
    CAMERA: "motion-camera-not-found",
    CLIP: "motion-clip-not-found",
    KEY: "motion-key-not-found",
    KEY_MINIMUM: "motion-key-minimum",
    KEY_CONFLICT: "motion-key-progress-conflict",
    DURATION: "motion-time-outside-duration",
    OVERLAP: "motion-overlapping-clip",
    PROGRAM_OVERLAP: "program-overlapping-clip",
    PROGRAM_CLIP: "program-clip-not-found",
    FOCUS_OBJECT: "motion-focus-object-not-found",
    SUBJECT: "motion-subject-not-found",
    MOVE: "motion-unknown-move",
} as const;

/** Program 跟随策略:UI 与 AI 共用同一组语义,冲突时由调用方二选一。 */
export const PROGRAM_FOLLOW = {
    FOLLOW: "follow",
    NONE: "none",
    REPLACE: "replace",
} as const;
export type ProgramFollow = (typeof PROGRAM_FOLLOW)[keyof typeof PROGRAM_FOLLOW];

const programLinkage = new ProgramLinkage();
const presetCompiler = new MotionPresetCompiler();
const shotSizePresets = new ShotSizePresets();

interface CreateMotionClipPayload {
    readonly clip: CameraMotionClipJSON;
}

interface CreateTakePayload {
    readonly id?: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly keys: readonly CameraKeyJSON[];
    readonly focus?: FocusTargetJSON | null;
    readonly program?: ProgramFollow;
    /** 整段时间曲线;缺省 smooth */
    readonly easing?: CameraMotionEasing;
}

interface SetMotionClipRangePayload {
    readonly id: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

interface SetMotionKeyPayload {
    readonly clipId: string;
    readonly key: CameraKeyJSON;
}

interface MoveMotionKeyPayload {
    readonly clipId: string;
    readonly keyId: string;
    readonly progress: number;
}

interface MotionKeyPayload {
    readonly clipId: string;
    readonly keyId: string;
}

interface SetMotionKeyHandlePayload extends MotionKeyPayload {
    readonly kind: MotionKeyHandleKind;
    readonly value: Vec3;
}

interface SetMotionClipEasingPayload {
    readonly id: string;
    readonly easing: CameraMotionEasing;
}

interface SetMotionClipFocusPayload {
    readonly id: string;
    readonly target: FocusTargetJSON | null;
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

interface PreviewClipPayload {
    readonly clipId: string;
}

interface SetViewModePayload {
    readonly mode: ViewMode;
}

const CAMERA_KEY_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        progress: { type: "number" },
        position: VEC3_SCHEMA,
        target: VEC3_SCHEMA,
        fov: nullable({ type: "number" }),
        handleMode: { type: "string", enum: Object.values(MOTION_HANDLE_MODE) },
        inHandle: VEC3_SCHEMA,
        outHandle: VEC3_SCHEMA,
    },
    required: ["id", "progress", "position", "target", "fov", "handleMode", "inHandle", "outHandle"],
};

const FOCUS_TARGET_SCHEMA: PayloadFieldSchema = {
    anyOf: [
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [FOCUS_TARGET_KIND.WORLD_POINT] },
                position: VEC3_SCHEMA,
            },
            required: ["kind", "position"],
        },
        {
            type: "object",
            properties: {
                kind: { type: "string", enum: [FOCUS_TARGET_KIND.SCENE_OBJECT] },
                objectId: { type: "string" },
                worldOffset: VEC3_SCHEMA,
            },
            required: ["kind", "objectId", "worldOffset"],
        },
    ],
};

const CAMERA_FOCUS_TRACK_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        mode: { type: "string", enum: [CAMERA_FOCUS_MODE] },
        target: FOCUS_TARGET_SCHEMA,
    },
    required: ["mode", "target"],
};

const CAMERA_MOTION_CLIP_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        cameraId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        keys: { type: "array", items: CAMERA_KEY_SCHEMA, minItems: MINIMUM_KEYS_PER_CLIP },
        focus: nullable(CAMERA_FOCUS_TRACK_SCHEMA),
        easing: { type: "string", enum: Object.values(CAMERA_MOTION_EASING) },
    },
    required: ["id", "cameraId", "startTimeSeconds", "durationSeconds", "keys", "focus", "easing"],
};

const CAMERA_PROGRAM_CLIP_SCHEMA: PayloadFieldSchema = {
    type: "object",
    properties: {
        id: { type: "string" },
        cameraId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
    },
    required: ["id", "cameraId", "startTimeSeconds", "durationSeconds"],
};

const CREATE_MOTION_CLIP_CONTRACT: PayloadContract = {
    properties: { clip: CAMERA_MOTION_CLIP_SCHEMA },
    required: ["clip"],
};

const CREATE_MOTION_TAKE_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        cameraId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        keys: { type: "array", items: CAMERA_KEY_SCHEMA, minItems: MINIMUM_KEYS_PER_CLIP },
        focus: nullable(FOCUS_TARGET_SCHEMA),
        program: { type: "string", enum: Object.values(PROGRAM_FOLLOW) },
        easing: { type: "string", enum: Object.values(CAMERA_MOTION_EASING) },
    },
    required: ["cameraId", "startTimeSeconds", "durationSeconds", "keys"],
};

const SET_MOTION_CLIP_RANGE_CONTRACT: PayloadContract = {
    properties: {
        id: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
    },
    required: ["id", "startTimeSeconds", "durationSeconds"],
};

const SET_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, key: CAMERA_KEY_SCHEMA },
    required: ["clipId", "key"],
};

const MOVE_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, keyId: { type: "string" }, progress: { type: "number" } },
    required: ["clipId", "keyId", "progress"],
};

const REMOVE_MOTION_KEY_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" }, keyId: { type: "string" } },
    required: ["clipId", "keyId"],
};

const SET_MOTION_KEY_HANDLE_CONTRACT: PayloadContract = {
    properties: {
        clipId: { type: "string" },
        keyId: { type: "string" },
        kind: { type: "string", enum: Object.values(MOTION_KEY_HANDLE_KIND) },
        value: VEC3_SCHEMA,
    },
    required: ["clipId", "keyId", "kind", "value"],
};

const RESET_MOTION_KEY_HANDLES_CONTRACT: PayloadContract = REMOVE_MOTION_KEY_CONTRACT;

const SET_MOTION_CLIP_EASING_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, easing: { type: "string", enum: Object.values(CAMERA_MOTION_EASING) } },
    required: ["id", "easing"],
};

const SET_MOTION_CLIP_FOCUS_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" }, target: nullable(FOCUS_TARGET_SCHEMA) },
    required: ["id", "target"],
};

const REMOVE_MOTION_CLIP_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};

const AUTHOR_MOTION_CONTRACT: PayloadContract = {
    properties: {
        cameraId: { type: "string" },
        startTimeSeconds: { type: "number" },
        durationSeconds: { type: "number" },
        move: { type: "string", enum: Object.values(MOTION_MOVE) },
        subjectId: { type: "string" },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        easing: { type: "string", enum: Object.values(CAMERA_MOTION_EASING) },
        degrees: { type: "number" },
        direction: { type: "string", enum: Object.values(ORBIT_DIRECTION) },
    },
    required: ["cameraId", "startTimeSeconds", "durationSeconds", "move"],
};

const QUICK_AUTHOR_MOTION_CONTRACT: PayloadContract = {
    properties: {
        subjectId: { type: "string" },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        move: { type: "string", enum: Object.values(MOTION_MOVE) },
        durationSeconds: { type: "number" },
        degrees: { type: "number" },
        direction: { type: "string", enum: Object.values(ORBIT_DIRECTION) },
        easing: { type: "string", enum: Object.values(CAMERA_MOTION_EASING) },
    },
    required: ["subjectId", "shotSize", "move", "durationSeconds"],
};

const SET_PROGRAM_CLIP_CONTRACT: PayloadContract = {
    properties: { clip: CAMERA_PROGRAM_CLIP_SCHEMA },
    required: ["clip"],
};

const REMOVE_PROGRAM_CLIP_CONTRACT: PayloadContract = REMOVE_MOTION_CLIP_CONTRACT;

const ENTER_MOTION_PREVIEW_CONTRACT: PayloadContract = {
    properties: { clipId: { type: "string" } },
    required: ["clipId"],
};

const EXIT_MOTION_PREVIEW_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;

const SET_VIEW_MODE_CONTRACT: PayloadContract = {
    properties: { mode: { type: "string", enum: Object.values(VIEW_MODE) } },
    required: ["mode"],
};

const CAMERA_MOTION_GET_CONTRACT: PayloadContract = EMPTY_PAYLOAD_CONTRACT;

function issue(code: string, path: string, message: string, options?: CommandIssue["options"]): CommandIssue {
    return { code, path, message, ...(options ? { options } : {}) };
}

function issueMessages(issues: readonly CommandIssue[]): string[] {
    return issues.map((current) => current.message);
}

/** author 与 quick-author 共用的语汇参数围栏(Rule of Two):语汇枚举 + 环绕参数 */
function presetParamIssues(payload: {
    readonly move: MotionMove;
    readonly degrees?: number;
    readonly direction?: OrbitDirection;
}): CommandIssue[] {
    if (!Object.values(MOTION_MOVE).includes(payload.move)) {
        return [issue(ISSUE_CODE.MOVE, "move", "未知的运镜语汇")];
    }
    const issues: CommandIssue[] = [];
    const { degrees, direction } = payload;
    if (degrees !== undefined && (!Number.isFinite(degrees) || degrees <= 0 || degrees > ORBIT_MAX_DEGREES)) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, "degrees", `环绕转角须为 (0, ${ORBIT_MAX_DEGREES}] 度的有限数`));
    }
    if (direction !== undefined && !isOrbitDirection(direction)) {
        issues.push(issue(ISSUE_CODE.PAYLOAD, "direction", "环绕方向须为 cw/ccw"));
    }
    return issues;
}

/** Program 跟随三件套只消费这个切片(拓宽签名:quick-author 的计划结构免构造整个 clip) */
interface ProgramRangeLike {
    readonly id: string;
    readonly cameraId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
}

function motionClipFrom(clip: CameraMotionClipJSON): CameraMotionClip | null {
    try {
        return new CameraMotionClip(clip);
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

function existingClip(ctx: DirectorContext, id: unknown): CameraMotionClip | null {
    return typeof id === "string" && id.length > 0 ? (ctx.motion.clip(id) ?? null) : null;
}

function clipRangeIssue(ctx: DirectorContext, clip: CameraMotionClip, excludedId: string | null): CommandIssue | null {
    const isOutsideDuration = clip.endTimeSeconds > ctx.timeline.document.duration;
    if (isOutsideDuration) return issue(ISSUE_CODE.DURATION, "clip", "运镜片段不能超出时间轴时长");
    const overlaps = ctx.motion
        .clipsForCamera(clip.cameraId)
        .some(
            (current) =>
                current.id !== excludedId &&
                current.startTimeSeconds < clip.endTimeSeconds &&
                clip.startTimeSeconds < current.endTimeSeconds,
        );
    return overlaps ? issue(ISSUE_CODE.OVERLAP, "clip", "同一机位的运镜片段不能重叠") : null;
}

function clipIssues(ctx: DirectorContext, clip: CameraMotionClip, excludedId: string | null): readonly CommandIssue[] {
    const camera = ctx.camera.director.getShot(clip.cameraId);
    const target = clip.focus?.target;
    const hasFocusObject =
        !target ||
        target.kind !== FOCUS_TARGET_KIND.SCENE_OBJECT ||
        ctx.scene.manager.getEntity(target.objectId) !== undefined;
    if (!camera) return [issue(ISSUE_CODE.CAMERA, "clip.cameraId", "运镜引用的机位不存在")];
    if (!hasFocusObject) return [issue(ISSUE_CODE.FOCUS_OBJECT, "clip.focus.target.objectId", "注视绑定对象不存在")];
    const range = clipRangeIssue(ctx, clip, excludedId);
    return range ? [range] : [];
}

/** 关键帧写操作共用的定位:片段 + 关键帧一次解析,失败即结构化 issue。 */
function locateKey(
    ctx: DirectorContext,
    clipId: string,
    keyId: string,
): { readonly clip: CameraMotionClip; readonly key: CameraKey } | CommandIssue {
    const clip = existingClip(ctx, clipId);
    if (!clip) return issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在");
    const key = clip.key(keyId);
    return key ? { clip, key } : issue(ISSUE_CODE.KEY, "keyId", "镜头关键帧不存在");
}

function isIssue(value: object): value is CommandIssue {
    return "code" in value;
}

/** 关键帧写命令的统一逆命令:回到该关键帧的前值。 */
function restoreKeyCommand(clipId: string, key: CameraKey): SerializedCommand {
    return { type: SetMotionKeyCommand.TYPE, payload: { clipId, key: key.toJSON() } };
}

function replaceKey(ctx: DirectorContext, clip: CameraMotionClip, key: CameraKey): void {
    ctx.motion.replaceClip(clip.withKey(key));
    ctx.playback.sampleCurrent();
}

/** Creates a serialized, camera-owned time segment. Trajectory and temporal range remain independently editable. */
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
        const clip = motionClipFrom(this.payload.clip);
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段格式无效")];
        if (ctx.motion.clip(clip.id)) return [issue(ISSUE_CODE.PAYLOAD, "clip.id", "运镜片段 id 已存在")];
        return clipIssues(ctx, clip, null);
    }

    execute(ctx: DirectorContext): void {
        const clip = motionClipFrom(this.payload.clip);
        if (clip) ctx.motion.replaceClip(clip);
        ctx.playback.sampleCurrent();
    }

    override invert(): readonly SerializedCommand[] {
        return [{ type: RemoveMotionClipCommand.TYPE, payload: { id: this.payload.clip.id } }];
    }
}

/**
 * 一次成片:运镜片段与其 Program 输出片段同时落地。
 *
 * 「做完运镜忘了切 Program = 成片该段黑屏」是最贵的沉默失败,故输出跟随是默认行为;
 * 其它机位已占用该时段时不静默覆盖,返回带 options 的结构化冲突让作者/AI 二选一。
 */
export class CreateMotionTakeCommand extends DirectorCommand<CreateTakePayload> {
    static readonly TYPE = "motion.create-take";
    readonly type = CreateMotionTakeCommand.TYPE;

    constructor(readonly payload: CreateTakePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = this.clip();
        if (!clip) return [issue(ISSUE_CODE.PAYLOAD, "keys", "镜头关键帧格式无效或少于两个")];
        const clipProblems = clipIssues(ctx, clip, null);
        if (clipProblems.length > 0) return clipProblems;
        return programIssues(ctx, clip, this.programMode());
    }

    execute(ctx: DirectorContext): void {
        const clip = this.clip();
        if (!clip) return;
        ctx.motion.replaceClip(clip);
        applyProgramFollow(ctx, clip, this.programMode());
        ctx.motionAuthoring.selectClip(clip.id);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = this.clip();
        if (!clip) return null;
        return [
            { type: RemoveMotionClipCommand.TYPE, payload: { id: clip.id } },
            ...invertProgramFollow(ctx, clip, this.programMode()),
        ];
    }

    private programMode(): ProgramFollow {
        return this.payload.program ?? PROGRAM_FOLLOW.FOLLOW;
    }

    private clip(): CameraMotionClip | null {
        try {
            return new CameraMotionClip({
                id: this.payload.id ?? takeIdFor(this.payload),
                cameraId: this.payload.cameraId,
                startTimeSeconds: this.payload.startTimeSeconds,
                durationSeconds: this.payload.durationSeconds,
                keys: this.payload.keys,
                focus: this.payload.focus ? { mode: CAMERA_FOCUS_MODE, target: this.payload.focus } : null,
                ...(this.payload.easing ? { easing: this.payload.easing } : {}),
            });
        } catch {
            return null;
        }
    }
}

/** take id 必须在 validate 与 execute 之间稳定,故由 payload 决定,缺省时按机位与起始时刻派生。 */
function takeIdFor(payload: CreateTakePayload): string {
    return `take-${payload.cameraId}-${payload.startTimeSeconds}-${payload.durationSeconds}`;
}

function programIssues(ctx: DirectorContext, clip: ProgramRangeLike, mode: ProgramFollow): readonly CommandIssue[] {
    if (mode !== PROGRAM_FOLLOW.FOLLOW) return [];
    const slot = programLinkage.slotFor(ctx.motion.program, clip.cameraId, clip.startTimeSeconds, clip.durationSeconds);
    if (slot.kind !== PROGRAM_SLOT_KIND.CONFLICT) return [];
    return [
        issue(ISSUE_CODE.PROGRAM_OVERLAP, "program", "该时段的 Program 输出已被其它机位占用", [
            { type: "motion.create-take:replace-program", label: "替换为本机位输出" },
            { type: "motion.create-take:keep-current", label: "保留现有输出" },
        ]),
    ];
}

function applyProgramFollow(ctx: DirectorContext, clip: ProgramRangeLike, mode: ProgramFollow): void {
    if (mode === PROGRAM_FOLLOW.NONE) return;
    const slot = programLinkage.slotFor(ctx.motion.program, clip.cameraId, clip.startTimeSeconds, clip.durationSeconds);
    const cleared = slot.clips.reduce((program, current) => program.withoutClip(current.id), ctx.motion.program);
    const merged = programLinkage.mergedClip(
        slot.kind === PROGRAM_SLOT_KIND.CONFLICT ? { kind: slot.kind, clips: [] } : slot,
        clip.cameraId,
        clip.startTimeSeconds,
        clip.durationSeconds,
        `program-${clip.id}`,
    );
    ctx.motion.replaceProgram(cleared.withClip(merged));
}

function invertProgramFollow(
    ctx: DirectorContext,
    clip: ProgramRangeLike,
    mode: ProgramFollow,
): readonly SerializedCommand[] {
    if (mode === PROGRAM_FOLLOW.NONE) return [];
    const slot = programLinkage.slotFor(ctx.motion.program, clip.cameraId, clip.startTimeSeconds, clip.durationSeconds);
    const restored = slot.clips.map((current) => ({
        type: SetProgramClipCommand.TYPE,
        payload: { clip: current.toJSON() },
    }));
    const merged = programLinkage.mergedClip(
        slot.kind === PROGRAM_SLOT_KIND.CONFLICT ? { kind: slot.kind, clips: [] } : slot,
        clip.cameraId,
        clip.startTimeSeconds,
        clip.durationSeconds,
        `program-${clip.id}`,
    );
    return [{ type: RemoveProgramClipCommand.TYPE, payload: { id: merged.id } }, ...restored];
}

/** 重定时一段运镜而不重画轨迹;跟随态的 Program 片段一并移动。 */
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
        const candidate = this.retimed(current);
        if (!candidate) return [issue(ISSUE_CODE.PAYLOAD, "clip", "运镜片段时间范围必须是有限正数")];
        return clipIssues(ctx, candidate, current.id);
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        const candidate = current ? this.retimed(current) : null;
        if (!current || !candidate) return;
        const following = programLinkage.followingClip(ctx.motion.program, current);
        ctx.motion.replaceClip(candidate);
        if (following) {
            ctx.motion.replaceProgram(
                ctx.motion.program.withoutClip(following.id).withClip(
                    new CameraProgramClip({
                        id: following.id,
                        cameraId: following.cameraId,
                        startTimeSeconds: candidate.startTimeSeconds,
                        durationSeconds: candidate.durationSeconds,
                    }),
                ),
            );
        }
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return null;
        const following = programLinkage.followingClip(ctx.motion.program, current);
        return [
            {
                type: SetMotionClipRangeCommand.TYPE,
                payload: {
                    id: current.id,
                    startTimeSeconds: current.startTimeSeconds,
                    durationSeconds: current.durationSeconds,
                },
            },
            ...(following ? [{ type: SetProgramClipCommand.TYPE, payload: { clip: following.toJSON() } }] : []),
        ];
    }

    private retimed(current: CameraMotionClip): CameraMotionClip | null {
        try {
            return current.withTimeRange(this.payload.startTimeSeconds, this.payload.durationSeconds);
        } catch {
            return null;
        }
    }
}

/** 落一枚镜头关键帧(存在即覆盖):视口摆位、时间轴打点与 AI 共用这一条写入口。 */
export class SetMotionKeyCommand extends DirectorCommand<SetMotionKeyPayload> {
    static readonly TYPE = "motion.set-key";
    readonly type = SetMotionKeyCommand.TYPE;

    constructor(readonly payload: SetMotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const clip = existingClip(ctx, this.payload.clipId);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在")];
        const key = cameraKeyOrNull(this.payload.key);
        if (!key)
            return [issue(ISSUE_CODE.PAYLOAD, "key", "镜头关键帧参数无效(progress∈[0,1]、位姿有限、fov 在围栏内)")];
        return withKeyIssues(clip, key);
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.clipId);
        const key = cameraKeyOrNull(this.payload.key);
        if (clip && key) replaceKey(ctx, clip, key);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = existingClip(ctx, this.payload.clipId);
        if (!clip) return null;
        const prior = clip.key(this.payload.key.id);
        return prior
            ? [restoreKeyCommand(clip.id, prior)]
            : [{ type: RemoveMotionKeyCommand.TYPE, payload: { clipId: clip.id, keyId: this.payload.key.id } }];
    }
}

function cameraKeyOrNull(json: CameraKeyJSON): CameraKey | null {
    try {
        return new CameraKey(json);
    } catch {
        return null;
    }
}

/** 关键帧写入的公共围栏:progress 冲突由轨迹聚合裁决,命令层只负责翻译成结构化 issue。 */
function withKeyIssues(clip: CameraMotionClip, key: CameraKey): readonly CommandIssue[] {
    try {
        clip.withKey(key);
        return [];
    } catch {
        return [issue(ISSUE_CODE.KEY_CONFLICT, "key.progress", "同一片段内关键帧进度必须唯一")];
    }
}

/** 重定时一枚关键帧:只改 progress,画面不动。 */
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
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        const moved = movedKeyOrNull(located.key, this.payload.progress);
        if (!moved) return [issue(ISSUE_CODE.PAYLOAD, "progress", "关键帧进度必须落在 [0,1]")];
        return withKeyIssues(located.clip, moved);
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        const moved = movedKeyOrNull(located.key, this.payload.progress);
        if (moved) replaceKey(ctx, located.clip, moved);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

function movedKeyOrNull(key: CameraKey, progress: number): CameraKey | null {
    try {
        return key.withProgress(progress);
    } catch {
        return null;
    }
}

export class RemoveMotionKeyCommand extends DirectorCommand<MotionKeyPayload> {
    static readonly TYPE = "motion.remove-key";
    readonly type = RemoveMotionKeyCommand.TYPE;

    constructor(readonly payload: MotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        return located.clip.keys.length > MINIMUM_KEYS_PER_CLIP
            ? []
            : [
                  issue(ISSUE_CODE.KEY_MINIMUM, "keyId", "运镜至少需要两枚关键帧;要清空请删除整段", [
                      { type: "motion.remove-clip", label: "删除该运镜片段" },
                  ]),
              ];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        const next = located.clip.withoutKey(this.payload.keyId);
        if (!next) return;
        ctx.motionAuthoring.selectKey(located.clip.id, null);
        ctx.motion.replaceClip(next);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 拖手柄即接管切线:命令层落地「auto → manual」的语义切换,系统此后不再自动平滑该点。 */
export class SetMotionKeyHandleCommand extends DirectorCommand<SetMotionKeyHandlePayload> {
    static readonly TYPE = "motion.set-key-handle";
    readonly type = SetMotionKeyHandleCommand.TYPE;

    constructor(readonly payload: SetMotionKeyHandlePayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return [located];
        const isValid =
            (this.payload.kind === MOTION_KEY_HANDLE_KIND.IN || this.payload.kind === MOTION_KEY_HANDLE_KIND.OUT) &&
            finiteVec3(this.payload.value);
        return isValid ? [] : [issue(ISSUE_CODE.PAYLOAD, "value", "手柄必须是有限向量,kind 取 in 或 out")];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        replaceKey(ctx, located.clip, located.key.withHandle(this.payload.kind, this.payload.value));
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 交还切线控制权:关键帧回到 auto,曲线重新自动平滑。 */
export class ResetMotionKeyHandlesCommand extends DirectorCommand<MotionKeyPayload> {
    static readonly TYPE = "motion.reset-key-handles";
    readonly type = ResetMotionKeyHandlesCommand.TYPE;

    constructor(readonly payload: MotionKeyPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? [located] : [];
    }

    execute(ctx: DirectorContext): void {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        if (isIssue(located)) return;
        replaceKey(ctx, located.clip, located.key.withAutoHandles());
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const located = locateKey(ctx, this.payload.clipId, this.payload.keyId);
        return isIssue(located) ? null : [restoreKeyCommand(located.clip.id, located.key)];
    }
}

/** 整段时间曲线:smooth = 起落加减速,linear = 全程匀速。段间快慢由关键帧 progress 分布表达。 */
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
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        return isCameraMotionEasing(this.payload.easing)
            ? []
            : [issue(ISSUE_CODE.PAYLOAD, "easing", "运镜缓动必须为 linear 或 smooth")];
    }

    execute(ctx: DirectorContext): void {
        const clip = existingClip(ctx, this.payload.id);
        if (!clip) return;
        ctx.motion.replaceClip(clip.withEasing(this.payload.easing));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const clip = existingClip(ctx, this.payload.id);
        return clip ? [{ type: SetMotionClipEasingCommand.TYPE, payload: { id: clip.id, easing: clip.easing } }] : null;
    }
}

/** 跟拍覆盖层:绑定对象即接管全部关键帧的注视点,target=null 解除覆盖回到关键帧插值。 */
export class SetMotionClipFocusCommand extends DirectorCommand<SetMotionClipFocusPayload> {
    static readonly TYPE = "motion.set-focus";
    readonly type = SetMotionClipFocusCommand.TYPE;

    constructor(readonly payload: SetMotionClipFocusPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const current = existingClip(ctx, this.payload.id);
        if (!current) return [issue(ISSUE_CODE.CLIP, "id", "运镜片段不存在")];
        const focus = this.focus();
        if (focus === undefined) return [issue(ISSUE_CODE.PAYLOAD, "target", "注视目标格式无效")];
        const target = focus?.target;
        const isResolvable =
            !target ||
            target.kind !== FOCUS_TARGET_KIND.SCENE_OBJECT ||
            ctx.scene.manager.getEntity(target.objectId) !== undefined;
        return isResolvable ? [] : [issue(ISSUE_CODE.FOCUS_OBJECT, "target.objectId", "注视绑定对象不存在")];
    }

    execute(ctx: DirectorContext): void {
        const current = existingClip(ctx, this.payload.id);
        const focus = this.focus();
        if (!current || focus === undefined) return;
        ctx.motion.replaceClip(current.withFocus(focus));
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current
            ? [
                  {
                      type: SetMotionClipFocusCommand.TYPE,
                      payload: { id: current.id, target: current.focus?.target.toJSON() ?? null },
                  },
              ]
            : null;
    }

    /** undefined = 载荷非法;null = 解除覆盖 */
    private focus(): CameraFocusTrack | null | undefined {
        if (this.payload.target === null || this.payload.target === undefined) return null;
        try {
            return new CameraFocusTrack({ target: this.payload.target });
        } catch {
            return undefined;
        }
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
        ctx.motionAuthoring.forgetClip(this.payload.id);
        ctx.motion.removeClip(this.payload.id);
        ctx.playback.sampleCurrent();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const current = existingClip(ctx, this.payload.id);
        return current ? [{ type: CreateMotionClipCommand.TYPE, payload: { clip: current.toJSON() } }] : null;
    }
}

/** author 与 quick-author 共用的 take 装配(Rule of Two):keys 编译 + 跟拍注入一处收口 */
function takeCommandFor(
    request: MotionPresetRequest,
    shot: CameraShot,
    subject: SubjectFocusBounds | null,
    takeId: string,
): CreateMotionTakeCommand {
    const keys = presetCompiler.compile(request, { shot, subject });
    return new CreateMotionTakeCommand({
        id: takeId,
        cameraId: request.cameraId,
        startTimeSeconds: request.startTimeSeconds,
        durationSeconds: request.durationSeconds,
        keys,
        ...(request.easing ? { easing: request.easing } : {}),
        focus:
            request.subjectId && subject
                ? {
                      kind: FOCUS_TARGET_KIND.SCENE_OBJECT,
                      objectId: request.subjectId,
                      worldOffset: subject.focusOffset,
                  }
                : null,
    });
}

/**
 * 语义层入口:导演语汇 → 标准关键帧序列 → 与 create-take 同一条落地路径。
 * UI 的预设按钮与 AI 工具调用共用它,产出可再编辑,不是黑盒。
 */
export class AuthorMotionCommand extends DirectorCommand<MotionPresetRequest> {
    static readonly TYPE = "motion.author";
    readonly type = AuthorMotionCommand.TYPE;

    constructor(readonly payload: MotionPresetRequest) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const paramIssues = presetParamIssues(this.payload);
        if (paramIssues.length > 0) return paramIssues;
        const shot = ctx.camera.director.getShot(this.payload.cameraId);
        if (!shot) return [issue(ISSUE_CODE.CAMERA, "cameraId", "运镜引用的机位不存在")];
        const subjectId = this.payload.subjectId;
        if (subjectId && !ctx.scene.manager.getEntity(subjectId)) {
            return [issue(ISSUE_CODE.SUBJECT, "subjectId", "跟拍对象不存在")];
        }
        return this.takeCommand(ctx)?.validateIssues?.(ctx) ?? [issue(ISSUE_CODE.PAYLOAD, "keys", "预设编译失败")];
    }

    execute(ctx: DirectorContext): void {
        this.takeCommand(ctx)?.execute(ctx);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        return this.takeCommand(ctx)?.invert(ctx) ?? null;
    }

    private takeCommand(ctx: DirectorContext): CreateMotionTakeCommand | null {
        const shot = ctx.camera.director.getShot(this.payload.cameraId);
        if (!shot) return null;
        const subject = this.payload.subjectId ? subjectBoundsFor(ctx, this.payload.subjectId) : null;
        return takeCommandFor(
            this.payload,
            shot,
            subject,
            `take-${this.payload.cameraId}-${this.payload.move}-${this.payload.startTimeSeconds}`,
        );
    }
}

interface QuickAuthorPayload {
    /** 被摄对象(同时成为跟拍目标);机位由景别预设从它派生 */
    readonly subjectId: string;
    /** 起幅景别(ShotSizePresets 定距,方位角取当前相机朝向) */
    readonly shotSize: ShotSize;
    readonly move: MotionMove;
    readonly durationSeconds: number;
    /** 环绕类语汇的转角(度) */
    readonly degrees?: number;
    readonly direction?: OrbitDirection;
    readonly easing?: CameraMotionEasing;
}

/** 快建机位 id:由被摄体与语汇派生——确定性(undo/redo 重放不漂移),同参数重复创建 = 复用同机位 */
function quickShotIdFor(subjectId: string, move: MotionMove): string {
    return `快建机位-${subjectId}-${move}`;
}

interface QuickAuthorPlan {
    readonly shotId: string;
    readonly shot: CameraShot;
    readonly range: ProgramRangeLike;
    readonly take: CreateMotionTakeCommand;
    readonly extendDuration: SetTimelineDurationCommand | null;
}

/**
 * 快速成片(聚合命令,地基优先红线 15):被摄对象 + 景别 + 语汇 → 建机位 + 运镜片段一次落地。
 * 起始时刻 = Program 末尾(追加编排,不覆盖既有);超出时间轴时一并扩时长。
 * 机位进大纲、可见可复用;撤销一步回滚全部副产物(片段/Program 跟随/机位/时长)。
 */
export class QuickAuthorMotionCommand extends DirectorCommand<QuickAuthorPayload> {
    static readonly TYPE = "motion.quick-author";
    readonly type = QuickAuthorMotionCommand.TYPE;

    constructor(readonly payload: QuickAuthorPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        const paramIssues = presetParamIssues(this.payload);
        if (paramIssues.length > 0) return paramIssues;
        if (!Object.values(SHOT_SIZE).includes(this.payload.shotSize)) {
            return [issue(ISSUE_CODE.PAYLOAD, "shotSize", "未知的景别")];
        }
        if (!Number.isFinite(this.payload.durationSeconds) || this.payload.durationSeconds <= 0) {
            return [issue(ISSUE_CODE.PAYLOAD, "durationSeconds", "时长须为正有限数")];
        }
        if (!ctx.scene.manager.getEntity(this.payload.subjectId)) {
            return [issue(ISSUE_CODE.SUBJECT, "subjectId", "被摄对象不存在")];
        }
        const plan = this.plan(ctx);
        if (!plan) return [issue(ISSUE_CODE.PAYLOAD, "keys", "预设编译失败")];
        // 机位由本命令创建,跳过 clipIssues 的机位存在性检查;Program 冲突沿用 create-take 的结构化二选一
        return programIssues(ctx, plan.range, PROGRAM_FOLLOW.FOLLOW);
    }

    execute(ctx: DirectorContext): void {
        const plan = this.plan(ctx);
        if (!plan) return;
        ctx.camera.addShot(plan.shotId, plan.shot);
        plan.extendDuration?.execute(ctx);
        plan.take.execute(ctx);
    }

    /** pre-state 求逆(dispatcher 在 execute 前调用):全部 id 由 payload 决定,无需读取已创建数据 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const { shotId, range } = this.planIdentity(ctx);
        const previousShot = ctx.camera.director.getShot(shotId);
        const shotRestore: readonly SerializedCommand[] = previousShot
            ? [{ type: "camera.set-shot", payload: { id: shotId, shot: previousShot.toJSON() } }]
            : [{ type: "camera.remove-shot", payload: { id: shotId } }];
        const end = range.startTimeSeconds + range.durationSeconds;
        const durationRestore: readonly SerializedCommand[] =
            end > ctx.timeline.document.duration
                ? [{ type: SetTimelineDurationCommand.TYPE, payload: { duration: ctx.timeline.document.duration } }]
                : [];
        return [
            { type: RemoveMotionClipCommand.TYPE, payload: { id: range.id } },
            ...invertProgramFollow(ctx, range, PROGRAM_FOLLOW.FOLLOW),
            ...shotRestore,
            ...durationRestore,
        ];
    }

    /** 计划的身份面(不编译 keys):invert 在 pre-state 调用,只依赖 payload 与 Program 末尾 */
    private planIdentity(ctx: DirectorContext): { readonly shotId: string; readonly range: ProgramRangeLike } {
        const shotId = quickShotIdFor(this.payload.subjectId, this.payload.move);
        const startTimeSeconds = programEndSeconds(ctx);
        return {
            shotId,
            range: {
                id: `take-${shotId}-${this.payload.move}-${startTimeSeconds}`,
                cameraId: shotId,
                startTimeSeconds,
                durationSeconds: this.payload.durationSeconds,
            },
        };
    }

    private plan(ctx: DirectorContext): QuickAuthorPlan | null {
        const subject = subjectBoundsFor(ctx, this.payload.subjectId);
        if (!subject) return null;
        const eye = ctx.camera.lastDirectorPose;
        const azimuth = eye ? azimuthAroundCenter(eye.position, subject.center) : DEFAULT_SHOT_AZIMUTH_RADIANS;
        const shot = shotSizePresets.resolve(this.payload.shotSize, subject.center, subject.radius, azimuth);
        const { shotId, range } = this.planIdentity(ctx);
        const request: MotionPresetRequest = {
            cameraId: shotId,
            startTimeSeconds: range.startTimeSeconds,
            durationSeconds: this.payload.durationSeconds,
            move: this.payload.move,
            subjectId: this.payload.subjectId,
            ...(this.payload.easing ? { easing: this.payload.easing } : {}),
            ...(this.payload.degrees !== undefined ? { degrees: this.payload.degrees } : {}),
            ...(this.payload.direction !== undefined ? { direction: this.payload.direction } : {}),
        };
        const end = range.startTimeSeconds + range.durationSeconds;
        return {
            shotId,
            shot,
            range,
            take: takeCommandFor(request, shot, subject, range.id),
            extendDuration:
                end > ctx.timeline.document.duration ? new SetTimelineDurationCommand({ duration: end }) : null,
        };
    }
}

/** Program 末尾时刻:快速创建在此追加编排;空 Program 从 0 开始 */
function programEndSeconds(ctx: DirectorContext): number {
    return ctx.motion.program.clips.reduce((end, clip) => Math.max(end, clip.endTimeSeconds), 0);
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

/** 预览尚未切入 Program 的片段(瞬态视图态,不入撤销栈)。 */
export class EnterMotionPreviewCommand extends DirectorCommand<PreviewClipPayload> {
    static readonly TYPE = "motion.preview.enter";
    readonly type = EnterMotionPreviewCommand.TYPE;

    constructor(readonly payload: PreviewClipPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return issueMessages(this.validateIssues(ctx));
    }

    override validateIssues(ctx: DirectorContext): readonly CommandIssue[] {
        return existingClip(ctx, this.payload.clipId) ? [] : [issue(ISSUE_CODE.CLIP, "clipId", "运镜片段不存在")];
    }

    execute(ctx: DirectorContext): void {
        const clip = ctx.motion.clip(this.payload.clipId);
        ctx.motionAuthoring.setPreviewClip(this.payload.clipId);
        ctx.motionAuthoring.setViewMode(VIEW_MODE.LENS);
        // 预览一段就该看到这一段:playhead 不在片段内时移到片段起点,否则画面停在别的机位上
        if (clip && !clip.covers(ctx.clock.time)) ctx.clock.seek(clip.startTimeSeconds);
        ctx.playback.sampleCurrent();
    }
}

export class ExitMotionPreviewCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "motion.preview.exit";
    readonly type = ExitMotionPreviewCommand.TYPE;

    constructor(readonly payload: Record<string, never> = EMPTY_PAYLOAD) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.setPreviewClip(null);
        ctx.playback.sampleCurrent();
    }
}

/** 视口模式切换(瞬态):导演视角 ↔ 镜头视角,写入目标随之从「无」变为镜头关键帧。 */
export class SetViewModeCommand extends DirectorCommand<SetViewModePayload> {
    static readonly TYPE = "view.set-mode";
    readonly type = SetViewModeCommand.TYPE;

    constructor(readonly payload: SetViewModePayload) {
        super();
    }

    validate(): string[] {
        const isKnown = this.payload.mode === VIEW_MODE.DIRECTOR || this.payload.mode === VIEW_MODE.LENS;
        return isKnown ? [] : ["视口模式必须是 director 或 lens"];
    }

    execute(ctx: DirectorContext): void {
        ctx.motionAuthoring.setViewMode(this.payload.mode);
        ctx.playback.sampleCurrent();
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
            viewMode: ctx.motionAuthoring.viewMode,
            previewClipId: ctx.motionAuthoring.previewClipId,
            handleModes: Object.values(MOTION_HANDLE_MODE),
        };
    }
}

function capability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return { type, version: MOTION_COMMAND_VERSION, kind, permissions, appliesWhen: MOTION_APPLIES_WHEN, payload };
}

/** Motion and Program commands share one discovery namespace while retaining independent write permissions. */
export function registerCameraMotionCommands(dispatcher: CommandDispatcher): void {
    const commands = [
        CreateMotionClipCommand,
        CreateMotionTakeCommand,
        QuickAuthorMotionCommand,
        SetMotionClipRangeCommand,
        SetMotionKeyCommand,
        MoveMotionKeyCommand,
        RemoveMotionKeyCommand,
        SetMotionKeyHandleCommand,
        ResetMotionKeyHandlesCommand,
        SetMotionClipEasingCommand,
        SetMotionClipFocusCommand,
        RemoveMotionClipCommand,
        AuthorMotionCommand,
        SetProgramClipCommand,
        RemoveProgramClipCommand,
        EnterMotionPreviewCommand,
        ExitMotionPreviewCommand,
        SetViewModeCommand,
    ] as const;
    type CameraMotionCommandType = (typeof commands)[number]["TYPE"];
    const contracts: Record<CameraMotionCommandType, PayloadContract> = {
        [CreateMotionClipCommand.TYPE]: CREATE_MOTION_CLIP_CONTRACT,
        [CreateMotionTakeCommand.TYPE]: CREATE_MOTION_TAKE_CONTRACT,
        [QuickAuthorMotionCommand.TYPE]: QUICK_AUTHOR_MOTION_CONTRACT,
        [SetMotionClipRangeCommand.TYPE]: SET_MOTION_CLIP_RANGE_CONTRACT,
        [SetMotionKeyCommand.TYPE]: SET_MOTION_KEY_CONTRACT,
        [MoveMotionKeyCommand.TYPE]: MOVE_MOTION_KEY_CONTRACT,
        [RemoveMotionKeyCommand.TYPE]: REMOVE_MOTION_KEY_CONTRACT,
        [SetMotionKeyHandleCommand.TYPE]: SET_MOTION_KEY_HANDLE_CONTRACT,
        [ResetMotionKeyHandlesCommand.TYPE]: RESET_MOTION_KEY_HANDLES_CONTRACT,
        [SetMotionClipEasingCommand.TYPE]: SET_MOTION_CLIP_EASING_CONTRACT,
        [SetMotionClipFocusCommand.TYPE]: SET_MOTION_CLIP_FOCUS_CONTRACT,
        [RemoveMotionClipCommand.TYPE]: REMOVE_MOTION_CLIP_CONTRACT,
        [AuthorMotionCommand.TYPE]: AUTHOR_MOTION_CONTRACT,
        [SetProgramClipCommand.TYPE]: SET_PROGRAM_CLIP_CONTRACT,
        [RemoveProgramClipCommand.TYPE]: REMOVE_PROGRAM_CLIP_CONTRACT,
        [EnterMotionPreviewCommand.TYPE]: ENTER_MOTION_PREVIEW_CONTRACT,
        [ExitMotionPreviewCommand.TYPE]: EXIT_MOTION_PREVIEW_CONTRACT,
        [SetViewModeCommand.TYPE]: SET_VIEW_MODE_CONTRACT,
    };
    for (const Command of commands) {
        dispatcher.register(
            Command.TYPE,
            (payload) => new Command(payload as never),
            capability(Command.TYPE, "command", [MOTION_PERMISSION], contracts[Command.TYPE]),
        );
    }
    dispatcher.registerQuery(
        CameraMotionGetQuery.TYPE,
        (payload: Record<string, never>) => new CameraMotionGetQuery(payload),
        capability(CameraMotionGetQuery.TYPE, "query", [MOTION_READ_PERMISSION], CAMERA_MOTION_GET_CONTRACT),
    );
}
