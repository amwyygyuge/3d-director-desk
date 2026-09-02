import { makeAutoObservable } from "mobx";

import type { LiveCameraPose } from "@/capture/CaptureService";
/** gizmo 模式:三态查表,工具条与控制器共享 */
export const GIZMO_MODE = {
    TRANSLATE: "translate",
    ROTATE: "rotate",
    SCALE: "scale",
} as const;
export type GizmoMode = (typeof GIZMO_MODE)[keyof typeof GIZMO_MODE];
export type GizmoAxis = "x" | "y" | "z";
/** 最近一次截图的溯源元数据(agent 断言用:拍的哪一秒、什么机位、多大) */
export interface CaptureMeta {
    readonly timeSeconds: number;
    readonly cameraPose: LiveCameraPose | null;
    readonly width: number;
    readonly height: number;
}
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
    /** 变换 gizmo 的挂载授权:绑定对象身份;点击选中不再直接出坐标轴,G 进入/退出(瞬时 UI 态,不序列化) */
    gizmoArmedId: string | null = null;
    /** ⌘K 视角/元素导航面板开关(瞬时 UI 态,不序列化) */
    paletteOpen = false;
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
    /** 模型加载结局:loaded/failed;loading 管进度,本表管结果(agent 可断言装载成败) */
    readonly modelOutcomes = new Map<string, "loaded" | "failed">();
    /** 最近截图溯源元数据,与 lastCaptureUrl 同寿命 */
    lastCaptureMeta: CaptureMeta | null = null;
    /** 最近视频产物;替换时回收旧 objectURL(同截图纪律) */
    lastVideoUrl: string | null = null;
    /** 视频录制中(命令层在录制起止写入;工具条据此切换 录制/停止 按钮) */
    videoRecording = false;
    lastVideoMeta: { readonly durationSeconds: number; readonly width: number; readonly height: number } | null = null;
    /** 姿态选择仅是瞬时 UI 身份；不进入 SceneObject、历史或序列化。 */
    posePickingObjectId: string | null = null;
    posePickingBoneKey: string | null = null;
    /** 右栏检查器各上下文类型的激活 tab(按类型记忆;瞬时 UI 态,不序列化) */
    readonly inspectorTabs = new Map<string, string>();
    private disposed = false;

    constructor() {
        makeAutoObservable<UiStore, "disposed">(this, { lastGizmoInteractionAt: false, disposed: false });
    }

    setGizmoMode(mode: GizmoMode): void {
        this.gizmoMode = mode;
    }
    armGizmo(id: string): void {
        this.gizmoArmedId = id;
    }
    disarmGizmo(): void {
        this.gizmoArmedId = null;
    }
    /** armed 派生(arm 绑定对象身份):快捷键 scope 裁决/gizmo 挂载/提示条三处共用,禁各写一份 === */
    isGizmoArmed(id: string | null): boolean {
        return id !== null && this.gizmoArmedId === id;
    }
    setPaletteOpen(open: boolean): void {
        this.paletteOpen = open;
    }
    /** 锁到指定轴;再次按同一轴恢复三轴自由 */
    toggleGizmoAxis(axis: GizmoAxis): void {
        const onlyThisActive = this.gizmoAxes[axis] && Object.values(this.gizmoAxes).filter(Boolean).length === 1;
        this.gizmoAxes = onlyThisActive ? ALL_AXES_FREE : { x: axis === "x", y: axis === "y", z: axis === "z" };
    }

    setPosePicking(objectId: string | null, boneKey: string | null): void {
        // 进入姿态拾取即解除变换:两个编辑模式不叠态,退出姿态后坐标轴不应无预期地回来
        if (objectId !== null) this.gizmoArmedId = null;
        this.posePickingObjectId = objectId;
        this.posePickingBoneKey = boneKey;
    }
    inspectorTabFor(kind: string): string | undefined {
        return this.inspectorTabs.get(kind);
    }

    setInspectorTab(kind: string, tabId: string): void {
        this.inspectorTabs.set(kind, tabId);
    }

    noteGizmoInteraction(): void {
        this.lastGizmoInteractionAt = performance.now();
    }
    setLastCapture(url: string, meta: CaptureMeta): void {
        if (this.disposed) {
            URL.revokeObjectURL(url);
        } else {
            if (this.lastCaptureUrl) URL.revokeObjectURL(this.lastCaptureUrl);
            this.lastCaptureUrl = url;
            this.lastCaptureMeta = meta;
        }
    }
    setVideoRecording(recording: boolean): void {
        this.videoRecording = recording;
    }

    setLastVideo(url: string, meta: { durationSeconds: number; width: number; height: number }): void {
        if (this.disposed) {
            URL.revokeObjectURL(url);
        } else {
            if (this.lastVideoUrl) URL.revokeObjectURL(this.lastVideoUrl);
            this.lastVideoUrl = url;
            this.lastVideoMeta = meta;
        }
    }
    /** 释放本 Store 持有的最终截图 URL；重复调用保持安全。 */
    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.lastCaptureUrl) URL.revokeObjectURL(this.lastCaptureUrl);
        this.lastCaptureUrl = null;
        this.lastCaptureMeta = null;
        if (this.lastVideoUrl) URL.revokeObjectURL(this.lastVideoUrl);
        this.lastVideoUrl = null;
        this.lastVideoMeta = null;
        this.loading.clear();
        this.modelOutcomes.clear();
        this.applicationNotice = null;
        this.posePickingObjectId = null;
        this.posePickingBoneKey = null;
        this.inspectorTabs.clear();
        this.gizmoArmedId = null;
        this.paletteOpen = false;
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
        // 新一次加载尝试清掉旧结局
        this.modelOutcomes.delete(requestId);
        this.loading.set(requestId, progress);
    }

    clearLoading(requestId: string): void {
        this.loading.delete(requestId);
    }
    reportModelOutcome(requestId: string, outcome: "loaded" | "failed"): void {
        if (this.disposed) return;
        this.modelOutcomes.set(requestId, outcome);
    }
}
