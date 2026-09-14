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

/**
 * 成像曝光合法域(`WebGLRenderer.toneMappingExposure` 的倍率)。
 *
 * 色调映射本身由 R3F 缺省提供(实测 `ACESFilmicToneMapping` + `srgb` 输出),缺的是曝光控制:
 * 恒为 1 时「压暗做低调」「提亮做柔和」这类基本影调意图在导演台里无法表达。
 * 上下限按可用影调区间收敛——低于 0.2 画面近黑、高于 3 高光全部烧掉,两端都不是可用素材。
 */
export const EXPOSURE = { DEFAULT: 1, MIN: 0.2, MAX: 3 } as const;

export function isExposureValid(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= EXPOSURE.MIN && value <= EXPOSURE.MAX;
}

/**
 * 地板颜色合法域(6 位十六进制)。
 *
 * 地板是画面里面积最大的一块,它的明度直接决定人物的反差与整体影调,
 * 因此属于成像档位而非纯装饰:换深色地板做低调、换浅色做柔和高调。
 */
const FLOOR_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
export const FLOOR_COLOR_DEFAULT = "#2a2a2e";

export function isFloorColor(value: unknown): value is string {
    return typeof value === "string" && FLOOR_COLOR_PATTERN.test(value);
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
    /** 成像曝光倍率;色调映射由 R3F 缺省提供,本档只控曝光 */
    readonly exposure: number;
    /**
     * 环境光照(IBL)开关。
     *
     * 开启后金属度/粗糙度才参与成像(内置人形的 glTF 材质是规范默认全金属,
     * 无环境贴图时 albedo 不参与漫反射)。环境贴图为程序化生成,不拉取任何外部资源。
     * PMREM 卷积有一次性成本且常驻一张立方图显存,故同为开关。
     */
    readonly environmentLightingEnabled: boolean;
    /**
     * 投影开关(主光的实时 shadow map + 地面接收)。
     *
     * 「物体真的站在空间里」的主要信息量来源——没有它,人物在画面上是贴片。
     * 有实测成本:开启后每帧要额外渲一遍深度图,故做成开关;缺省关闭,既有工程画面零变化。
     */
    readonly shadowsEnabled: boolean;
    /** 参考地板颜色(6 位十六进制);面积最大的一块,直接影响人物反差 */
    readonly floorColor: string;
    /**
     * 实心地面开关。
     *
     * 关闭后只剩网格线(等于本功能之前的行为):地板颜色不再成像,投影也失去接收面。
     * 有实测成本——它是一张覆盖视口的全屏面,按满分辨率着色(实测 ~0.11ms/帧,
     * 高分屏满 dpr 下与整帧同量级),故按性能纪律做成开关。
     */
    readonly floorSurfaceEnabled: boolean;
}

export const STUDIO_ENVIRONMENT_DEFAULTS: StudioEnvironmentJSON = {
    gridSizeMeters: GRID_SIZE.DEFAULT_METERS,
    renderQuality: RENDER_QUALITY.PERFORMANCE,
    frameRateVisible: false,
    outputGridVisible: true,
    exposure: EXPOSURE.DEFAULT,
    environmentLightingEnabled: false,
    shadowsEnabled: false,
    floorColor: FLOOR_COLOR_DEFAULT,
    floorSurfaceEnabled: false,
};

export function isStudioEnvironmentJSON(value: unknown): value is StudioEnvironmentJSON {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Partial<StudioEnvironmentJSON>;
    return (
        isGridSizeValid(candidate.gridSizeMeters) &&
        isRenderQuality(candidate.renderQuality) &&
        typeof candidate.frameRateVisible === "boolean" &&
        typeof candidate.outputGridVisible === "boolean" &&
        isExposureValid(candidate.exposure) &&
        typeof candidate.environmentLightingEnabled === "boolean" &&
        typeof candidate.shadowsEnabled === "boolean" &&
        isFloorColor(candidate.floorColor) &&
        typeof candidate.floorSurfaceEnabled === "boolean"
    );
}

