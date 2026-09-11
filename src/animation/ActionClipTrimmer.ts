import { AnimationClip, Quaternion } from "three";
import type { KeyframeTrack } from "three";

/**
 * 动作裁剪:去除源资产开头/结尾的静态参考帧(如 T-Pose 首帧)。
 *
 * 内置动作在构建期就烘好了(见 scripts/bake-actor-assets.ts),不经过这里;
 * 本模块服务于宿主注入与用户导入的第三方动作——它们的参考帧数量不可预期,
 * 只能在运行时按调用方给的窗口裁掉。
 *
 * 裁剪不能简单丢关键帧:窗口边界通常落在两帧之间,必须重采样出边界帧,
 * 否则动作会在首尾突跳。四元数走 slerp,其余分量走线性插值。
 */
const TRIM_LEFT_QUATERNION = new Quaternion();
const TRIM_RIGHT_QUATERNION = new Quaternion();
function writeTrackSample(track: KeyframeTrack, timeSeconds: number, values: Float32Array, offset: number): void {
    const valueSize = track.getValueSize();
    const times = track.times;
    const rightIndex = [...times].findIndex((time) => time >= timeSeconds);
    const clampedRightIndex = rightIndex < 0 ? times.length - 1 : rightIndex;
    const leftIndex = clampedRightIndex === 0 ? 0 : clampedRightIndex - 1;
    const leftTime = times[leftIndex] ?? 0;
    const rightTime = times[clampedRightIndex] ?? leftTime;
    const progress = rightTime === leftTime ? 0 : (timeSeconds - leftTime) / (rightTime - leftTime);
    const leftOffset = leftIndex * valueSize;
    const rightOffset = clampedRightIndex * valueSize;
    if (track.name.endsWith(".quaternion") && valueSize === 4) {
        TRIM_LEFT_QUATERNION.set(
            track.values[leftOffset] ?? 0,
            track.values[leftOffset + 1] ?? 0,
            track.values[leftOffset + 2] ?? 0,
            track.values[leftOffset + 3] ?? 1,
        );
        TRIM_RIGHT_QUATERNION.set(
            track.values[rightOffset] ?? 0,
            track.values[rightOffset + 1] ?? 0,
            track.values[rightOffset + 2] ?? 0,
            track.values[rightOffset + 3] ?? 1,
        );
        TRIM_LEFT_QUATERNION.slerp(TRIM_RIGHT_QUATERNION, progress);
        values[offset] = TRIM_LEFT_QUATERNION.x;
        values[offset + 1] = TRIM_LEFT_QUATERNION.y;
        values[offset + 2] = TRIM_LEFT_QUATERNION.z;
        values[offset + 3] = TRIM_LEFT_QUATERNION.w;
        return;
    }
    for (const index of Array.from({ length: valueSize }, (_, valueIndex) => valueIndex)) {
        const leftValue = track.values[leftOffset + index] ?? 0;
        const rightValue = track.values[rightOffset + index] ?? leftValue;
        values[offset + index] = leftValue + (rightValue - leftValue) * progress;
    }
}

function trimmedTrack(track: KeyframeTrack, startTimeSeconds: number, endTimeSeconds: number): KeyframeTrack {
    const valueSize = track.getValueSize();
    const interiorTimes = [...track.times].filter((time) => time > startTimeSeconds && time < endTimeSeconds);
    const times = new Float32Array(interiorTimes.length + 2);
    const values = new Float32Array((interiorTimes.length + 2) * valueSize);
    times[0] = 0;
    writeTrackSample(track, startTimeSeconds, values, 0);
    interiorTimes.forEach((time, index) => {
        times[index + 1] = time - startTimeSeconds;
        const sourceOffset = [...track.times].findIndex((sourceTime) => sourceTime === time) * valueSize;
        values.set(track.values.slice(sourceOffset, sourceOffset + valueSize), (index + 1) * valueSize);
    });
    times[interiorTimes.length + 1] = endTimeSeconds - startTimeSeconds;
    writeTrackSample(track, endTimeSeconds, values, (interiorTimes.length + 1) * valueSize);
    const trimmed = track.clone();
    trimmed.times = times;
    trimmed.values = values;
    return trimmed;
}

export function trimClip(clip: AnimationClip, trimStartSeconds: number, trimEndSeconds: number): AnimationClip {
    if (trimStartSeconds === 0 && trimEndSeconds === 0) return clip;
    const endTimeSeconds = clip.duration - trimEndSeconds;
    if (trimStartSeconds < 0 || trimEndSeconds < 0 || endTimeSeconds <= trimStartSeconds) {
        throw new Error("ActionClipTrimmer: 动作裁剪窗口无效");
    }
    return new AnimationClip(
        clip.name,
        endTimeSeconds - trimStartSeconds,
        clip.tracks.map((track) => trimmedTrack(track, trimStartSeconds, endTimeSeconds)),
    );
}
