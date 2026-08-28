import { createContext, useContext } from "react";

import { AnimationBinder } from "../animation/AnimationBinder";
import { AnimationLibrary } from "../assets/AnimationLibrary";
import { AssetLibrary } from "../assets/AssetLibrary";
import { HostBridge } from "../bridge/HostBridge";
import { PostMessageAdapter } from "../host/HostAdapter";
import type { HostAdapter } from "../host/HostAdapter";
import { CaptureService } from "../capture/CaptureService";
import { CommandDispatcher } from "../command/CommandDispatcher";
import { registerBuiltinCommands } from "../command/commands";
import { CommandHistory } from "../command/CommandHistory";
import { ModelImporter } from "../loaders/ModelImporter";
import { ShortcutRegistry } from "../shortcuts/ShortcutRegistry";
import { CameraStore } from "../store/CameraStore";
import { SceneStore } from "../store/SceneStore";
import { SelectionStore } from "../store/SelectionStore";
import { UiStore } from "../store/UiStore";
import { TimeTransport } from "../time/TimeTransport";

/**
 * 一个导演台实例的完整状态集合。
 * Monet 画布可同时挂载多个导演台节点 → 每实例一套,禁全局单例。
 */
export interface DirectorDeskStores {
    scene: SceneStore;
    camera: CameraStore;
    selection: SelectionStore;
    clock: TimeTransport;
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
    /** 宿主适配器:缺省 iframe 形态(PostMessageAdapter);Monet 直嵌注入 MonetNodeAdapter */
    host: HostAdapter;
    /** 撤销/重做历史(命令层红利;回放经 dispatcher record:false) */
    history: CommandHistory;
    /** 动作库(纯数据表 + clip 运行时表) */
    animations: AnimationLibrary;
    /** 动作挂载协调器;创建时即接入统一时钟 */
    binder: AnimationBinder;
}

export function createDirectorDeskStores(options?: { host?: HostAdapter | undefined }): DirectorDeskStores {
    const dispatcher = new CommandDispatcher();
    registerBuiltinCommands(dispatcher);
    const history = new CommandHistory();
    history.bindDispatcher(dispatcher);
    dispatcher.attachHistory(history);
    // 缺省落 iframe 形态;直嵌形态由宿主经 host 注入,不建桥不留监听器
    const host = options?.host ?? new PostMessageAdapter(new HostBridge());
    const clock = new TimeTransport();
    const binder = new AnimationBinder();
    binder.bindTransport(clock);
    return {
        scene: new SceneStore(),
        camera: new CameraStore(),
        selection: new SelectionStore(),
        clock: clock,
        capture: new CaptureService(),
        dispatcher,
        assets: new AssetLibrary(),
        models: new ModelImporter(),
        ui: new UiStore(),
        shortcuts: new ShortcutRegistry<DirectorDeskStores>(),
        host,
        history,
        animations: new AnimationLibrary(),
        binder,
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
