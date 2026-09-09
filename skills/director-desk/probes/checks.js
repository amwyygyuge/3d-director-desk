/**
 * 导演台四项数值判定 —— 依赖 geometry-audit.js 先注入。
 *
 * 每项都返回可证伪的数字,失败时带首个违规时刻与对象 id,直接指向要改哪个实体。
 * 判定顺序即修复优先级:穿模 → 遮挡 → 视觉踩盒 → 构图。
 */
(() => {
    const C = window.__auditCore;
    if (!C) throw new Error("先注入 geometry-audit.js");

    /** 人偶采样点:胶囊近似。半径 0.32 是人偶肩宽的一半。 */
    const BODY_HEIGHTS = [0.2, 0.5, 0.9, 1.3, 1.7];
    const BODY_RADIUS = 0.32;
    const ACTOR_HEIGHT = 1.75;

    /**
     * 1) 穿模:人物与障碍物、人物与人物的最小间距。
     * 阈值经验值:人物-障碍 >= 0.85m,人物-人物 >= 1.2m。低于此视觉上就开始"手臂插进对方"。
     */
    function penetration({ t0 = 0, t1 = null, step = 0.1, actors, obstaclePattern } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const ids = actors ?? defaultActors();
        const worstObs = {};
        const worstPair = {};
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            const boxes = C.obstacles(obstaclePattern);
            const poses = {};
            for (const id of ids) {
                const p = C.runtimePose(id);
                if (!p) continue;
                poses[id] = p.pos;
                for (const b of boxes) {
                    let m = Infinity;
                    for (const hy of BODY_HEIGHTS) {
                        m = Math.min(m, C.pointBoxDistance([p.pos[0], p.pos[1] + hy, p.pos[2]], b) - BODY_RADIUS);
                    }
                    const k = `${id}/${b.id}`;
                    if (!worstObs[k] || m < worstObs[k].gap) worstObs[k] = { gap: +m.toFixed(2), t: +t.toFixed(2) };
                }
            }
            for (let i = 0; i < ids.length; i++) {
                for (let j = i + 1; j < ids.length; j++) {
                    const a = poses[ids[i]];
                    const b = poses[ids[j]];
                    if (!a || !b) continue;
                    const gap = Math.hypot(a[0] - b[0], a[2] - b[2]) - BODY_RADIUS * 2;
                    const k = `${ids[i]}/${ids[j]}`;
                    if (!worstPair[k] || gap < worstPair[k].gap)
                        worstPair[k] = { gap: +gap.toFixed(2), t: +t.toFixed(2) };
                }
            }
        }
        const vsObstacle = Object.entries(worstObs)
            .filter(([, v]) => v.gap < 0.85)
            .sort((a, b) => a[1].gap - b[1].gap);
        const vsActor = Object.entries(worstPair)
            .filter(([, v]) => v.gap < 1.2)
            .sort((a, b) => a[1].gap - b[1].gap);
        const minOf = (obj) => {
            const vals = Object.values(obj).map((v) => v.gap);
            return vals.length ? +Math.min(...vals).toFixed(2) : null;
        };
        const samples = Object.keys(worstObs).length + Object.keys(worstPair).length;
        return {
            // 没有任何采样对 = 场景里没障碍/没主体,这不叫通过,叫没测到
            pass: samples > 0 && vsObstacle.length === 0 && vsActor.length === 0,
            samples,
            minObstacleGap: minOf(worstObs),
            minActorGap: minOf(worstPair),
            violations: { vsObstacle, vsActor },
        };
    }

    /**
     * 2) 视线遮挡:相机 → 主体身体网格的线段对每个障碍盒求交。
     * 每主体 5 高度 × 3 横偏 = 15 个采样点。任一命中即该采样被挡。
     * `camera.check-framing` 只测视锥包含,测不出这个。
     */
    function occlusion({ t0 = 0, t1 = null, step = 0.1, actors, obstaclePattern } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const ids = actors ?? defaultActors();
        let blocked = 0;
        let total = 0;
        let minCamClear = Infinity;
        let firstHit = null;
        let camClearAt = null;
        const byBlocker = {};
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            const basis = C.cameraBasis();
            if (!basis) continue;
            const boxes = C.obstacles(obstaclePattern);
            for (const b of boxes) {
                const dist = C.pointBoxDistance(basis.cam, b);
                if (dist < minCamClear) {
                    minCamClear = dist;
                    camClearAt = { t: +t.toFixed(2), id: b.id };
                }
            }
            for (const id of ids) {
                const p = C.runtimePose(id);
                if (!p) continue;
                for (const hy of BODY_HEIGHTS) {
                    for (const off of [-0.25, 0, 0.25]) {
                        total++;
                        const world = [p.pos[0] + off * basis.right[0], p.pos[1] + hy, p.pos[2] + off * basis.right[2]];
                        for (const b of boxes) {
                            if (C.segmentHitsBox(basis.cam, world, b)) {
                                blocked++;
                                byBlocker[b.id] = (byBlocker[b.id] || 0) + 1;
                                if (!firstHit) firstHit = { t: +t.toFixed(2), actor: id, blocker: b.id };
                                break;
                            }
                        }
                    }
                }
            }
        }
        return {
            pass: blocked === 0 && minCamClear >= 1.5,
            blocked,
            total,
            ratio: +(blocked / Math.max(total, 1)).toFixed(4),
            firstHit,
            byBlocker,
            minCameraClearance: +minCamClear.toFixed(2),
            camClearAt,
        };
    }

    /**
     * 3) 视觉踩盒:主体脚点投影是否落在某个障碍盒顶面的投影范围内。
     * 这是纯屏幕空间错觉 —— 三维上间距充足,高机位下看起来"站在方块上"。
     * 实测视觉复核会连续两次报这个"穿模",而三维间距是 2.26m。
     */
    function visualStanding({ t0 = 0, t1 = null, step = 0.1, actors, obstaclePattern } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const ids = actors ?? defaultActors();
        const hits = [];
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            const basis = C.cameraBasis();
            if (!basis) continue;
            const boxes = C.obstacles(obstaclePattern);
            for (const id of ids) {
                const p = C.runtimePose(id);
                if (!p) continue;
                const foot = C.project(basis, [p.pos[0], p.pos[1] + 0.05, p.pos[2]]);
                if (!foot) continue;
                for (const b of boxes) {
                    const top = [
                        [b.min[0], b.max[1], b.min[2]],
                        [b.max[0], b.max[1], b.min[2]],
                        [b.min[0], b.max[1], b.max[2]],
                        [b.max[0], b.max[1], b.max[2]],
                    ]
                        .map((c) => C.project(basis, c))
                        .filter(Boolean);
                    if (top.length < 4) continue;
                    const xs = top.map((c) => c.nx);
                    const ys = top.map((c) => c.ny);
                    if (
                        foot.nx >= Math.min(...xs) &&
                        foot.nx <= Math.max(...xs) &&
                        foot.ny >= Math.min(...ys) &&
                        foot.ny <= Math.max(...ys)
                    ) {
                        hits.push({ t: +t.toFixed(2), actor: id, box: b.id });
                    }
                }
            }
        }
        return { pass: hits.length === 0, count: hits.length, sample: hits.slice(0, 12) };
    }

    /**
     * 4) 构图:半裁切 / 头顶余量 / 眼高三分线 / 主体尺寸 / 前置空间。
     * 半裁切 = 头脚一个在画内一个在画外,视觉复核会报"只露一半"。
     */
    function composition({ t0 = 0, t1 = null, step = 0.1, actors } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const ids = actors ?? defaultActors();
        let halfCrop = 0;
        let firstCrop = null;
        const headroom = [];
        const eyeNy = [];
        const heightPct = [];
        const leadSpace = [];
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            const basis = C.cameraBasis();
            if (!basis) continue;
            for (const id of ids) {
                const p = C.runtimePose(id);
                if (!p) continue;
                const foot = C.project(basis, [p.pos[0], p.pos[1] + 0.02, p.pos[2]]);
                const head = C.project(basis, [p.pos[0], p.pos[1] + ACTOR_HEIGHT, p.pos[2]]);
                const eye = C.project(basis, [p.pos[0], p.pos[1] + ACTOR_HEIGHT * 0.92, p.pos[2]]);
                if (!foot || !head || !eye) continue;
                const inside = (n) => Math.abs(n.nx) <= 1 && Math.abs(n.ny) <= 1;
                if (inside(foot) !== inside(head)) {
                    halfCrop++;
                    if (!firstCrop) firstCrop = { t: +t.toFixed(2), actor: id };
                }
                if (inside(eye)) {
                    headroom.push(1 - head.ny);
                    eyeNy.push(eye.ny);
                    heightPct.push(Math.abs(head.ny - foot.ny) * 50);
                    // 前置空间:主体前进方向一侧的画框余量
                    const heading = C.vec.dot([-Math.sin(p.yaw), 0, -Math.cos(p.yaw)], basis.right);
                    leadSpace.push(heading >= 0 ? 1 - eye.nx : 1 + eye.nx);
                }
            }
        }
        const stat = (arr) => {
            if (!arr.length) return null;
            const m = arr.reduce((a, b) => a + b, 0) / arr.length;
            return { mean: +m.toFixed(2), min: +Math.min(...arr).toFixed(2), max: +Math.max(...arr).toFixed(2) };
        };
        const hr = stat(headroom);
        const eye = stat(eyeNy);
        return {
            pass: halfCrop === 0 && hr && hr.mean >= 0.3 && hr.mean <= 0.8,
            halfCrop,
            firstCrop,
            headroom: hr,
            eyeLineNy: eye,
            subjectHeightPercent: stat(heightPct),
            leadSpace: stat(leadSpace),
            note: "头顶余量目标 0.3~0.8;眼高 ny 目标 +0.33(上三分线);头顶余量 ≈1.0 表示头顶正好在画面中心,上半屏全空",
        };
    }

    function defaultActors() {
        return (C.q("scene.describe") ?? [])
            .filter(
                (e) =>
                    e.kind === "model" &&
                    e.narrativeIdentity &&
                    /protagonist|antagonist|supporting/.test(e.narrativeIdentity.role),
            )
            .map((e) => e.id);
    }

    /** 一次跑全部四项。任一 pass=false 就别录制。 */
    function all(opts = {}) {
        const pen = penetration(opts);
        const occ = occlusion(opts);
        const stand = visualStanding(opts);
        const comp = composition(opts);
        return {
            pass: pen.pass && occ.pass && stand.pass && comp.pass,
            penetration: pen,
            occlusion: occ,
            visualStanding: stand,
            composition: comp,
        };
    }

    window.__audit = { penetration, occlusion, visualStanding, composition, all, defaultActors };
    return "checks installed: __audit.{penetration,occlusion,visualStanding,composition,all}";
})();
