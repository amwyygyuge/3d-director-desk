import { Raycaster, Vector3 } from "three";
import type { Object3D } from "three";

import type { Transform, Vec3 } from "@/core/SceneObject";
import { HOME_DIRECTOR_POSE } from "@/store/CameraStore";
import type { DirectorDeskStores } from "@/ui/shell/DirectorDeskContext";

/** 未命中任何表面时,落相机前方这段距离的地面上。 */
const FALLBACK_DISTANCE_METERS = 4;
/** 地面基准:工作室地面(y=0)是唯一不进实体树的承接面,命中它用解析求交而不是放一块网格进树。 */
const GROUND_Y = 0;
/** 视线下俯角下限:接近平视时与地面的交点远到失去「视野中心」语义,改走固定距离兜底。 */
const MIN_DOWNWARD_SLOPE = 0.02;

const RAYCASTER = new Raycaster();
const ORIGIN = new Vector3();
const FORWARD = new Vector3();

/** 递归收集可命中网格;helper 子树(包围框/坐标轴等编辑辅助物)整体跳过。 */
function collectHitMeshes(root: Object3D, sink: Object3D[]): void {
    if (root.userData.helper === true) return;
    const candidate = root as { isMesh?: boolean; isSkinnedMesh?: boolean };
    if (candidate.isMesh === true || candidate.isSkinnedMesh === true) sink.push(root);
    for (const child of root.children) collectHitMeshes(child, sink);
}

/**
 * 视角中心落位解析器(无状态领域服务):把「放到场景里」对齐到「我正在看哪里」。
 *
 * 取代黄金角螺旋的理由:螺旋以世界原点为中心固定扩散,布景(整间屋子/整条街)进场后,
 * 固定落点必埋进墙体与地板之下,作者放进去的第一眼找不到自己的东西。
 *
 * 命中链:视线中心射线 → 最近实体表面(布景/道具,含锁定布景——锁定只挡人手不挡射线语义)
 * → y=0 地面解析交点 → 相机前方 4 米地面。落点 y 即表面高度,模型归一化底部贴实体原点,
 * 人偶原点在脚底,两者都天然「站在命中面上」。
 */
export class ViewPlacementResolver {
    resolve(stores: DirectorDeskStores): Transform {
        const pose = stores.camera.lastDirectorPose ?? HOME_DIRECTOR_POSE;
        ORIGIN.set(pose.position[0], pose.position[1], pose.position[2]);
        FORWARD.set(
            pose.target[0] - pose.position[0],
            pose.target[1] - pose.position[1],
            pose.target[2] - pose.position[2],
        );
        // 防御 position≈target 的退化位姿:退化为正前方,保证兜底链有方向可用
        if (FORWARD.lengthSq() === 0) FORWARD.set(0, 0, -1);
        FORWARD.normalize();
        RAYCASTER.set(ORIGIN, FORWARD);

        const meshes: Object3D[] = [];
        for (const entity of stores.scene.manager.list()) {
            const runtime = stores.scene.manager.getRuntime(entity.id);
            if (runtime) collectHitMeshes(runtime, meshes);
        }
        const hit = RAYCASTER.intersectObjects(meshes, false)[0];
        return {
            position: hit ? [hit.point.x, hit.point.y, hit.point.z] : this.groundFallback(),
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
        };
    }

    /** 地面解析交点;朝天或平视时退固定距离。 */
    private groundFallback(): Vec3 {
        const groundT = (GROUND_Y - ORIGIN.y) / FORWARD.y;
        if (FORWARD.y < -MIN_DOWNWARD_SLOPE && groundT > 0) {
            return [ORIGIN.x + FORWARD.x * groundT, GROUND_Y, ORIGIN.z + FORWARD.z * groundT];
        }
        return [
            ORIGIN.x + FORWARD.x * FALLBACK_DISTANCE_METERS,
            GROUND_Y,
            ORIGIN.z + FORWARD.z * FALLBACK_DISTANCE_METERS,
        ];
    }
}

/** 无状态服务的共享实例:解析只读 stores,不持任何每桌状态。 */
export const viewPlacement = new ViewPlacementResolver();
