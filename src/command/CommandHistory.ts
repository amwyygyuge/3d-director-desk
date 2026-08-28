import { makeAutoObservable } from "mobx";

import type { CommandDispatcher } from "./CommandDispatcher";
import type { DirectorContext, SerializedCommand } from "./DirectorCommand";

/** 一条可逆历史记录:undo/redo 互为逆序列 */
export interface HistoryEntry {
    readonly label: string;
    readonly undo: readonly SerializedCommand[];
    readonly redo: readonly SerializedCommand[];
}

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
        makeAutoObservable(this, { dispatcher: false } as never);
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

    undo(ctx: DirectorContext): void {
        this.replay(this.undoStack, this.redoStack, ctx);
    }

    redo(ctx: DirectorContext): void {
        this.replay(this.redoStack, this.undoStack, ctx);
    }

    private replay(from: HistoryEntry[], to: HistoryEntry[], ctx: DirectorContext): void {
        const entry = from.pop();
        if (!entry || !this.dispatcher) return;
        for (const command of from === this.undoStack ? entry.undo : entry.redo) {
            this.dispatcher.dispatch(command, ctx, { record: false });
        }
        to.push(entry);
    }
}
