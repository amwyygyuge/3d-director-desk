import type { DirectorCommand, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandResult } from "./DirectorCommand";
import type { CommandHistory } from "./CommandHistory";

type CommandFactory = (payload: never) => DirectorCommand;

const COMMAND_ERROR = {
    MALFORMED_ENVELOPE: "malformed-command",
    UNKNOWN: "unknown-command",
    CONSTRUCTION_FAILED: "command-construction-failed",
    VALIDATION_FAILED: "validation-failed",
    EXECUTION_FAILED: "execution-failed",
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
 * 命令分发器(注册表):type 字符串 → 命令工厂。
 * AI 工具的 tool schema 由 listCommands 派生,保证「AI 可调」与「UI 已用」单一真相源。
 */
export class CommandDispatcher {
    private readonly factories = new Map<string, CommandFactory>();
    private history: CommandHistory | null = null;

    /** 历史栈后绑定(工厂期 CommandHistory 先建、再回绑),undo 回放用 record:false 防自递归 */
    attachHistory(history: CommandHistory): void {
        this.history = history;
    }

    register(commandType: string, factory: CommandFactory): void {
        if (this.factories.has(commandType)) {
            throw new Error(`CommandDispatcher: duplicate command type "${commandType}"`);
        }
        this.factories.set(commandType, factory);
    }

    dispatch(raw: unknown, ctx: DirectorContext, options?: { record?: boolean }): CommandResult {
        const serialized = readSerializedCommand(raw);
        if (!serialized) {
            return { ok: false, error: COMMAND_ERROR.MALFORMED_ENVELOPE, issues: [MALFORMED_ENVELOPE_ISSUE] };
        }
        const factory = this.factories.get(serialized.type);
        if (!factory) return { ok: false, error: `${COMMAND_ERROR.UNKNOWN}: ${serialized.type}` };

        try {
            const command = factory(serialized.payload as never);
            try {
                const issues = command.validate(ctx);
                if (issues.length > 0) return { ok: false, error: COMMAND_ERROR.VALIDATION_FAILED, issues };
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

    listCommands(): readonly string[] {
        return [...this.factories.keys()];
    }
}
