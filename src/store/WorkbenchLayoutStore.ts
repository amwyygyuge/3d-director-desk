import { makeAutoObservable } from "mobx";

import type { RailSection } from "../workspace/railSections";

/**
 * 工作台壳层聚合(方案 D「液态悬浮界面」的状态边界)。
 *
 * 职责只有一件事:悬浮壳层的空间编排与显隐。它刻意不碰 gizmo、加载反馈、截图产物
 * (那些留在 UiStore),也不碰任何场景数据——壳层状态纯 UI 态,不入文档、不进撤销栈。
 *
 * 每 DirectorDesk 实例一套(实例化纪律);Monet 画布可同时挂多个导演台节点。
 */
export class WorkbenchLayoutStore {
    /** 左栏当前钉住的二级面板;null = 只剩图标条(hover 展开标签是纯 CSS,不占状态) */
    railSection: RailSection | null = null;
    /** 底部时间线由把手钉住展开;hover 意图展开属组件局部瞬时态,不入本聚合 */
    timelinePinned = false;
    /** 运镜轨迹预览开关:本桌局部辅助物,不入文档 */
    motionPathPreviewVisible: boolean;
    /** 全屏预览:悬浮壳层与场景辅助物一并隐去,Program 输出接管视口相机 */
    presentationMode = false;

    constructor(options?: { readonly motionPathPreviewVisible?: boolean | undefined }) {
        this.motionPathPreviewVisible = options?.motionPathPreviewVisible ?? false;
        makeAutoObservable(this);
    }

    /**
     * 编辑态可见性:悬浮壳层(顶部药丸/左栏/检查器/时间线)与场景辅助物
     * (机位标记、灯光标记、运镜轨迹)共用同一开关——全屏预览时画面必须只剩成片内容。
     */
    get authoringVisible(): boolean {
        return !this.presentationMode;
    }

    /** 运镜轨迹预览的最终可见性:局部开关 ∧ 编辑态 */
    get motionPathPreviewActive(): boolean {
        return this.motionPathPreviewVisible && this.authoringVisible;
    }

    /** 再次点击同一图标收起抽屉(DCC 惯例的开合语义) */
    toggleRailSection(section: RailSection): void {
        this.railSection = this.railSection === section ? null : section;
    }

    toggleTimelinePin(): void {
        this.timelinePinned = !this.timelinePinned;
    }

    setMotionPathPreviewVisible(visible: boolean): void {
        this.motionPathPreviewVisible = visible;
    }

    /** 仅供 presentation 命令调用:UI 与 AI 都经命令层进出预览,不直写本字段 */
    setPresentationMode(active: boolean): void {
        this.presentationMode = active;
        if (active) this.railSection = null;
    }
}
