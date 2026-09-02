import type { CommandIssue, DirectorCommand, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";
import type { CommandResult } from "@/command/DirectorCommand";
import type { CommandHistory } from "@/command/CommandHistory";
import type { PayloadContract } from "@/command/PayloadContract";
import { checkPayloadContract } from "@/command/PayloadContract";

type CommandFactory = (payload: never) => DirectorCommand;
type QueryFactory = (payload: never) => DirectorQuery;

export interface CommandCapability {
    readonly type: string;
    readonly version: "1";
    readonly kind: "command" | "query";
    readonly permissions: readonly string[];
    readonly appliesWhen: string;
    /** payload 契约:dispatch 外层结构校验 + AI tool schema 派生的单一真相源(债 D1) */
    readonly payload: PayloadContract;
}
export interface DispatchOptions {
    /** undo 回放传 false 防自递归 */
    readonly record?: boolean;
    /** 调用方持有的权限集;缺省(undefined)= 跳过检查(UI 同进程路径),显式传入(含空数组)即强制 */
    readonly permissions?: readonly string[];
}

export interface DirectorQuery<P = unknown> {
    readonly type: string;
    readonly payload: P;
    validate(ctx: DirectorContext): readonly string[];
    /** 与命令一致的稳定结构化校验失败，供 AI/宿主按 path 重试。 */
    validateIssues?(ctx: DirectorContext): readonly CommandIssue[];
    execute(ctx: DirectorContext): unknown;
}

export type QueryResult = CommandResult & { readonly value?: unknown };

const COMMAND_ERROR = {
    MALFORMED_ENVELOPE: "malformed-command",
    UNKNOWN: "unknown-command",
    CONSTRUCTION_FAILED: "command-construction-failed",
    VALIDATION_FAILED: "validation-failed",
    EXECUTION_FAILED: "execution-failed",
    PAYLOAD_CONTRACT_VIOLATION: "payload-contract-violation",
    PERMISSION_DENIED: "permission-denied",
} as const;

const MALFORMED_ENVELOPE_ISSUE = "type must be a string and payload must be present";
const MALFORMED_PAYLOAD_ISSUE = "payload does not satisfy the command contract";

function readSerializedCommand(raw: unknown): SerializedCommand | null {
    try {
        if (
            typeof raw !== "object" ||
            raw === null ||
            Array.isArray(raw) ||
            !("type" in raw) ||
            typeof raw.type !== "string" ||
            !Object.hasOwn(raw, "payload")
        ) {
            return null;
        }
        const command = raw as SerializedCommand;
        return { type: command.type, payload: command.payload };
    } catch {
        return null;
    }
}

/**
 * 权限闸门:permissions 缺省放行(UI 同进程路径),显式传入即逐条核对 capability.permissions。
 * 违例走结构化 issue——权限是宿主配置问题,两态一致,不做 dev throw。
 */
function checkAccess(
    type: string,
    capability: CommandCapability | undefined,
    permissions: readonly string[] | undefined,
): CommandResult | null {
    if (permissions === undefined || !capability) return null;
    const missing = capability.permissions.filter((permission) => !permissions.includes(permission));
    if (missing.length === 0) return null;
    const message = `权限不足: ${type} 需要 ${missing.join(", ")}`;
    return {
        ok: false,
        error: COMMAND_ERROR.PERMISSION_DENIED,
        issues: [message],
        issueDetails: [{ code: COMMAND_ERROR.PERMISSION_DENIED, path: "permissions", message }],
    };
}

/**
 * 契约闸门(D1):未知字段/缺失必填/类型违例。
 * 开发期 throw——立刻暴露写错的调用点;生产期降级为结构化 issue 供 AI 按 path 重试。
 */
function checkContract(serialized: SerializedCommand, capability: CommandCapability | undefined): CommandResult | null {
    if (!capability) return null;
    const violations = checkPayloadContract(capability.payload, serialized.payload);
    if (violations.length === 0) return null;
    if (import.meta.env.DEV) {
        throw new Error(`[${serialized.type}] payload 契约违规: ${violations.map((v) => v.message).join("; ")}`);
    }
    return {
        ok: false,
        error: COMMAND_ERROR.PAYLOAD_CONTRACT_VIOLATION,
        issues: violations.map((v) => v.message),
        issueDetails: violations.map((v) => ({
            code: COMMAND_ERROR.PAYLOAD_CONTRACT_VIOLATION,
            path: v.path,
            message: v.message,
        })),
    };
}

/**
 * 命令分发器(注册表):type 字符串 → 命令工厂。
 * AI 工具的 tool schema 由 listCapabilities 派生,保证「AI 可调」与「UI 已用」单一真相源。
 */
export class CommandDispatcher {
    private readonly factories = new Map<string, CommandFactory>();
    private readonly queryFactories = new Map<string, QueryFactory>();
    private readonly capabilities = new Map<string, CommandCapability>();
    private history: CommandHistory | null = null;

    /** 历史栈后绑定(工厂期 CommandHistory 先建、再回绑),undo 回放用 record:false 防自递归 */
    attachHistory(history: CommandHistory): void {
        this.history = history;
    }

    register(commandType: string, factory: CommandFactory, capability: CommandCapability): void {
        if (this.factories.has(commandType) || this.queryFactories.has(commandType)) {
            throw new Error(`CommandDispatcher: duplicate command type "${commandType}"`);
        }
        this.factories.set(commandType, factory);
        this.capabilities.set(commandType, capability);
    }

    registerQuery(queryType: string, factory: QueryFactory, capability: CommandCapability): void {
        if (this.factories.has(queryType) || this.queryFactories.has(queryType)) {
            throw new Error(`CommandDispatcher: duplicate command type "${queryType}"`);
        }
        this.queryFactories.set(queryType, factory);
        this.capabilities.set(queryType, capability);
    }

    dispatch(raw: unknown, ctx: DirectorContext, options?: DispatchOptions): CommandResult {
        const serialized = readSerializedCommand(raw);
        if (!serialized) {
            return { ok: false, error: COMMAND_ERROR.MALFORMED_ENVELOPE, issues: [MALFORMED_ENVELOPE_ISSUE] };
        }
        const factory = this.factories.get(serialized.type);
        if (!factory) return { ok: false, error: `${COMMAND_ERROR.UNKNOWN}: ${serialized.type}` };
        const denied = checkAccess(serialized.type, this.capabilities.get(serialized.type), options?.permissions);
        if (denied) return denied;
        const contractFailure = checkContract(serialized, this.capabilities.get(serialized.type));
        if (contractFailure) return contractFailure;

        try {
            const command = factory(serialized.payload as never);
            try {
                const details = command.validateIssues?.(ctx);
                const issues = details ? details.map((issue) => issue.message) : command.validate(ctx);
                if (issues.length > 0) {
                    return {
                        ok: false,
                        error: COMMAND_ERROR.VALIDATION_FAILED,
                        issues,
                        ...(details ? { issueDetails: details } : {}),
                    };
                }
            } catch {
                return { ok: false, error: COMMAND_ERROR.VALIDATION_FAILED, issues: [MALFORMED_PAYLOAD_ISSUE] };
            }
            try {
                const inverse = options?.record === false ? null : (command.invert?.(ctx) ?? null);
                command.execute(ctx);
                if (inverse && inverse.length > 0) {
                    this.history?.record({ label: serialized.type, undo: inverse, redo: [serialized] });
                }
                return { ok: true };
            } catch {
                return { ok: false, error: COMMAND_ERROR.EXECUTION_FAILED };
            }
        } catch {
            return { ok: false, error: COMMAND_ERROR.CONSTRUCTION_FAILED, issues: [MALFORMED_PAYLOAD_ISSUE] };
        }
    }
    query(raw: unknown, ctx: DirectorContext, options?: DispatchOptions): QueryResult {
        const serialized = readSerializedCommand(raw);
        if (!serialized) {
            return { ok: false, error: COMMAND_ERROR.MALFORMED_ENVELOPE, issues: [MALFORMED_ENVELOPE_ISSUE] };
        }
        const factory = this.queryFactories.get(serialized.type);
        if (!factory) return { ok: false, error: `${COMMAND_ERROR.UNKNOWN}: ${serialized.type}` };
        const denied = checkAccess(serialized.type, this.capabilities.get(serialized.type), options?.permissions);
        if (denied) return denied;
        const contractFailure = checkContract(serialized, this.capabilities.get(serialized.type));
        if (contractFailure) return contractFailure;
        try {
            const query = factory(serialized.payload as never);
            const details = query.validateIssues?.(ctx);
            const issues = details ? details.map((issue) => issue.message) : query.validate(ctx);
            if (issues.length > 0) {
                return {
                    ok: false,
                    error: COMMAND_ERROR.VALIDATION_FAILED,
                    issues,
                    ...(details ? { issueDetails: details } : {}),
                };
            }
            return { ok: true, value: query.execute(ctx) };
        } catch {
            return { ok: false, error: COMMAND_ERROR.CONSTRUCTION_FAILED, issues: [MALFORMED_PAYLOAD_ISSUE] };
        }
    }

    listCommands(): readonly string[] {
        return [...this.factories.keys()];
    }

    listCapabilities(): readonly CommandCapability[] {
        return [...this.capabilities.values()];
    }
}
