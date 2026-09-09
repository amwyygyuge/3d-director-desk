import { makeAutoObservable } from "mobx";

/**
 * 渲染画质档:唯一影响 3D 输出质量的开关(截图与录制成片同样受它影响)。
 * high = 满设备像素比 + MSAA;performance = 限像素比 + 关 MSAA,换帧率。
 */
export const RENDER_QUALITY = { HIGH: "high", PERFORMANCE: "performance" } as const;

export type RenderQuality = (typeof RENDER_QUALITY)[keyof typeof RENDER_QUALITY];

export function isRenderQuality(value: unknown): value is RenderQuality {
    return Object.values(RENDER_QUALITY).includes(value as RenderQuality);
}

/** 各档的画布参数(Canvas 直接消费,禁在组件里再拼一份) */
export const RENDER_QUALITY_PROFILES: Record<
    RenderQuality,
    { readonly label: string; readonly dpr: readonly [number, number]; readonly antialias: boolean }
> = {
    [RENDER_QUALITY.HIGH]: { label: "高画质", dpr: [1, 2], antialias: true },
    [RENDER_QUALITY.PERFORMANCE]: { label: "高性能", dpr: [1, 1.5], antialias: false },
};

/** 参考地板尺寸合法域(米):宿主 prop 初始值、菜单滑杆与命令校验共用同一围栏(裸数值入口纪律) */
export const GRID_SIZE = { DEFAULT_METERS: 12, MIN_METERS: 2, MAX_METERS: 100 } as const;

export function isGridSizeValid(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= GRID_SIZE.MIN_METERS &&
        value <= GRID_SIZE.MAX_METERS
    );
}

/** 演播室档位的可序列化形态(工程文档的 `studio` 通道)。 */
export interface StudioEnvironmentJSON {
    /** 参考地板边长(米) */
    readonly gridSizeMeters: number;
    /** 渲染画质档(高画质 / 高性能) */
    readonly renderQuality: RenderQuality;
    /** 视口右上角真实帧率读数的显隐 */
    readonly frameRateVisible: boolean;
    /** 成片安全框内的九宫格构图辅助线显隐 */
    readonly outputGridVisible: boolean;
}

export const STUDIO_ENVIRONMENT_DEFAULTS: StudioEnvironmentJSON = {
    gridSizeMeters: GRID_SIZE.DEFAULT_METERS,
    renderQuality: RENDER_QUALITY.PERFORMANCE,
    frameRateVisible: false,
    outputGridVisible: true,
};

export function isStudioEnvironmentJSON(value: unknown): value is StudioEnvironmentJSON {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Partial<StudioEnvironmentJSON>;
    return (
        isGridSizeValid(candidate.gridSizeMeters) &&
        isRenderQuality(candidate.renderQuality) &&
        typeof candidate.frameRateVisible === "boolean" &&
        typeof candidate.outputGridVisible === "boolean"
    );
}

/**
 * 演播室档位聚合(工程级、可 JSON 往返)。
 *
 * 边界:这里放的是「这个工程在什么演播室里排的」——参考地板尺度、渲染画质档,
 * 以及作者为本工程选定的观测读数与构图辅助线。它们决定成片质量与画面构图判断,
 * 因此属于工程数据,随文档导出/导入并进撤销栈;
 * 壳层的空间编排(左栏开合、时间线高度、预览态)仍是瞬时 UI 态,留在 WorkbenchLayoutStore。
 *
 * 写入纪律:一切修改经 studio.* 命令,组件与宿主不直写(命令层收口)。
 */
export class StudioEnvironment {
    gridSizeMeters: number = STUDIO_ENVIRONMENT_DEFAULTS.gridSizeMeters;
    renderQuality: RenderQuality = STUDIO_ENVIRONMENT_DEFAULTS.renderQuality;
    frameRateVisible: boolean = STUDIO_ENVIRONMENT_DEFAULTS.frameRateVisible;
    outputGridVisible: boolean = STUDIO_ENVIRONMENT_DEFAULTS.outputGridVisible;

    /** 宿主 prop 只注入创建期初值;运行期由项目菜单经命令接管。 */
    constructor(init?: { gridSizeMeters?: number | undefined }) {
        makeAutoObservable(this);
        if (init?.gridSizeMeters === undefined) return;
        if (isGridSizeValid(init.gridSizeMeters)) {
            this.gridSizeMeters = init.gridSizeMeters;
        } else if (import.meta.env.DEV) {
            console.warn(
                `[StudioEnvironment] gridSizeMeters 非法(${String(init.gridSizeMeters)}),回落 ${String(GRID_SIZE.DEFAULT_METERS)}m`,
            );
        }
    }

    get profile(): (typeof RENDER_QUALITY_PROFILES)[RenderQuality] {
        return RENDER_QUALITY_PROFILES[this.renderQuality];
    }

    /** 地板尺寸唯一写口;非法值静默拒绝(命令层已校验,这里兜宿主/未来路径) */
    setGridSizeMeters(value: number): void {
        if (!isGridSizeValid(value)) return;
        this.gridSizeMeters = value;
    }

    setRenderQuality(quality: RenderQuality): void {
        if (!isRenderQuality(quality)) return;
        this.renderQuality = quality;
    }

    setFrameRateVisible(visible: boolean): void {
        this.frameRateVisible = visible;
    }

    setOutputGridVisible(visible: boolean): void {
        this.outputGridVisible = visible;
    }

    /** 文档导入的整档替换:逐字段覆盖,不保留上一工程的残留档位。 */
    restore(snapshot: StudioEnvironmentJSON): void {
        this.gridSizeMeters = snapshot.gridSizeMeters;
        this.renderQuality = snapshot.renderQuality;
        this.frameRateVisible = snapshot.frameRateVisible;
        this.outputGridVisible = snapshot.outputGridVisible;
    }

    toJSON(): StudioEnvironmentJSON {
        return {
            gridSizeMeters: this.gridSizeMeters,
            renderQuality: this.renderQuality,
            frameRateVisible: this.frameRateVisible,
            outputGridVisible: this.outputGridVisible,
        };
    }
}
