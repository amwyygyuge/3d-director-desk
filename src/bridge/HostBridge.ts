import { HOST_BRIDGE_FAILURE_CODE, HOST_OUTBOUND_MESSAGE_TYPE, isDirectorDeskMessage } from "@/bridge/protocol";
import type { HostInboundMessage, HostOutboundMessage, HostOutboundRequest } from "@/bridge/protocol";

/** 每个导演台实例的不可变宿主会话标识。 */
export class HostBridgeSession {
    constructor(readonly id: string) {
        if (id.length === 0) throw new Error("HostBridgeSession.id 不能为空");
    }

    matches(sessionId: string): boolean {
        return this.id === sessionId;
    }
}

/**
 * postMessage 信任边界。目标窗口、精确 origin 与实例会话均由嵌入宿主显式提供；
 * 不存在通配 origin 或隐式 parent 回退。
 */
export class HostBridgeConfiguration {
    constructor(
        readonly targetWindow: Window,
        readonly targetOrigin: string,
        readonly session: HostBridgeSession,
    ) {
        if (targetOrigin === "*" || new URL(targetOrigin).origin !== targetOrigin) {
            throw new Error("HostBridgeConfiguration.targetOrigin 必须是精确 origin");
        }
    }
}

type InboundHandler = (message: HostInboundMessage) => void;

/**
 * 宿主桥接适配器:在到达领域层之前完成 origin、source、session 和完整协议校验。
 */
export class HostBridge {
    private readonly inboundHandlers = new Map<HostInboundMessage["type"], Set<InboundHandler>>();
    private readonly listener: (event: MessageEvent) => void;
    private disposed = false;

    constructor(private readonly configuration: HostBridgeConfiguration) {
        this.listener = (event: MessageEvent) => this.handleMessage(event);
        window.addEventListener("message", this.listener);
    }

    on(type: HostInboundMessage["type"], handler: InboundHandler): () => void {
        const handlers = this.inboundHandlers.get(type) ?? new Set<InboundHandler>();
        handlers.add(handler);
        this.inboundHandlers.set(type, handlers);
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) this.inboundHandlers.delete(type);
        };
    }

    post(message: HostOutboundRequest): void {
        if (this.disposed) return;
        const outbound: HostOutboundMessage = { ...message, sessionId: this.configuration.session.id };
        this.configuration.targetWindow.postMessage(outbound, this.configuration.targetOrigin);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        window.removeEventListener("message", this.listener);
        this.inboundHandlers.clear();
    }

    private handleMessage(event: MessageEvent): void {
        if (
            this.disposed ||
            event.origin !== this.configuration.targetOrigin ||
            event.source !== this.configuration.targetWindow
        )
            return;
        if (!this.hasMatchingSession(event.data)) return;
        if (!isDirectorDeskMessage(event.data)) {
            this.postFailure(HOST_BRIDGE_FAILURE_CODE.INVALID_MESSAGE, "宿主消息格式无效");
            return;
        }
        const handlers = this.inboundHandlers.get(event.data.type);
        if (!handlers) return;
        for (const handler of handlers) handler(event.data);
    }

    private hasMatchingSession(data: unknown): boolean {
        if (typeof data !== "object" || data === null || !("sessionId" in data)) return false;
        return typeof data.sessionId === "string" && this.configuration.session.matches(data.sessionId);
    }

    private postFailure(
        code: (typeof HOST_BRIDGE_FAILURE_CODE)[keyof typeof HOST_BRIDGE_FAILURE_CODE],
        message: string,
    ): void {
        this.post({
            type: HOST_OUTBOUND_MESSAGE_TYPE.COMMAND_FAILED,
            payload: { code, message },
        });
    }
}
