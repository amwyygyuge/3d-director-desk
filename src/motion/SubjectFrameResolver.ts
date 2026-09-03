import type { SceneManager } from "@/core/SceneManager";
import type { SubjectFrameSample } from "@/motion/SubjectFrameSample";
import type { Vec3 } from "@/core/SceneObject";
import type { TimelineDoc } from "@/timeline/TimelineDoc";
import { evaluateTransformTrack, createTransformSample } from "@/timeline/TimelineSampler";
import type { TransformSample } from "@/timeline/TimelineSampler";
import { TIMELINE_TRACK_KIND } from "@/timeline/TimelineTrack";
import type { TimelineTrack } from "@/timeline/TimelineTrack";

/**
 * 跟随参考系模式。
 * world = 只跟位移(相机保持世界朝向,用于侧向平行推轨/俯瞰跟随);
 * heading = 跟主体朝向(背后跟随、前导倒退、越肩)。
 *
 * 不提供「轨迹切线」第三种:PATH 朝向策略下主体 rotation.y 已经就是切线 yaw,
 * KEYED 策略下作者显式指定了朝向,相机应服从作者而不是二次猜测。
 */
export const FOLLOW_FRAME = {
    WORLD: "world",
    HEADING: "heading",
} as const;
export type FollowFrame = (typeof FOLLOW_FRAME)[keyof typeof FOLLOW_FRAME];

/** yaw 取值查表(禁 if 链);world 恒 0 使平滑累加自然退化为单位向量 */
const FOLLOW_FRAME_YAW: Record<FollowFrame, (pose: TransformSample) => number> = {
    [FOLLOW_FRAME.WORLD]: () => 0,
    [FOLLOW_FRAME.HEADING]: (pose) => pose.rotation[1],
};

/** 命令层围栏:外部 payload 的参考系先过枚举检查;hasOwn 挡原型链 */
export function isFollowFrame(value: unknown): value is FollowFrame {
    return typeof value === "string" && Object.hasOwn(FOLLOW_FRAME_YAW, value);
}

/** 平滑窗口的定点抽头数:预算封顶,不随窗口长度膨胀 */
const FOLLOW_SMOOTHING_TAPS = 5;
const SINGLE_TAP = 1;
const TAP_WINDOW_CENTER = 0.5;

/** 窄端口:解析口只需要「当前时间轴文档」,不依赖 TimelineStore 的其余状态。 */
export interface TimelineDocumentSource {
    readonly document: TimelineDoc;
}

/** 跟随系解算请求(纯数据):CameraFollowTrack 结构上满足它,motion 层因此不反向依赖 camera 层。 */
export interface SubjectFrameRequest {
    readonly objectId: string;
    readonly anchorOffset: Vec3;
    readonly frame: FollowFrame;
    readonly lagSeconds: number;
    readonly smoothingSeconds: number;
}

/**
 * 主体位姿唯一解析口(领域服务)。
 *
 * 「主体此刻在哪、朝哪」只能有一个答案:注视锁定与跟拍共用本类。
 * 求值走时间线文档的纯函数(evaluateTransformTrack),不读 three 的 matrixWorld——
 * 只有文档求值能回答任意时刻,滞后与平滑正是在别的时刻取样。
 *
 * 滞后/平滑是时间域的纯函数而非逐帧积分:拖动播放头、倒放、逐帧导出必须得到同一结果,
 * 弹簧阻尼做不到这一点。
 */
export class SubjectFrameResolver {
    private readonly pose: TransformSample = createTransformSample();
    /** 轨查找缓存:文档不可变,引用相等即可判定缓存有效,稳态下每帧零分配(find 会造闭包) */
    private cachedDocument: TimelineDoc | null = null;
    private cachedObjectId: string | null = null;
    private cachedTrack: TimelineTrack | null = null;
    /** 平滑抽头累加器:留在实例上,避免每帧在采样函数里重新开局部变量 */
    private sumX = 0;
    private sumY = 0;
    private sumZ = 0;
    private sumYawCos = 0;
    private sumYawSin = 0;

    constructor(
        private readonly timeline: TimelineDocumentSource,
        private readonly scene: SceneManager,
    ) {}

