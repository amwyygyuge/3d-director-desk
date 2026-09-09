"""
导演台运行采样器的离线镜像。

与运行时的对应关系(逐行移植,不要"优化"掉任何分支):
  MotionTrajectory        -> Trajectory        (段级三次 Bézier + 自动手柄 + 弧长表)
  AutoHandleSolver        -> _tangent_component(端点镜像虚拟点)
  TimelineSampler         -> evaluate_transform_track(hold 钳位 + grounded + path 朝向 + 弧长)
  CameraMotionClip        -> CameraClip        (整段 easing 后定位段,段内线性 target/fov)
  SubjectFrameResolver    -> SubjectFrameResolver(lag + 5 抽头平滑 + 锚点,只取 yaw)

为什么必须镜像而非近似:任何「在 Python 里算一遍」的判定(速度/遮挡/曝光剖面)只有与
运行时同一求值规则时才可证伪;用通用样条近似会测出运行时不存在的顿点。
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional, Sequence

import numpy as np

# MotionTrajectory.ts
CATMULL_ROM_TANGENT_WEIGHT = 1.0 / 6.0
ARC_SAMPLES_PER_SEGMENT = 16
# TimelineSampler.ts applyPolicies
GROUND_HEIGHT_METERS = 0.0
# SubjectFrameResolver.ts
FOLLOW_SMOOTHING_TAPS = 5
SINGLE_TAP = 1
TAP_WINDOW_CENTER = 0.5

Vec3 = Sequence[float]


def _tangent_component(points: np.ndarray, index: int, axis: int) -> float:
    """AutoHandleSolver.tangentComponent:端点用镜像虚拟点补齐。"""
    current = points[index, axis]
    previous = points[index - 1, axis] if index > 0 else None
    nxt = points[index + 1, axis] if index + 1 < len(points) else None
    from_ = previous if previous is not None else (current if nxt is None else 2.0 * current - nxt)
    to = nxt if nxt is not None else (current if previous is None else 2.0 * current - previous)
    return (to - from_) * CATMULL_ROM_TANGENT_WEIGHT


def _cubic(from_: float, c1: float, c2: float, to: float, p: float) -> float:
    inv = 1.0 - p
    return (
        inv * inv * inv * from_
        + 3.0 * inv * inv * p * c1
        + 3.0 * inv * p * p * c2
        + p * p * p * to
    )


class Trajectory:
    """MotionTrajectory 的离线镜像:构造期解算控制点与弧长表,采样零分支。"""

    def __init__(self, keys: list[dict]):
        if len(keys) < 2:
            raise ValueError("Trajectory requires at least two keys")
        ordered = sorted(keys, key=lambda k: k["progress"])
        progresses = [k["progress"] for k in ordered]
        if len(set(progresses)) != len(progresses):
            raise ValueError("Trajectory key progress values must be unique")
        self.keys = ordered
        self.progress = np.array(progresses, dtype=float)
        self.positions = np.array([k["position"] for k in ordered], dtype=float)  # (n,3)
        self._controls = self._solve_control_points()  # (seg, 2, 3): [c1, c2]
        self._arc_lengths = self._solve_arc_lengths()

    def _solve_control_points(self) -> np.ndarray:
        n = len(self.keys)
        controls = np.zeros((n - 1, 2, 3))
        for seg in range(n - 1):
            c1 = np.array(self.keys[seg]["position"], dtype=float) + self._handle(seg, "out")
            c2 = np.array(self.keys[seg + 1]["position"], dtype=float) + self._handle(seg + 1, "in")
            controls[seg, 0] = c1
            controls[seg, 1] = c2
        return controls

    def _handle(self, index: int, which: str) -> np.ndarray:
        key = self.keys[index]
        if key.get("handleMode") == "manual":
            return np.array(key[which + "Handle"], dtype=float)
        # auto: Catmull-Rom 切线,in 手柄是 out 的镜像(AutoHandleSolver.solve)
        t = np.array(
            [_tangent_component(self.positions, index, axis) for axis in range(3)],
            dtype=float,
        )
        return t if which == "out" else -t

    # ---- 段定位(MotionTrajectory.segmentIndexAt / segmentProgress) ----
    @property
    def segment_count(self) -> int:
        return len(self.keys) - 1

    def segment_index_at(self, progress: float) -> int:
        last = self.segment_count - 1
        idx = int(np.searchsorted(self.progress, progress, side="right")) - 1
        return min(max(idx, 0), last)

    def segment_progress(self, progress: float, segment_index: int) -> float:
        a = self.keys[segment_index]["progress"]
        b = self.keys[segment_index + 1]["progress"]
        span = b - a
        local = 0.0 if span == 0 else (progress - a) / span
        return min(max(local, 0.0), 1.0)

    # ---- 求值 ----
    def sample_segment(self, segment_index: int, local: float) -> np.ndarray:
        from_ = self.positions[segment_index]
        to = self.positions[segment_index + 1]
        c1 = self._controls[segment_index, 0]
        c2 = self._controls[segment_index, 1]
        return np.array(
            [
                _cubic(from_[ax], c1[ax], c2[ax], to[ax], local)
                for ax in range(3)
            ]
        )

    def sample(self, progress: float) -> np.ndarray:
        seg = self.segment_index_at(progress)
        return self.sample_segment(seg, self.segment_progress(progress, seg))

    def sample_tangent(self, progress: float) -> np.ndarray:
        seg = self.segment_index_at(progress)
        local = self.segment_progress(progress, seg)
        from_ = self.positions[seg]
        to = self.positions[seg + 1]
        c1 = self._controls[seg, 0]
        c2 = self._controls[seg, 1]
        inv = 1.0 - local
        return np.array(
            [
                3.0
                * (
                    inv * inv * (c1[ax] - from_[ax])
                    + 2 * inv * local * (c2[ax] - c1[ax])
                    + local * local * (to[ax] - c2[ax])
                )
                for ax in range(3)
            ]
        )

    # ---- 弧长表(构造期一次,与运行时同形) ----
    def _solve_arc_lengths(self) -> np.ndarray:
        sample_count = self.segment_count * ARC_SAMPLES_PER_SEGMENT
        lengths = np.zeros(sample_count + 1)
        prev = self.sample(0.0)
        for step in range(1, sample_count + 1):
            cur = self.sample(step / sample_count)
            lengths[step] = lengths[step - 1] + float(np.linalg.norm(cur - prev))
            prev = cur
        return lengths

    @property
    def total_length(self) -> float:
        return float(self._arc_lengths[-1])

    def arc_length_at(self, progress: float) -> float:
        sample_count = self.segment_count * ARC_SAMPLES_PER_SEGMENT
        clamped = min(max(progress, 0.0), 1.0)
        pos = clamped * sample_count
        index = min(int(math.floor(pos)), sample_count - 1)
        from_ = self._arc_lengths[index]
        to = self._arc_lengths[index + 1]
        return float(from_ + (to - from_) * (pos - index))


def _eased(easing: str, p: float) -> float:
    return p * p * (3.0 - 2.0 * p) if easing == "smooth" else p


@dataclass
class TransformSample:
    position: np.ndarray
    rotation: np.ndarray
    scale: np.ndarray
    arc_length_meters: float


def _copy(v) -> np.ndarray:
    return np.array(v, dtype=float)


class TransformTrack:
    """TimelineSampler.evaluateTransformTrack 的离线镜像(hold 钳位 + grounded + path 朝向)。"""

    def __init__(self, track: dict):
        self.target_id = track.get("targetId")
        self.keyframes = sorted(track.get("keyframes") or [], key=lambda k: k["time"])
        policies = track.get("policies") or {}
        self.grounded = policies.get("grounding") == "ground"
        self.path_oriented = policies.get("orientation") == "path"
        self.holds_outside = policies.get("extrapolation", "hold") == "hold"
        self.stride_meters = float(policies.get("strideMeters") or 1.6)
        keys = [
            {
                "id": k.get("id"),
                "progress": 0.0,  # 归一化在 build_trajectory 内做
                "position": k["value"]["position"],
                "inHandle": k.get("inHandle") or [0, 0, 0],
                "outHandle": k.get("outHandle") or [0, 0, 0],
                "handleMode": k.get("handleMode") or "auto",
            }
            for k in self.keyframes
        ]
        first_t = self.keyframes[0]["time"] if self.keyframes else 0.0
        last_t = self.keyframes[-1]["time"] if self.keyframes else 0.0
        span = last_t - first_t
        # 归一化 progress(与 buildTransformTrajectory 一致)
        traj_keys = []
        for keyframe, tk in zip(self.keyframes, keys):
            tk = dict(tk)
            tk["progress"] = 0.0 if span <= 0 else (keyframe["time"] - first_t) / span
            traj_keys.append(tk)
        self.trajectory: Optional[Trajectory] = Trajectory(traj_keys) if len(traj_keys) >= 2 else None
        self._eval_cache: dict[float, Optional[TransformSample]] = {}

    @property
    def first_time(self) -> float:
        return self.keyframes[0]["time"]

    @property
    def last_time(self) -> float:
        return self.keyframes[-1]["time"]

    def evaluate(self, t: float) -> Optional[TransformSample]:
        t = round(float(t), 6)
        cached = self._eval_cache.get(t)
        if cached is not None:
            return cached
        result = self._evaluate_uncached(t)
        self._eval_cache[t] = result
        return result

    def _evaluate_uncached(self, t: float) -> Optional[TransformSample]:
        first = self.keyframes[0]
        last = self.keyframes[-1]
        before = t < first["time"]
        after = t > last["time"]
        if (before or after) and not self.holds_outside:
            return None

        out = TransformSample(_copy([0, 0, 0]), _copy([0, 0, 0]), _copy([1, 1, 1]), 0.0)

        def emit(segment_index: int, local_progress: float, keyframe_value: dict):
            out.position = _copy(keyframe_value["position"])
            out.rotation = _copy(keyframe_value["rotation"])
            out.scale = _copy(keyframe_value["scale"])
            self._apply_policies(out, segment_index, local_progress)

        if before or t == first["time"] or len(self.keyframes) == 1:
            emit(0, 0.0, first["value"])
            return out
        if after or t == last["time"]:
            emit(max(0, (self.trajectory.segment_count - 1) if self.trajectory else 0), 1.0, last["value"])
            return out

        # 段内:easing 后的进度同时喂给直线字段与曲线
        times = [k["time"] for k in self.keyframes]
        import bisect

        upper = bisect.bisect_right(times, t)
        right = self.keyframes[upper]
        left = self.keyframes[upper - 1]
        span = right["time"] - left["time"]
        p = 0.0 if span == 0 else (t - left["time"]) / span
        eased = _eased(right.get("easing") or "linear", p)
        # rotation/scale 线性
        out.rotation = _copy(left["value"]["rotation"]) + (
            _copy(right["value"]["rotation"]) - _copy(left["value"]["rotation"])
        ) * eased
        out.scale = _copy(left["value"]["scale"]) + (
            _copy(right["value"]["scale"]) - _copy(left["value"]["scale"])
        ) * eased
        seg = upper - 1
        if self.trajectory is not None:
            out.position = self.trajectory.sample_segment(seg, eased)
        else:
            out.position = _copy(left["value"]["position"]) + (
                _copy(right["value"]["position"]) - _copy(left["value"]["position"])
            ) * eased
        self._apply_policies(out, seg, eased)
        return out

    def _apply_policies(self, out: TransformSample, segment_index: int, local_progress: float) -> None:
        if self.grounded:
            out.position[1] = GROUND_HEIGHT_METERS
        traj = self.trajectory
        if traj is None:
            out.arc_length_meters = 0.0
            return
        a = traj.keys[segment_index]["progress"]
        b = traj.keys[segment_index + 1]["progress"]
        global_progress = a + local_progress * (b - a)
        out.arc_length_meters = traj.arc_length_at(global_progress)
        if not self.path_oriented:
            return
        tangent = traj.sample_tangent(global_progress)
        if tangent[0] == 0 and tangent[2] == 0:
            return
        # 模型正面 -Z:yaw = atan2(-x, -z)
        out.rotation = np.array([0.0, math.atan2(-tangent[0], -tangent[2]), 0.0])


class SubjectFrame:
    """SubjectFrameSample 的离线镜像:origin + cos/sin 形式 yaw。"""

    def __init__(self, origin: np.ndarray, yaw_cos: float, yaw_sin: float):
        self.origin = origin
        self.yaw_cos = yaw_cos
        self.yaw_sin = yaw_sin

    def to_world(self, local: np.ndarray) -> np.ndarray:
        x, y, z = float(local[0]), float(local[1]), float(local[2])
        return np.array(
            [
                self.origin[0] + self.yaw_cos * x + self.yaw_sin * z,
                self.origin[1] + y,
                self.origin[2] - self.yaw_sin * x + self.yaw_cos * z,
            ]
        )


class SubjectFrameResolver:
    """SubjectFrameResolver.resolveFrame 的离线镜像:lag + 抽头平滑 + 锚点。"""

    def __init__(self, tracks_by_target: dict[str, TransformTrack]):
        self.tracks_by_target = tracks_by_target

    def _clamp_to_track_span(self, track: TransformTrack, t: float) -> float:
        return min(max(t, track.first_time), track.last_time)

    def resolve_frame(self, follow: dict, t: float) -> Optional[SubjectFrame]:
        object_id = follow["objectId"]
        track = self.tracks_by_target.get(object_id)
        if track is None:
            return None
        lagged = t - float(follow.get("lagSeconds") or 0.0)
        smoothing = float(follow.get("smoothingSeconds") or 0.0)
        taps = FOLLOW_SMOOTHING_TAPS if smoothing > 0 else SINGLE_TAP
        frame_kind = follow.get("frame") or "world"

        sx = sy = sz = 0.0
        cos_sum = sin_sum = 0.0
        for i in range(taps):
            ratio = 0.0 if taps == SINGLE_TAP else i / (taps - 1) - TAP_WINDOW_CENTER
            tap_time = self._clamp_to_track_span(track, lagged + ratio * smoothing)
            pose = track.evaluate(tap_time)
            if pose is None:
                return None
            yaw = 0.0 if frame_kind == "world" else float(pose.rotation[1])
            sx += pose.position[0]
            sy += pose.position[1]
            sz += pose.position[2]
            cos_sum += math.cos(yaw)
            sin_sum += math.sin(yaw)
        length = math.hypot(cos_sum, sin_sum)
        yaw_cos = 1.0 if length == 0 else cos_sum / length
        yaw_sin = 0.0 if length == 0 else sin_sum / length

        anchor = np.array(follow.get("anchorOffset") or [0, 0, 0], dtype=float)
        root = np.array([sx / taps, sy / taps, sz / taps])
        origin = np.array(
            [
                root[0] + yaw_cos * anchor[0] + yaw_sin * anchor[2],
                root[1] + anchor[1],
                root[2] - yaw_sin * anchor[0] + yaw_cos * anchor[2],
            ]
        )
        return SubjectFrame(origin, yaw_cos, yaw_sin)


@dataclass
class CameraSample:
    position: np.ndarray
    target: np.ndarray
    fov: float


class CameraClip:
    """CameraMotionClip + CameraFrameSolver 的离线镜像(整段 easing,follow 参考系,段内线性 target/fov)。"""

    def __init__(self, clip: dict, resolver: SubjectFrameResolver):
        self.id = clip.get("id")
        self.start = float(clip["startTimeSeconds"])
        self.duration = float(clip["durationSeconds"])
        self.end = self.start + self.duration
        self.easing = clip.get("easing") or "linear"
        self.follow = clip.get("follow")
        self.focus = clip.get("focus")
        self.resolver = resolver
        keys = [
            {
                "id": k.get("id"),
                "progress": float(k["progress"]),
                "position": k["position"],
                "inHandle": k.get("inHandle") or [0, 0, 0],
                "outHandle": k.get("outHandle") or [0, 0, 0],
                "handleMode": k.get("handleMode") or "auto",
                "target": k["target"],
                "fov": float(k["fov"]),
            }
            for k in clip["keys"]
        ]
        self.key_data = sorted(keys, key=lambda k: k["progress"])
        self.trajectory = Trajectory(self.key_data)

    def covers(self, t: float) -> bool:
        return self.start <= t <= self.end

    def solve(self, t: float) -> Optional[CameraSample]:
        if not self.covers(t):
            return None
        progress = _eased(self.easing, (t - self.start) / self.duration)
        traj = self.trajectory
        seg = traj.segment_index_at(progress)
        local = traj.segment_progress(progress, seg)
        position = traj.sample_segment(seg, local)

        frame = None
        if self.follow:
            frame = self.resolver.resolve_frame(self.follow, t)
            if frame is None:
                return None
            position = frame.to_world(position)

        from_k = self.key_data[seg]
        to_k = self.key_data[seg + 1]
        target = _copy(from_k["target"]) + (_copy(to_k["target"]) - _copy(from_k["target"])) * local
        if frame is not None:
            target = frame.to_world(target)
        fov = from_k["fov"] + (to_k["fov"] - from_k["fov"]) * local
        return CameraSample(position=position, target=target, fov=fov)
