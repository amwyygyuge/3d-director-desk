import type { CaptureProduct } from "@/capture/CaptureProduct";

/** 宿主通信协议:Monet 画布节点嵌入的契约层 */

/** 协议版本:主仓与本包独立发版后会漂移,ready 握手携带本版本。 */
export const PROTOCOL_VERSION = 1;

export const HOST_INBOUND_MESSAGE_TYPE = {
    IMPORT_MODEL: "director-desk:import-model",
    REGISTER_ASSETS: "director-desk:register-assets",
} as const;

export const HOST_OUTBOUND_MESSAGE_TYPE = {
    READY: "director-desk:ready",
    CAPTURE_PRODUCED: "director-desk:capture-produced",
    COMMAND_FAILED: "director-desk:command-failed",
} as const;
export const HOST_BRIDGE_FAILURE_CODE = {
    INVALID_MESSAGE: "invalid-message",
} as const;
export type HostBridgeFailureCode = (typeof HOST_BRIDGE_FAILURE_CODE)[keyof typeof HOST_BRIDGE_FAILURE_CODE];

interface HostMessageBase<TType extends string, TPayload> {
    readonly type: TType;
    readonly sessionId: string;
    readonly payload: TPayload;
}

/** 宿主 → 导演台 */
export type HostInboundMessage =
    | HostMessageBase<
          (typeof HOST_INBOUND_MESSAGE_TYPE)["IMPORT_MODEL"],
          { readonly url: string; readonly name: string }
      >
    | HostMessageBase<(typeof HOST_INBOUND_MESSAGE_TYPE)["REGISTER_ASSETS"], { readonly assets: readonly unknown[] }>;

/** 导演台 → 宿主(Bridge 自动附加已配置的 sessionId) */
export type HostOutboundRequest =
    | {
          readonly type: (typeof HOST_OUTBOUND_MESSAGE_TYPE)["READY"];
          readonly payload: { readonly protocolVersion: number };
      }
    | {
          readonly type: (typeof HOST_OUTBOUND_MESSAGE_TYPE)["CAPTURE_PRODUCED"];
          readonly payload: CaptureProduct;
      }
    | {
          readonly type: (typeof HOST_OUTBOUND_MESSAGE_TYPE)["COMMAND_FAILED"];
          readonly payload: { readonly code: HostBridgeFailureCode; readonly message: string };
      };

/** DirectorDesk → host wire message;只由 HostBridge 构造 sessionId。 */
export type HostOutboundMessage = HostOutboundRequest & { readonly sessionId: string };

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isSessionId(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

/** 仅接受完整的、已知类型的入站消息，禁止把未校验对象交给领域层。 */
export function isDirectorDeskMessage(data: unknown): data is HostInboundMessage {
    if (!isRecord(data) || !isSessionId(data.sessionId) || !isRecord(data.payload)) return false;
    if (data.type === HOST_INBOUND_MESSAGE_TYPE.IMPORT_MODEL) {
        return (
            typeof data.payload.url === "string" && data.payload.url.length > 0 && typeof data.payload.name === "string"
        );
    }
    if (data.type === HOST_INBOUND_MESSAGE_TYPE.REGISTER_ASSETS) {
        return Array.isArray(data.payload.assets);
    }
    return false;
}
