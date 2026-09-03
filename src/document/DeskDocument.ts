import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import type { CameraProgramTrackJSON } from "@/camera/CameraProgramTrack";
import type { CameraShotJSON } from "@/camera/CameraShot";
import type { SceneObjectInit } from "@/core/SceneObject";
import type { TimelineDocInit } from "@/timeline/TimelineDoc";
import type { DirectorContext } from "@/command/DirectorCommand";
import type { PosePresetJSON } from "@/pose/PosePreset";

/**
 * 文档格式版本:功能未上线,不做跨版本迁移——版本不符即判不支持。
 * v6 起运镜与机位彻底解耦;v7 起时间轴带帧率、播放范围与标记;v8 起运镜片段带跟拍覆盖层。
 */
export const DESK_DOCUMENT_VERSION = 8;

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
    readonly posePresets: readonly PosePresetJSON[];
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
        posePresets: ctx.posePresets.customPresets().map((preset) => preset.toJSON()),
    };
}
