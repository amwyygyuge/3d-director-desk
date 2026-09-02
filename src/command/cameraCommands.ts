import { Box3 } from "three";

import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { FocusTargetResolver } from "@/camera/FocusTargetResolver";
import { createCameraMotionSample, sampleCameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import { azimuthAroundCenter, DEFAULT_SHOT_AZIMUTH_RADIANS, ShotSizePresets } from "@/camera/ShotSizePresets";
import { PROGRAM_SOURCE_KIND } from "@/camera/CameraProgramTrack";
import { SetProgramClipCommand } from "@/command/cameraMotionCommands";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { subjectBoundsFor } from "@/command/subjectBounds";
import type { SubjectBounds } from "@/command/subjectBounds";
import type { Vec3 } from "@/core/SceneObject";
import { measureModelBox } from "@/core/measureModelBox";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";

/** 采样缓冲:查询低频但遵守零分配纪律(命令层模块级临时对象先例) */
const TMP_MOTION_SAMPLE: CameraMotionSample = createCameraMotionSample();
const TMP_POSITION_SAMPLE: MotionPositionSample = createPositionSample();
const TMP_FOCUS_SAMPLE = { x: 0, y: 0, z: 0 };
const CAMERA_COMMAND_VERSION = "1" as const;
const CAMERA_APPLIES_WHEN = "director-desk.camera-v1";
const CAMERA_EDIT_PERMISSION = "camera:edit";
const CAMERA_READ_PERMISSION = "camera:read";
const shotSizePresets = new ShotSizePresets();

const SHOT_ID_PAYLOAD_CONTRACT: PayloadContract = {
    properties: { id: { type: "string" } },
    required: ["id"],
};
const FRAME_SUBJECT_PAYLOAD_CONTRACT: PayloadContract = {
    properties: {
        shotId: { type: "string" },
        subjectIds: { type: "array", items: { type: "string" }, minItems: 1 },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        azimuth: { type: "number" },
    },
    required: ["shotId", "subjectIds", "shotSize"],
};

const CHECK_FRAMING_CONTRACT: PayloadContract = {
    properties: { subjectIds: { type: "array", items: { type: "string" }, minItems: 1 } },
    required: ["subjectIds"],
};

function cameraCapability(
    type: string,
    kind: "command" | "query",
    permissions: readonly string[],
    payload: PayloadContract,
): CommandCapability {
    return { type, version: CAMERA_COMMAND_VERSION, kind, permissions, appliesWhen: CAMERA_APPLIES_WHEN, payload };
}

const CAMERA_POSE_CAPABILITY = cameraCapability(
    "camera.get-pose",
    "query",
    [CAMERA_READ_PERMISSION],
    EMPTY_PAYLOAD_CONTRACT,
);

/**
 * 生效相机位姿查询(agent 断言用):live = 渲染器实际相机(运镜 sink 写入后的真值);
 * motionSampled = 当前时刻运镜路径的采样期望值。两者并排,运镜是否生效一眼可断。
 */
export class CameraGetPoseQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "camera.get-pose";
    readonly type = CameraGetPoseQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        const programSource = ctx.motion.program.sourceAt(ctx.clock.time);
        const clip =
            programSource?.kind === PROGRAM_SOURCE_KIND.MOTION_CLIP
                ? (ctx.motion.clip(programSource.motionClipId) ?? null)
                : null;
        const focusResolver = new FocusTargetResolver(ctx.scene.manager);
        const focusTarget =
            clip?.focus && focusResolver.resolve(clip.focus, TMP_FOCUS_SAMPLE) ? TMP_FOCUS_SAMPLE : null;
        const isSampled =
            clip !== null &&
            (clip.focus === null || focusTarget !== null) &&
            sampleCameraMotionClip(clip, ctx.clock.time, focusTarget, TMP_POSITION_SAMPLE, TMP_MOTION_SAMPLE);
        const sampled = isSampled ? TMP_MOTION_SAMPLE : null;
        return {
            activeShotId: ctx.camera.activeShotId,
            programSource,
            live: ctx.capture.readCameraPose(),
            motionSampled: sampled
                ? {
                      position: [sampled.positionX, sampled.positionY, sampled.positionZ],
                      target: [sampled.targetX, sampled.targetY, sampled.targetZ],
                      fov: sampled.fov,
                  }
                : null,
            directorPose: ctx.camera.lastDirectorPose,
        };
    }
}
/**
 * 机位表此前只能直读 desk.camera.director; 注册查询让工具/宿主面可发现。
 */
export class CameraListShotsQuery implements DirectorQuery<Record<string, never>> {
    static readonly TYPE = "camera.list-shots";
    readonly type = CameraListShotsQuery.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {}

    validate(): readonly string[] {
        return [];
    }

    execute(ctx: DirectorContext): unknown {
        return {
            shots: ctx.camera.director.listShots().map(([id, shot]) => ({ id, shot: shot.toJSON() })),
            activeShotId: ctx.camera.activeShotId,
        };
    }
}

