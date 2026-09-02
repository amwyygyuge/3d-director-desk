import { makeAutoObservable } from "mobx";

import { WORKSPACE_SECTION } from "@/workspace/workspaceSections";
import type { WorkspaceSection } from "@/workspace/workspaceSections";

/**
 * 渲染画质档:唯一影响 3D 输出质量的开关(截图与录制成片同样受它影响)。
 * high = 满设备像素比 + MSAA;performance = 限像素比 + 关 MSAA,换帧率。
 */
export const RENDER_QUALITY = { HIGH: "high", PERFORMANCE: "performance" } as const;
/** 参考地板尺寸合法域(米):宿主 prop 初始值与菜单滑杆共用同一围栏(裸数值入口纪律) */
export const GRID_SIZE = { DEFAULT_METERS: 12, MIN_METERS: 2, MAX_METERS: 100 } as const;

export function isGridSizeValid(value: number): boolean {
    return Number.isFinite(value) && value >= GRID_SIZE.MIN_METERS && value <= GRID_SIZE.MAX_METERS;
}
export type RenderQuality = (typeof RENDER_QUALITY)[keyof typeof RENDER_QUALITY];

/** 各档的画布参数(Canvas 直接消费,禁在组件里再拼一份) */
export const RENDER_QUALITY_PROFILES: Record<
    RenderQuality,
    { readonly label: string; readonly dpr: readonly [number, number]; readonly antialias: boolean }
> = {
    [RENDER_QUALITY.HIGH]: { label: "高画质", dpr: [1, 2], antialias: true },
    [RENDER_QUALITY.PERFORMANCE]: { label: "高性能", dpr: [1, 1.5], antialias: false },
};

/**
 * 工作台壳层聚合(方案 D「液态悬浮界面」的状态边界)。
 *
 * 职责:悬浮壳层的空间编排与显隐 + 演播室环境档(渲染画质/参考地板)。
 * 它刻意不碰 gizmo、加载反馈、截图产物(那些留在 UiStore),也不碰任何场景数据——
 * 壳层与演播室档位是纯 UI 态,不入文档、不进撤销栈。
 *
 * 每 DirectorDesk 实例一套(实例化纪律);Monet 画布可同时挂多个导演台节点。
 */
export class WorkbenchLayoutStore {
    /** 左栏当前分区:tab 互斥单选;纯 UI 态,不入文档与撤销栈 */
    activeSection: WorkspaceSection = WORKSPACE_SECTION.OUTLINE;
    /** 底部时间线展开态:点击把手开合;纯 UI 态,不入文档与撤销栈 */
    timelineExpanded = false;
    /** 全屏预览:悬浮壳层与场景辅助物一并隐去,Program 输出接管视口相机 */
    presentationMode = false;
    /** 渲染画质档:高性能 */
    renderQuality: RenderQuality = RENDER_QUALITY.PERFORMANCE;
    /** 参考地板边长(米):视口辅助物档位,不入文档不进撤销栈 */
    gridSizeMeters: number = GRID_SIZE.DEFAULT_METERS;

    constructor(init?: { gridSizeMeters?: number | undefined }) {
        makeAutoObservable(this);
        if (init?.gridSizeMeters === undefined) return;
        if (isGridSizeValid(init.gridSizeMeters)) {
            this.gridSizeMeters = init.gridSizeMeters;
        } else if (import.meta.env.DEV) {
            console.warn(
                `[WorkbenchLayoutStore] gridSizeMeters 非法(${String(init.gridSizeMeters)}),回落 ${String(GRID_SIZE.DEFAULT_METERS)}m`,
            );
        }
    }

    /**
     * 编辑态可见性:悬浮壳层(顶部药丸/左栏/检查器/时间线)与机位/灯光标记共用同一开关——
     * 全屏预览时画面必须只剩成片内容。运镜轨迹辅助物不在此列:它由 MotionAuthoringStore
     * 单独门控,因为「一边看成片画面、一边看自己的轨迹」正是运镜手感的来源。
     */
    get authoringVisible(): boolean {
        return !this.presentationMode;
    }

    /** 切换左栏分区:tab 单级直达,无中间态 */
    activateWorkspaceSection(section: WorkspaceSection): void {
        this.activeSection = section;
    }

    setRenderQuality(quality: RenderQuality): void {
        this.renderQuality = quality;
    }
    /** 地板尺寸设置的唯一写口;非法值静默拒绝(UI 滑杆已被 min/max 钳制,这里是 prop/未来 AI 路径的兜底) */
    setGridSizeMeters(value: number): void {
        if (!isGridSizeValid(value)) return;
        this.gridSizeMeters = value;
    }

    toggleTimelineExpanded(): void {
        this.timelineExpanded = !this.timelineExpanded;
    }

    /** 仅供 presentation 命令调用:UI 与 AI 都经命令层进出预览,不直写本字段 */
    setPresentationMode(active: boolean): void {
        this.presentationMode = active;
    }
}
