import { SHOT_SIZE } from "@/camera/CameraShot";
import type { ShotSize } from "@/camera/CameraShot";
import { FocusTargetResolver } from "@/camera/FocusTargetResolver";
import { createCameraMotionSample, sampleCameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionSample } from "@/camera/CameraMotionClip";
import { azimuthAroundCenter, DEFAULT_SHOT_AZIMUTH_RADIANS, ShotSizePresets } from "@/camera/ShotSizePresets";
import { CreateMotionClipCommand, SetProgramClipCommand } from "@/command/cameraMotionCommands";
import { DirectorCommand } from "@/command/DirectorCommand";
import type { DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandCapability, CommandDispatcher, DirectorQuery } from "@/command/CommandDispatcher";
import { EMPTY_PAYLOAD_CONTRACT } from "@/command/PayloadContract";
import type { PayloadContract } from "@/command/PayloadContract";
import { subjectBoundsFor } from "@/command/subjectBounds";
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
        subjectId: { type: "string" },
        shotSize: { type: "string", enum: Object.values(SHOT_SIZE) },
        azimuth: { type: "number" },
    },
    required: ["shotId", "subjectId", "shotSize"],
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
        const programCameraId = ctx.motion.program.cameraAt(ctx.clock.time);
        const shot = programCameraId ? ctx.camera.director.getShot(programCameraId) : undefined;
        const clip = programCameraId ? ctx.motion.clipAt(programCameraId, ctx.clock.time) : null;
        const focusResolver = new FocusTargetResolver(ctx.scene.manager);
        const focusTarget =
            clip?.focus && focusResolver.resolve(clip.focus, TMP_FOCUS_SAMPLE) ? TMP_FOCUS_SAMPLE : null;
        const isSampled =
            clip !== null &&
            shot !== undefined &&
            (clip.focus === null || focusTarget !== null) &&
            sampleCameraMotionClip(clip, ctx.clock.time, shot, focusTarget, TMP_POSITION_SAMPLE, TMP_MOTION_SAMPLE);
        const sampled = isSampled ? TMP_MOTION_SAMPLE : null;
        return {
            activeShotId: ctx.camera.activeShotId,
            programCameraId,
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
    subjectId: string;
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
        ctx.motion.removeCamera(this.payload.id);
        ctx.camera.removeShot(this.payload.id);
    }

    /** Restores the static camera before its dependent temporal data, preserving command invariants on redo. */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const previousShot = ctx.camera.director.getShot(this.payload.id);
        if (!previousShot) return null;
        const wasActive = ctx.camera.activeShotId === this.payload.id;
        const motionCommands = ctx.motion
            .clipsForCamera(this.payload.id)
            .map((clip) => ({ type: CreateMotionClipCommand.TYPE, payload: { clip: clip.toJSON() } }));
        const programCommands = ctx.motion.program.clips
            .filter((clip) => clip.cameraId === this.payload.id)
            .map((clip) => ({ type: SetProgramClipCommand.TYPE, payload: { clip: clip.toJSON() } }));
        return [
            { type: "camera.set-shot", payload: { id: this.payload.id, shot: previousShot.toJSON() } },
            ...motionCommands,
            ...programCommands,
            ...(wasActive ? [{ type: ActivateShotCommand.TYPE, payload: { id: this.payload.id } }] : []),
        ];
    }
}

/** 按被摄体边界生成景别机位,让 UI 与工具复用同一构图语义。 */
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
        if (typeof this.payload.subjectId !== "string" || this.payload.subjectId.length === 0) {
            return ["被摄对象 id 格式无效"];
        }
        if (!ctx.scene.manager.getEntity(this.payload.subjectId)) return ["被摄对象不存在"];
        if (!Object.values(SHOT_SIZE).includes(this.payload.shotSize)) return ["未知的景别"];
        if (this.payload.azimuth !== undefined && !Number.isFinite(this.payload.azimuth)) {
            return ["方位角须为有限数"];
        }
        return [];
    }

    execute(ctx: DirectorContext): void {
        const subject = subjectBoundsFor(ctx, this.payload.subjectId);
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
}