interface ShotIdPayload {
    id: string;
}

interface FrameSubjectPayload {
    shotId: string;
    /** 多被摄体联合取景:中点取各中心均值,半径覆盖全体(双人同框由此成为构造保证) */
    subjectIds: string[];
    shotSize: ShotSize;
    azimuth?: number;
}

/** 切入机位视角:机位必须已存在 */
export class ActivateShotCommand extends DirectorCommand<ShotIdPayload> {
    static readonly TYPE = "camera.activate";
    readonly type = ActivateShotCommand.TYPE;

    constructor(readonly payload: ShotIdPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.camera.director.getShot(this.payload.id) ? [] : [`机位 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.activateShot(this.payload.id);
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const prev = ctx.camera.activeShotId;
        return prev
            ? [{ type: ActivateShotCommand.TYPE, payload: { id: prev } }]
            : [{ type: DeactivateShotCommand.TYPE, payload: {} }];
    }
}

/** 回导演视角(自由轨道) */
export class DeactivateShotCommand extends DirectorCommand<Record<string, never>> {
    static readonly TYPE = "camera.deactivate";
    readonly type = DeactivateShotCommand.TYPE;

    constructor(readonly payload: Record<string, never> = {}) {
        super();
    }

    validate(): string[] {
        return [];
    }

    execute(ctx: DirectorContext): void {
        ctx.camera.backToDirectorView();
    }

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const prev = ctx.camera.activeShotId;
        return prev ? [{ type: ActivateShotCommand.TYPE, payload: { id: prev } }] : null;
    }
}

/** 删除机位;删激活中的机位时联动回导演视角(CameraStore.removeShot 已收口) */
export class RemoveShotCommand extends DirectorCommand<ShotIdPayload> {
    static readonly TYPE = "camera.remove-shot";
    readonly type = RemoveShotCommand.TYPE;

    constructor(readonly payload: ShotIdPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        return ctx.camera.director.getShot(this.payload.id) ? [] : [`机位 "${this.payload.id}" 不存在`];
    }

    execute(ctx: DirectorContext): void {
        ctx.motion.removeStaticShot(this.payload.id);
        ctx.camera.removeShot(this.payload.id);
    }

    /** Restores the static camera and only Program segments that directly referenced it. */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const previousShot = ctx.camera.director.getShot(this.payload.id);
        if (!previousShot) return null;
        const wasActive = ctx.camera.activeShotId === this.payload.id;
        const programCommands = ctx.motion.program.clips
            .filter(
                (clip) =>
                    clip.source.kind === PROGRAM_SOURCE_KIND.STATIC_SHOT && clip.source.shotId === this.payload.id,
            )
            .map((clip) => ({ type: SetProgramClipCommand.TYPE, payload: { clip: clip.toJSON() } }));
        return [
            { type: "camera.set-shot", payload: { id: this.payload.id, shot: previousShot.toJSON() } },
            ...programCommands,
            ...(wasActive ? [{ type: ActivateShotCommand.TYPE, payload: { id: this.payload.id } }] : []),
        ];
    }
}

/** 联合包围球:中点 = 各中心均值;半径 = 各中心到均值距离 + 各自半径 的最大值 */
function jointSubjectBounds(ctx: DirectorContext, subjectIds: readonly string[]): SubjectBounds | null {
    const subjects = subjectIds.flatMap((id) => {
        const bounds = subjectBoundsFor(ctx, id);
        return bounds ? [bounds] : [];
    });
    if (subjects.length === 0) return null;
    const center: Vec3 = [
        subjects.reduce((sum, s) => sum + s.center[0], 0) / subjects.length,
        subjects.reduce((sum, s) => sum + s.center[1], 0) / subjects.length,
        subjects.reduce((sum, s) => sum + s.center[2], 0) / subjects.length,
    ];
    const radius = subjects.reduce(
        (furthest, s) =>
            Math.max(
                furthest,
                Math.hypot(s.center[0] - center[0], s.center[1] - center[1], s.center[2] - center[2]) + s.radius,
            ),
        0,
    );
    return { center, radius };
}

/** 按被摄体边界生成景别机位,让 UI 与工具复用同一构图语义;多被摄体按联合包围球同框。 */
export class CameraFrameSubjectCommand extends DirectorCommand<FrameSubjectPayload> {
    static readonly TYPE = "camera.frame-subject";
    readonly type = CameraFrameSubjectCommand.TYPE;

    constructor(readonly payload: FrameSubjectPayload) {
        super();
    }

    validate(ctx: DirectorContext): string[] {
        if (typeof this.payload.shotId !== "string" || this.payload.shotId.length === 0) {
            return ["机位 id 格式无效"];
        }
        if (!Array.isArray(this.payload.subjectIds) || this.payload.subjectIds.length === 0) {
            return ["被摄对象列表须非空"];
        }
        const missing = this.payload.subjectIds.filter((id) => !ctx.scene.manager.getEntity(id));
        if (missing.length > 0) return [`被摄对象不存在: ${missing.join(", ")}`];
        if (!Object.values(SHOT_SIZE).includes(this.payload.shotSize)) return ["未知的景别"];
        if (this.payload.azimuth !== undefined && !Number.isFinite(this.payload.azimuth)) {
            return ["方位角须为有限数"];
        }
        return [];
    }

    execute(ctx: DirectorContext): void {
        const subject = jointSubjectBounds(ctx, this.payload.subjectIds);
        if (!subject) return;
        const eye = ctx.camera.lastDirectorPose;
        const azimuth =
            this.payload.azimuth ??
            (eye ? azimuthAroundCenter(eye.position, subject.center) : DEFAULT_SHOT_AZIMUTH_RADIANS);
        const shot = shotSizePresets.resolve(this.payload.shotSize, subject.center, subject.radius, azimuth);
        ctx.camera.addShot(this.payload.shotId, shot);
    }

    /** 覆盖已有机位 → 回滚旧参数;新建 → 撤销即删除。 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] {
        const previousShot = ctx.camera.director.getShot(this.payload.shotId);
        return previousShot
            ? [{ type: "camera.set-shot", payload: { id: this.payload.shotId, shot: previousShot.toJSON() } }]
            : [{ type: RemoveShotCommand.TYPE, payload: { id: this.payload.shotId } }];
    }
}

interface CheckFramingPayload {
    readonly subjectIds: string[];
}

const TMP_FRAMING_BOX = new Box3();

/**
 * 视锥同框查询:消灭布景链路的截图依赖——「出画没有」是数据断言,不用眼睛。
 * marginNdc 为负即出画,绝对值是回正所需的归一化边距。
 */
export class CameraCheckFramingQuery implements DirectorQuery<CheckFramingPayload> {
    static readonly TYPE = "camera.check-framing";
    readonly type = CameraCheckFramingQuery.TYPE;

    constructor(readonly payload: CheckFramingPayload) {}

    validate(ctx: DirectorContext): readonly string[] {
        return this.payload.subjectIds
            .filter((id) => !ctx.scene.manager.getEntity(id))
            .map((id) => `对象 "${id}" 不存在`);
    }

    execute(ctx: DirectorContext): unknown {
        // 激活机位存在 → 按机位定义解析式测量(渲染相机下一帧才就位,同任务链读不到)
        const activeShot = ctx.camera.activeShotId ? ctx.camera.director.getShot(ctx.camera.activeShotId) : undefined;
        const pose = activeShot
            ? { position: activeShot.position, target: activeShot.target, fov: activeShot.fov }
            : undefined;
        return this.payload.subjectIds.map((id) => {
            const runtime = ctx.scene.manager.getRuntime(id);
            if (runtime) measureModelBox(runtime, TMP_FRAMING_BOX);
            const measure = runtime ? ctx.capture.measureFraming(TMP_FRAMING_BOX, pose) : null;
            return { id, inFrame: measure?.inFrame ?? false, marginNdc: measure?.marginNdc ?? null };
        });
    }
}

export function registerCameraCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(
        ActivateShotCommand.TYPE,
        (payload: ShotIdPayload) => new ActivateShotCommand(payload),
        cameraCapability(ActivateShotCommand.TYPE, "command", [CAMERA_EDIT_PERMISSION], SHOT_ID_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        DeactivateShotCommand.TYPE,
        () => new DeactivateShotCommand(),
        cameraCapability(DeactivateShotCommand.TYPE, "command", [CAMERA_EDIT_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        RemoveShotCommand.TYPE,
        (payload: ShotIdPayload) => new RemoveShotCommand(payload),
        cameraCapability(RemoveShotCommand.TYPE, "command", [CAMERA_EDIT_PERMISSION], SHOT_ID_PAYLOAD_CONTRACT),
    );
    dispatcher.register(
        CameraFrameSubjectCommand.TYPE,
        (payload: FrameSubjectPayload) => new CameraFrameSubjectCommand(payload),
        cameraCapability(
            CameraFrameSubjectCommand.TYPE,
            "command",
            [CAMERA_EDIT_PERMISSION],
            FRAME_SUBJECT_PAYLOAD_CONTRACT,
        ),
    );
    dispatcher.registerQuery(
        CameraGetPoseQuery.TYPE,
        (payload: Record<string, never>) => new CameraGetPoseQuery(payload),
        CAMERA_POSE_CAPABILITY,
    );
    dispatcher.registerQuery(
        CameraListShotsQuery.TYPE,
        (payload: Record<string, never>) => new CameraListShotsQuery(payload),
        cameraCapability(CameraListShotsQuery.TYPE, "query", [CAMERA_READ_PERMISSION], EMPTY_PAYLOAD_CONTRACT),
    );
    dispatcher.registerQuery(
        CameraCheckFramingQuery.TYPE,
        (payload: CheckFramingPayload) => new CameraCheckFramingQuery(payload),
        cameraCapability(CameraCheckFramingQuery.TYPE, "query", [CAMERA_READ_PERMISSION], CHECK_FRAMING_CONTRACT),
    );
}