/**
 * 演播室档位聚合(工程级、可 JSON 往返)。
 *
 * 边界:这里放的是「这个工程在什么演播室里排的」——参考地板尺度、渲染画质档、成像档位
 * (曝光/接触阴影/环境光照),以及作者为本工程选定的观测读数与构图辅助线。
 * 它们决定成片质量与画面构图判断,因此属于工程数据,随文档导出/导入并进撤销栈;
 * 壳层的空间编排(左栏开合、时间线高度、预览态)仍是瞬时 UI 态,留在 WorkbenchLayoutStore。
 *
 * 写入纪律:一切修改经 studio.* 命令,组件与宿主不直写(命令层收口)。
 */
export class StudioEnvironment {
    gridSizeMeters: number = STUDIO_ENVIRONMENT_DEFAULTS.gridSizeMeters;
    renderQuality: RenderQuality = STUDIO_ENVIRONMENT_DEFAULTS.renderQuality;
    frameRateVisible: boolean = STUDIO_ENVIRONMENT_DEFAULTS.frameRateVisible;
    outputGridVisible: boolean = STUDIO_ENVIRONMENT_DEFAULTS.outputGridVisible;
    exposure: number = STUDIO_ENVIRONMENT_DEFAULTS.exposure;
    environmentLightingEnabled: boolean = STUDIO_ENVIRONMENT_DEFAULTS.environmentLightingEnabled;
    shadowsEnabled: boolean = STUDIO_ENVIRONMENT_DEFAULTS.shadowsEnabled;
    floorColor: string = STUDIO_ENVIRONMENT_DEFAULTS.floorColor;
    floorSurfaceEnabled: boolean = STUDIO_ENVIRONMENT_DEFAULTS.floorSurfaceEnabled;

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

    /** 曝光唯一写口;非法值静默拒绝(同 setGridSizeMeters 口径) */
    setExposure(value: number): void {
        if (!isExposureValid(value)) return;
        this.exposure = value;
    }

    setEnvironmentLightingEnabled(enabled: boolean): void {
        this.environmentLightingEnabled = enabled;
    }

    setShadowsEnabled(enabled: boolean): void {
        this.shadowsEnabled = enabled;
    }

    /** 地板颜色唯一写口;非法值静默拒绝(同 setGridSizeMeters 口径) */
    setFloorColor(value: string): void {
        if (!isFloorColor(value)) return;
        this.floorColor = value.toLowerCase();
    }

    setFloorSurfaceEnabled(enabled: boolean): void {
        this.floorSurfaceEnabled = enabled;
    }

    /** 文档导入的整档替换:逐字段覆盖,不保留上一工程的残留档位。 */
    restore(snapshot: StudioEnvironmentJSON): void {
        this.gridSizeMeters = snapshot.gridSizeMeters;
        this.renderQuality = snapshot.renderQuality;
        this.frameRateVisible = snapshot.frameRateVisible;
        this.outputGridVisible = snapshot.outputGridVisible;
        this.exposure = snapshot.exposure;
        this.environmentLightingEnabled = snapshot.environmentLightingEnabled;
        this.shadowsEnabled = snapshot.shadowsEnabled;
        this.floorColor = snapshot.floorColor;
        this.floorSurfaceEnabled = snapshot.floorSurfaceEnabled;
    }

    toJSON(): StudioEnvironmentJSON {
        return {
            gridSizeMeters: this.gridSizeMeters,
            renderQuality: this.renderQuality,
            frameRateVisible: this.frameRateVisible,
            outputGridVisible: this.outputGridVisible,
            exposure: this.exposure,
            environmentLightingEnabled: this.environmentLightingEnabled,
            shadowsEnabled: this.shadowsEnabled,
            floorColor: this.floorColor,
            floorSurfaceEnabled: this.floorSurfaceEnabled,
        };
    }
}
