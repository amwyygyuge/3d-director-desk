/**
 * 运动学审计与匀速走位构建 —— 依赖 geometry-audit.js 先注入。
 *
 * 解决的问题:走位轨在转角处减速、直线段突然加速,看起来"一顿一顿"。
 * 根因是样条切线在关键帧处的不连续 + 关键帧时间未按弧长分配。
 */
(() => {
    const C = window.__auditCore;
    if (!C) throw new Error("先注入 geometry-audit.js");

    /**
     * 速度曲线统计。
     *
     * **测量步长必须 >= 0.1s。** step=0.05 时 seek 的时间量化误差被除以极小 dt 放大成假波动:
     * 同一条已匀速的轨迹在 0.05s 下测得 CV=0.336、速度范围 1.64~4.94,
     * 在 0.2s 下测得 CV=0.023、范围 3.29~3.70。前者全是噪声。
     * 判定"顿不顿"用 0.2s;只有排查单帧异常才用更细步长,且结论要交叉验证。
     */
    function speedProfile(id, { step = 0.2, t0 = 0, t1 = null } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const samples = [];
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            const p = C.runtimePose(id);
            if (p) samples.push({ t: +t.toFixed(3), pos: p.pos });
        }
        const v = [];
        for (let i = 1; i < samples.length; i++) {
            const a = samples[i].pos;
            const b = samples[i - 1].pos;
            v.push({ t: samples[i].t, sp: Math.hypot(a[0] - b[0], a[2] - b[2]) / step });
        }
        if (!v.length) return null;
        const sp = v.map((x) => x.sp);
        const mean = sp.reduce((a, b) => a + b, 0) / sp.length;
        const sd = Math.sqrt(sp.reduce((s, x) => s + (x - mean) ** 2, 0) / sp.length);
        // 顿点 = 局部极小且低于均值 60%
        const dips = [];
        for (let i = 2; i < v.length - 2; i++) {
            if (v[i].sp < v[i - 2].sp && v[i].sp < v[i + 2].sp && v[i].sp < mean * 0.6) {
                dips.push({ t: v[i].t, speed: +v[i].sp.toFixed(2) });
            }
        }
        return {
            pass: sd / mean < 0.2 && dips.length === 0,
            meanSpeed: +mean.toFixed(2),
            cv: +(sd / mean).toFixed(3),
            min: +Math.min(...sp).toFixed(2),
            max: +Math.max(...sp).toFixed(2),
            dipCount: dips.length,
            dips: dips.slice(0, 8),
            measureStep: step,
        };
    }

    /**
     * 构建匀速绕障走位轨。三件事一起做,少一件就会顿:
     *  1. 关键帧时间按累积弦长分配 —— 等弧长等时间 = 匀速。
     *  2. 手柄按相邻段长自适应(Catmull-Rom / 3),不是固定系数。
     *     固定 0.5 会过冲(实测峰值偏移达声明值 2.3 倍);零手柄会让每个关键帧都刹车(CV 0.61、25 处顿点)。
     *  3. easing 用 linear。smooth 是整段时间曲线,会在首尾加减速。
     *
     * 参数关系(闭式,别试):绕行幅度 `offset >= 障碍半宽 + 身体半径 0.32 + 目标间隙 0.85`。
     * 加大 offset 会挤占邻道,须同步放宽 `laneX`;`__audit.penetration` 会同时报这两项。
     */
    function buildLanes(spec) {
        const {
            lanes, // [{ trackId, objectId, laneX, obstacleZ: [...], sides: [...] }]
            z0,
            z1,
            duration,
            offset,
            ramp = 4.0,
            hold = 2.6,
            actionAssetId = "builtin.action.running",
        } = spec;
        const log = [];
        for (const tr of C.q("timeline.get-document").tracks ?? []) {
            for (const k of tr.keyframes ?? []) C.d("timeline.remove-key", { trackId: tr.id, keyframeId: k.id });
        }
        for (const lane of lanes) {
            const pts = [[z0, lane.laneX]];
            lane.obstacleZ.forEach((zo, i) => {
                const s = lane.sides[i];
                pts.push([zo + ramp, lane.laneX]);
                pts.push([zo + hold, lane.laneX + s * offset]);
                pts.push([zo - hold, lane.laneX + s * offset]);
                pts.push([zo - ramp, lane.laneX]);
            });
            pts.push([z1, lane.laneX]);
            pts.sort((a, b) => b[0] - a[0]);
            const poly = pts.map(([z, x]) => [x, 0, z]);

            const cum = [0];
            for (let i = 1; i < poly.length; i++) {
                cum.push(cum[i - 1] + Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][2] - poly[i - 1][2]));
            }
            const total = cum[cum.length - 1];

            for (let i = 0; i < poly.length; i++) {
                const prev = poly[Math.max(0, i - 1)];
                const next = poly[Math.min(poly.length - 1, i + 1)];
                const chord = Math.hypot(next[0] - prev[0], next[2] - prev[2]) || 1;
                const dir = [(next[0] - prev[0]) / chord, 0, (next[2] - prev[2]) / chord];
                const segLen = Math.min(
                    i > 0 ? Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][2] - poly[i - 1][2]) : Infinity,
                    i < poly.length - 1
                        ? Math.hypot(poly[i + 1][0] - poly[i][0], poly[i + 1][2] - poly[i][2])
                        : Infinity,
                );
                const h = Math.min(segLen, chord) / 3;
                C.d("timeline.add-key", {
                    trackId: lane.trackId,
                    targetId: lane.objectId,
                    keyframe: {
                        id: `${lane.trackId}-k${i}`,
                        time: +((cum[i] / total) * duration).toFixed(4),
                        value: {
                            position: [+poly[i][0].toFixed(4), 0, +poly[i][2].toFixed(4)],
                            rotation: [0, 0, 0],
                            scale: [1, 1, 1],
                        },
                        easing: "linear",
                        handleMode: "manual",
                        inHandle: [-dir[0] * h, 0, -dir[2] * h],
                        outHandle: [dir[0] * h, 0, dir[2] * h],
                    },
                });
            }
            C.d("timeline.set-track-policies", {
                trackId: lane.trackId,
                policies: {
                    orientation: "path",
                    grounding: "ground",
                    locomotion: "sync",
                    extrapolation: "hold",
                },
            });
            // 参数搜索会反复 unmount/mount;构建完必须补挂,否则留在卸载态(实测动作整批丢失)
            const ks = (C.q("timeline.get-document").tracks.find((t) => t.id === lane.trackId).keyframes ?? [])
                .slice()
                .sort((a, b) => a.time - b.time);
            C.d("assets.mount", {
                assetId: actionAssetId,
                objectId: lane.objectId,
                alignToTrack: { trackId: lane.trackId, fromKeyframeId: ks[0].id, toKeyframeId: ks[ks.length - 1].id },
            });
            log.push({ trackId: lane.trackId, pathLength: +total.toFixed(2), keys: poly.length });
        }
        return { lanes: log, impliedSpeed: +(log[0].pathLength / duration).toFixed(2) };
    }

    /** 按目标跑速反解时长。人类跑步 3~4.5 m/s;超过 5 就明显是快放。 */
    function durationForSpeed(pathLength, targetSpeed = 3.7) {
        return +(pathLength / targetSpeed).toFixed(1);
    }

    window.__kine = { speedProfile, buildLanes, durationForSpeed };
    return "kinematics installed: __kine.{speedProfile,buildLanes,durationForSpeed}";
})();
