import type { AnimationBinder } from "@/animation/AnimationBinder";
import type { ActionPreviewController } from "@/animation/ActionPreviewController";
import type { AnimationLibrary } from "@/assets/AnimationLibrary";
import type { AssetCatalog } from "@/assets/catalog/AssetCatalog";
import type { HostAdapter } from "@/host/HostAdapter";
import type { ModelImporter } from "@/loaders/ModelImporter";
import type { CameraStore } from "@/store/CameraStore";
import type { MotionAuthoringStore } from "@/store/MotionAuthoringStore";
import type { CameraMotionStore } from "@/store/CameraMotionStore";
import type { CaptureService } from "@/capture/CaptureService";
import type { VideoExportSession } from "@/capture/VideoExportSession";
import type { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import type { PoseGroundingService } from "@/pose/PoseGroundingService";
import type { ActorRuntime } from "@/actor/ActorRuntime";
import type { PosePresetLibrary } from "@/pose/PosePresetLibrary";
import type { SceneStore } from "@/store/SceneStore";
import type { TimeTransport } from "@/time/TimeTransport";
import type { SelectionStore } from "@/store/SelectionStore";
import type { UiStore } from "@/store/UiStore";
import type { WorkbenchLayoutStore } from "@/store/WorkbenchLayoutStore";
import type { PlaybackCoordinator } from "@/timeline/PlaybackCoordinator";
import type { TimelineStore } from "@/store/TimelineStore";
import type { DocumentImportService } from "@/document/DocumentImportService";

/**
 * DirectorDeskStores 在结构上天然满足本接口;仅暴露命令执行及移除后的选中态收敛所需依赖。
 */
export interface DirectorContext {
    readonly scene: SceneStore;
    readonly camera: CameraStore;
    readonly clock: TimeTransport;
    readonly timeline: TimelineStore;
    readonly motion: CameraMotionStore;
    /** 运镜编排态:视口模式、预览片段、选中关键帧(纯 UI 态,不入文档与撤销栈) */
    readonly motionAuthoring: MotionAuthoringStore;
    /** 回放只写 Three 运行时；命令层用于编辑后立即重采样与停止恢复。 */
    readonly playback: PlaybackCoordinator;
    readonly capture: CaptureService;
    /** 视频导出生命周期的唯一权威；MediaRecorder 运行时句柄仍由 capture 持有。 */
    readonly videoExport: VideoExportSession;
    /** 模型加载/缓存(文档导入时重取动作 clip) */
    readonly models: ModelImporter;
    /** 模型级局部动作预览，独立于 Timeline 的全局 playhead。 */
    readonly actionPreview: ActionPreviewController;
    readonly binder: AnimationBinder;
    /** Per-desk Three skeleton index; command/query boundary returns serializable DTOs only. */
    readonly skeletons: SkeletonRuntimeRegistry;
    /** Converts an evaluated static pose into a grounded serializable transform. */
    readonly poseGrounding: PoseGroundingService;
    /** 人偶外观与体型的 Three 写方；命令只交付纯数据，材质与骨骼缩放由它落地。 */
    readonly actorRuntime: ActorRuntime;
    /** 姿势预设注册表（内置 + 工程自建）；命令层只收 presetId，不收裸四元数。 */
    readonly posePresets: PosePresetLibrary;
    readonly animations: AnimationLibrary;
    /** 资源目录(内置/注入/远程条目的统一注册表) */
    readonly catalog: AssetCatalog;
    /** 宿主适配器(截图回传/模型导入;iframe 与直嵌两形态一契约) */
    readonly host: HostAdapter;
    /** 截图预览等界面态 */
    readonly ui: UiStore;
    /** 悬浮壳层编排态;预览模式命令的落点(纯 UI 态,不入文档与撤销栈) */
    readonly layout: WorkbenchLayoutStore;
    /** 对象移除后由命令层收敛选中态，避免 UI 留下失效引用 */
    readonly selection: SelectionStore;
    /** 工程快照替换应用服务：候选聚合校验、提交与异步动作恢复同属一个生命周期。 */
    readonly documentImports: DocumentImportService;
}

export interface CommandIssueOption {
    readonly type: string;
    readonly label: string;
}

export interface CommandIssue {
    readonly code: string;
    readonly path: string;
    readonly message: string;
    readonly options?: readonly CommandIssueOption[];
}

export type CommandResult =
    | {
          ok: true;
      }
    | {
          ok: false;
          error: string;
          issues?: readonly string[];
          issueDetails?: readonly CommandIssue[];
      };

/** 线上传输形态:AI 工具调用 / HostBridge 消息 / 回放日志都是它 */
export interface SerializedCommand {
    readonly type: string;
    readonly payload: unknown;
}

/**
 * 导演命令抽象基类(命令层唯一入口)。
 *
 * 纪律:UI 交互、宿主消息、AI 工具调用对场景的一切写操作,
 * 都必须收敛为 DirectorCommand 经 CommandDispatcher 分发——
 * 这是 AI 接入、撤销、操作回放日志的唯一挂点。
 *
 * 实现约束:
 * - payload 必须纯数据可序列化(JSON 往返不丢信息);
 * - validate 先于 execute,非法输入产出结构化 issues 供调用方(AI)重试;
 * - execute 内不抛异常,领域错误走 CommandResult。
 */
export abstract class DirectorCommand<P = unknown> {
    abstract readonly type: string;
    abstract readonly payload: P;

    /** 返回问题列表,空数组 = 校验通过 */
    abstract validate(ctx: DirectorContext): string[];

    /** 可选的稳定结构化问题；保留 validate 以兼容既有命令。 */
    validateIssues?(ctx: DirectorContext): readonly CommandIssue[];
    abstract execute(ctx: DirectorContext): void;

    /**
     * 求逆(撤销体系挂点,可选):返回能撤销本命令的命令序列;
     * 以 execute 前的 pre-state 调用(Dispatcher 保证时序)。
     * 返回 null = 不可撤销(瞬态命令如 transport.play、capture.frame)。
     */
    invert?(ctx: DirectorContext): readonly SerializedCommand[] | null;
}
