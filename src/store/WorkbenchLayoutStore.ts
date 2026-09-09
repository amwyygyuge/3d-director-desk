import { makeAutoObservable } from "mobx";

import { WORKSPACE_SECTION } from "@/workspace/workspaceSections";
import type { WorkspaceSection } from "@/workspace/workspaceSections";
// 壳层几何 token 的单一真相源在 theme:store 复用它,避免高度上下限在两处各写一份
import { CHROME, TIMELINE_HEIGHT } from "@/ui/shell/theme";

/** 壳层空间编排:编辑保留全套工具,审看片段仅留轻壳,演播交出完整画面。 */
export const SHELL_MODE = { AUTHORING: "authoring", REVIEW: "review", PRESENTATION: "presentation" } as const;
export type ShellMode = (typeof SHELL_MODE)[keyof typeof SHELL_MODE];

export function isShellMode(value: unknown): value is ShellMode {
    return Object.values(SHELL_MODE).includes(value as ShellMode);
}
/**
 * 工作台壳层聚合(方案 D「液态悬浮界面」的状态边界)。
 *
 * 职责:悬浮壳层的空间编排与显隐。
 * 它刻意不碰 gizmo、加载反馈、截图产物(那些留在 UiStore),不碰任何场景数据,
 * 也不碰演播室档位——参考地板/渲染画质/观测读数已归 StudioEnvironment,那些是随文档往返的工程数据。
 * 壳层编排本身是纯 UI 态,不入文档、不进撤销栈。
 *
 * 每 DirectorDesk 实例一套(实例化纪律);Monet 画布可同时挂多个导演台节点。
 */
export class WorkbenchLayoutStore {
    /** 左栏当前分区:tab 互斥单选;纯 UI 态,不入文档与撤销栈 */
    activeSection: WorkspaceSection = WORKSPACE_SECTION.OUTLINE;
    /** 左栏作者意图:review 强制仅留图标轨，退出后恢复此处选择。 */
    private navigatorCollapsedRequested = false;
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

    constructor() {
        makeAutoObservable(this);
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
    /** 左栏在 review 强制收起为图标轨，其他模式遵循作者显式选择。 */
    get navigatorCollapsed(): boolean {
        return this.shellMode === SHELL_MODE.REVIEW || this.navigatorCollapsedRequested;
    }

    /** 切换左栏分区:tab 单级直达,无中间态 */
    activateWorkspaceSection(section: WorkspaceSection): void {
        this.activeSection = section;
    }

    toggleTimelineExpanded(): void {
        this.timelineExpandedRequested = !this.timelineExpandedRequested;
    }
    toggleNavigatorCollapsed(): void {
        this.navigatorCollapsedRequested = !this.navigatorCollapsedRequested;
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