    /**
     * 主体在该时刻的位姿(不含滞后/平滑/锚点)。注视锁定解析走这一条。
     * 时间落在走位轨成文区间之外时退回实体权威变换,与回放的 restore 语义一致。
     */
    resolvePose(objectId: string, timeSeconds: number, output: TransformSample): boolean {
        const track = this.trackFor(objectId);
        if (track && evaluateTransformTrack(track, timeSeconds, output)) return true;
        const entity = this.scene.getEntity(objectId);
        if (!entity) return false;
        const { position, rotation, scale } = entity.transform;
        output.position[0] = position[0];
        output.position[1] = position[1];
        output.position[2] = position[2];
        output.rotation[0] = rotation[0];
        output.rotation[1] = rotation[1];
        output.rotation[2] = rotation[2];
        output.scale[0] = scale[0];
        output.scale[1] = scale[1];
        output.scale[2] = scale[2];
        output.arcLengthMeters = 0;
        return true;
    }

    /**
     * 该时刻的跟随系:滞后取样 → 平滑窗口 → 锚点原点。
     * 采样期每帧调用,只写调用方持有的载体,永不分配。
     */
    resolveFrame(request: SubjectFrameRequest, timeSeconds: number, output: SubjectFrameSample): boolean {
        const track = this.trackFor(request.objectId);
        const laggedTimeSeconds = timeSeconds - request.lagSeconds;
        const tapCount = request.smoothingSeconds > 0 ? FOLLOW_SMOOTHING_TAPS : SINGLE_TAP;
        const yawOf = FOLLOW_FRAME_YAW[request.frame];
        this.resetAccumulators();
        // 索引式循环是零分配纪律的直接要求(闭包与迭代器都会在采样期产生垃圾)
        for (let tapIndex = 0; tapIndex < tapCount; tapIndex += 1) {
            const offsetRatio = tapCount === SINGLE_TAP ? 0 : tapIndex / (tapCount - 1) - TAP_WINDOW_CENTER;
            const tapTimeSeconds = clampToTrackSpan(track, laggedTimeSeconds + offsetRatio * request.smoothingSeconds);
            if (!this.resolvePose(request.objectId, tapTimeSeconds, this.pose)) return false;
            const yaw = yawOf(this.pose);
            this.sumX += this.pose.position[0];
            this.sumY += this.pose.position[1];
            this.sumZ += this.pose.position[2];
            this.sumYawCos += Math.cos(yaw);
            this.sumYawSin += Math.sin(yaw);
        }
        // 角度用 cos/sin 求和再单位化,而不是直接平均弧度:后者在 ±π 处会翻转
        output.setYawComponents(this.sumYawCos, this.sumYawSin);
        const anchor = request.anchorOffset;
        output.setAnchoredOrigin(
            this.sumX / tapCount,
            this.sumY / tapCount,
            this.sumZ / tapCount,
            anchor[0],
            anchor[1],
            anchor[2],
        );
        return true;
    }

    private resetAccumulators(): void {
        this.sumX = 0;
        this.sumY = 0;
        this.sumZ = 0;
        this.sumYawCos = 0;
        this.sumYawSin = 0;
    }

    private trackFor(objectId: string): TimelineTrack | null {
        const document = this.timeline.document;
        if (this.cachedDocument === document && this.cachedObjectId === objectId) return this.cachedTrack;
        this.cachedDocument = document;
        this.cachedObjectId = objectId;
        this.cachedTrack = document.trackForTarget(objectId, TIMELINE_TRACK_KIND.TRANSFORM) ?? null;
        return this.cachedTrack;
    }
}

/**
 * 抽头时刻夹到走位轨的成文区间。
 * 不夹取的话,片段首尾的滞后/平滑会把取样时刻推到区间外,求值退回实体权威变换,画面当场跳一下。
 */
function clampToTrackSpan(track: TimelineTrack | null, timeSeconds: number): number {
    const keyframes = track?.keyframes;
    const first = keyframes?.[0];
    const last = keyframes?.[keyframes.length - 1];
    if (!first || !last) return timeSeconds;
    return Math.min(Math.max(timeSeconds, first.time), last.time);
}
