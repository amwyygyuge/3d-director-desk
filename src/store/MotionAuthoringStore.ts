import { makeAutoObservable } from "mobx";

import { TimelineViewport } from "@/authoring/TimelineViewport";
import { DEFAULT_PRESET_DURATION_SECONDS } from "@/authoring/MotionPresetCompiler";
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
 * 这边管「作者正在编排哪段运镜」——视口模式、预览片段、轨迹显隐、吸附与时间轴窗口;
 * 「时间轴上选中的是谁」归 TimelineSelectionStore,不在这里留第二份。
 */
export class MotionAuthoringStore {
    viewMode: ViewMode = VIEW_MODE.DIRECTOR;
    /** 尚未切入 Program 的片段也要能预览:采样器据此回退取景 */
    previewClipId: string | null = null;
    /** 轨迹辅助物开关:与壳层显隐解耦,掌镜/镜头视角下仍可见;导演台是编排工具,默认开 */
    pathVisible: boolean;
    /**
     * 跟拍世界扫掠路径仅供排查结果:作者日常编辑看相对主体的构图,故默认关闭。
     * 由顶栏命令开关,不与通用编排轨迹显隐混用。
     */
    sweepPathVisible = false;
    snapEnabled = true;
    /**
     * 走位草绘模式(钉住式):开启时视口左键归绘制,导航让位给右键/中键/滚轮。
     * 不做弹簧键——WASD+Space/Shift 已被飞行导航持续占用,任何裸字母弹簧键都会在飞行中误触发。
     */
    draftActive = false;

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
    /** 预设时长与目标/落幅同住编排态——面板开合不该把作者的选择清零。 */
    presetDurationSeconds = DEFAULT_PRESET_DURATION_SECONDS;
    /** null = 未缩放,窗口跟随工程时长;一旦作者缩放/平移即固化为显式窗口 */
    timelineViewport: TimelineViewport | null = null;

    constructor(
        private readonly layout: WorkbenchLayoutStore,
        options?: MotionAuthoringStoreOptions,
    ) {
        this.pathVisible = options?.pathVisible ?? true;
        makeAutoObservable<MotionAuthoringStore, "layout">(this, { layout: false });
    }

    /** 镜头视角只在非成片输出态成立:成片接管时不再叠加编排语义。 */
    get lensViewActive(): boolean {
        return this.viewMode === VIEW_MODE.LENS && !this.layout.isProgramTakeover;
    }

    /** 运镜期视口相机由成片输出或镜头视角接管。 */
    get programOutputActive(): boolean {
        return this.layout.isProgramTakeover || this.lensViewActive;
    }

    /** 轨迹辅助物不进入成片输出,review 仍保留作者的编排上下文。 */
    get pathHelpersVisible(): boolean {
        return this.pathVisible && !this.layout.isProgramTakeover;
    }

    setViewMode(mode: ViewMode): void {
        this.viewMode = mode;
        if (mode === VIEW_MODE.DIRECTOR) this.setPreviewClip(null);
    }

    setPreviewClip(clipId: string | null): void {
        this.previewClipId = clipId;
        this.layout.setMotionPreviewActive(clipId !== null);
    }

    /** 片段被删除后收敛预览态,避免采样器指向已消失的片段;选中态的收敛归 TimelineSelectionStore。 */
    forgetClip(clipId: string): void {
        if (this.previewClipId !== clipId) return;
        this.previewClipId = null;
    }

    setPathVisible(visible: boolean): void {
        this.pathVisible = visible;
    }

    setSweepPathVisible(visible: boolean): void {
        this.sweepPathVisible = visible;
    }

    setSnapEnabled(enabled: boolean): void {
        this.snapEnabled = enabled;
    }

    setDraftActive(active: boolean): void {
        this.draftActive = active;
    }

    setSubject(objectId: string | null): void {
        this.subjectId = objectId;
    }

    setLandingShotSize(shotSize: ShotSize | null): void {
        this.landingShotSize = shotSize;
    }

    setPresetDurationSeconds(seconds: number): void {
        this.presetDurationSeconds = seconds;
    }

    setTimelineViewport(viewport: TimelineViewport): void {
        this.timelineViewport = viewport;
    }

    /** 时间轴窗口的唯一解析口:未缩放时铺满时长,已缩放时钳进时长内。 */
    timelineViewportFor(durationSeconds: number): TimelineViewport {
        return (this.timelineViewport ?? TimelineViewport.full(durationSeconds)).clampedTo(durationSeconds);
    }
}
