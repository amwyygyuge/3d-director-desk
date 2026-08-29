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
    /** 应用级命令失败提示；宿主边界写入，展示层自行订阅和清除。 */
    applicationNotice: string | null = null;
    /** 飞行中(WASD 按住):DirectorDesk 据此把 frameloop 切 "always" */
    flying = false;
    /** 加载中资源:稳定对象请求 id → 进度 0~1(反馈体系;Map 字段自动可观察) */
    readonly loading = new Map<string, number>();
    /** 姿态选择仅是瞬时 UI 身份；不进入 SceneObject、历史或序列化。 */
    posePickingObjectId: string | null = null;
    posePickingBoneKey: string | null = null;
    private disposed = false;

    constructor() {
        makeAutoObservable<UiStore, "disposed">(this, { lastGizmoInteractionAt: false, disposed: false });
    }

    setGizmoMode(mode: GizmoMode): void {
        this.gizmoMode = mode;
    }
    /** 锁到指定轴;再次按同一轴恢复三轴自由 */
    toggleGizmoAxis(axis: GizmoAxis): void {
        const onlyThisActive = this.gizmoAxes[axis] && Object.values(this.gizmoAxes).filter(Boolean).length === 1;
        this.gizmoAxes = onlyThisActive ? ALL_AXES_FREE : { x: axis === "x", y: axis === "y", z: axis === "z" };
    }

    setPosePicking(objectId: string | null, boneKey: string | null): void {
        this.posePickingObjectId = objectId;
        this.posePickingBoneKey = boneKey;
    }

    noteGizmoInteraction(): void {
        this.lastGizmoInteractionAt = performance.now();
    }
    setLastCaptureUrl(url: string): void {
        if (this.disposed) {
            URL.revokeObjectURL(url);
        } else {
            if (this.lastCaptureUrl) URL.revokeObjectURL(this.lastCaptureUrl);
            this.lastCaptureUrl = url;
        }
    }
    /** 释放本 Store 持有的最终截图 URL；重复调用保持安全。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.lastCaptureUrl) URL.revokeObjectURL(this.lastCaptureUrl);
        this.lastCaptureUrl = null;
        this.loading.clear();
        this.applicationNotice = null;
        this.posePickingObjectId = null;
        this.posePickingBoneKey = null;
    }
    toggleHelp(): void {
        this.helpOpen = !this.helpOpen;
    }
    setFlying(flying: boolean): void {
        this.flying = flying;
    }

    setApplicationNotice(message: string): void {
        if (this.disposed) return;
        this.applicationNotice = message;
    }

    clearApplicationNotice(): void {
        this.applicationNotice = null;
    }

    reportLoading(requestId: string, progress: number): void {
        if (this.disposed) return;
        this.loading.set(requestId, progress);
    }

    clearLoading(requestId: string): void {
        this.loading.delete(requestId);
    }
}
