import { Box3 } from "three";

import { lowestBoneWorldY } from "@/actor/rigMetrics";
import type { ActorRuntime } from "@/actor/ActorRuntime";
import { measureModelBox } from "@/core/measureModelBox";
import type { SceneManager } from "@/core/SceneManager";
import type { Transform } from "@/core/SceneObject";

/** 非人偶的贴地余量:归一化后模型底部即实体原点,余量为 0。 */
const GROUND_OFFSET = 0;
const GROUND_ALIGNMENT_EPSILON_METERS = 0.0001;

/**
 * Runtime adapter that converts an evaluated pose's visual bounds into a serializable scene transform.
 *
 * It is invoked only by an explicit preset command, never by the render loop: pose switching therefore
 * remains grounded without turning per-frame bounds measurement into a performance cost.
 *
 * 人偶走骨骼度量而不是包围盒:armature 缩放型 rig 的蒙皮包围盒是壳层缩放的二次量,按它贴地会把人偶
 * 埋进地下(实测下沉 0.8 m)。人偶的接触面取「最低骨骼」,目标高度由 ActorRuntime 用 rest 余量折算。
 */
export class PoseGroundingService {
    private readonly bounds = new Box3();

    constructor(
        private readonly scene: SceneManager,
        private readonly actors: ActorRuntime,
    ) {}

    alignObjectToGround(objectId: string): Transform | null {
        const entity = this.scene.getEntity(objectId);
        const runtime = this.scene.getRuntime(objectId);
        if (!entity || !runtime) return null;
        const actorClearanceY = this.actors.groundTargetY(objectId);
        const contactY = actorClearanceY === null ? this.boundsContactY(runtime) : lowestBoneWorldY(runtime);
        if (contactY === null) return null;
        // 站面基准取实体自身高度而非世界 0:站在布景楼面/台面上的对象,换姿势贴地不得被拽回地面
        const baseY = entity.transform.position[1];
        const deltaY = baseY + (actorClearanceY ?? GROUND_OFFSET) - contactY;
        if (Math.abs(deltaY) < GROUND_ALIGNMENT_EPSILON_METERS) return null;
        const transform = entity.transform;
        return {
            position: [transform.position[0], transform.position[1] + deltaY, transform.position[2]],
            rotation: transform.rotation,
            scale: transform.scale,
        };
    }

    private boundsContactY(runtime: Parameters<typeof measureModelBox>[0]): number | null {
        measureModelBox(runtime, this.bounds);
        return this.bounds.isEmpty() || !Number.isFinite(this.bounds.min.y) ? null : this.bounds.min.y;
    }
}
