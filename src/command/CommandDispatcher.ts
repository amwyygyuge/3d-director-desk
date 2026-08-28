import type { DirectorCommand, DirectorContext, SerializedCommand } from "./DirectorCommand";
import type { CommandResult } from "./DirectorCommand";

type CommandFactory = (payload: never) => DirectorCommand;

/**
 * 命令分发器(注册表):type 字符串 → 命令工厂。
 * AI 工具的 tool schema 由 listCommands 派生,保证「AI 可调」与「UI 已用」单一真相源。
 */
export class CommandDispatcher {
    private readonly factories = new Map<string, CommandFactory>();

    register(commandType: string, factory: CommandFactory): void {
        if (this.factories.has(commandType)) {
            throw new Error(`CommandDispatcher: duplicate command type "${commandType}"`);
        }
        this.factories.set(commandType, factory);
    }

    dispatch(raw: SerializedCommand, ctx: DirectorContext): CommandResult {
        const factory = this.factories.get(raw.type);
        if (!factory) return { ok: false, error: `unknown-command: ${raw.type}` };

        const command = factory(raw.payload as never);
        const issues = command.validate(ctx);
        if (issues.length > 0) return { ok: false, error: "validation-failed", issues };

        command.execute(ctx);
        return { ok: true };
    }

    listCommands(): readonly string[] {
        return [...this.factories.keys()];
    }
}
