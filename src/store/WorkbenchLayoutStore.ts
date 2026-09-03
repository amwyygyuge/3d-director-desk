import { makeAutoObservable } from "mobx";

import { WORKSPACE_SECTION } from "@/workspace/workspaceSections";
import type { WorkspaceSection } from "@/workspace/workspaceSections";
// 壳层几何 token 的单一真相源在 theme:store 复用它,避免高度上下限在两处各写一份
import { CHROME, TIMELINE_HEIGHT } from "@/ui/shell/theme";

/**
 * 渲染画质档:唯一影响 3D 输出质量的开关(截图与录制成片同样受它影响)。
 * high = 满设备像素比 + MSAA;performance = 限像素比 + 关 MSAA,换帧率。
 */
export const RENDER_QUALITY = { HIGH: "high", PERFORMANCE: "performance" } as const;
/** 壳层空间编排:编辑保留全套工具,审看片段仅留轻壳,演播交出完整画面。 */
export const SHELL_MODE = { AUTHORING: "authoring", REVIEW: "review", PRESENTATION: "presentation" } as const;
export type ShellMode = (typeof SHELL_MODE)[keyof typeof SHELL_MODE];

export function isShellMode(value: unknown): value is ShellMode {
    return Object.values(SHELL_MODE).includes(value as ShellMode);
}
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
    /** 底部时间线作者意图:review 时只派生迷你条,退出后才恢复这份开合选择。 */
    private timelineExpandedRequested = false;
    /** 壳层作者意图;实际 review 由运镜预览派生,避免预览命令跨域改壳层。 */
    private requestedShellMode: ShellMode = SHELL_MODE.AUTHORING;
    /** 运镜预览驱动的瞬态 review 条件,由 MotionAuthoringStore 在命令执行时同步。 */
    private motionPreviewActive = false;
    /** Tab 的临时全隐不改变 shellMode,恢复时精确回到原空间编排。 */
    private shellHidden = false;
    /**
     * 指针是否停在时间线控制台内:键盘归属的唯一判据。
     *
     * 时间轴键位(空格、方向键、S、I/O…)与视口飞行导航(WASD+Space/Shift)用的是同一批物理键。
     * 用「指针在谁身上」裁决归属是 DCC 的通行解法:同一时刻只有一方接管,不靠优先级碰运气。
     */
    isTimelinePointerOver = false;
    /** 作者拖拽出的展开高度(px):纯壳层几何,不入文档与撤销栈 */
    timelineExpandedHeightPx: number = TIMELINE_HEIGHT.DEFAULT_PX;
    /** 渲染画质档:高性能 */
    renderQuality: RenderQuality = RENDER_QUALITY.PERFORMANCE;
    /** 帧率读数按需展示:默认收起,不入文档与撤销栈 */
    frameRateVisible = false;
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

    /** 当前有效壳层态:成片输出优先,运镜预览次之,其余回到作者显式选择。 */
    get shellMode(): ShellMode {
        if (this.requestedShellMode === SHELL_MODE.PRESENTATION) return SHELL_MODE.PRESENTATION;
        return this.motionPreviewActive ? SHELL_MODE.REVIEW : this.requestedShellMode;
    }

    /** 显式选择供视图命令求逆;预览派生不会污染作者原先的空间编排。 */
    get explicitShellMode(): ShellMode {
        return this.requestedShellMode;
    }

    /** 成片输出是否接管视口:相机、辅助物和导出策略共用,不各自判断具体壳层态。 */
    get isProgramTakeover(): boolean {
        return this.shellMode === SHELL_MODE.PRESENTATION;
    }

    /** 编辑辅助物只在成片输出时退出,review 仍是可编辑的运镜上下文。 */
    get authoringVisible(): boolean {
        return !this.isProgramTakeover;
    }

    /** 悬浮壳层可见性:Tab 只影响壳层,不把 3D 编辑辅助物一起藏掉。 */
    get chromeVisible(): boolean {
        return this.authoringVisible && !this.shellHidden;
    }

    /** 时间线在 review 强制呈迷你条,但不抹掉作者此前的展开选择。 */
    get timelineExpanded(): boolean {
        return this.shellMode === SHELL_MODE.REVIEW ? false : this.timelineExpandedRequested;
    }

    /** 切换左栏分区:tab 单级直达,无中间态 */
    activateWorkspaceSection(section: WorkspaceSection): void {
        this.activeSection = section;
    }

    setRenderQuality(quality: RenderQuality): void {
        this.renderQuality = quality;
    }
    /** 帧率读数是调试观测信息,默认隐藏,仅由项目菜单显式切换。 */
    toggleFrameRateVisible(): void {
        this.frameRateVisible = !this.frameRateVisible;
    }
    /** 地板尺寸设置的唯一写口;非法值静默拒绝(UI 滑杆已被 min/max 钳制,这里是 prop/未来 AI 路径的兜底) */
    setGridSizeMeters(value: number): void {
        if (!isGridSizeValid(value)) return;
        this.gridSizeMeters = value;
    }

    toggleTimelineExpanded(): void {
        this.timelineExpandedRequested = !this.timelineExpandedRequested;
    }

    /** 由时间线控制台的指针进出事件写入;纯瞬时视图态,不入文档与撤销栈。 */
    setTimelinePointerOver(isOver: boolean): void {
        this.isTimelinePointerOver = isOver;
    }

    /** 壳层实际占用的时间线高度:收起/review 恒为迷你条,展开才用作者拖出的高度。 */
    get timelineChromeHeightPx(): number {
        return this.timelineExpanded ? this.timelineExpandedHeightPx : CHROME.timelineMiniPx;
    }

    /** 拖拽落点的唯一写口;越界静默钳位——拖拽手势本身已被围栏限制,这里兜宿主/AI 路径。 */
    setTimelineExpandedHeightPx(value: number): void {
        if (!Number.isFinite(value)) return;
        this.timelineExpandedHeightPx = Math.min(Math.max(value, TIMELINE_HEIGHT.MIN_PX), TIMELINE_HEIGHT.MAX_PX);
    }

    /** 仅供视图命令调用:壳层模式不允许组件直写。 */
    setShellMode(mode: ShellMode): void {
        this.requestedShellMode = mode;
    }

    /** 仅由运镜预览态同步:保持「预览即 review」是派生规则而非跨命令联动。 */
    setMotionPreviewActive(active: boolean): void {
        this.motionPreviewActive = active;
    }

    /** 仅供 Tab 视图命令调用:临时隐壳与 shellMode 正交。 */
    setShellHidden(hidden: boolean): void {
        this.shellHidden = hidden;
    }

    get isShellHidden(): boolean {
        return this.shellHidden;
    }
}
