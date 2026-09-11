/**
 * 视场角围栏(领域常量)。
 *
 * 定义在本模块而非 `CameraShot`:焦距围栏由它派生,而 `CameraShot` 又要引用 `CameraLens`——
 * 反过来会形成模块环(两侧都有顶层常量求值,环上的求值顺序不可靠)。
 * `CameraShot` 从这里 re-export,既有调用点无需改动。
 */
export const FOV_MIN = 1;
export const FOV_MAX = 179;

/**
 * 35mm 全画幅胶片规格(毫米)。
 *
 * 与 three 的 `PerspectiveCamera.filmGauge` 缺省值一致——两处必须同口径,
 * 否则「导演台显示 50mm、渲染相机按别的画幅算」会得到不一致的视角。
 */
export const FILM_GAUGE_MM = 35;

/**
 * 胶片高度(毫米):横画幅下按宽高比收窄。
 *
 * 与 three 的 `getFilmHeight()` 同一口径(`filmGauge / max(aspect, 1)`)。
 * **焦距换算必须带宽高比**:同一支 50mm 镜头在 16:9 上的垂直视场角
 * 与在 1:1 上不同。早先按固定 35mm 高度算,50mm 得到 38.58°,
 * 而 three 在 16:9 下给 22.275° —— 那会让导演台标的焦距与实际成像不符。
 */
function filmHeightMm(aspect: number): number {
    return FILM_GAUGE_MM / Math.max(aspect, 1);
}

/**
 * fov(垂直视场角,度) → 焦距(毫米)。
 * 与 three 的 `getFocalLength()` 同一公式(实测双向往返精确)。
 * 自己实现而不调 three:本模块是纯领域计算,不该为一个三角函数持有相机实例。
 */
export function focalLengthFromFov(fovDegrees: number, aspect: number): number {
    return (0.5 * filmHeightMm(aspect)) / Math.tan(((fovDegrees * 0.5) * Math.PI) / 180);
}

/** 焦距(毫米) → fov(垂直视场角,度);`focalLengthFromFov` 的逆。 */
export function fovFromFocalLength(focalLengthMm: number, aspect: number): number {
    return (2 * Math.atan((0.5 * filmHeightMm(aspect)) / focalLengthMm) * 180) / Math.PI;
}

/**
 * 焦距合法域(毫米),按给定宽高比派生。
 *
 * 不独立立界,而是由 `FOV_MIN`/`FOV_MAX` 换算得来:焦距是 fov 的**派生视图**,
 * 两套独立围栏必然漂移(会出现「焦距合法但换算出的 fov 越界」这种自相矛盾的输入)。
 */
export function focalLengthRangeMm(aspect: number): { readonly min: number; readonly max: number } {
    return { min: focalLengthFromFov(FOV_MAX, aspect), max: focalLengthFromFov(FOV_MIN, aspect) };
}

export function isFocalLengthMm(value: unknown, aspect: number): value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = focalLengthRangeMm(aspect);
    return value >= range.min && value <= range.max;
}

/**
 * 光圈合法域(f 值)。
 *
 * f 值越小景深越浅。上界 22 是常规镜头的最小光圈(再小衍射已经压过景深收益),
 * 下界 0.7 覆盖到 Kubrick 那支 f/0.7 的极端浅景深,给创作留余量。
 */
export const APERTURE_F_STOP = { DEFAULT: 2.8, MIN: 0.7, MAX: 22 } as const;

export function isApertureFStop(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= APERTURE_F_STOP.MIN &&
        value <= APERTURE_F_STOP.MAX
    );
}

/**
 * 对焦距离(米)。
 *
 * `null` 表示**自动对焦到注视目标**——这是导演台的常态:机位由「位置 + 注视点」定义,
 * 对焦面自然落在被摄体上。显式数值用于「失焦开场」「对焦转移」这类刻意脱焦的表达。
 */
export const FOCUS_DISTANCE_METERS = { MIN: 0.05, MAX: 500 } as const;

export function isFocusDistanceMeters(value: unknown): value is number | null {
    if (value === null) return true;
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= FOCUS_DISTANCE_METERS.MIN &&
        value <= FOCUS_DISTANCE_METERS.MAX
    );
}

/** 镜头的可序列化形态。 */
export interface CameraLensJSON {
    readonly apertureFStop: number;
    /** null = 自动对焦到注视目标 */
    readonly focusDistanceMeters: number | null;
}

export const CAMERA_LENS_DEFAULTS: CameraLensJSON = {
    apertureFStop: APERTURE_F_STOP.DEFAULT,
    focusDistanceMeters: null,
};

export function isCameraLensJSON(value: unknown): value is CameraLensJSON {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const candidate = value as Partial<CameraLensJSON>;
    return isApertureFStop(candidate.apertureFStop) && isFocusDistanceMeters(candidate.focusDistanceMeters);
}

/**
 * 镜头值对象:由属性值定义、不可变(与 `CameraShot` 同纪律)。
 *
 * 边界:这里只放**光学参数**——焦距不在其中,它是 `CameraShot.fov` 的派生视图
 * (见 `focalLengthFromFov`),存两份必然漂移。景深要落到画面还需要后处理通道;
 * 本值对象先把「导演意图」持久化下来,渲染侧是否兑现是另一层的事,
 * 因此它单独可用:AI 可以声明浅景深意图,也可读回校验。
 */
export class CameraLens {
    readonly apertureFStop: number;
    readonly focusDistanceMeters: number | null;

    constructor(init?: { apertureFStop?: number; focusDistanceMeters?: number | null }) {
        const aperture = init?.apertureFStop ?? CAMERA_LENS_DEFAULTS.apertureFStop;
        if (!isApertureFStop(aperture)) {
            throw new Error(`CameraLens: apertureFStop 必须是 ${APERTURE_F_STOP.MIN}~${APERTURE_F_STOP.MAX}`);
        }
        const focus = init?.focusDistanceMeters ?? null;
        if (!isFocusDistanceMeters(focus)) {
            throw new Error("CameraLens: focusDistanceMeters 必须是 null 或正的有限米数");
        }
        this.apertureFStop = aperture;
        this.focusDistanceMeters = focus;
        Object.freeze(this);
    }

    equals(other: CameraLens): boolean {
        return (
            this.apertureFStop === other.apertureFStop && this.focusDistanceMeters === other.focusDistanceMeters
        );
    }

    toJSON(): CameraLensJSON {
        return { apertureFStop: this.apertureFStop, focusDistanceMeters: this.focusDistanceMeters };
    }
}
