import { makeAutoObservable } from "mobx";

import type { LiveCameraPose } from "@/capture/CaptureService";
import type { VideoExportSource } from "@/capture/VideoExportSession";
/** gizmo 模式:三态查表,工具条与控制器共享 */
export const GIZMO_MODE = {
    TRANSLATE: "translate",
    ROTATE: "rotate",
    SCALE: "scale",
} as const;
export type GizmoMode = (typeof GIZMO_MODE)[keyof typeof GIZMO_MODE];
export type GizmoAxis = "x" | "y" | "z";
/** 最近一次截图的溯源元数据(agent 按 requestId 对账 AI 连发/重试产物归属)。 */
export interface CaptureMeta {
    readonly timeSeconds: number;
    readonly cameraPose: LiveCameraPose | null;
    readonly width: number;
    readonly height: number;
    readonly requestId: string;
}
/** 最近一次视频的溯源元数据(agent 按 requestId 对账 AI 连发/重试产物归属)。 */
export interface VideoMeta {
    readonly durationSeconds: number;
    readonly width: number;
    readonly height: number;
    readonly requestId: string;
    readonly source: VideoExportSource;
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
    /**
     * 应用级**成功**提示(常态语气);与 applicationNotice 分开,后者恒为错误语气。
     * 只用于「操作成了,但结果不在当前视野里」这类需要指路的反馈——
     * 看得见结果的操作不该弹提示(那是噪音)。
     */
    successNotice: string | null = null;
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
    lastVideoMeta: VideoMeta | null = null;
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
    /**
     * 变换手柄已挂载:此刻视口指针归 gizmo。
     * drei 的 TransformControls 直接监听 canvas 原生 pointerdown,不走 R3F 事件派发——
     * 两侧无法互相 stopPropagation,重叠的编辑辅助物只能按本判据主动让出指针。
     */
    get isGizmoEngaged(): boolean {
        return this.gizmoArmedId !== null;
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

    setLastVideo(url: string, meta: VideoMeta): void {
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
        this.successNotice = null;
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

    setSuccessNotice(message: string): void {
        if (this.disposed) return;
        this.successNotice = message;
    }

    clearSuccessNotice(): void {
        this.successNotice = null;
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

    /**
     * 忘掉某个对象的装载结局。
     *
     * 结局表只描述「当前挂载中的模型内容」:内容卸载(实体退场、url 换绑、画布重建)后旧结局必须一并作废。
     * 留着它就是一条谎言——同 id 的模型再次装载时 `entityLoadState` 会在真实骨架到位前就报 "loaded",
     * 动作挂载据此拿空壳 root 做骨骼预检,得到匹配率 0% 并被当成 bone-incompatible 拒下
     * (实测路径:导入 → 清空场景 → 再导入)。
     */
    forgetModelOutcome(requestId: string): void {
        this.modelOutcomes.delete(requestId);
    }

    /**
     * 工程替换的收束:退场对象的装载结局随之作废。
     * 留任对象的结局必须保留——它们的运行时未更换,清掉会让无骨骼模型永久停在 "loading"。
     */
    retainModelOutcomes(objectIds: Iterable<string>): void {
        const surviving = new Set(objectIds);
        for (const requestId of [...this.modelOutcomes.keys()]) {
            if (!surviving.has(requestId)) this.modelOutcomes.delete(requestId);
        }
    }
}
