import { makeAutoObservable } from "mobx";

/** 选中 Store(纯 UI 态,不进命令层):只存 id 列表;主选 = 最后点选者,gizmo 只挂主选 */
export class SelectionStore {
    selectedIds: string[] = [];

    constructor() {
        makeAutoObservable(this);
    }

    /** additive(cmd/ctrl 点选)切换成员;否则替换为单选 */
    select(id: string, options?: { additive?: boolean }): void {
        if (!options?.additive) {
            this.selectedIds = [id];
            return;
        }
        this.selectedIds = this.selectedIds.includes(id)
            ? this.selectedIds.filter((existing) => existing !== id)
            : [...this.selectedIds, id];
    }

    clear(): void {
        this.selectedIds = [];
    }

    remove(id: string): void {
        if (!this.selectedIds.includes(id)) return;
        this.selectedIds = this.selectedIds.filter((selectedId) => selectedId !== id);
    }

    isSelected(id: string): boolean {
        return this.selectedIds.includes(id);
    }

    get primaryId(): string | null {
        return this.selectedIds.at(-1) ?? null;
    }
}
