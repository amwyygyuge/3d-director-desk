import type { CameraMotionSample } from "@/camera/CameraMotionClip";

/**
 * 视口姿态探针(运行时桥):由拥有 R3F 相机的装备实现,让编排层在不接触 Three 的前提下
 * 读到「此刻画面」并落成关键帧。与 CameraMotionSink 反向——一个写、一个读,同一所有者持有。
 */
export interface ViewportPoseSource {
    readPose(sample: CameraMotionSample): boolean;
}
