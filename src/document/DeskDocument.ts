import type { CameraMotionClipJSON } from "../camera/CameraMotionClip";
import type { CameraProgramTrackJSON } from "../camera/CameraProgramTrack";
import type { CameraShotJSON } from "../camera/CameraShot";
import type { SceneObjectInit } from "../core/SceneObject";
import type { DirectorContext } from "../command/DirectorCommand";

export const DESK_DOCUMENT_VERSION = 4;

export interface DeskDocumentMotion {
    readonly clips: readonly CameraMotionClipJSON[];
    readonly program: CameraProgramTrackJSON;
}

/** Camera-first desk document: static scene layout, static poses, cameras, motion, and Program cuts only. */
export interface DeskDocument {
    readonly version: typeof DESK_DOCUMENT_VERSION;
    readonly entities: readonly SceneObjectInit[];
    readonly shots: readonly { readonly id: string; readonly shot: CameraShotJSON }[];
    readonly motion: DeskDocumentMotion;
    readonly durationSeconds: number;
}

export function assembleDeskDocument(ctx: DirectorContext): DeskDocument {
    const entities = ctx.scene.manager.list();
    return {
        version: DESK_DOCUMENT_VERSION,
        entities: entities.map((entity) => entity.toJSON()),
        shots: ctx.camera.director.listShots().map(([id, shot]) => ({ id, shot: shot.toJSON() })),
        motion: {
            clips: ctx.motion.clips.map((clip) => clip.toJSON()),
            program: ctx.motion.program.toJSON(),
        },
        durationSeconds: ctx.timeline.duration,
    };
}
