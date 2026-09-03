import type { CaptureProduct } from "@/capture/CaptureProduct";

import { HostBridge } from "@/bridge/HostBridge";
import type { HostBridgeConfiguration } from "@/bridge/HostBridge";
import { HOST_INBOUND_MESSAGE_TYPE, HOST_OUTBOUND_MESSAGE_TYPE } from "@/bridge/protocol";

/** 宿主适配器接口:导演台与宿主的唯一契约面(两形态一契约)。 */
export interface HostAdapter {
    /** 宿主侧请求导入模型(Monet 生成资产 → 导演台场景) */
    readonly onImportModel: (handler: (payload: { url: string; name: string }) => void) => () => void;
    /** 宿主侧注册资源条目进目录(外部注入通道;条目逐条过校验围栏) */
    readonly onRegisterAssets: (handler: (payload: { assets: readonly unknown[] }) => void) => () => void;
    /** 已完成采集产物回传宿主(成为节点 outputs);异步宿主在上传和落节点完成后 resolve。 */
    readonly reportCapture: (product: CaptureProduct) => void | Promise<void>;
    /** ready 握手(带协议版本;直嵌形态是空操作) */
    readonly reportReady: (protocolVersion: number) => void;
    /** 实例卸载回收(可选;iframe 形态释放 message 监听) */
    readonly dispose?: () => void;
}

type InboundType = (typeof HOST_INBOUND_MESSAGE_TYPE)[keyof typeof HOST_INBOUND_MESSAGE_TYPE];
type InboundHandler = (payload: never) => void;

interface InboundSubscription {
    readonly type: InboundType;
    readonly handler: InboundHandler;
    unsubscribe: (() => void) | null;
}

/**
 * iframe 形态:把 HostAdapter 契约映射到 HostBridge 的 postMessage 协议。
 * Bridge 监听器只在已挂载的 DirectorDesk effect 中 activate，避免 StrictMode 丢弃实例泄漏监听器。
 */
export class PostMessageAdapter implements HostAdapter {
    private readonly subscriptions = new Set<InboundSubscription>();
    private bridge: HostBridge | null = null;
    private disposed = false;

    constructor(private readonly configuration: HostBridgeConfiguration) {}

    activate(): void {
        if (this.disposed || this.bridge !== null) return;
        const bridge = new HostBridge(this.configuration);
        this.bridge = bridge;
        for (const subscription of this.subscriptions) this.attachSubscription(bridge, subscription);
    }

    private attachSubscription(bridge: HostBridge, subscription: InboundSubscription): void {
        subscription.unsubscribe = bridge.on(subscription.type, (message) =>
            subscription.handler(message.payload as never),
        );
    }

    private addSubscription(type: InboundType, handler: InboundHandler): () => void {
        if (this.disposed) return () => {};
        const subscription: InboundSubscription = { type, handler, unsubscribe: null };
        this.subscriptions.add(subscription);
        if (this.bridge !== null) this.attachSubscription(this.bridge, subscription);
        return () => {
            subscription.unsubscribe?.();
            this.subscriptions.delete(subscription);
        };
    }

    onImportModel(handler: (payload: { url: string; name: string }) => void): () => void {
        return this.addSubscription(HOST_INBOUND_MESSAGE_TYPE.IMPORT_MODEL, handler);
    }

    onRegisterAssets(handler: (payload: { assets: readonly unknown[] }) => void): () => void {
        return this.addSubscription(HOST_INBOUND_MESSAGE_TYPE.REGISTER_ASSETS, handler);
    }

    reportCapture(product: CaptureProduct): void {
        this.bridge?.post({ type: HOST_OUTBOUND_MESSAGE_TYPE.CAPTURE_PRODUCED, payload: product });
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
    onRegisterAssets(): () => void {
        return () => {};
    }

    reportCapture(): void {}

    reportReady(): void {}
}
