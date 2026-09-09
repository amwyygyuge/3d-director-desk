"""
相机运动学与连续性语法(180°/30°/景别),全部基于离线采样,不渲染。
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.signal import savgol_filter

from dd_sampler import CameraClip, SubjectFrameResolver, TransformTrack


@dataclass
class CameraDynamics:
    time: np.ndarray
    position: np.ndarray  # (n,3)
    target: np.ndarray
    fov: np.ndarray
    speed: np.ndarray  # m/s
    accel: np.ndarray  # m/s^2
    jerk: np.ndarray  # m/s^3
    angular_speed: np.ndarray  # deg/s(视线方向变化率)
    fov_rate: np.ndarray  # deg/s


def sample_clip_dynamics(clip: CameraClip, fps: int = 60, smooth_window: float = 0.15) -> CameraDynamics:
    """对单条运镜片段采样并求导。savgol 窗口按秒换算成奇数帧。"""
    n = max(int(clip.duration * fps) + 1, 3)
    t = np.linspace(clip.start, clip.end, n)
    pos = np.zeros((n, 3))
    tgt = np.zeros((n, 3))
    fov = np.zeros(n)
    for i, tt in enumerate(t):
        s = clip.solve(float(tt))
        if s is None:
            raise ValueError(f"clip {clip.id} cannot solve at t={tt}")
        pos[i] = s.position
        tgt[i] = s.target
        fov[i] = s.fov

    dt = 1.0 / fps
    # savgol 平滑求导,抑制采样/量化噪声
    window = max(int(round(smooth_window * fps)) | 1, 5)  # 奇数,至少 5
    if window >= n:
        window = n - 1 if (n - 1) % 2 == 1 else n - 2
    if window < 5:
        window = 5 if n >= 5 else (n if n % 2 == 1 else n - 1)
    poly = 3
    pos_s = savgol_filter(pos, window, poly, axis=0)
    vel = savgol_filter(pos, window, poly, deriv=1, delta=dt, axis=0)
    acc = savgol_filter(pos, window, poly, deriv=2, delta=dt, axis=0)
    jrk = savgol_filter(pos, window, poly, deriv=3, delta=dt, axis=0)

    speed = np.linalg.norm(vel, axis=1)
    accel = np.linalg.norm(acc, axis=1)
    jerk = np.linalg.norm(jrk, axis=1)

    # 视线方向角速度
    view = tgt - pos_s
    view_norm = view / np.maximum(np.linalg.norm(view, axis=1, keepdims=True), 1e-9)
    ang = np.zeros(n)
    for i in range(1, n):
        cosang = float(np.clip(np.dot(view_norm[i - 1], view_norm[i]), -1.0, 1.0))
        ang[i] = math.degrees(math.acos(cosang)) / dt

    fov_rate = np.gradient(fov, dt)
    return CameraDynamics(t, pos, tgt, fov, speed, accel, jerk, ang, fov_rate)


def continuity_report(clips: list[CameraClip], tracks: dict[str, TransformTrack]) -> list[dict]:
    """相邻镜头切点:180° 规则(轴线两侧)与 30° 规则(方位角差)。"""
    ordered = sorted(clips, key=lambda c: c.start)
    report = []
    for i in range(1, len(ordered)):
        prev = ordered[i - 1]
        cur = ordered[i]
        cut = cur.start
        prev_end = prev.solve(cut - 1e-3) or prev.solve(prev.end)
        cur_start = cur.solve(cut + 1e-3) or cur.solve(cur.start)
        if prev_end is None or cur_start is None:
            continue

        def subject_of(c: CameraClip, t: float):
            if not c.follow:
                return None
            track = tracks.get(c.follow["objectId"])
            return track.evaluate(t).position if track else None

        prev_subj = subject_of(prev, cut - 1e-3)
        cur_subj = subject_of(cur, cut + 1e-3)
        # 以两主体连线为动作轴;同主体时退化为该主体朝向
        if prev_subj is not None and cur_subj is not None:
            axis = cur_subj - prev_subj
            if np.linalg.norm(axis) < 1e-6:
                axis = np.array([1.0, 0.0, 0.0])
        else:
            axis = np.array([1.0, 0.0, 0.0])
        axis = axis / np.linalg.norm(axis)

        def side(cam_pos: np.ndarray, ref: np.ndarray) -> float:
            rel = cam_pos - ref
            cross_y = axis[2] * rel[0] - axis[0] * rel[2]  # 2D cross y 分量
            return float(np.sign(cross_y))

        ref = prev_subj if prev_subj is not None else cur_subj
        prev_side = side(prev_end.position, ref)
        cur_side = side(cur_start.position, ref)
        crossed = prev_side != 0 and cur_side != 0 and prev_side != cur_side

        # 30°:相机绕主体方位角差
        def azimuth(cam_pos: np.ndarray, subj: np.ndarray) -> float:
            d = cam_pos - subj
            return math.degrees(math.atan2(d[0], d[2]))

        az_prev = azimuth(prev_end.position, prev_subj if prev_subj is not None else prev_end.target)
        az_cur = azimuth(cur_start.position, cur_subj if cur_subj is not None else cur_start.target)
        az_diff = abs((az_cur - az_prev + 180.0) % 360.0 - 180.0)

        report.append(
            {
                "cut_at": float(cut),
                "from": prev.id,
                "to": cur.id,
                "axis_crossed": crossed,
                "azimuth_diff_deg": round(az_diff, 1),
                "violates_30deg": az_diff < 30.0,
            }
        )
    return report


# 景别阶梯:主体身高占画面高度百分比 -> 标签
SHOT_SIZE_LADDER = [
    (200.0, "ECU"),
    (100.0, "CU"),
    (50.0, "MCU"),
    (25.0, "MS"),
    (12.0, "MLS"),
    (6.0, "LS"),
    (0.0, "ELS"),
]


def shot_size_label(height_percent: float) -> str:
    for threshold, label in SHOT_SIZE_LADDER:
        if height_percent >= threshold:
            return label
    return "ELS"


def subject_height_percent(clip: CameraClip, track: TransformTrack, t: float, actor_height: float = 1.75) -> float | None:
    """主体在画面中的高度占比(竖直张角 / fov)。"""
    s = clip.solve(t)
    if s is None:
        return None
    subj = track.evaluate(t)
    if subj is None:
        return None
    dist = float(np.linalg.norm(subj.position - s.position))
    if dist <= 0:
        return None
    angular = math.degrees(2.0 * math.atan((actor_height / 2.0) / dist))
    return angular / s.fov * 100.0


def foot_skate(track: TransformTrack, stride_meters: float | None = None, fps: int = 60) -> dict:
    """脚滑:步频相位与已走弧长的失配。

    locomotion sync 下动作相位 = arcLength / strideMeters。若轨迹实际配速
    让相位推进速度与标称步幅不一致,支撑脚就在地面滑动。
    返回弧长速度剖面与标称速度的偏差比(>1 偏快,<1 偏慢)。
    """
    stride = stride_meters if stride_meters is not None else track.stride_meters
    traj = track.trajectory
    if traj is None:
        return {"ok": False, "reason": "无轨迹"}
    n = max(int((track.last_time - track.first_time) * fps) + 1, 3)
    ts = np.linspace(track.first_time, track.last_time, n)
    arc = np.array([track.evaluate(float(t)).arc_length_meters for t in ts])
    # 弧长速度 = 实际地面速度(弧线已含曲线)
    dt = 1.0 / fps
    arc_vel = np.gradient(arc, dt)
    # 标称:每个 stride_meters 对应一个完整步态周期;相位速度 = arc_vel / stride
    # 与 1 的偏差即脚滑程度。给出均值、峰值与超阈值时段。
    phase_rate = arc_vel / stride
    mean = float(np.mean(phase_rate))
    peak = float(np.max(np.abs(phase_rate - mean)))
    return {
        "ok": True,
        "stride_meters": stride,
        "mean_phase_rate": round(mean, 3),
        "peak_deviation": round(peak, 3),
        "arc_vel_mean_mps": round(float(np.mean(arc_vel)), 3),
        "arc_vel_cv": round(float(np.std(arc_vel) / max(np.mean(arc_vel), 1e-9)), 3),
    }
