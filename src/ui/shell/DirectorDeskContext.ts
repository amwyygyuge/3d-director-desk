import { createContext, useContext } from "react";

import { AssetCatalog } from "@/assets/catalog/AssetCatalog";
import { BuiltinAssetProvider } from "@/assets/catalog/AssetProvider";
import type { AssetProvider } from "@/assets/catalog/AssetProvider";

import { ActorRuntime } from "@/actor/ActorRuntime";
import { PosePresetLibrary } from "@/pose/PosePresetLibrary";
import { AnimationBinder } from "@/animation/AnimationBinder";
import { ActionPreviewController } from "@/animation/ActionPreviewController";
import { AnimationLibrary } from "@/assets/AnimationLibrary";
import { AssetLibrary } from "@/assets/AssetLibrary";
import type { HostBridgeConfiguration } from "@/bridge/HostBridge";
import { InertHostAdapter, PostMessageAdapter } from "@/host/HostAdapter";
import type { HostAdapter } from "@/host/HostAdapter";
import { CaptureService } from "@/capture/CaptureService";
import { DeskShellPresentation } from "@/ui/shell/DeskShellPresentation";
import type { DeskShellPresentationInit } from "@/ui/shell/DeskShellPresentation";
import { FrameRateMonitor } from "@/core/FrameRateMonitor";
import { CommandDispatcher } from "@/command/CommandDispatcher";
import { registerBuiltinCommands, registerBuiltinKeyframeCodecs } from "@/command/commands";
import { CommandHistory } from "@/command/CommandHistory";
import { DocumentImportService } from "@/document/DocumentImportService";
import { ModelImporter } from "@/loaders/ModelImporter";
import { ShortcutRegistry } from "@/shortcuts/ShortcutRegistry";
import { SkeletonRuntimeRegistry } from "@/pose/SkeletonRuntimeRegistry";
import { PoseGroundingService } from "@/pose/PoseGroundingService";
import { CameraStore } from "@/store/CameraStore";
import { ViewportCameraAuthority } from "@/camera/ViewportCameraAuthority";
import { CameraMotionStore } from "@/store/CameraMotionStore";
import { KeyframeAuthoringService } from "@/authoring/KeyframeAuthoringService";
import { SnapResolver } from "@/authoring/SnapResolver";
import { TimelineLayout } from "@/authoring/TimelineLayout";
import { MotionAuthoringStore } from "@/store/MotionAuthoringStore";
import { SceneStore } from "@/store/SceneStore";
import { SelectionStore } from "@/store/SelectionStore";
import { WorkbenchLayoutStore } from "@/store/WorkbenchLayoutStore";
import { PlayheadDisplay } from "@/ui/timeline/PlayheadDisplay";
import { UiStore } from "@/store/UiStore";
import { TimelineStore } from "@/store/TimelineStore";
import { PlaybackCoordinator } from "@/timeline/PlaybackCoordinator";
import { TimeTransport } from "@/time/TimeTransport";

type DeskFinalizer = () => void;

/**
 * 每桌生命周期守卫:StrictMode 同步重放 effect 时撤销延迟销毁；真正卸载后才中止异步工作和释放资源。
 */
export class DeskLifecycleGuard {
    private readonly controller = new AbortController();
    private disposalScheduled = false;
    private disposed = false;

    get signal(): AbortSignal {
        return this.controller.signal;
    }

    activate(): void {
        if (this.disposed) return;
        this.disposalScheduled = false;
    }

    scheduleDispose(finalizer: DeskFinalizer): void {
        if (this.disposed || this.disposalScheduled) return;
        this.disposalScheduled = true;
        queueMicrotask(() => this.finalize(finalizer));
    }

    private finalize(finalizer: DeskFinalizer): void {
        if (this.disposed || !this.disposalScheduled) return;
        this.disposed = true;
        this.controller.abort();
        finalizer();
    }
}

/**
 * 一个导演台实例的完整状态集合。
 * Monet 画布可同时挂载多个导演台节点 → 每实例一套,禁全局单例。
 */
