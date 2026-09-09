#!/usr/bin/env python3
"""导演台离线美学审计:读工程 JSON,跑四项第一梯队判定。

用法:
  python analyze.py "director-desk-scene.json"
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from dd_sampler import CameraClip, SubjectFrameResolver, TransformTrack
from dd_lighting import build_lights, irradiance_profile, solve_intensities
from dd_camera import (
    continuity_report,
    foot_skate,
    sample_clip_dynamics,
    shot_size_label,
    subject_height_percent,
)


def load_doc(path: str) -> dict:
    return json.loads(Path(path).read_text())


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: analyze.py <scene.json>", file=sys.stderr)
        return 2
    doc = load_doc(sys.argv[1])

    entities = doc["entities"]
    tracks = {t["targetId"]: TransformTrack(t) for t in doc["timeline"]["tracks"]}
    resolver = SubjectFrameResolver(tracks)
    clips = [CameraClip(c, resolver) for c in doc["motion"]["clips"]]
    lights = build_lights(entities)

    report: dict = {"scene": sys.argv[1], "version": doc.get("version")}

    # ---- 1. 光照前向模型 ----
    # 沿三条走位路径在腰部高度采样
    sample_points = []
    for tid in ("runnerA", "runnerB", "runnerC"):
        tr = tracks.get(tid)
        if not tr:
            continue
        for i in range(41):
            t = tr.first_time + (tr.last_time - tr.first_time) * i / 40.0
            s = tr.evaluate(t)
            p = s.position.copy()
            p[1] = 0.9  # 腰部
            sample_points.append(p)
    pts = np.array(sample_points)
    prof = irradiance_profile(lights, pts)
    report["lighting"] = {
        "sample_points": len(pts),
        "irradiance": {
            "min": round(float(prof.min()), 3),
            "max": round(float(prof.max()), 3),
            "mean": round(float(prof.mean()), 3),
            "cv": round(float(prof.std() / max(prof.mean(), 1e-9)), 3),
        },
        "per_light_contribution_mean": {},
    }
    from dd_lighting import irradiance_matrix

    A = irradiance_matrix(lights, pts)
    for j, l in enumerate(lights):
        contrib = float(np.mean(A[:, j] * l.intensity))
        report["lighting"]["per_light_contribution_mean"][l.id] = round(contrib, 3)

    # 反解:让照度剖面拉平到当前均值的 1.2 倍
    target = np.full(len(pts), float(prof.mean()) * 1.2)
    solved = solve_intensities(lights, pts, target)
    report["lighting"]["inverse_solve"] = solved

    # ---- 2. 相机动力学 ----
    report["camera"] = {}
    for clip in clips:
        dyn = sample_clip_dynamics(clip, fps=60)
        report["camera"][clip.id] = {
            "speed_mps": {"mean": round(float(dyn.speed.mean()), 2), "max": round(float(dyn.speed.max()), 2)},
            "accel_mps2": {"mean": round(float(dyn.accel.mean()), 2), "max": round(float(dyn.accel.max()), 2)},
            "jerk_mps3": {"mean": round(float(dyn.jerk.mean()), 2), "max": round(float(dyn.jerk.max()), 2)},
            "angular_speed_degs": {"mean": round(float(dyn.angular_speed.mean()), 1), "max": round(float(dyn.angular_speed.max()), 1)},
            "fov_rate_degs": {"mean": round(float(dyn.fov_rate.mean()), 2), "max": round(float(dyn.fov_rate.max()), 2)},
        }
        # 景别
        if clip.follow:
            tid = clip.follow["objectId"]
            hp = subject_height_percent(clip, tracks[tid], (clip.start + clip.end) / 2.0)
            report["camera"][clip.id]["shot_size_mid"] = {
                "height_percent": round(hp, 1) if hp is not None else None,
                "label": shot_size_label(hp) if hp is not None else None,
            }

    # ---- 3. 连续性 180°/30° ----
    report["continuity"] = continuity_report(clips, tracks)

    # ---- 4. 脚滑 ----
    report["foot_skate"] = {tid: foot_skate(tr) for tid, tr in tracks.items()}

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
