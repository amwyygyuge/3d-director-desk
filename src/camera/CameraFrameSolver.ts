import { sampleCameraMotionClip } from "@/camera/CameraMotionClip";
import type { CameraMotionClip, CameraMotionSample } from "@/camera/CameraMotionClip";
import type { FocusTargetSample } from "@/camera/CameraFocusTrack";
import { FocusTargetResolver } from "@/camera/FocusTargetResolver";
import type { SceneManager } from "@/core/SceneManager";
import { createPositionSample } from "@/motion/MotionTrajectory";
import type { MotionPositionSample } from "@/motion/MotionTrajectory";
import { SubjectFrameResolver } from "@/motion/SubjectFrameResolver";
import type { TimelineDocumentSource } from "@/motion/SubjectFrameResolver";
import { SubjectFrameSample } from "@/motion/SubjectFrameSample";

/**
 * 一刻画面的解算器(领域服务):片段 + 时刻 → 世界位姿标量。
 *
 * 两层覆盖的解算顺序在此收口:跟拍先给出参考系(站哪),注视再覆盖注视点(看哪)。
 * 回放采样器与断言查询共用本类,避免「成片怎么算」出现第二份实现。
 *
 * 自持全部缓冲,帧级调用零分配。
 */
export class CameraFrameSolver {
    private readonly subjects: SubjectFrameResolver;
    private readonly focusResolver: FocusTargetResolver;
    private readonly positionSample: MotionPositionSample = createPositionSample();
    private readonly focusSample: FocusTargetSample = { x: 0, y: 0, z: 0 };
    private readonly frameSample = new SubjectFrameSample();

    constructor(timeline: TimelineDocumentSource, scene: SceneManager) {
        this.subjects = new SubjectFrameResolver(timeline, scene);
        this.focusResolver = new FocusTargetResolver(this.subjects);
    }

    /** 主体位姿解析口:视口辅助物与命令层的空间换算共用同一个答案。 */
    get subjectFrames(): SubjectFrameResolver {
        return this.subjects;
    }

    /** 任一覆盖层解析失败即返回 false——宁可停在上一帧,也好过把镜头弹到错误位置。 */
    solve(clip: CameraMotionClip, timeSeconds: number, sample: CameraMotionSample): boolean {
        const follow = clip.follow;
        if (follow && !this.subjects.resolveFrame(follow, timeSeconds, this.frameSample)) return false;
        const focus = clip.focus;
        if (focus && !this.focusResolver.resolve(focus, timeSeconds, this.focusSample)) return false;
        return sampleCameraMotionClip(
            clip,
            timeSeconds,
            follow ? this.frameSample : null,
            focus ? this.focusSample : null,
            this.positionSample,
            sample,
        );
    }
}
