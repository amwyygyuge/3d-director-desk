import { type CommandDispatcher } from "../command/CommandDispatcher";
import type { DirectorContext, SerializedCommand } from "../command/DirectorCommand";
import type { HostBridge } from "./HostBridge";

/**
 * 桥接适配器:把宿主消息翻译成命令走 CommandDispatcher(红线 #8)。
 * HostBridge 只做传输,本类做协议→命令的映射,双方都不感知对方细节。
 *
 * 返回解绑函数。
 */
export function connectBridgeCommands(
    bridge: HostBridge,
    dispatcher: CommandDispatcher,
    ctx: DirectorContext,
): () => void {
    const dispatch = (raw: SerializedCommand) => dispatcher.dispatch(raw, ctx);

    bridge.on("director-desk:import-model", (msg) => {
        if (msg.type !== "director-desk:import-model") return;
        dispatch({
            type: "object.place",
            payload: {
                id: `model-${crypto.randomUUID()}`,
                kind: "model",
                sourceUrl: msg.payload.url,
            },
        });
    });

    return () => {
        // HostBridge 当前生命周期与 DirectorDesk 实例一致,随 bridge.dispose 整体回收
    };
}
