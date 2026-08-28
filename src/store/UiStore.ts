import { makeAutoObservable } from "mobx";

/** gizmo 模式:三态查表,工具条与控制器共享 */
export const GIZMO_MODE = {
    TRANSLATE: "translate",
    ROTATE: "rotate",
    SCALE: "scale",
} as const;
export type GizmoMode = (typeof GIZMO_MODE)[keyof typeof GIZMO_MODE];
export type GizmoAxis = "x" | "y" | "z";
const ALL_AXES_FREE: Record<GizmoAxis, boolean> = { x: true, y: true, z: true };

/**
 * gizmo 交互守卫窗:点击 gizmo 对 R3F 射线而言是"空点",
 * Canvas onPointerMissed 会误触发取消选中——用时间戳窗口隔开拖拽与点空。
 */
export const GIZMO_CLICK_GUARD_MS = 150;

/**
 * UI 态 Store:gizmo 模式等纯界面状态。
 * lastGizmoInteractionAt 是事件守卫时间戳,排除出 observable(高频写,无人订阅)。
 */
export class UiStore {
    gizmoMode: GizmoMode = GIZMO_MODE.TRANSLATE;
    lastGizmoInteractionAt = 0;
    /** 轴约束:全 true = 自由;仅一轴 true = 锁定该轴(DCC 惯例 X/Y/Z 切换) */
    gizmoAxes: Record<GizmoAxis, boolean> = ALL_AXES_FREE;
    /** 最近一次截图预览;替换时回收旧 objectURL(内存纪律) */
    lastCaptureUrl: string | null = null;
    /** 快捷键速查浮层开关 */
    helpOpen = false;
    /** 飞行中(WASD 按住):DirectorDesk 据此把 frameloop 切 "always" */
    flying = false;
    /** 加载中资源:label → 进度 0~1(反馈体系;Map 字段自动可观察) */
    readonly loading = new Map<string, number>();

    constructor() {
        makeAutoObservable(this, { lastGizmoInteractionAt: false });
    }

    setGizmoMode(mode: GizmoMode): void {
        this.gizmoMode = mode;
    }
    /** 锁到指定轴;再次按同一轴恢复三轴自由 */
    toggleGizmoAxis(axis: GizmoAxis): void {
        const onlyThisActive = this.gizmoAxes[axis] && Object.values(this.gizmoAxes).filter(Boolean).length === 1;
        this.gizmoAxes = onlyThisActive ? ALL_AXES_FREE : { x: axis === "x", y: axis === "y", z: axis === "z" };
    }

    noteGizmoInteraction(): void {
        this.lastGizmoInteractionAt = performance.now();
    }
    setLastCaptureUrl(url: string): void {
        if (this.lastCaptureUrl) URL.revokeObjectURL(this.lastCaptureUrl);
        this.lastCaptureUrl = url;
    }
    toggleHelp(): void {
        this.helpOpen = !this.helpOpen;
    }
    setFlying(flying: boolean): void {
        this.flying = flying;
    }

    reportLoading(label: string, progress: number): void {
        this.loading.set(label, progress);
    }

    clearLoading(label: string): void {
        this.loading.delete(label);
    }
}
