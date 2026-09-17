import { Raycaster, Vector3 } from "three";
import type { Intersection, Object3D } from "three";

import type { SceneManager } from "@/core/SceneManager";

/**
 * 向下吸附的抬升量:以基准高度(实体当前 y / 上一采样点 y)为起点向上抬这么多再向下看。
 * 2m 覆盖台面/舞台级高差,低于常见吊顶与楼座净高(≥2.5m)——楼座/室内下方拖动不会被吸到上层;
 * 更高的落差沿台阶连续爬升(基准逐点跟进)或先 Y 轴抬高再水平拖。
 */
const SNAP_LIFT_METERS = 2;
/** 可站面的法线朝上阈值:排除吊灯底、吊顶等朝下面(它们不是站面);约 60° 以内坡面仍可站立。 */
const UP_FACING_MIN = 0.5;
/** 无命中时的承接面高度:工作室地面不在实体树内,是唯一例外的解析兜底。 */
const GROUND_Y = 0;

const RAYCASTER = new Raycaster();
const DOWN: Vector3 = new Vector3(0, -1, 0);
const ORIGIN = new Vector3();
const TMP_NORMAL = new Vector3();
// three 的 intersectObjects 每次仍会为命中项分配小对象;复用结果数组只是压住外层数组的分配
const HITS: Intersection[] = [];

/** 递归收集可命中网格;helper 子树(包围框/坐标轴等编辑辅助物)整体跳过。 */
export function collectHitMeshes(root: Object3D, sink: Object3D[]): void {
    if (root.userData.helper === true) return;
    const candidate = root as { isMesh?: boolean; isSkinnedMesh?: boolean };
    if (candidate.isMesh === true || candidate.isSkinnedMesh === true) sink.push(root);
    for (const child of root.children) collectHitMeshes(child, sink);
}

/** 吸附候选快照:被拖实体自身排除(自吸附会把对象钉死在自己表面)。拖动/绘制起点采集一次,期间复用。 */
export function collectSurfaceSnapCandidates(manager: SceneManager, excludeId: string): Object3D[] {
    const sink: Object3D[] = [];
    for (const entity of manager.list()) {
        if (entity.id === excludeId) continue;
        const runtime = manager.getRuntime(entity.id);
        if (runtime) collectHitMeshes(runtime, sink);
    }
    return sink;
}

/** node 是否在 root 子树内(含自身);沿 parent 链递归,深度即场景树深度,零分配。 */
function isWithinSubtree(node: Object3D | null, root: Object3D): boolean {
    if (node === null) return false;
    if (node === root) return true;
    return isWithinSubtree(node.parent, root);
}

/**
 * 命中过滤:取第一个面朝上的站面命中;excludeRoot 子树内的命中整体跳过——
 * 共享候选池(播放贴地)可能含采样目标自身,实体不得站到自己头上(锁定人偶自吸附会逐帧错爬)。
 */
function firstUpFacingHit(hits: readonly Intersection[], excludeRoot: Object3D | null): Intersection | null {
    for (const hit of hits) {
        if (!hit.face) continue;
        if (excludeRoot !== null && isWithinSubtree(hit.object, excludeRoot)) continue;
        TMP_NORMAL.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (TMP_NORMAL.y > UP_FACING_MIN) return hit;
    }
    return null;
}

/**
 * 向下取站面:从 (x, y + SNAP_LIFT_METERS, z) 垂直向下,取第一个面朝上的命中高度。
 * 未命中 → GROUND_Y(演播室地面语义);命中朝下面(灯罩/吊顶下沿)不算站面,继续往下看。
 * 位置参数而非具名对象:帧级热路径,选项对象每次调用都是一笔分配(性能铁律优先于参数收敛规范)。
 */
export function snapDownToSurface(
    meshes: readonly Object3D[],
    x: number,
    y: number,
    z: number,
    excludeRoot: Object3D | null = null,
): number {
    ORIGIN.set(x, y + SNAP_LIFT_METERS, z);
    RAYCASTER.set(ORIGIN, DOWN);
    HITS.length = 0;
    // readonly → 可变断言:three 的签名要可变数组,intersectObjects 实际只读不写
    RAYCASTER.intersectObjects(meshes as Object3D[], false, HITS);
    const hit = firstUpFacingHit(HITS, excludeRoot);
    return hit === null ? GROUND_Y : hit.point.y;
}

/**
 * 指针射线取站面:沿给定射线(通常 setFromCamera 而来)取第一个面朝上的命中点,写入 out。
 * 走位起草/拖点用它替代「与 y=0 隐形平面求交」——布景地板不在 y=0 时,
 * 平面交点的 xz 与指针所指的可见地板存在视差错位,画出来的路径整体偏移(实测)。
 */
export function pickUpwardSurfacePoint(raycaster: Raycaster, meshes: readonly Object3D[], out: Vector3): boolean {
    HITS.length = 0;
    raycaster.intersectObjects(meshes as Object3D[], false, HITS);
    const hit = firstUpFacingHit(HITS, null);
    if (hit === null) return false;
    out.copy(hit.point);
    return true;
}
