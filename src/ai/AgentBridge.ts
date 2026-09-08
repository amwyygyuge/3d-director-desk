import { when } from "mobx";

import type { CommandCapability, QueryResult } from "@/command/CommandDispatcher";
import type { CommandIssue, CommandResult } from "@/command/DirectorCommand";
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

/** AI 工具定义:能力契约 + 描述的直接映射,Monet agent 工具组由它注册。 */
export interface AgentToolSchema {
    readonly name: string;
    readonly description: string;
    readonly kind: "command" | "query";
    readonly permissions: readonly string[];
    readonly appliesWhen: string;
    readonly inputSchema: AgentToolInputSchema;
}

/** Agent 单次工具调用：invocationId 是幂等键，重试同一写调用不会重复写入场景。 */
export interface AgentToolInvocation {
    readonly invocationId: string;
    readonly toolName: string;
    readonly payload: unknown;
}

export interface AgentToolFailure {
    readonly code: string;
    readonly issues: readonly string[];
    readonly issueDetails: readonly CommandIssue[];
}

export type AgentToolInvocationResult =
    | {
          readonly invocationId: string;
          readonly toolName: string;
          readonly ok: true;
          readonly value: unknown;
      }
    | {
          readonly invocationId: string;
          readonly toolName: string;
          readonly ok: false;
          readonly error: AgentToolFailure;
      };

export interface AgentBridgeOptions {
    /** Monet 当前决策为全开；宿主可在每实例构造时传更小的授权集。 */
    readonly permissions?: readonly string[];
}

/** 异步产物的默认对账等待上限:截图同步帧内取样,毫秒级即回;超时即视为管线异常。 */
const DEFAULT_CAPTURE_TIMEOUT_MS = 5_000;
const MAX_CACHED_INVOCATIONS = 128;
const LOG_PREFIX = "[AgentBridge]";
const AGENT_RUNTIME_ERROR = "agent-runtime-error";

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

function resultFor(invocation: AgentToolInvocation, result: CommandResult | QueryResult): AgentToolInvocationResult {
    if (!result.ok) {
        return {
            invocationId: invocation.invocationId,
            toolName: invocation.toolName,
            ok: false,
            error: {
                code: result.error,
                issues: result.issues ?? [],
                issueDetails: result.issueDetails ?? [],
            },
        };
    }
    return {
        invocationId: invocation.invocationId,
        toolName: invocation.toolName,
        ok: true,
        value: "value" in result ? result.value : null,
    };
}

/** 每桌调用账本：只缓存写调用，保证宿主/模型网络重试不重复落地命令。 */
class AgentInvocationLedger {
    private readonly results = new Map<string, AgentToolInvocationResult>();

    get(invocationId: string): AgentToolInvocationResult | undefined {
        return this.results.get(invocationId);
    }

    record(result: AgentToolInvocationResult): void {
        this.results.set(result.invocationId, result);
        if (this.results.size <= MAX_CACHED_INVOCATIONS) return;
        const oldestInvocationId = this.results.keys().next().value;
        if (typeof oldestInvocationId === "string") this.results.delete(oldestInvocationId);
    }
}

/**
 * AI 接入桥(每导演台实例一座)。
 *
 * 边界:功能模块不知道 AI 的存在；桥只经 capability、dispatcher 与只读查询接入。
 * 写入继续走 CommandDispatcher，查询同样经过权限与 payload 契约闸门。
 */
export class AgentBridge {
    private readonly ledger = new AgentInvocationLedger();
    private readonly permissions: readonly string[];

    constructor(
        private readonly stores: DirectorDeskStores,
        options: AgentBridgeOptions = {},
    ) {
        this.permissions = options.permissions ?? this.fullPermissions;
    }

    /** AI 工具组:schema 由契约直接派生,永不手写;描述缺失即登记漂移。 */
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

    /** 宿主交给该桥的实际授权集；缺省采用当前全开产品决策。 */
    get grantedPermissions(): readonly string[] {
        return this.permissions;
    }

    /** 全开权限集(Monet 已决策 agent 默认全开);需要收窄时宿主在构造时注入。 */
    get fullPermissions(): readonly string[] {
        const granted = this.stores.dispatcher.listCapabilities().flatMap((c) => c.permissions);
        return granted.filter((permission, index) => granted.indexOf(permission) === index);
    }

    /** 工具调用唯一执行口：按 capability.kind 分发 query/command，并以 invocationId 幂等化写操作。 */
    invoke(invocation: AgentToolInvocation): AgentToolInvocationResult {
        const capability = this.stores.dispatcher.listCapabilities().find((item) => item.type === invocation.toolName);
        if (!capability) return this.unknownToolResult(invocation);
        const replayed = capability.kind === "command" ? this.ledger.get(invocation.invocationId) : undefined;
        if (replayed) return replayed;
        const result = this.execute(capability, invocation);
        if (capability.kind === "command") this.ledger.record(result);
        return result;
    }

    /** 等一帧截图产物按 requestId 就位;超时返回 null(管线异常,勿重试同 id)。 */
    awaitFrameCapture(requestId: string, timeoutMs?: number): Promise<CaptureMeta | null> {
        return this.awaitMeta(requestId, () => this.stores.ui.lastCaptureMeta, timeoutMs);
    }

    /** 等一段视频产物按 requestId 就位;超时返回 null(录制时长上限见 VIDEO_MAX_DURATION_SECONDS)。 */
    awaitVideoCapture(requestId: string, timeoutMs?: number): Promise<VideoMeta | null> {
        return this.awaitMeta(requestId, () => this.stores.ui.lastVideoMeta, timeoutMs);
    }

    private execute(capability: CommandCapability, invocation: AgentToolInvocation): AgentToolInvocationResult {
        try {
            const serialized = { type: invocation.toolName, payload: invocation.payload };
            const options = { permissions: this.permissions };
            const result =
                capability.kind === "command"
                    ? this.stores.dispatcher.dispatch(serialized, this.stores, options)
                    : this.stores.dispatcher.query(serialized, this.stores, options);
            return resultFor(invocation, result);
        } catch {
            return {
                invocationId: invocation.invocationId,
                toolName: invocation.toolName,
                ok: false,
                error: { code: AGENT_RUNTIME_ERROR, issues: [], issueDetails: [] },
            };
        }
    }

    private unknownToolResult(invocation: AgentToolInvocation): AgentToolInvocationResult {
        return {
            invocationId: invocation.invocationId,
            toolName: invocation.toolName,
            ok: false,
            error: { code: "unknown-command", issues: [`未知工具: ${invocation.toolName}`], issueDetails: [] },
        };
    }

    /** requestId 对账等待:capture 命令 fire-and-forget 的配套读侧(frame/video 共用,Rule of Two)。 */
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
