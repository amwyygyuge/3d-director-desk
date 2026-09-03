import { makeAutoObservable } from "mobx";

import { TimelineSelection } from "@/authoring/TimelineSelection";

/**
 * 时间轴选中态的唯一持有者(每桌一套)。
 *
 * 边界:它只回答「时间轴上正被编辑的是谁」。三维视口里的场景对象选中仍归 SelectionStore,
 * 两者互斥由调用方在选中时显式清对方——本 store 不反向依赖场景。
 * 纯 UI 态:不入工程文档,不进撤销栈。
 */
export class TimelineSelectionStore {
    current: TimelineSelection = TimelineSelection.none();

    constructor() {
        makeAutoObservable(this);
    }

    get hasSelection(): boolean {
        return !this.current.isEmpty;
    }

    select(selection: TimelineSelection): void {
        if (this.current.equals(selection)) return;
        this.current = selection;
    }

    clear(): void {
        this.current = TimelineSelection.none();
    }

    /** 片段/轨道/关键帧被删除后收敛,避免把手与底栏指向已消失的实体 */
    forget(entityId: string): void {
        if (!this.current.references(entityId)) return;
        this.current = TimelineSelection.none();
    }
}
