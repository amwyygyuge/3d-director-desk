import type { HostBridge } from "../bridge/HostBridge";

/**
 * 宿主适配器接口:导演台与宿主的唯一契约面(两形态一契约)。
 * - iframe 形态:PostMessageAdapter 走 HostBridge;
 * - Monet 组件直嵌形态:MonetNodeAdapter 直连 Monet api,不绕 postMessage。
 * DirectorDesk 经 `host` prop 注入;缺省(无 prop)时 iframe 形态自动落 PostMessageAdapter。
 */
export interface HostAdapter {
    /** 宿主侧请求导入模型(Monet 生成资产 → 导演台场景) */
    readonly onImportModel: (handler: (payload: { url: string; name: string }) => void) => () => void;
    /** 截图产物回传宿主(成为节点 outputs) */
    readonly reportCapture: (payload: { blobUrl: string; width: number; height: number }) => void;
    /** ready 握手(带协议版本;直嵌形态是空操作) */
    readonly reportReady: (protocolVersion: number) => void;
    /** 实例卸载回收(可选;iframe 形态释放 message 监听) */
    readonly dispose?: () => void;
}

/** iframe 形态:把 HostAdapter 契约映射到 HostBridge 的 postMessage 协议 */
export class PostMessageAdapter implements HostAdapter {
    constructor(private readonly bridge: HostBridge) {}

    onImportModel(handler: (payload: { url: string; name: string }) => void): () => void {
        this.bridge.on("director-desk:import-model", (msg) => {
            if (msg.type === "director-desk:import-model") handler(msg.payload);
        });
        // HostBridge 生命周期随 DirectorDesk 实例整体回收,无单独解绑面
        return () => {};
    }

    reportCapture(payload: { blobUrl: string; width: number; height: number }): void {
        this.bridge.post({ type: "director-desk:capture-produced", payload });
    }

    reportReady(protocolVersion: number): void {
        // 顶层窗口(playground)无宿主,握手只在 iframe 形态发出
        if (window.parent === window) return;
        this.bridge.post({ type: "director-desk:ready", payload: { protocolVersion } });
    }

    dispose(): void {
        this.bridge.dispose();
    }
}
