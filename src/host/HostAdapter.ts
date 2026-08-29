import { HostBridge } from "../bridge/HostBridge";
import type { HostBridgeConfiguration } from "../bridge/HostBridge";
import { HOST_INBOUND_MESSAGE_TYPE, HOST_OUTBOUND_MESSAGE_TYPE } from "../bridge/protocol";

/** 宿主适配器接口:导演台与宿主的唯一契约面(两形态一契约)。 */
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

type ImportHandler = (payload: { url: string; name: string }) => void;

interface ImportSubscription {
    readonly handler: ImportHandler;
    unsubscribe: (() => void) | null;
}

/**
 * iframe 形态:把 HostAdapter 契约映射到 HostBridge 的 postMessage 协议。
 * Bridge 监听器只在已挂载的 DirectorDesk effect 中 activate，避免 StrictMode 丢弃实例泄漏监听器。
 */
export class PostMessageAdapter implements HostAdapter {
    private readonly subscriptions = new Set<ImportSubscription>();
    private bridge: HostBridge | null = null;
    private disposed = false;

    constructor(private readonly configuration: HostBridgeConfiguration) {}

    activate(): void {
        if (this.disposed || this.bridge !== null) return;
        const bridge = new HostBridge(this.configuration);
        this.bridge = bridge;
        for (const subscription of this.subscriptions) {
            subscription.unsubscribe = bridge.on(HOST_INBOUND_MESSAGE_TYPE.IMPORT_MODEL, (message) =>
                subscription.handler(message.payload),
            );
        }
    }

    onImportModel(handler: ImportHandler): () => void {
        if (this.disposed) return () => {};
        const subscription: ImportSubscription = { handler, unsubscribe: null };
        this.subscriptions.add(subscription);
        if (this.bridge !== null) {
            subscription.unsubscribe = this.bridge.on(HOST_INBOUND_MESSAGE_TYPE.IMPORT_MODEL, (message) =>
                handler(message.payload),
            );
        }
        return () => {
            subscription.unsubscribe?.();
            this.subscriptions.delete(subscription);
        };
    }

    reportCapture(payload: { blobUrl: string; width: number; height: number }): void {
        this.bridge?.post({ type: HOST_OUTBOUND_MESSAGE_TYPE.CAPTURE_PRODUCED, payload });
    }

    reportReady(protocolVersion: number): void {
        this.bridge?.post({ type: HOST_OUTBOUND_MESSAGE_TYPE.READY, payload: { protocolVersion } });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.bridge?.dispose();
        this.subscriptions.clear();
    }
}

/** 未配置可信 postMessage 宿主时的安全缺省适配器。 */
export class InertHostAdapter implements HostAdapter {
    onImportModel(): () => void {
        return () => {};
    }

    reportCapture(): void {}

    reportReady(): void {}
}
