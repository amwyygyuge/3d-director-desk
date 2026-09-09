/**
 * 导演台几何审计探针 —— 在页面里注入一次,之后所有"穿模 / 遮挡 / 构图"判定都用数值,不问截图。
 *
 * 用法(浏览器驱动侧):
 *   await tab.evaluate(await Bun.file("skills/director-desk/probes/geometry-audit.js").text());
 *   const r = JSON.parse(await tab.evaluate(`JSON.stringify(__audit.penetration({ step: 0.1 }))`));
 *
 * 前置:页面已有 window.__directorDesk。脚本自带 __d / __q 兜底封装。
 *
 * 设计前提(踩过的坑,别改):
 *  - 包围盒必须从 three 运行时现算。`scene.describe` 的 bounds 在 object.move 改 scale 后不刷新。
 *  - 位姿必须读 `getRuntime(id).position`。实体 transform 是作者态,时间轴采样不写回去。
 *  - 相机位姿用 `camera.get-pose` 的 motionSampled(运镜期望值),与渲染帧时序无关。
 */
(() => {
    const desk = window.__directorDesk;
    if (!desk) throw new Error("__directorDesk 不存在:页面未就绪或不是 playground");

    const d = (type, payload = {}) => desk.dispatcher.dispatch({ type, payload }, desk);
    const q = (type, payload = {}) => {
        const r = desk.dispatcher.query({ type, payload }, desk);
        return r.ok ? r.value : null;
    };

    // ---------- 向量基元 ----------
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const len = (a) => Math.hypot(a[0], a[1], a[2]);
    const norm = (a) => {
        const l = len(a) || 1;
        return [a[0] / l, a[1] / l, a[2] / l];
    };

    // ---------- 场景采样 ----------
    const seek = (t) => d("transport.seek", { time: +t.toFixed(3) });

    /** 运行时世界位姿。走位轨驱动的是运行时,不是实体 transform。 */
    function runtimePose(id) {
        const rt = desk.scene.manager.getRuntime(id);
        if (!rt) return null;
        return { pos: [rt.position.x, rt.position.y, rt.position.z], yaw: rt.rotation.y };
    }

    /** 从 three 运行时现算世界 AABB。绝不用 scene.describe 的 bounds。 */
    function worldAabb(id) {
        const rt = desk.scene.manager.getRuntime(id);
        if (!rt) return null;
        let min = [Infinity, Infinity, Infinity];
        let max = [-Infinity, -Infinity, -Infinity];
        rt.updateWorldMatrix(true, true);
        rt.traverse((o) => {
            if (!o.geometry) return;
            if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
            const bb = o.geometry.boundingBox;
            for (let i = 0; i < 8; i++) {
                const v = new o.position.constructor(
                    i & 1 ? bb.max.x : bb.min.x,
                    i & 2 ? bb.max.y : bb.min.y,
                    i & 4 ? bb.max.z : bb.min.z,
                ).applyMatrix4(o.matrixWorld);
                min = [Math.min(min[0], v.x), Math.min(min[1], v.y), Math.min(min[2], v.z)];
                max = [Math.max(max[0], v.x), Math.max(max[1], v.y), Math.max(max[2], v.z)];
            }
        });
        return Number.isFinite(min[0]) ? { id, min, max } : null;
    }

    /** 障碍物集合:默认取 id 前缀匹配的 scenery。 */
    function obstacles(pattern = /^(obs|deco|prop)-/) {
        return (q("scene.describe") ?? [])
            .filter((e) => pattern.test(e.id))
            .map((e) => worldAabb(e.id))
            .filter(Boolean);
    }

    // ---------- 几何判定 ----------
    /** 点到 AABB 的最短距离。0 = 点在盒内。 */
    function pointBoxDistance(p, box) {
        const dx = Math.max(box.min[0] - p[0], 0, p[0] - box.max[0]);
        const dy = Math.max(box.min[1] - p[1], 0, p[1] - box.max[1]);
        const dz = Math.max(box.min[2] - p[2], 0, p[2] - box.max[2]);
        return Math.hypot(dx, dy, dz);
    }

    /** 线段 a→b 与 AABB 相交(slab 法)。相机→主体命中即遮挡。 */
    function segmentHitsBox(a, b, box) {
        let t0 = 0;
        let t1 = 1;
        const dir = sub(b, a);
        for (let i = 0; i < 3; i++) {
            if (Math.abs(dir[i]) < 1e-9) {
                if (a[i] < box.min[i] || a[i] > box.max[i]) return false;
                continue;
            }
            let lo = (box.min[i] - a[i]) / dir[i];
            let hi = (box.max[i] - a[i]) / dir[i];
            if (lo > hi) [lo, hi] = [hi, lo];
            t0 = Math.max(t0, lo);
            t1 = Math.min(t1, hi);
            if (t0 > t1) return false;
        }
        return true;
    }

    /** 相机基与投影。nx/ny 是 NDC,|v| <= 1 在画内。 */
    function cameraBasis(aspect = 16 / 9) {
        const pose = q("camera.get-pose");
        const p = pose && pose.motionSampled;
        if (!p) return null;
        const dir = norm(sub(p.target, p.position));
        const right = norm(cross(dir, [0, 1, 0]));
        const up = cross(right, dir);
        const tanV = Math.tan((p.fov * Math.PI) / 360);
        return { cam: p.position, dir, right, up, tanV, tanH: tanV * aspect, fov: p.fov };
    }

    function project(basis, world) {
        const rel = sub(world, basis.cam);
        const z = dot(rel, basis.dir);
        if (z <= 0.2) return null; // 在相机背后或贴脸
        return { nx: dot(rel, basis.right) / z / basis.tanH, ny: dot(rel, basis.up) / z / basis.tanV, z };
    }

    window.__auditCore = {
        d,
        q,
        seek,
        runtimePose,
        worldAabb,
        obstacles,
        pointBoxDistance,
        segmentHitsBox,
        cameraBasis,
        project,
        vec: { sub, dot, cross, len, norm },
    };
    return "geometry-audit core installed";
})();
