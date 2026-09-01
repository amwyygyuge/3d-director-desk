import { makeAutoObservable } from "mobx";

import type { CommandDispatcher } from "@/command/CommandDispatcher";
import type { CommandResult, DirectorContext, SerializedCommand } from "@/command/DirectorCommand";

/** 一条可逆历史记录:undo/redo 互为逆序列 */
export interface HistoryEntry {
    readonly label: string;
    readonly undo: readonly SerializedCommand[];
    readonly redo: readonly SerializedCommand[];
}

const HISTORY_ERROR = {
    EMPTY: "history-empty",
    DISPATCHER_UNAVAILABLE: "history-dispatcher-unavailable",
} as const;

/**
 * 命令历史(撤销/重做):命令层红利的兑现。
 *
 * 设计:逆命令法而非快照法——命令集合小且每个命令都能精确求逆
 * (place↔remove、move↔旧 transform 回放、mount↔unmount),无快照内存负担。
 * Dispatcher 在 execute 前(pre-state)调 command.invert(ctx) 求逆,成功后入栈;
 * undo/redo 本身经 dispatcher 回放(record:false),与普通命令同走校验链。
 */
export class CommandHistory {
    private dispatcher: CommandDispatcher | null = null;
    private readonly undoStack: HistoryEntry[] = [];
    private readonly redoStack: HistoryEntry[] = [];

    constructor() {
        makeAutoObservable<CommandHistory, "dispatcher">(this, { dispatcher: false });
    }

    /** 工厂期注入 dispatcher;undo/redo 回放经此,但不再入栈(record:false) */
    bindDispatcher(dispatcher: CommandDispatcher): void {
        this.dispatcher = dispatcher;
    }

    get canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    get canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    record(entry: HistoryEntry): void {
        this.undoStack.push(entry);
        this.redoStack.length = 0;
    }

    undo(ctx: DirectorContext): CommandResult {
        return this.replay(
            this.undoStack,
            this.redoStack,
            ctx,
            (entry) => entry.undo,
            (entry) => entry.redo,
        );
    }

    redo(ctx: DirectorContext): CommandResult {
        return this.replay(
            this.redoStack,
            this.undoStack,
            ctx,
            (entry) => entry.redo,
            (entry) => entry.undo,
        );
    }

    private replay(
        from: HistoryEntry[],
        to: HistoryEntry[],
        ctx: DirectorContext,
        commandsFor: (entry: HistoryEntry) => readonly SerializedCommand[],
        compensationFor: (entry: HistoryEntry) => readonly SerializedCommand[],
    ): CommandResult {
        const entry = from.at(-1);
        const dispatcher = this.dispatcher;
        if (!entry || !dispatcher) {
            return { ok: false, error: entry ? HISTORY_ERROR.DISPATCHER_UNAVAILABLE : HISTORY_ERROR.EMPTY };
        }

        for (const command of commandsFor(entry)) {
            const result = dispatcher.dispatch(command, ctx, { record: false });
            if (!result.ok) {
                this.compensate(compensationFor(entry), ctx, dispatcher);
                return result;
            }
        }
        from.pop();
        to.push(entry);
        return { ok: true };
    }

    private compensate(
        commands: readonly SerializedCommand[],
        ctx: DirectorContext,
        dispatcher: CommandDispatcher,
    ): void {
        for (const command of commands) dispatcher.dispatch(command, ctx, { record: false });
    }
}
