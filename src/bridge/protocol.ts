/** 宿主通信协议:Monet 画布节点嵌入的契约层 */

/** 宿主 → 导演台 */
export type HostInboundMessage =
    | { type: "director-desk:open-session"; payload: { canvasId: string; nodeId: string } }
    | { type: "director-desk:import-model"; payload: { url: string; name: string } };

/** 导演台 → 宿主 */
export type HostOutboundMessage =
    | { type: "director-desk:ready" }
    | { type: "director-desk:capture-produced"; payload: { blobUrl: string; width: number; height: number } };

export const DIRECTOR_DESK_MESSAGE_PREFIX = "director-desk:" as const;

export function isDirectorDeskMessage(data: unknown): data is HostInboundMessage {
    if (typeof data !== "object" || data === null) return false;
    if (!("type" in data)) return false;
    const type: unknown = data.type;
    return typeof type === "string" && type.startsWith(DIRECTOR_DESK_MESSAGE_PREFIX);
}