export interface DirectorDeskStores {
    scene: SceneStore;
    camera: CameraStore;
    selection: SelectionStore;
    clock: TimeTransport;
    /** 真实 R3F render 的低频帧率读数；只作性能观测，绝不进入文档状态。 */
    frameRate: FrameRateMonitor;
    /** 可序列化 TimelineDoc 的每实例状态容器 */
    timeline: TimelineStore;
    /** 单条导演运镜路径的每实例可序列化状态容器 */
    motion: CameraMotionStore;
    /** 运镜编排态(视口模式、预览片段、选中关键帧、轨迹显隐、时间轴窗口) */
    motionAuthoring: MotionAuthoringStore;
    /** 视口相机所有权裁决:导航路径与轨道控制器的启停唯一判据 */
    viewportCamera: ViewportCameraAuthority;
    /** 三数据源 → 统一行几何的时间轴视图模型(展开轨与迷你轨共用) */
    timelineLayout: TimelineLayout;
    /** 打点上下文分派(K:镜头关键帧 / 走位关键帧) */
    keyframeAuthoring: KeyframeAuthoringService;
    /** 时间轴拖拽吸附候选解析 */
    snapResolver: SnapResolver;
    /** TimelineDoc 与运镜路径 → Three 运行时的唯一回放写方 */
    playback: PlaybackCoordinator;
    capture: CaptureService;
    /** 命令层唯一入口:UI/宿主/AI 的一切写操作经此分发 */
    dispatcher: CommandDispatcher;
    /** 已导入模型资产表(MobX 纯数据) */
    assets: AssetLibrary;
    /** 资源目录:内置/注入条目的统一注册表(纯元数据,与资源本体解耦) */
    catalog: AssetCatalog;
    /** 模型加载/缓存/释放(非 observable,three 资源) */
    models: ModelImporter;
    /** gizmo 模式等纯界面状态 */
    ui: UiStore;
    /** 悬浮壳层编排态(左栏抽屉、时间线钉住、预览模式) */
    layout: WorkbenchLayoutStore;
    /** playhead 的低频显示值:全桌唯一一份,避免多个面板各挂一条帧级 reaction */
    playheadDisplay: PlayheadDisplay;
    /** 快捷键注册表(机制层;语义在 shortcuts/builtinShortcuts) */
    shortcuts: ShortcutRegistry<DirectorDeskStores>;
    /** 宿主适配器:注入直嵌适配器，或由 hostBridge 配置可信 postMessage；无配置时惰性无通信 */
    host: HostAdapter;
    /** 壳层呈现配置:宿主品牌化/出口文案/工具栏扩展(创建期注入、运行期不变的值对象) */
    presentation: DeskShellPresentation;
    /** 撤销/重做历史(命令层红利;回放经 dispatcher record:false) */
    history: CommandHistory;
    /** 动作库(纯数据表 + clip 运行时表) */
    animations: AnimationLibrary;
    /** 动作挂载协调器;创建时即接入统一时钟 */
    binder: AnimationBinder;
    /** 当前 Inspector 选中模型的非持久动作预览；不驱动全局时间线。 */
    actionPreview: ActionPreviewController;
    /** 骨骼 Three 运行时索引；只存于本桌实例，绝不进入 MobX。 */
    skeletons: SkeletonRuntimeRegistry;
    /** 静态预设姿势的地面贴合运行时服务；输出仍经命令写回 Transform。 */
    poseGrounding: PoseGroundingService;
    /** 人偶外观/体型的 Three 运行时写方；每桌一套，绝不进 MobX。 */
    actorRuntime: ActorRuntime;
    /** 姿势预设注册表：内置预设 + 工程自建预设（MobX 可观察，面板直读）。 */
    posePresets: PosePresetLibrary;
    /** 工程快照替换应用服务：管理候选聚合提交与动作恢复取消域。 */
    documentImports: DocumentImportService;
    /** 生命周期守卫与异步工作取消域 */
    lifecycle: DeskLifecycleGuard;
}

