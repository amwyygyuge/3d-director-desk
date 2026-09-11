import type { CameraMotionClipJSON } from "@/camera/CameraMotionClip";
import type { CameraProgramTrackJSON } from "@/camera/CameraProgramTrack";
import type { CameraShotJSON } from "@/camera/CameraShot";
import type { SceneObjectInit } from "@/core/SceneObject";
import type { TimelineDocInit } from "@/timeline/TimelineDoc";
import type { DirectorContext } from "@/command/DirectorCommand";
import type { ActionLoopMode } from "@/assets/ActionAsset";
import type { PosePresetJSON } from "@/pose/PosePreset";
import type { LightingMode } from "@/store/SceneStore";
import type { OutputFormatId } from "@/output/OutputFormat";
import type { StudioEnvironmentJSON } from "@/studio/StudioEnvironment";

/**
 * v20 起演播室档位带成像三项(曝光/接触阴影/环境光照);`isStudioEnvironmentJSON` 要求三者存在,
 *     旧档缺任一项即判不支持(零兼容阶段不写迁移器)。
 * v19 起演播室档位进文档:参考地板边长、渲染画质档、帧率读数与九宫格显隐。
 *     它们决定成片质量与构图判断,此前只活在壳层 UI 态里,导出/导入/刷新一律丢失;
 *     校验器对 `studio` 硬要求(缺失即判无效),故必须换版本号。
 * v18 起走位轨持久化 `policies.extrapolation`:轨道时间跨度之外钳到首/末关键帧(hold,默认)
 *     还是交还实体权威变换(rest)。旧档缺该字段时构造期取 hold,与旧档 rest 语义不同,
 *     故必须换版本号——同一份 JSON 在两版里表现不同,是兼容层再也分辨不出的那类变更。
 * v17 起动作排期段持久化稳定 `id`:同一实体可对同一动作有多段排期,
 *     时间轴段条、选中态与运行时 clip 全按段 id 定位;旧档缺少该 id 无法还原段身份。
 * v16 起同一实体可持久化**多段动作排期**(一次性 → 循环 → 一次性),
 *     且排期可声明对齐到某条走位轨的关键帧区间(轨道重定时后排期自动跟随);
 * v15 起实体持久化叙事身份与量纲模式；旧档不迁移，版本不符即判不支持。
 * v14 起项目级输出画幅进入文档；切换采用中心裁切，机位仍只保存位姿。
 * v6 起运镜与机位彻底解耦;v7 起时间轴带帧率、播放范围与标记;v8 起运镜片段带跟拍覆盖层;
 * v9 起动作挂载按实体数组记录(同一动作可挂多个实体),灯光模式进文档;
 * v10 起动作带循环语义与时间轴排期(开始时间/演出时长);
 * v11 起一次性动作带回收时长,结束后回到常驻姿势;
 * v12 起动作排期带进入时长,从常驻姿势平滑进入动作;
 * v13 起动作资产持久化裁剪窗口,去除源文件静态参考帧。
 */
export const DESK_DOCUMENT_VERSION = 20;

/** 走位轨对齐声明:排期时段由该轨的关键帧区间派生。 */
export interface DeskDocumentActionAlignment {
    readonly trackId: string;
    readonly fromKeyframeId: string | null;
    readonly toKeyframeId: string | null;
}

export interface DeskDocumentActionMount {
    /** 排期段身份;时间轴段条与运行时 clip 均按它定位,导入后必须原样恢复。 */
    readonly id: string;
    readonly objectId: string;
    readonly startTimeSeconds: number;
    readonly durationSeconds: number;
    readonly attackSeconds: number;
    readonly releaseSeconds: number;
    /** 非空 = 该段排期对齐到走位轨区间;导入后恢复对齐声明,重定时继续自动跟随。 */
    readonly alignment?: DeskDocumentActionAlignment | null;
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

/** 成片输出格式：只持久化比例选择，实际像素尺寸由当前宿主 canvas 决定。 */
export interface DeskDocumentOutput {
    readonly formatId: OutputFormatId;
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
    readonly output: DeskDocumentOutput;
    /** 演播室档位:参考地板尺度、渲染画质档与作者选定的观测/构图辅助显隐。 */
    readonly studio: StudioEnvironmentJSON;
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
        output: { formatId: ctx.output.formatId },
        studio: ctx.studio.toJSON(),
        actions: ctx.animations.actions.map((action) => ({
            name: action.name,
            url: action.url,
            clipName: ctx.animations.getClip(action.id)?.name ?? "",
            loopMode: action.loopMode,
            trimStartSeconds: action.trimStartSeconds,
            trimEndSeconds: action.trimEndSeconds,
            // 同一实体可能对同一动作有多段排期(如走→停→走),故逐条导出而不是只取首条
            mountedOn: entities.flatMap((entity) =>
                entity.actionPerformances
                    .filter((performance) => performance.actionId === action.id)
                    .map((performance) => ({
                        id: performance.id,
                        objectId: entity.id,
                        startTimeSeconds: performance.startTimeSeconds,
                        durationSeconds: performance.durationSeconds,
                        attackSeconds: performance.attackSeconds,
                        releaseSeconds: performance.releaseSeconds,
                        alignment: performance.alignment?.toJSON() ?? null,
                    })),
            ),
        })),
        lighting: { mode: ctx.scene.lightingMode },
        posePresets: ctx.posePresets.customPresets().map((preset) => preset.toJSON()),
    };
}
