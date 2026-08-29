import { createContext, useContext } from "react";

import { AnimationBinder } from "../animation/AnimationBinder";
import { AnimationLibrary } from "../assets/AnimationLibrary";
import { AssetLibrary } from "../assets/AssetLibrary";
import type { HostBridgeConfiguration } from "../bridge/HostBridge";
import { InertHostAdapter, PostMessageAdapter } from "../host/HostAdapter";
import type { HostAdapter } from "../host/HostAdapter";
import { CaptureService } from "../capture/CaptureService";
import { CommandDispatcher } from "../command/CommandDispatcher";
import { registerBuiltinCommands } from "../command/commands";
import { CommandHistory } from "../command/CommandHistory";
import { ModelImporter } from "../loaders/ModelImporter";
import { ShortcutRegistry } from "../shortcuts/ShortcutRegistry";
import { SkeletonRuntimeRegistry } from "../pose/SkeletonRuntimeRegistry";
import { CameraStore } from "../store/CameraStore";
import { CameraMotionStore } from "../store/CameraMotionStore";
import { ContinuityDiagnosticsStore } from "../store/ContinuityDiagnosticsStore";
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
    /** 可序列化 TimelineDoc 的每实例状态容器 */
    timeline: TimelineStore;
    /** 单条导演运镜路径的每实例可序列化状态容器 */
    motion: CameraMotionStore;
    /** Non-persistent continuity query presentation state; it never enters history or scene data. */
    continuity: ContinuityDiagnosticsStore;
    /** TimelineDoc 与运镜路径 → Three 运行时的唯一回放写方 */
    playback: PlaybackCoordinator;
    capture: CaptureService;
    /** 命令层唯一入口:UI/宿主/AI 的一切写操作经此分发 */
    dispatcher: CommandDispatcher;
    /** 已导入模型资产表(MobX 纯数据) */
    assets: AssetLibrary;
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
    /** 动作库(纯数据表 + clip 运行时表) */
    animations: AnimationLibrary;
    /** 动作挂载协调器;创建时即接入统一时钟 */
    binder: AnimationBinder;
    /** 骨骼 Three 运行时索引；只存于本桌实例，绝不进入 MobX。 */
    skeletons: SkeletonRuntimeRegistry;
    /** 生命周期守卫与异步工作取消域 */
    lifecycle: DeskLifecycleGuard;
}

export function createDirectorDeskStores(options?: {
    host?: HostAdapter | undefined;
    hostBridge?: HostBridgeConfiguration | undefined;
}): DirectorDeskStores {
    const dispatcher = new CommandDispatcher();
    registerBuiltinCommands(dispatcher);
    const history = new CommandHistory();
    history.bindDispatcher(dispatcher);
    dispatcher.attachHistory(history);
    const host =
        options?.host ?? (options?.hostBridge ? new PostMessageAdapter(options.hostBridge) : new InertHostAdapter());
    const clock = new TimeTransport();
    const binder = new AnimationBinder();
    const scene = new SceneStore();
    const timeline = new TimelineStore();
    const skeletons = new SkeletonRuntimeRegistry();
    const motion = new CameraMotionStore();
    binder.bindTransport(clock);
    const camera = new CameraStore();
    const playback = new PlaybackCoordinator(timeline, scene.manager, clock, motion, camera, binder, skeletons);
    return {
        scene,
        selection: new SelectionStore(),
        timeline,
        motion,
        playback,
        continuity: new ContinuityDiagnosticsStore(scene, camera, timeline),
        camera,
        clock,
        capture: new CaptureService(),
        dispatcher,
        assets: new AssetLibrary(),
        models: new ModelImporter(),
        ui: new UiStore(),
        shortcuts: new ShortcutRegistry<DirectorDeskStores>(),
        host,
        history,
        animations: new AnimationLibrary(),
        skeletons,
        binder,
        lifecycle: new DeskLifecycleGuard(),
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
