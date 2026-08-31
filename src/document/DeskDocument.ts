import type { CameraMotionClipJSON } from "../camera/CameraMotionClip";
import type { CameraProgramTrackJSON } from "../camera/CameraProgramTrack";
import type { CameraShotJSON } from "../camera/CameraShot";
import type { SceneObjectInit } from "../core/SceneObject";
import type { TimelineDocInit } from "../timeline/TimelineDoc";
import type { DirectorContext } from "../command/DirectorCommand";

export const DESK_DOCUMENT_VERSION = 3;

/** 动作资产引用(clip 本体是运行时资源,文档只存 URL;clipName 用于多 clip 文件内定位) */
export interface DeskDocumentAction {
    readonly name: string;
    readonly url: string;
    readonly clipName: string;
    readonly mountedOn: string | null;
}

export interface DeskDocumentMotion {
    readonly clips: readonly CameraMotionClipJSON[];
    readonly program: CameraProgramTrackJSON;
}

/**
 * 导演台文档:一个镜头工程的完整可序列化快照。机位、运镜和 Program 输出均为纯数据，
 * 运行时 Three 相机、辅助物和编辑器视口选择均不进入文档。
 */
export interface DeskDocument {
    readonly version: typeof DESK_DOCUMENT_VERSION;
    readonly entities: readonly SceneObjectInit[];
    readonly shots: readonly { readonly id: string; readonly shot: CameraShotJSON }[];
    readonly motion: DeskDocumentMotion;
    readonly timeline: TimelineDocInit;
    readonly actions: readonly DeskDocumentAction[];
}

/** 装配当前状态为文档(单一事实源:各域 toJSON) */
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
        timeline: ctx.timeline.document.toJSON(),
        actions: ctx.animations.actions.map((action) => ({
            name: action.name,
            url: action.url,
            clipName: ctx.animations.getClip(action.id)?.name ?? "",
            mountedOn: entities.find((entity) => entity.actionId === action.id)?.id ?? null,
        })),
    };
}
