import { FocusTargetResolver } from "../camera/FocusTargetResolver";
import { sampleCameraMotionClip } from "../camera/CameraMotionClip";
import type { CameraMotionSample } from "../camera/CameraMotionClip";
import type { PathPositionSample } from "../camera/CameraMotionPath";
import { CreateMotionClipCommand, SetProgramClipCommand } from "./cameraMotionCommands";
import { DirectorCommand } from "./DirectorCommand";
import type { CommandCapability, DirectorQuery } from "./CommandDispatcher";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandDispatcher } from "./CommandDispatcher";

const TMP_MOTION_SAMPLE: CameraMotionSample = {
    positionX: 0,
    positionY: 0,
    positionZ: 0,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
    fov: 45,
};
const TMP_PATH_SAMPLE: PathPositionSample = { x: 0, y: 0, z: 0 };
const TMP_FOCUS_SAMPLE = { x: 0, y: 0, z: 0 };
const CAMERA_POSE_CAPABILITY: CommandCapability = {
    type: "camera.get-pose",
    version: "1",
    kind: "query",
    permissions: ["camera:read"],
    appliesWhen: "director-desk.camera-v2",
};

/** Reads the Program camera pose; viewport preview selection remains editor-local state. */
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
        const sampled =
            clip &&
            shot &&
            focusResolver.resolve(clip.focus, TMP_FOCUS_SAMPLE) &&
            sampleCameraMotionClip(clip, ctx.clock.time, shot, TMP_FOCUS_SAMPLE, TMP_PATH_SAMPLE, TMP_MOTION_SAMPLE)
                ? TMP_MOTION_SAMPLE
                : null;
        return {
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

interface ShotIdPayload {
    readonly id: string;
}

/** Removing a camera atomically removes its dependent motion and Program clips. */
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

    override invert(ctx: DirectorContext): readonly SerializedCommand[] | null {
        const previousShot = ctx.camera.director.getShot(this.payload.id);
        if (!previousShot) return null;
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
        ];
    }
}

export function registerCameraCommands(dispatcher: CommandDispatcher): void {
    dispatcher.register(RemoveShotCommand.TYPE, (payload: ShotIdPayload) => new RemoveShotCommand(payload));
    dispatcher.registerQuery(
        CameraGetPoseQuery.TYPE,
        (payload: Record<string, never>) => new CameraGetPoseQuery(payload),
        CAMERA_POSE_CAPABILITY,
    );
}