export function createDirectorDeskStores(options?: {
    host?: HostAdapter | undefined;
    hostBridge?: HostBridgeConfiguration | undefined;
    /** 宿主注入的资源 provider(直嵌形态);内置资源始终加载 */
    assetProviders?: readonly AssetProvider[] | undefined;
    /** 运镜轨迹辅助物的初始可见性(Storybook/宿主播种) */
    motionPathVisible?: boolean | undefined;
    /** 壳层呈现定制(产品名/采集按钮文案/工具栏扩展位);仅创建期读取 */
    presentation?: DeskShellPresentationInit | undefined;
    /** 参考地板边长初始值(米);运行期由项目菜单滑杆接管 */
    gridSizeMeters?: number | undefined;
}): DirectorDeskStores {
    const dispatcher = new CommandDispatcher();
    registerBuiltinCommands(dispatcher);
    registerBuiltinKeyframeCodecs();
    const history = new CommandHistory();
    history.bindDispatcher(dispatcher);
    dispatcher.attachHistory(history);
    const host =
        options?.host ?? (options?.hostBridge ? new PostMessageAdapter(options.hostBridge) : new InertHostAdapter());
    const timeline = new TimelineStore();
    // 时钟的时长权威来自时间轴文档:playhead 双端钳在 [0, duration],不再播过尾
    const clock = new TimeTransport({
        get durationSeconds() {
            return timeline.document.duration;
        },
    });
    const binder = new AnimationBinder();
    const actionPreview = new ActionPreviewController(binder);
    const scene = new SceneStore();
    const actorRuntime = new ActorRuntime(scene.manager);
    const poseGrounding = new PoseGroundingService(scene.manager, actorRuntime);
    const skeletons = new SkeletonRuntimeRegistry();
    const posePresets = new PosePresetLibrary();
    const motion = new CameraMotionStore();
    binder.bindTransport(clock);
    const camera = new CameraStore();
    const layout = new WorkbenchLayoutStore({ gridSizeMeters: options?.gridSizeMeters });
    const motionAuthoring = new MotionAuthoringStore(layout, { pathVisible: options?.motionPathVisible });
    const viewportCamera = new ViewportCameraAuthority(camera, motionAuthoring);
    const playback = new PlaybackCoordinator(
        timeline,
        scene.manager,
        clock,
        motion,
        camera,
        binder,
        skeletons,
        motionAuthoring,
    );
    const catalog = new AssetCatalog();
    const lifecycle = new DeskLifecycleGuard();
    const documentImports = new DocumentImportService();
    // 资源目录装载:内置必载 + 宿主注入;异步失败静默(目录为空可由 assets.list 断言发现)
    void catalog.loadProvider(new BuiltinAssetProvider(), "builtin", lifecycle.signal);
    for (const provider of options?.assetProviders ?? []) {
        void catalog.loadProvider(provider, "injected", lifecycle.signal);
    }
    return {
        scene,
        selection: new SelectionStore(),
        timeline,
        motion,
        playback,
        camera,
        clock,
        capture: new CaptureService(),
        frameRate: new FrameRateMonitor(),
        dispatcher,
        assets: new AssetLibrary(),
        models: new ModelImporter(),
        ui: new UiStore(),
        layout,
        motionAuthoring,
        viewportCamera,
        timelineLayout: new TimelineLayout(motion, timeline),
        keyframeAuthoring: new KeyframeAuthoringService(),
        snapResolver: new SnapResolver(),
        playheadDisplay: new PlayheadDisplay(clock),
        shortcuts: new ShortcutRegistry<DirectorDeskStores>(),
        host,
        presentation: new DeskShellPresentation(options?.presentation),
        history,
        animations: new AnimationLibrary(),
        skeletons,
        poseGrounding,
        actorRuntime,
        posePresets,
        binder,
        actionPreview,
        catalog,
        lifecycle,
        documentImports,
    };
}

const DirectorDeskContext = createContext<DirectorDeskStores | null>(null);

export const DirectorDeskProvider = DirectorDeskContext.Provider;

export function useDirectorDeskStores(): DirectorDeskStores {
    const stores = useContext(DirectorDeskContext);
    if (!stores) {
        throw new Error("useDirectorDeskStores 必须在 <DirectorDesk> 内部使用");
    }
    return stores;
}
