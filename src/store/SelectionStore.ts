import { makeAutoObservable } from "mobx";

/** 选中 Store:只存 id 集合;选中态判定走细粒度计算,避免整树订阅 */
export class SelectionStore {
    selectedId: string | null = null;

    constructor() {
        makeAutoObservable(this);
    }

    select(id: string | null): void {
        this.selectedId = id;
    }

    isSelected(id: string): boolean {
        return this.selectedId === id;
    }
}
