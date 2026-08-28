import type { DirectorCommand, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandResult } from "./DirectorCommand";
import type { CommandHistory } from "./CommandHistory";

type CommandFactory = (payload: never) => DirectorCommand;

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

    dispatch(raw: SerializedCommand, ctx: DirectorContext, options?: { record?: boolean }): CommandResult {
        const factory = this.factories.get(raw.type);
        if (!factory) return { ok: false, error: `unknown-command: ${raw.type}` };

        const command = factory(raw.payload as never);
        const issues = command.validate(ctx);
        if (issues.length > 0) return { ok: false, error: "validation-failed", issues };

        // invert 必须在 execute 前以 pre-state 求逆(move 的旧 transform、remove 的实体快照)
        const inverse = options?.record === false ? null : (command.invert?.(ctx) ?? null);
        command.execute(ctx);
        if (inverse && inverse.length > 0) {
            this.history?.record({ label: raw.type, undo: inverse, redo: [raw] });
        }
        return { ok: true };
    }

    listCommands(): readonly string[] {
        return [...this.factories.keys()];
    }
}
