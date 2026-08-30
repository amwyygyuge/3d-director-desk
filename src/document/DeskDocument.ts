import type { CameraMotionPathJSON } from "../camera/CameraMotionPath";
import type { CameraShotJSON } from "../camera/CameraShot";
import type { SceneObjectInit } from "../core/SceneObject";
import type { TimelineDocInit } from "../timeline/TimelineDoc";
import type { DirectorContext } from "../command/DirectorCommand";

export const DESK_DOCUMENT_VERSION = 1;

/** 动作资产引用(clip 本体是运行时资源,文档只存 URL;clipName 用于多 clip 文件内定位) */
export interface DeskDocumentAction {
    readonly name: string;
    readonly url: string;
    readonly clipName: string;
    readonly mountedOn: string | null;
}

/**
 * 导演台文档:一个镜头工程的完整可序列化快照(实体/机位/运镜/时间轴/动作引用)。
 * 导出 → 宿主/AI 存档或跨控制台接管;导入 → 整树恢复(替换式,非合并)。
 */
export interface DeskDocument {
    readonly version: typeof DESK_DOCUMENT_VERSION;
    readonly entities: readonly SceneObjectInit[];
    readonly shots: readonly { readonly id: string; readonly shot: CameraShotJSON }[];
    readonly motion: CameraMotionPathJSON | null;
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
        motion: ctx.motion.path?.toJSON() ?? null,
        timeline: ctx.timeline.document.toJSON(),
        actions: ctx.animations.actions.map((action) => ({
            name: action.name,
            url: action.url,
            clipName: ctx.animations.getClip(action.id)?.name ?? "",
            mountedOn: entities.find((entity) => entity.actionId === action.id)?.id ?? null,
        })),
    };
}
