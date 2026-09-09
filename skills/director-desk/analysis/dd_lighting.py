"""
光照前向模型与反解。

复刻 three.js 的 punctual light 衰减(getDistanceAttenuation / getSpotAttenuation),
对走位路径采样点逐灯求辐照度,不渲染即可得到整条跑道的照度剖面。

反解:把「每盏灯的强度」当未知量,辐照度对其近似线性,用带边界的
scipy.optimize.lsq_linear 解出命中目标照度剖面的一组强度。
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from scipy.optimize import lsq_linear


def _srgb_to_linear_channel(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_color_to_linear_rgb(hex_color: str) -> np.ndarray:
    """#rrggbb → 线性 RGB 三元组(three 在 physicallyCorrect 下用线性空间着色)。"""
    h = hex_color.lstrip("#")
    srgb = np.array([int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)])
    return np.array([_srgb_to_linear_channel(float(c)) for c in srgb])


def _rotation_to_direction(rotation: np.ndarray) -> np.ndarray:
    """实体 rotation(弧度) 作用在局部 -Z 上,得到世界系光轴方向。

    three.js 灯光 target 是实体的子节点(局部 [0,0,-1]),光轴随实体朝向。
    按 XYZ 顺序应用欧拉角,等价于 three 的默认 Euler order。
    """
    rx, ry, rz = float(rotation[0]), float(rotation[1]), float(rotation[2])
    # 局部 -Z
    v = np.array([0.0, 0.0, -1.0])
    # Rx
    cx, sx = math.cos(rx), math.sin(rx)
    v = np.array([v[0], cx * v[1] - sx * v[2], sx * v[1] + cx * v[2]])
    # Ry
    cy, sy = math.cos(ry), math.sin(ry)
    v = np.array([cy * v[0] + sy * v[2], v[1], -sy * v[0] + cy * v[2]])
    # Rz
    cz, sz = math.cos(rz), math.sin(rz)
    v = np.array([cz * v[0] - sz * v[1], sz * v[0] + cz * v[1], v[2]])
    return v


def _distance_attenuation(distance: float, cutoff: float, decay: float) -> float:
    """three getDistanceAttenuation: 1/max(d^decay, 0.01) * 截止窗口。"""
    falloff = 1.0 / max(distance**decay, 0.01)
    if cutoff > 0.0:
        ratio = distance / cutoff
        window = max(0.0, 1.0 - ratio**4)
        falloff *= window * window
    return falloff


def _spot_attenuation(cos_angle: float, cone_cos: float, penumbra_cos: float) -> float:
    """three getSpotAttenuation: smoothstep(coneCosine, penumbraCosine, angleCosine)。"""
    # GLSL smoothstep(edge0, edge1, x)
    if penumbra_cos == cone_cos:
        return 1.0 if cos_angle >= penumbra_cos else 0.0
    t = (cos_angle - cone_cos) / (penumbra_cos - cone_cos)
    t = min(max(t, 0.0), 1.0)
    return t * t * (3.0 - 2.0 * t)


@dataclass
class SceneLight:
    id: str
    type: str  # directional | point | spot
    color_linear: np.ndarray  # (3,)
    intensity: float
    position: np.ndarray  # (3,)
    direction: np.ndarray  # (3,) 世界系,spot/directional 有效
    distance: float
    decay: float
    cone_cos: float  # spot 半角余弦
    penumbra_cos: float

    @classmethod
    def from_entity(cls, entity: dict) -> "SceneLight":
        light = entity["light"]
        transform = entity["transform"]
        light_type = light["type"]
        angle_rad = math.radians(float(light.get("angleDegrees", 180.0)))
        cone_cos = math.cos(angle_rad)
        penumbra = float(light.get("penumbra", 0.0))
        # three: penumbra 内缩光锥有效角;penumbraCos = cos(angle*(1-penumbra))
        penumbra_cos = math.cos(angle_rad * (1.0 - penumbra))
        return cls(
            id=entity["id"],
            type=light_type,
            color_linear=hex_color_to_linear_rgb(light["color"]),
            intensity=float(light["intensity"]),
            position=np.array(transform["position"], dtype=float),
            direction=_rotation_to_direction(np.array(transform["rotation"], dtype=float)),
            distance=float(light.get("distance", 0.0)),
            decay=float(light.get("decay", 2.0)),
            cone_cos=cone_cos,
            penumbra_cos=penumbra_cos,
        )

    def irradiance_factor_at(self, point: np.ndarray) -> float:
        """单位强度下该灯在 point 的辐照度系数(未乘颜色/强度)。"""
        if self.type == "directional":
            return 1.0
        to_point = point - self.position
        d = float(np.linalg.norm(to_point))
        base = _distance_attenuation(d, self.distance, self.decay)
        if self.type == "point":
            return base
        # spot
        if d == 0.0:
            return base
        dir_to_point = to_point / d
        cos_angle = float(np.dot(dir_to_point, self.direction))
        return base * _spot_attenuation(cos_angle, self.cone_cos, self.penumbra_cos)


def build_lights(entities: list[dict]) -> list[SceneLight]:
    return [SceneLight.from_entity(e) for e in entities if e.get("kind") == "light" and e.get("light")]


def irradiance_matrix(lights: list[SceneLight], points: np.ndarray) -> np.ndarray:
    """A[i, j] = 灯 j 在采样点 i 的单位强度辐照度。形状 (n_points, n_lights)。"""
    n = len(points)
    m = len(lights)
    A = np.zeros((n, m))
    for j, light in enumerate(lights):
        if light.type == "directional":
            A[:, j] = 1.0
        else:
            for i in range(n):
                A[i, j] = light.irradiance_factor_at(points[i])
    return A


def irradiance_profile(lights: list[SceneLight], points: np.ndarray) -> np.ndarray:
    """各采样点的总辐照度(标量,颜色取亮度)。"""
    A = irradiance_matrix(lights, points)
    intensities = np.array([l.intensity for l in lights])
    luminance_weight = np.array([float(np.dot(l.color_linear, [0.2126, 0.7152, 0.0722])) for l in lights])
    return A @ (intensities * luminance_weight)


def solve_intensities(
    lights: list[SceneLight],
    points: np.ndarray,
    target: np.ndarray,
    intensity_bounds: tuple[float, float] = (0.0, 100.0),
) -> dict:
    """反解一组强度,使路径上照度逼近 target。

    只调强度,不动位置/朝向/颜色。directional 不衰减,权重恒 1,会主导解,
    故默认把它排除在可调之外(它通常承担整体基调,不是局部补光手段)。
    """
    tunable = [i for i, l in enumerate(lights) if l.type != "directional"]
    if not tunable:
        return {"ok": False, "reason": "无可调灯(全部 directional)", "intensities": {}}
    A = irradiance_matrix(lights, points)
    fixed = np.zeros(len(lights))
    for i, l in enumerate(lights):
        if l.type == "directional":
            fixed[i] = l.intensity
    luminance_weight = np.array([float(np.dot(l.color_linear, [0.2126, 0.7152, 0.0722])) for l in lights])
    residual_target = target - A @ (fixed * luminance_weight)

    A_tunable = A[:, tunable] * luminance_weight[tunable]
    result = lsq_linear(A_tunable, residual_target, bounds=intensity_bounds)
    solved = {lights[i].id: float(result.x[k]) for k, i in enumerate(tunable)}
    return {
        "ok": bool(result.success),
        "intensities": solved,
        "residual_norm": float(np.linalg.norm(result.fun)),
        "points": len(points),
    }
