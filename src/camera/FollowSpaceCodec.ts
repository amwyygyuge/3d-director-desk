import type { CameraFollowTrack } from "@/camera/CameraFollowTrack";
import type { CameraKeyJSON } from "@/camera/CameraKey";
import type { CameraMotionClip } from "@/camera/CameraMotionClip";
import type { SceneManager } from "@/core/SceneManager";
import type { Vec3 } from "@/core/SceneObject";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";
import { SubjectFrameResolver } from "@/motion/SubjectFrameResolver";
import type { TimelineDocumentSource } from "@/motion/SubjectFrameResolver";
import { SubjectFrameSample } from "@/motion/SubjectFrameSample";

/** 换算的目标空间。片段的关键帧空间由 clip.follow 是否为空唯一决定,payload 不带空间标志位。 */
export const FOLLOW_SPACE = {
    WORLD: "world",
    LOCAL: "local",
} as const;
export type FollowSpace = (typeof FOLLOW_SPACE)[keyof typeof FOLLOW_SPACE];

/** 位置:平移 + 旋转 */
const POINT_TRANSFORMS: Record<
    FollowSpace,
    (frame: SubjectFrameSample, x: number, y: number, z: number, out: MotionPositionSample) => void
> = {
    [FOLLOW_SPACE.LOCAL]: (frame, x, y, z, out) => frame.toLocal(x, y, z, out),
    [FOLLOW_SPACE.WORLD]: (frame, x, y, z, out) => frame.toWorld(x, y, z, out),
};

/** 手柄:相对偏移量,只旋转 */
const OFFSET_TRANSFORMS: Record<
    FollowSpace,
    (frame: SubjectFrameSample, x: number, y: number, z: number, out: MotionPositionSample) => void
> = {
    [FOLLOW_SPACE.LOCAL]: (frame, x, y, z, out) => frame.rotateToLocal(x, y, z, out),
    [FOLLOW_SPACE.WORLD]: (frame, x, y, z, out) => frame.rotateToWorld(x, y, z, out),
};

/**
 * 跟随系与世界系之间的换算口(领域服务)。
 *
 * 绑定与解绑是同一变换的正逆:每枚关键帧取自己的时刻(clip.timeAtProgress,含整段缓动反解),
 * 用与采样期完全相同的 resolveFrame 求参考系。因此在关键帧时刻,绑定前后画面严格不变;
 * 段间形状会随主体重构——那正是跟拍的语义。
 *
 * 视口拖拽、镜头视角打点、绑定/解绑共用本类,禁止各写一份换算。
 * 调用频率是手势级而非帧级,故允许返回新的 Vec3/JSON。
 */
export class FollowSpaceCodec {
    private readonly frame = new SubjectFrameSample();
    private readonly buffer: MotionPositionSample = createPositionSample();

    constructor(private readonly subjects: SubjectFrameResolver) {}

    /** 单点换算:视口拖拽落点、打点位姿。目标不可解析时返回 null,调用方放弃写入。 */
    convertPoint(follow: CameraFollowTrack, timeSeconds: number, space: FollowSpace, point: Vec3): Vec3 | null {
        if (!this.subjects.resolveFrame(follow, timeSeconds, this.frame)) return null;
        POINT_TRANSFORMS[space](this.frame, point[0], point[1], point[2], this.buffer);
        return [this.buffer.x, this.buffer.y, this.buffer.z];
    }

    /** 手柄换算:相对偏移量只旋转不平移,套用 convertPoint 会把手柄拽成绝对坐标。 */
    convertOffset(follow: CameraFollowTrack, timeSeconds: number, space: FollowSpace, offset: Vec3): Vec3 | null {
        if (!this.subjects.resolveFrame(follow, timeSeconds, this.frame)) return null;
        OFFSET_TRANSFORMS[space](this.frame, offset[0], offset[1], offset[2], this.buffer);
        return [this.buffer.x, this.buffer.y, this.buffer.z];
    }

    /** 整段换算:绑定(→ local)与解绑(→ world)。任一枚解析失败即整段放弃,不留半段坏数据。 */
    convertKeys(
        clip: CameraMotionClip,
        follow: CameraFollowTrack,
        space: FollowSpace,
    ): readonly CameraKeyJSON[] | null {
        const movePoint = POINT_TRANSFORMS[space];
        const moveOffset = OFFSET_TRANSFORMS[space];
        const converted: CameraKeyJSON[] = [];
        for (const key of clip.keys) {
            const timeSeconds = clip.timeAtProgress(key.progress);
            if (!this.subjects.resolveFrame(follow, timeSeconds, this.frame)) return null;
            const json = key.toJSON();
            converted.push({
                ...json,
                position: this.applied(movePoint, key.position),
                target: this.applied(movePoint, key.target),
                inHandle: this.applied(moveOffset, json.inHandle),
                outHandle: this.applied(moveOffset, json.outHandle),
            });
        }
        return converted;
    }

    private applied(
        transform: (frame: SubjectFrameSample, x: number, y: number, z: number, out: MotionPositionSample) => void,
        vector: Vec3,
    ): Vec3 {
        transform(this.frame, vector[0], vector[1], vector[2], this.buffer);
        return [this.buffer.x, this.buffer.y, this.buffer.z];
    }
}

/** UI 手势、命令层与断言查询共用的装配口(四处调用,禁各自 new 一串依赖)。 */
export function followSpaceCodecFor(source: {
    readonly timeline: TimelineDocumentSource;
    readonly scene: { readonly manager: SceneManager };
}): FollowSpaceCodec {
    return new FollowSpaceCodec(new SubjectFrameResolver(source.timeline, source.scene.manager));
}
