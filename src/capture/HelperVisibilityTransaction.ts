import type { Object3D } from "three";

/** Runtime-only observation of one capture helper hide/restore transaction. */
export interface CaptureHelperLifecycle {
    readonly hiddenHelperCount: number;
    readonly hiddenPoseHelperCount: number;
    readonly helpersRestored: boolean;
}

/**
 * 采集期临时摘除辅助物并精确复位的运行时事务。
 *
 * 辅助物只在单次采集任务内不可见，避免 demand render 将中间态泄露给编辑视口。
 */
export class HelperVisibilityTransaction {
    private hiddenHelpers: Object3D[] = [];
    private hiddenPoseHelperCount = 0;
    private helpersRestored = false;

    hide(helpers: Iterable<Object3D>): void {
        const hiddenHelpers: Object3D[] = [];
        this.hiddenPoseHelperCount = 0;
        this.helpersRestored = false;
        for (const helper of helpers) {
            if (!helper.visible) continue;
            helper.visible = false;
            hiddenHelpers.push(helper);
            if (helper.userData.poseHelper === true) this.hiddenPoseHelperCount += 1;
        }
        this.hiddenHelpers = hiddenHelpers;
    }

    restore(): CaptureHelperLifecycle {
        for (const helper of this.hiddenHelpers) helper.visible = true;
        this.helpersRestored = this.hiddenHelpers.every((helper) => helper.visible);
        return Object.freeze({
            hiddenHelperCount: this.hiddenHelpers.length,
            hiddenPoseHelperCount: this.hiddenPoseHelperCount,
            helpersRestored: this.helpersRestored,
        });
    }
}
