import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import type { CameraProgramTrackJSON } from "@/camera/CameraProgramTrack";
import type { CameraShotJSON } from "@/camera/CameraShot";
import type { SceneObjectInit } from "@/core/SceneObject";
import type { TimelineDocInit } from "@/timeline/TimelineDoc";
import type { DirectorContext } from "@/command/DirectorCommand";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import type { PosePresetJSON } from "@/pose/PosePreset";
import type { LightingMode } from "@/store/SceneStore";

/**
 * 文档格式版本:功能未上线,不做跨版本迁移——版本不符即判不支持。
 * v6 起运镜与机位彻底解耦;v7 起时间轴带帧率、播放范围与标记;v8 起运镜片段带跟拍覆盖层;
 * v9 起动作挂载按实体数组记录(同一动作可挂多个实体),灯光模式进文档;
 * v10 起动作带循环语义与时间轴排期(开始时间/演出时长);
 * v11 起一次性动作带回收时长,结束后回到常驻姿势;
 * v12 起动作排期带进入时长,从常驻姿势平滑进入动作;
 * v13 起动作资产持久化裁剪窗口,去除源文件静态参考帧。
 */
export const DESK_DOCUMENT_VERSION = 13;

export interface DeskDocumentActionMount {
    readonly objectId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly attackSeconds: number;
    readonly releaseSeconds: number;
}

/** 动作资产引用(clip 本体是运行时资源,文档只存 URL;clipName 用于多 clip 文件内定位) */
export interface DeskDocumentAction {
    readonly name: string;
    readonly url: string;
    readonly clipName: string;
    readonly loopMode: ActionLoopMode;
    readonly trimStartSeconds: number;
    readonly trimEndSeconds: number;
    /** 挂载该动作的全部实体及排期;GLB 可为空，FBX 必须有目标骨架以完成重定向。 */
    readonly mountedOn: readonly DeskDocumentActionMount[];
}

/** 灯光模式(studio 兜底 / custom 自定义);灯本体是实体,走 entities 通道 */
export interface DeskDocumentLighting {
    readonly mode: LightingMode;
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
    readonly lighting: DeskDocumentLighting;
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
            loopMode: action.loopMode,
            trimStartSeconds: action.trimStartSeconds,
            trimEndSeconds: action.trimEndSeconds,
            mountedOn: entities.flatMap((entity) => {
                const performance = entity.actionPerformance;
                return performance?.actionId === action.id
                    ? [
                          {
                              objectId: entity.id,
                              startTimeSeconds: performance.startTimeSeconds,
                              durationSeconds: performance.durationSeconds,
                              attackSeconds: performance.attackSeconds,
                              releaseSeconds: performance.releaseSeconds,
                          },
                      ]
                    : [];
            }),
        })),
        lighting: { mode: ctx.scene.lightingMode },
        posePresets: ctx.posePresets.customPresets().map((preset) => preset.toJSON()),
    };
}
