import { isDirectorDeskMessage } from "./protocol";
import type { HostInboundMessage, HostOutboundMessage } from "./protocol";

/**
 * 宿主桥接适配器:隔离 postMessage 协议与领域层。
 * Monet 画布节点(或 iframe 嵌入)经此与导演台通信,领域类不感知宿主存在。
 */
export class HostBridge {
    private readonly inboundHandlers = new Map<string, (msg: HostInboundMessage) => void>();
    private readonly listener: (event: MessageEvent) => void;

    constructor(private readonly targetWindow: Window = window.parent) {
        this.listener = (event: MessageEvent) => {
            if (!isDirectorDeskMessage(event.data)) return;
            const handler = this.inboundHandlers.get(event.data.type);
            handler?.(event.data);
        };
        window.addEventListener("message", this.listener);
    }

    on(type: HostInboundMessage["type"], handler: (msg: HostInboundMessage) => void): void {
        this.inboundHandlers.set(type, handler);
    }

    post(message: HostOutboundMessage): void {
        this.targetWindow.postMessage(message, "*");
    }

    dispose(): void {
        window.removeEventListener("message", this.listener);
        this.inboundHandlers.clear();
    }
}
