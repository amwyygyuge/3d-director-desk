import { sampleCameraMotionPath } from "../camera/CameraMotionPath";
import type { CameraMotionSample } from "../camera/CameraMotionPath";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandCapability, DirectorQuery } from "./CommandDispatcher";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

/** 采样缓冲:查询低频但遵守零分配纪律(命令层模块级临时对象先例) */
const TMP_MOTION_SAMPLE: CameraMotionSample = {
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    fov: 45,
};

const CAMERA_POSE_CAPABILITY: CommandCapability = {
    type: "camera.get-pose",
    version: "1",
    kind: "query",
    permissions: ["camera:read"],
    appliesWhen: "director-desk.camera-v1",
};

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
        const path = ctx.motion.path;
        const sampled =
            path && sampleCameraMotionPath(path, ctx.clock.time, TMP_MOTION_SAMPLE) ? TMP_MOTION_SAMPLE : null;
        return {
            activeShotId: ctx.camera.activeShotId,
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
interface ShotIdPayload {
    id: string;
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
        ctx.camera.removeShot(this.payload.id);
    }

    /** 机位快照回放;若删的是激活机位,回放后恢复激活态 */
    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const prev = ctx.camera.director.getShot(this.payload.id);
        if (!prev) return null;
        const wasActive = ctx.camera.activeShotId === this.payload.id;
        return [
            { type: "camera.set-shot", payload: { id: this.payload.id, shot: prev.toJSON() } },
            ...(wasActive ? [{ type: ActivateShotCommand.TYPE, payload: { id: this.payload.id } }] : []),
        ];
    }
}

export function registerCameraCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(ActivateShotCommand.TYPE, (payload: ShotIdPayload) => new ActivateShotCommand(payload));
    dispatcher.register(DeactivateShotCommand.TYPE, () => new DeactivateShotCommand());
    dispatcher.register(RemoveShotCommand.TYPE, (payload: ShotIdPayload) => new RemoveShotCommand(payload));
    dispatcher.registerQuery(
        CameraGetPoseQuery.TYPE,
        (payload: Record<string, never>) => new CameraGetPoseQuery(payload),
        CAMERA_POSE_CAPABILITY,
    );
}
