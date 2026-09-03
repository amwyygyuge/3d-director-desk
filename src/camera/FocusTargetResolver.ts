import { FOCUS_TARGET_KIND } from "@/camera/CameraFocusTrack";
import type { CameraFocusTrack, FocusTargetSample } from "@/camera/CameraFocusTrack";
import type { SubjectFrameResolver } from "@/motion/SubjectFrameResolver";
import { createTransformSample } from "@/timeline/TimelineSampler";
import type { TransformSample } from "@/timeline/TimelineSampler";

/**
 * 注视目标解析:世界点直通,场景对象经主体位姿唯一解析口。
 *
 * 主体位置不读 three 的 matrixWorld:运行时根节点的变换本就由同一份走位数据写入,
 * 而只有文档求值能回答「任意时刻」——跟拍的滞后与平滑正建立在这一点上。
 * 两条读法并存必然漂移,故此处与跟拍共用 SubjectFrameResolver。
 */
export class FocusTargetResolver {
    private readonly pose: TransformSample = createTransformSample();

    constructor(private readonly subjects: SubjectFrameResolver) {}

    resolve(track: CameraFocusTrack, timeSeconds: number, sample: FocusTargetSample): boolean {
        const target = track.target;
        if (target.kind === FOCUS_TARGET_KIND.WORLD_POINT) {
            sample.x = target.position[0];
            sample.y = target.position[1];
            sample.z = target.position[2];
            return true;
        }
        if (!this.subjects.resolvePose(target.objectId, timeSeconds, this.pose)) return false;
        sample.x = this.pose.position[0] + target.worldOffset[0];
        sample.y = this.pose.position[1] + target.worldOffset[1];
        sample.z = this.pose.position[2] + target.worldOffset[2];
        return true;
    }
}
