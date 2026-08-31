import { createContext, useContext } from "react";

import { AssetCatalog } from "../assets/catalog/AssetCatalog";
import { BuiltinAssetProvider } from "../assets/catalog/AssetProvider";
import type { AssetProvider } from "../assets/catalog/AssetProvider";

import { AssetLibrary } from "../assets/AssetLibrary";
import type { HostBridgeConfiguration } from "../bridge/HostBridge";
import { InertHostAdapter, PostMessageAdapter } from "../host/HostAdapter";
import type { HostAdapter } from "../host/HostAdapter";
import { CaptureService } from "../capture/CaptureService";
import { FrameRateMonitor } from "../core/FrameRateMonitor";
import { CommandDispatcher } from "../command/CommandDispatcher";
import { registerBuiltinCommands } from "../command/commands";
import { CommandHistory } from "../command/CommandHistory";
import { ModelImporter } from "../loaders/ModelImporter";
import { ShortcutRegistry } from "../shortcuts/ShortcutRegistry";
import { SkeletonRuntimeRegistry } from "../pose/SkeletonRuntimeRegistry";
import { PoseGroundingService } from "../pose/PoseGroundingService";
import { CameraStore } from "../store/CameraStore";
import { CameraAuthoringStore } from "../store/CameraAuthoringStore";
import { CameraMotionStore } from "../store/CameraMotionStore";
import { SceneStore } from "../store/SceneStore";
import { SelectionStore } from "../store/SelectionStore";
import { UiStore } from "../store/UiStore";
import { TimelineStore } from "../store/TimelineStore";
import { PlaybackCoordinator } from "../timeline/PlaybackCoordinator";
import { TimeTransport } from "../time/TimeTransport";

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
    /** Camera sequence duration state; scene object animation tracks are intentionally absent. */
    timeline: TimelineStore;
    /** Per-desk serializable camera motion and Program output state. */
    motion: CameraMotionStore;
    /** Per-desk camera/editor selection; separate from scene-object selection and document state. */
    authoring: CameraAuthoringStore;
    /** Camera playback plus static pose application. */
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
    /** 快捷键注册表(机制层;语义在 shortcuts/builtinShortcuts) */
    shortcuts: ShortcutRegistry<DirectorDeskStores>;
    /** 宿主适配器:注入直嵌适配器，或由 hostBridge 配置可信 postMessage；无配置时惰性无通信 */
    host: HostAdapter;
    /** 撤销/重做历史(命令层红利;回放经 dispatcher record:false) */
    history: CommandHistory;
    /** 骨骼 Three 运行时索引；只存于本桌实例，绝不进入 MobX。 */
    skeletons: SkeletonRuntimeRegistry;
    /** 静态预设姿势的地面贴合运行时服务；输出仍经命令写回 Transform。 */
    poseGrounding: PoseGroundingService;
    /** 生命周期守卫与异步工作取消域 */
    lifecycle: DeskLifecycleGuard;
}

export function createDirectorDeskStores(options?: {
    host?: HostAdapter | undefined;
    hostBridge?: HostBridgeConfiguration | undefined;
    /** 宿主注入的资源 provider(直嵌形态);内置资源始终加载 */
    assetProviders?: readonly AssetProvider[] | undefined;
}): DirectorDeskStores {
    const dispatcher = new CommandDispatcher();
    registerBuiltinCommands(dispatcher);
    const history = new CommandHistory();
    history.bindDispatcher(dispatcher);
    dispatcher.attachHistory(history);
    const host =
        options?.host ?? (options?.hostBridge ? new PostMessageAdapter(options.hostBridge) : new InertHostAdapter());
    const clock = new TimeTransport();
    const scene = new SceneStore();
    const poseGrounding = new PoseGroundingService(scene.manager);
    const timeline = new TimelineStore();
    const skeletons = new SkeletonRuntimeRegistry();
    const motion = new CameraMotionStore();
    const camera = new CameraStore();
    const authoring = new CameraAuthoringStore();
    const playback = new PlaybackCoordinator(scene.manager, clock, motion, camera, skeletons);
    const catalog = new AssetCatalog();
    const lifecycle = new DeskLifecycleGuard();
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
        authoring,
        playback,
        camera,
        clock,
        capture: new CaptureService(),
        frameRate: new FrameRateMonitor(),
        dispatcher,
        assets: new AssetLibrary(),
        models: new ModelImporter(),
        ui: new UiStore(),
        shortcuts: new ShortcutRegistry<DirectorDeskStores>(),
        host,
        history,
        skeletons,
        poseGrounding,
        catalog,
        lifecycle,
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
