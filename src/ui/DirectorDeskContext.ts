import { createContext, useContext } from "react";

import { CaptureService } from "../capture/CaptureService";
import { CameraStore } from "../store/CameraStore";
import { SceneStore } from "../store/SceneStore";
import { SelectionStore } from "../store/SelectionStore";
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
}

export function createDirectorDeskStores(): DirectorDeskStores {
    return {
        scene: new SceneStore(),
        camera: new CameraStore(),
        selection: new SelectionStore(),
        clock: new TimeTransport(),
        capture: new CaptureService(),
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
