import { makeAutoObservable } from "mobx";

import { TimelineViewport } from "@/authoring/TimelineViewport";
import type { ShotSize } from "@/camera/CameraShot";
import type { WorkbenchLayoutStore } from "@/store/WorkbenchLayoutStore";

/**
 * 视口模式:导演视角自由摆位;镜头视角跟随时间轴输出,视口手势写的是镜头关键帧。
 * 掌镜(静态机位)是 CameraStore.activeShotId 的既有语义,不在本枚举内重复表达。
 */
export const VIEW_MODE = {
    DIRECTOR: "director",
    LENS: "lens",
} as const;
export type ViewMode = (typeof VIEW_MODE)[keyof typeof VIEW_MODE];

export interface MotionAuthoringStoreOptions {
    readonly pathVisible?: boolean | undefined;
}

/**
 * 运镜编排态(每桌一套,纯 UI 态:不入工程文档、不进撤销栈)。
 *
 * 与 WorkbenchLayoutStore 的边界:那边管壳层的空间编排(左栏/时间线/预览),
 * 这边管「作者正在编排哪段运镜」——视口模式、预览片段、选中关键帧、轨迹显隐、吸附与时间轴窗口。
 */
export class MotionAuthoringStore {
    viewMode: ViewMode = VIEW_MODE.DIRECTOR;
    /** 尚未切入 Program 的片段也要能预览:采样器据此回退取景 */
    previewClipId: string | null = null;
    selectedClipId: string | null = null;
    selectedKeyId: string | null = null;
    /** 轨迹辅助物开关:与壳层显隐解耦,掌镜/镜头视角下仍可见;导演台是编排工具,默认开 */
    pathVisible: boolean;
    snapEnabled = true;
    /**
     * 走位草绘模式(钉住式):开启时视口左键归绘制,导航让位给右键/中键/滚轮。
     * 不做弹簧键——WASD+Space/Shift 已被飞行导航持续占用,任何裸字母弹簧键都会在飞行中误触发。
     */
    draftActive = false;
    /** 选中的走位关键帧(轨道 id + 帧 id):把手渲染、Delete 归属与检查器都读它 */
    selectedWalkTrackId: string | null = null;
    selectedWalkKeyframeId: string | null = null;
    /**
     * 被摄目标(场景对象 id):运镜预设的取景中心与新片段的跟拍绑定共用它。
     * 它不能从「当前选中」推导——选中机位时右栏才显示运镜,此时选中的就不可能是模型。
     */
    subjectId: string | null = null;
    /**
     * 落幅景别(运镜收尾时的构图):null = 保持机位当前构图。
     * 与 subjectId 同住编排态——面板开合是壳层行为,不该把作者的编排选择清零。
     */
    landingShotSize: ShotSize | null = null;
    /** null = 未缩放,窗口跟随工程时长;一旦作者缩放/平移即固化为显式窗口 */
    timelineViewport: TimelineViewport | null = null;

    constructor(
        private readonly layout: WorkbenchLayoutStore,
        options?: MotionAuthoringStoreOptions,
    ) {
        this.pathVisible = options?.pathVisible ?? true;
        makeAutoObservable<MotionAuthoringStore, "layout">(this, { layout: false });
    }

    /** 镜头视角只在编辑态成立:全屏预览本身就是成片接管,不再叠加编排语义。 */
    get lensViewActive(): boolean {
        return this.viewMode === VIEW_MODE.LENS && !this.layout.presentationMode;
    }

    /** 运镜期视口相机由采样器接管的判据:全屏预览或镜头视角。 */
    get programOutputActive(): boolean {
        return this.layout.presentationMode || this.lensViewActive;
    }

    /** 轨迹辅助物最终可见性:成片画面里不该出现编排辅助物,其余情形跟随开关。 */
    get pathHelpersVisible(): boolean {
        return this.pathVisible && !this.layout.presentationMode;
    }

    setViewMode(mode: ViewMode): void {
        this.viewMode = mode;
        if (mode === VIEW_MODE.DIRECTOR) this.previewClipId = null;
    }

    setPreviewClip(clipId: string | null): void {
        this.previewClipId = clipId;
    }

    selectClip(clipId: string | null): void {
        this.selectedClipId = clipId;
        this.selectedKeyId = null;
    }

    selectKey(clipId: string, keyId: string | null): void {
        this.selectedClipId = clipId;
        this.selectedKeyId = keyId;
    }

    /** 片段被删除后收敛编排态,避免 UI 留下失效引用。 */
    forgetClip(clipId: string): void {
        this.previewClipId = this.previewClipId === clipId ? null : this.previewClipId;
        if (this.selectedClipId !== clipId) return;
        this.selectedClipId = null;
        this.selectedKeyId = null;
    }

    setPathVisible(visible: boolean): void {
        this.pathVisible = visible;
    }

    setSnapEnabled(enabled: boolean): void {
        this.snapEnabled = enabled;
    }

    setDraftActive(active: boolean): void {
        this.draftActive = active;
    }
    /** 选中整条走位轨:右栏编辑轨级策略或删除轨;关键帧保持未选，避免 Delete 误删一枚帧。 */
    selectWalkTrack(trackId: string | null): void {
        this.selectWalkKey(trackId, null);
    }

    selectWalkKey(trackId: string | null, keyframeId: string | null): void {
        this.selectedWalkTrackId = trackId;
        this.selectedWalkKeyframeId = keyframeId;
    }

    /** 轨道被整体重画/清空后收敛选中态,避免把手指向已消失的帧。 */
    forgetWalkTrack(trackId: string): void {
        if (this.selectedWalkTrackId !== trackId) return;
        this.selectWalkKey(null, null);
    }

    setSubject(objectId: string | null): void {
        this.subjectId = objectId;
    }

    setLandingShotSize(shotSize: ShotSize | null): void {
        this.landingShotSize = shotSize;
    }

    setTimelineViewport(viewport: TimelineViewport): void {
        this.timelineViewport = viewport;
    }

    /** 时间轴窗口的唯一解析口:未缩放时铺满时长,已缩放时钳进时长内。 */
    timelineViewportFor(durationSeconds: number): TimelineViewport {
        return (this.timelineViewport ?? TimelineViewport.full(durationSeconds)).clampedTo(durationSeconds);
    }
}
