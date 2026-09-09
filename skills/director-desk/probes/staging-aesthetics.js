/**
 * 布景美学审计 —— 依赖 geometry-audit.js + checks.js 先注入。
 *
 * 这些指标都是"看起来对不对"里可以算的那部分。凡能算的一律走这里,
 * 视觉复核只负责"好不好看"。实测视觉复核在下面每一项上都给过错误结论。
 */
(() => {
    const C = window.__auditCore;
    if (!C) throw new Error("先注入 geometry-audit.js");

    const ACTOR_RADIUS = 0.32;

    /**
     * 1) 绕行有效性 —— 回答"轨迹到底有没有在绕障碍物"。
     *
     * 这是最容易自欺的一项:轨迹有漂亮的 S 形摆动 ≠ 在绕障碍。实测把车道拉到 ±5.6
     * 而障碍留在 ±3.4 时,跑者依然左右摆动、`penetration` 全绿,但障碍根本不在路上,
     * 画面上就是"人在空地上莫名扭动"。
     *
     * 判定链:
     *  a. 基线 = 起点→终点直线。
     *  b. 对每个障碍算它到基线的横向距离 `lateral`。`lateral > 半宽 + 身体半径` 说明
     *     直线本来就撞不上它 → `needsDetour: false`,这个障碍是摆设,不计分。
     *  c. 对确实挡路的障碍,要求实际轨迹在其前后 6m 内的峰值偏离 > `半宽 + 身体半径`,
     *     且最小间隙 >= 0.85m。偏离不足 = 蹭着过去,视觉上不成立。
     *
     * `checked === 0` 不算通过 —— 那是"一个障碍都没挡路",布景本身失败。
     */
    function detourEffectiveness({ actors, t0 = 0, t1 = null, step = 0.15, window: win = 6 } = {}) {
        const dur = t1 ?? C.q("transport.get-state").durationSeconds;
        const ids = actors ?? window.__audit.defaultActors();
        const boxes = C.obstacles();
        const paths = Object.fromEntries(ids.map((id) => [id, []]));
        for (let t = t0; t <= dur + 1e-6; t += step) {
            C.seek(t);
            for (const id of ids) {
                const p = C.runtimePose(id);
                if (p) paths[id].push({ t: +t.toFixed(2), x: p.pos[0], z: p.pos[2] });
            }
        }
        const report = [];
        for (const id of ids) {
            const path = paths[id];
            if (path.length < 3) continue;
            const A = path[0];
            const B = path[path.length - 1];
            const dx = B.x - A.x;
            const dz = B.z - A.z;
            const L = Math.hypot(dx, dz) || 1;
            const nx = -dz / L;
            const nz = dx / L;
            for (const b of boxes) {
                const bx = (b.min[0] + b.max[0]) / 2;
                const bz = (b.min[2] + b.max[2]) / 2;
                const half = Math.max((b.max[0] - b.min[0]) / 2, (b.max[2] - b.min[2]) / 2);
                const lateral = Math.abs((bx - A.x) * nx + (bz - A.z) * nz);
                const along = ((bx - A.x) * dx + (bz - A.z) * dz) / L;
                if (along < 0 || along > L) continue;
                if (lateral >= half + ACTOR_RADIUS) continue; // 不挡路,是摆设
                let peak = 0;
                let gap = Infinity;
                let atT = null;
                for (const s of path) {
                    const sAlong = ((s.x - A.x) * dx + (s.z - A.z) * dz) / L;
                    if (Math.abs(sAlong - along) > win) continue;
                    const dev = Math.abs((s.x - A.x) * nx + (s.z - A.z) * nz);
                    if (dev > peak) {
                        peak = dev;
                        atT = s.t;
                    }
                    gap = Math.min(gap, C.pointBoxDistance([s.x, 0.9, s.z], b) - ACTOR_RADIUS);
                }
                report.push({
                    actor: id,
                    obstacle: b.id,
                    lateralFromLine: +lateral.toFixed(2),
                    peakDeviation: +peak.toFixed(2),
                    atT,
                    clearance: +gap.toFixed(2),
                    ok: peak > half + ACTOR_RADIUS && gap >= 0.85,
                });
            }
        }
        const failed = report.filter((r) => !r.ok);
        return { pass: report.length > 0 && failed.length === 0, checked: report.length, failed, all: report };
    }

    /**
     * 2) 曝光 —— 用像素直方图判定明暗,不问截图。
     *
     * 视觉复核对亮度的判读极不稳定:同一组灯下它把 meanLuma 215 的帧说成"整体偏暗",
     * 把 133 的帧说成"略偏亮"。直方图是客观的。
     *
     * 目标:`meanLuma` 100~150,`clippedPct < 1`。最亮两档合计 > 40% 就是过曝观感,
     * 最暗两档合计 > 50% 就是死黑。
     */
    async function exposure({ requestId = "expo-audit", sample = 16 } = {}) {
        C.d("capture.frame", { requestId });
        await new Promise((r) => setTimeout(r, 1200));
        const url = window.__directorDesk.ui.lastCaptureUrl;
        if (!url) return null;
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        const hist = new Array(16).fill(0);
        let sum = 0;
        let n = 0;
        let clipped = 0;
        let crushed = 0;
        for (let i = 0; i < data.length; i += 4 * sample) {
            const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            hist[Math.min(15, Math.floor(l / 16))]++;
            sum += l;
            n++;
            if (l > 250) clipped++;
            if (l < 6) crushed++;
        }
        const mean = sum / n;
        const pct = hist.map((h) => +((h / n) * 100).toFixed(1));
        const highEnd = pct[14] + pct[15];
        const lowEnd = pct[0] + pct[1];
        return {
            pass: mean >= 100 && mean <= 150 && (clipped / n) * 100 < 1 && highEnd < 40 && lowEnd < 50,
            meanLuma: +mean.toFixed(1),
            clippedPct: +((clipped / n) * 100).toFixed(2),
            crushedPct: +((crushed / n) * 100).toFixed(2),
            highEndPct: +highEnd.toFixed(1),
            lowEndPct: +lowEnd.toFixed(1),
            histogram: pct,
        };
    }

    /**
     * 2b) 主体曝光 —— 只在主体所在像素采样,**这是判定明暗的正确口径**。
     *
     * 全画幅 `exposure` 会被背景带偏:网格地板本身是深色,占 70~80% 画面,
     * 于是最暗两档恒为 80% 且加光完全不动(实测光强 ×2.5→×9,暗部占比一直 80.2%)。
     * 照着全画幅数字加光只会把主体打到过曝而背景依旧黑。
     *
     * 判定:主体均值 90~190,最暗采样 >= 40。
     */
    async function subjectExposure({ actors, patch = 21, requestId = "subject-expo" } = {}) {
        const ids = actors ?? window.__audit.defaultActors();
        const basis = C.cameraBasis();
        if (!basis) return null;
        const pts = [];
        for (const id of ids) {
            const p = C.runtimePose(id);
            if (!p) continue;
            for (const hy of [0.5, 1.0, 1.5]) {
                const n = C.project(basis, [p.pos[0], p.pos[1] + hy, p.pos[2]]);
                if (n && Math.abs(n.nx) <= 1 && Math.abs(n.ny) <= 1) pts.push({ id, nx: n.nx, ny: n.ny });
            }
        }
        if (!pts.length) return null;
        C.d("capture.frame", { requestId });
        await new Promise((r) => setTimeout(r, 1200));
        const url = window.__directorDesk.ui.lastCaptureUrl;
        if (!url) return null;
        const bmp = await createImageBitmap(await (await fetch(url)).blob());
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const samples = [];
        for (const q of pts) {
            const px = Math.round((q.nx * 0.5 + 0.5) * bmp.width);
            const py = Math.round((0.5 - q.ny * 0.5) * bmp.height);
            const x0 = Math.max(0, px - (patch >> 1));
            const y0 = Math.max(0, py - (patch >> 1));
            const d = ctx.getImageData(x0, y0, Math.min(patch, bmp.width - x0), Math.min(patch, bmp.height - y0)).data;
            let s = 0;
            let n = 0;
            for (let i = 0; i < d.length; i += 4) {
                s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
                n++;
            }
            samples.push({ id: q.id, luma: +(s / n).toFixed(1) });
        }
        const vals = samples.map((x) => x.luma);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        return {
            pass: mean >= 90 && mean <= 190 && Math.min(...vals) >= 40,
            subjectMeanLuma: +mean.toFixed(1),
            min: Math.min(...vals),
            max: Math.max(...vals),
            samples,
        };
    }

    /**
     * 3) 灯光朝向 —— 光轴本地是 -Z,由实体 rotation 决定,**不会自动指向场景中心**。
     *
     * 这是最隐蔽的坑:16 盏灯全部 `rotation: [0,0,0]` 时,挂在 11m 高的聚光是水平射出的,
     * 跑道上一点没照到。表现为"怎么加灯都还是暗",查 intensity 永远查不出来。
     *
     * `aimAt` 反解 rotation:yaw = atan2(-dx, -dz),pitch = asin(dy)。
     */
    function aimAt(id, point) {
        const e = (C.q("scene.describe") ?? []).find((x) => x.id === id);
        if (!e) return { ok: false, reason: `实体 ${id} 不存在` };
        const p = e.transform.position;
        const d = [point[0] - p[0], point[1] - p[1], point[2] - p[2]];
        const l = Math.hypot(...d) || 1;
        const n = [d[0] / l, d[1] / l, d[2] / l];
        const yaw = Math.atan2(-n[0], -n[2]);
        const pitch = Math.asin(Math.max(-1, Math.min(1, n[1])));
        const r = C.d("object.move", {
            id,
            transform: { position: p, rotation: [pitch, yaw, 0], scale: e.transform.scale },
        });
        return { ok: r.ok, yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) };
    }

    /** 报出所有 rotation 全零的灯 —— 它们的光轴都朝 -Z 水平,几乎肯定是漏设朝向。 */
    function unaimedLights() {
        return (C.q("lighting.list") ?? [])
            .filter((e) => e.light.type !== "point") // point 无方向,不需要朝向
            .filter((e) => e.transform.rotation.every((r) => Math.abs(r) < 1e-6))
            .map((e) => ({ id: e.id, type: e.light.type, position: e.transform.position }));
    }

    /** 按系数整体缩放光强。求曝光解时二分这个系数,不要逐盏手调。 */
    function scaleIntensity(factor, baseline) {
        let n = 0;
        for (const e of C.q("lighting.list") ?? []) {
            const base = baseline?.[e.id] ?? e.light.intensity;
            const next = { ...e.light, intensity: Math.max(0.01, +(base * factor).toFixed(2)) };
            if (C.d("light.adjust", { id: e.id, light: next }).ok) n++;
        }
        return n;
    }

    /** 快照当前光强,作为 scaleIntensity 的 baseline(否则反复缩放会指数衰减)。 */
    function intensityBaseline() {
        return Object.fromEntries((C.q("lighting.list") ?? []).map((e) => [e.id, e.light.intensity]));
    }

    /**
     * 4) 三点照明几何 —— key/fill 方位夹角、明暗比、色温分离度。
     * 经典值:夹角 90~135°,明暗比 2:1(低反差)~8:1(戏剧),暖冷分离 > 0.2。
     */
    function lightingRatio({ keyId = "key-light", fillId = "fill-light", subject = [0, 1, 0] } = {}) {
        const list = C.q("lighting.list") ?? [];
        const key = list.find((e) => e.id === keyId);
        const fill = list.find((e) => e.id === fillId);
        if (!key || !fill) return null;
        const azimOf = (e) => {
            const d = C.vec.norm(C.vec.sub(e.transform.position, subject));
            return { azim: (Math.atan2(d[0], d[2]) * 180) / Math.PI, elev: (Math.asin(d[1]) * 180) / Math.PI };
        };
        const gk = azimOf(key);
        const gf = azimOf(fill);
        let sep = Math.abs(gk.azim - gf.azim);
        if (sep > 180) sep = 360 - sep;
        const warmth = (hex) => {
            const [r, , b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
            return r - b;
        };
        const ratio = key.light.intensity / Math.max(fill.light.intensity, 0.01);
        return {
            pass: sep >= 90 && sep <= 135 && ratio >= 2 && ratio <= 8,
            keyFillAngle: +sep.toFixed(1),
            keyElevation: +gk.elev.toFixed(1),
            ratio: +ratio.toFixed(2),
            stops: +Math.log2(ratio).toFixed(2),
            warmthSeparation: +(warmth(key.light.color) - warmth(fill.light.color)).toFixed(3),
        };
    }

    window.__staging = {
        detourEffectiveness,
        exposure,
        subjectExposure,
        aimAt,
        unaimedLights,
        scaleIntensity,
        intensityBaseline,
        lightingRatio,
    };
    return "staging installed: __staging.{detourEffectiveness,subjectExposure,exposure,aimAt,unaimedLights,scaleIntensity,intensityBaseline,lightingRatio}";
})();
