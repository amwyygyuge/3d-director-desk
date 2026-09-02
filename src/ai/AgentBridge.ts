import { when } from "mobx";

import type { CommandCapability } from "@/command/CommandDispatcher";
import { waitMs } from "@/core/waitMs";
import type { CaptureMeta, VideoMeta } from "@/store/UiStore";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

import { AGENT_TOOL_DESCRIPTIONS } from "@/ai/toolDescriptions";

/** 工具输入 schema:JSON Schema 对象根,与契约检查的未知字段拒绝语义一致(additionalProperties: false) */
export interface AgentToolInputSchema {
    readonly type: "object";
    readonly properties: CommandCapability["payload"]["properties"];
    readonly required?: readonly string[];
    readonly additionalProperties: false;
}

/** AI 工具定义:能力契约 + 描述的直接映射,Monet agent 工具组由它注册 */
export interface AgentToolSchema {
    readonly name: string;
    readonly description: string;
    readonly kind: "command" | "query";
    readonly permissions: readonly string[];
    readonly appliesWhen: string;
    readonly inputSchema: AgentToolInputSchema;
}

/** 异步产物的默认对账等待上限:截图同步帧内取样,毫秒级即回;超时即视为管线异常 */
const DEFAULT_CAPTURE_TIMEOUT_MS = 5_000;
const LOG_PREFIX = "[AgentBridge]";

function toToolSchema(capability: CommandCapability, description: string): AgentToolSchema {
    const { payload, ...rest } = capability;
    return {
        ...rest,
        name: capability.type,
        description,
        inputSchema: {
            type: "object",
            properties: payload.properties,
            ...(payload.required ? { required: payload.required } : {}),
            additionalProperties: false,
        },
    };
}

/**
 * AI 接入桥(独立模块,功能模块零感知)。
 *
 * 边界:功能模块(command/store)不知道 AI 的存在;本模块只经公共只读面
 * (dispatcher.listCapabilities / UiStore 产物元数据)向外派生 AI 工具组与产物对账。
 * 宿主在 onReady(stores) 后 `new AgentBridge(stores)`,每导演台实例一座桥。
 *
 * 漂移围栏:描述表按 type 键控,与能力清单对账——缺描述 dev 即抛,prod 降级为
 * 跳过该工具并 console.warn(fail-closed:未描述的工具不发给 agent)。
 */
export class AgentBridge {
    constructor(private readonly stores: DirectorDeskStores) {}

    /** AI 工具组:schema 由契约直接派生,永不手写;描述缺失即登记漂移 */
    listToolSchemas(): readonly AgentToolSchema[] {
        const capabilities = this.stores.dispatcher.listCapabilities();
        const missing = capabilities.filter((c) => AGENT_TOOL_DESCRIPTIONS[c.type] === undefined).map((c) => c.type);
        if (missing.length > 0) {
            const message = `AI 工具描述缺失(登记漂移): ${missing.join(", ")}`;
            if (import.meta.env.DEV) throw new Error(message);
            console.warn(`${LOG_PREFIX} ${message}`);
        }
        return capabilities.flatMap((capability) => {
            const description = AGENT_TOOL_DESCRIPTIONS[capability.type];
            return description === undefined ? [] : [toToolSchema(capability, description)];
        });
    }

    /** 全开权限集(Monet 已决策 agent 默认全开);需要收窄时宿主自行裁剪后再传 dispatch */
    get fullPermissions(): readonly string[] {
        const granted = this.stores.dispatcher.listCapabilities().flatMap((c) => c.permissions);
        return granted.filter((permission, index) => granted.indexOf(permission) === index);
    }

    /** 等一帧截图产物按 requestId 就位;超时返回 null(管线异常,勿重试同 id) */
    awaitFrameCapture(requestId: string, timeoutMs?: number): Promise<CaptureMeta | null> {
        return this.awaitMeta(requestId, () => this.stores.ui.lastCaptureMeta, timeoutMs);
    }

    /** 等一段视频产物按 requestId 就位;超时返回 null(录制时长上限见 VIDEO_MAX_DURATION_SECONDS) */
    awaitVideoCapture(requestId: string, timeoutMs?: number): Promise<VideoMeta | null> {
        return this.awaitMeta(requestId, () => this.stores.ui.lastVideoMeta, timeoutMs);
    }

    /** requestId 对账等待:capture 命令 fire-and-forget 的配套读侧(frame/video 共用,Rule of Two) */
    private async awaitMeta<TMeta extends { readonly requestId: string }>(
        requestId: string,
        read: () => TMeta | null,
        timeoutMs = DEFAULT_CAPTURE_TIMEOUT_MS,
    ): Promise<TMeta | null> {
        if (read()?.requestId === requestId) return read();
        const observation = when(() => read()?.requestId === requestId);
        const outcome = await Promise.race([observation.then(() => read()), waitMs(timeoutMs).then(() => null)]);
        if (outcome === null) observation.cancel();
        return outcome;
    }
}
