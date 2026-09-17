import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef } from "react";

import { DirectorDesk } from "@/index";
import type { DirectorDeskStores, SerializedCommand } from "@/index";
import "@/styles/index.css";
import "./index.css";
import { LocalStorageScenePersistence } from "./LocalStorageScenePersistence";
import { seedCinematicScene } from "./seedCinematicScene";

declare global {
    interface Window {
        /**
         * 导演台宿主/AI 驱动句柄:
         * 写操作走 __directorDesk.dispatcher.dispatch(命令层幻觉围栏生效),
         * 读操作走 dispatcher.query 或直读 observable stores;能力清单见 listCapabilities()。
         */
        __directorDesk?: DirectorDeskStores;
        __directorDeskClientId?: string;
    }
}

/** 桥接 RPC 报文(桥接服务转发;eval 仅在桥显式开启时才会到达这里)。 */
interface BridgeRequest {
    readonly id?: string;
    readonly method?: "query" | "dispatch" | "eval";
    readonly action?: SerializedCommand;
    readonly code?: string;
}

/** 桥下行消息:RPC 请求之外还有握手等控制帧。 */
type BridgeMessage = BridgeRequest & { readonly type?: string; readonly clientId?: string };

/** 容错解析:坏帧直接丢弃,不让桥端格式问题打断页面。 */
function safeParseBridgeMessage(raw: string): BridgeMessage | null {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null ? (parsed as BridgeMessage) : null;
    } catch {
        return null;
    }
}

const BRIDGE_RETRY_INITIAL_MS = 1000;
const BRIDGE_RETRY_MAX_MS = 5000;
const BRIDGE_RETRY_BACKOFF = 1.5;

/**
 * playground ↔ 桥接服务的 WebSocket 客户端。
 *
 * 生命周期随 DirectorDesk 实例:onReady 建连,dispose() 断连且不再重试。
 * 只认桥接服务下发的三种方法;写操作一律经命令层(query/dispatch),
 * eval 是桥显式 opt-in 后才会到达的调试通道,不作为 AI 能力暴露。
 */
class DirectorBridgeClient {
    private ws: WebSocket | null = null;
    private retryDelayMs = BRIDGE_RETRY_INITIAL_MS;
    /** DOM 环境的 setTimeout 句柄即 number */
    private retryTimer: number | undefined;
    private disposed = false;

    constructor(
        private readonly stores: DirectorDeskStores,
        private readonly bridgeUrl: string,
    ) {
        this.connect();
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.ws?.close();
        this.ws = null;
    }

    private connect(): void {
        if (this.disposed) return;
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
        try {
            this.ws = new WebSocket(this.bridgeUrl);
        } catch {
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log(`[DirectorDesk Bridge] Connected to RPC Bridge on ${this.bridgeUrl}`);
            this.retryDelayMs = BRIDGE_RETRY_INITIAL_MS;
            this.ws?.send(
                JSON.stringify({
                    type: "client-info",
                    info: {
                        userAgent: navigator.userAgent,
                        viewport: { width: window.innerWidth, height: window.innerHeight },
                    },
                }),
            );
        };

        this.ws.onmessage = (evt: MessageEvent<string>) => void this.handleMessage(evt.data);

        this.ws.onclose = () => {
            this.scheduleReconnect();
        };

        this.ws.onerror = () => {
            this.ws?.close();
        };
    }

    private scheduleReconnect(): void {
        if (this.disposed) return;
        clearTimeout(this.retryTimer);
        this.retryDelayMs = Math.min(this.retryDelayMs * BRIDGE_RETRY_BACKOFF, BRIDGE_RETRY_MAX_MS);
        this.retryTimer = window.setTimeout(() => this.connect(), this.retryDelayMs);
    }

    private async handleMessage(raw: string): Promise<void> {
        const req = safeParseBridgeMessage(raw);
        if (!req) return;
        if (req.type === "handshake" && req.clientId) {
            window.__directorDeskClientId = req.clientId;
            console.log(`[DirectorDesk Bridge] Handshake ok. Client ID: ${req.clientId}`);
            return;
        }
        if (!req.id) return; // 无 id 广播无需应答
        const result = await this.executeRequest(req);
        this.ws?.send(JSON.stringify({ id: req.id, result }));
    }

    private async executeRequest(req: BridgeRequest): Promise<unknown> {
        try {
            if (req.method === "query" && req.action) {
                return this.stores.dispatcher.query(req.action, this.stores);
            }
            if (req.method === "dispatch" && req.action) {
                return this.stores.dispatcher.dispatch(req.action, this.stores);
            }
            if (req.method === "eval" && typeof req.code === "string") {
                // 调试通道:桥只在显式 allowEval 时才转发;到达即视为已获本机授权
                const executor = new Function("desk", `return (async () => { ${req.code} })()`) as (
                    desk: DirectorDeskStores,
                ) => Promise<unknown>;
                return await executor(this.stores);
            }
            return { ok: false, error: `unsupported bridge method: ${String(req.method)}` };
        } catch (err) {
            // 结构化失败回给桥;不暴露原始堆栈(契约违规在 DEV 会 throw,见 CommandDispatcher)
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
    }
}

/**
 * 默认桥地址:本地 dev 直连 127.0.0.1:4005(桥只绑 IPv4 回环;写 localhost 在 Windows 上
 * 可能解析到 ::1,撞上不相关的残留监听)。非 localhost 部署(如 GitHub Pages)不主动连桥,
 * 除非显式给 ?bridge=ws://host:port。
 */
function resolveBridgeUrl(): string | null {
    const explicit = new URLSearchParams(window.location.search).get("bridge");
    if (explicit) return explicit;
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    return isLocalhost ? "ws://127.0.0.1:4005" : null;
}

const container = document.getElementById("root");
if (!container) throw new Error("playground: #root not found");

export function Playground() {
    const persistenceRef = useRef<LocalStorageScenePersistence | null>(null);
    const bridgeRef = useRef<DirectorBridgeClient | null>(null);

    const handleReady = useCallback((stores: DirectorDeskStores): void => {
        console.log("[playground] DirectorDesk ready!");
        window.__directorDesk = stores;

        persistenceRef.current?.dispose();
        bridgeRef.current?.dispose();
        try {
            const persistence = new LocalStorageScenePersistence(stores, window.localStorage);
            persistence.restore();
            persistence.start();
            persistenceRef.current = persistence;

            // 本地存储为空(初次打开或线上首次访问)时播种演示场景,停在 0 帧由作者决定播放
            if (stores.scene.objectCount === 0) {
                void seedCinematicScene(stores);
            }
        } catch (e) {
            console.error("[playground] persistence error:", e);
        }

        const bridgeUrl = resolveBridgeUrl();
        if (bridgeUrl === null) {
            console.log("[DirectorDesk] Running in standalone mode (no bridge).");
            return;
        }
        bridgeRef.current = new DirectorBridgeClient(stores, bridgeUrl);
    }, []);

    useEffect(
        () => () => {
            persistenceRef.current?.dispose();
            bridgeRef.current?.dispose();
        },
        [],
    );

    return (
        <div style={{ width: "100vw", height: "100vh", margin: 0 }}>
            {/* 资产基址随 vite base 走:本地 dev 是 /builtin-assets,Pages 构建带仓库子路径前缀 */}
            <DirectorDesk onReady={handleReady} builtinAssetBaseUrl={`${import.meta.env.BASE_URL}builtin-assets`} />
        </div>
    );
}

createRoot(container).render(<Playground />);
